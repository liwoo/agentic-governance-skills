// Build a reading index for the assessor: where each room's concepts appear in the codebase.
// Keyword hits are leads to read, never verdicts. Snippets are redacted for likely secrets.

import { readdir, readFile, stat } from "node:fs/promises";
import { basename, extname, join, relative, resolve, sep } from "node:path";
import { loadCatalog, skillRoot } from "./catalog.mjs";

const SKIP_DIRS = new Set([
  ".git", ".hg", ".svn", "node_modules", ".venv", "venv", "env", ".env", "__pycache__", ".mypy_cache",
  ".pytest_cache", ".ruff_cache", ".tox", ".nox", "site-packages", "dist", "build", "out", ".next", ".nuxt",
  ".turbo", ".cache", "target", "bin", "obj", "vendor", "coverage", ".coverage", ".idea", ".vscode",
  ".terraform", ".serverless", ".parcel-cache", ".svelte-kit", "agent-governance-scorecard", ".governance-scorecard",
]);
const CODE_EXT = new Set([
  ".py", ".pyi", ".ipynb", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".cs", ".go", ".java", ".kt",
  ".rb", ".rs", ".php", ".swift", ".scala", ".sql", ".sh",
]);
const CONFIG_EXT = new Set([".yaml", ".yml", ".toml", ".json", ".ini", ".cfg", ".tf", ".bicep", ".xml", ".csproj", ".env.example"]);
const DOC_EXT = new Set([".md", ".mdx", ".rst", ".txt"]);
const MANIFESTS = new Set([
  "pyproject.toml", "requirements.txt", "requirements-dev.txt", "setup.py", "setup.cfg", "Pipfile", "poetry.lock",
  "uv.lock", "package.json", "go.mod", "Cargo.toml", "pom.xml", "build.gradle", "Gemfile", "environment.yml",
]);
const SKIP_FILES = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|poetry\.lock|uv\.lock|Cargo\.lock|governance-scorecard[^/]*)$|\.min\.(js|css)$/;
const MAX_FILE_BYTES = 512 * 1024;
const MAX_FILES = 25_000;

const TEST_PATH = /(^|\/)(tests?|__tests__|spec|specs|evals?)\/|(^|\/)test_[^/]+$|_test\.[a-z]+$|\.(test|spec)\.[a-z]+$/i;
const CI_PATH = /(^|\/)(\.github\/workflows\/|\.gitlab-ci\.ya?ml$|azure-pipelines[^/]*\.ya?ml$|\.circleci\/|Jenkinsfile$|\.buildkite\/)/;

export function kindOf(path) {
  if (CI_PATH.test(path)) return "ci";
  if (TEST_PATH.test(path)) return "test";
  const ext = extname(path).toLowerCase();
  if (DOC_EXT.has(ext)) return "doc";
  if (CODE_EXT.has(ext)) return "code";
  return "config";
}

const SECRETISH = [
  /\b(sk|pk|rk)-[A-Za-z0-9_-]{12,}/g,
  /\b(ghp|gho|ghs|github_pat)_[A-Za-z0-9_]{12,}/g,
  /\bAKIA[0-9A-Z]{12,}/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g,
  /(["'`])[A-Za-z0-9+/=_-]{24,}\1/g,
];
export function redact(text) {
  let out = text;
  for (const pattern of SECRETISH) out = out.replace(pattern, "«redacted»");
  out = out.replace(/((?:secret|password|passwd|token|api[_-]?key|private[_-]?key)\s*[:=]\s*)(["'`]?)[^\s"'`,;]{6,}\2/gi, "$1«redacted»");
  return out.length > 220 ? `${out.slice(0, 217)}…` : out;
}

const compile = (patterns) => new RegExp(patterns.map((p) => `(?:${p})`).join("|"), "i");

async function* walk(root, dir = root) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name) || full === skillRoot) continue;
      yield* walk(root, full);
    } else if (entry.isFile()) {
      yield full;
    }
  }
}

export async function discover(rootArg, { maxSamples = 40, maxFilesPerRoom = 25 } = {}) {
  const root = resolve(rootArg);
  const { discovery, rooms } = loadCatalog();
  const roomRegex = Object.fromEntries(Object.entries(discovery.concepts).map(([room, p]) => [room, compile(p)]));
  const toolRegex = compile(discovery.toolPatterns);
  const consequentialRegex = compile(discovery.consequentialPatterns);
  const frameworkRegex = Object.fromEntries(Object.entries(discovery.frameworkPatterns).map(([name, p]) => [name, compile(p)]));

  const result = {
    root,
    generatedAt: new Date().toISOString(),
    note: "Keyword index only. Every lead must be confirmed by reading the code before it counts as evidence.",
    files: { scanned: 0, skipped: 0, byKind: {}, byExtension: {} },
    manifests: [],
    ci: [],
    tests: [],
    frameworks: {},
    tools: [],
    consequential: [],
    rooms: Object.fromEntries(rooms.map((r) => [r.id, { files: {}, samples: [] }])),
  };

  for await (const full of walk(root)) {
    const path = relative(root, full).split(sep).join("/");
    if (SKIP_FILES.test(path)) continue;
    const ext = extname(path).toLowerCase() || basename(path);
    const isManifest = MANIFESTS.has(basename(path)) || ext === ".csproj";
    if (!isManifest && !CODE_EXT.has(ext) && !CONFIG_EXT.has(ext) && !DOC_EXT.has(ext) && basename(path) !== "Dockerfile") continue;
    if (result.files.scanned >= MAX_FILES) {
      result.files.skipped++;
      continue;
    }
    const info = await stat(full);
    if (info.size > MAX_FILE_BYTES) {
      result.files.skipped++;
      continue;
    }
    const content = await readFile(full, "utf8");
    if (content.includes("\u0000")) continue;

    const kind = kindOf(path);
    result.files.scanned++;
    result.files.byKind[kind] = (result.files.byKind[kind] ?? 0) + 1;
    result.files.byExtension[ext] = (result.files.byExtension[ext] ?? 0) + 1;
    if (isManifest) result.manifests.push(path);
    if (kind === "ci") result.ci.push(path);
    if (kind === "test") result.tests.push(path);

    if (kind !== "doc") {
      for (const [name, regex] of Object.entries(frameworkRegex)) {
        if (regex.test(content)) (result.frameworks[name] ??= []).length < 8 && result.frameworks[name].push(path);
      }
    }

    const lines = content.split(/\r?\n/);
    lines.forEach((raw, i) => {
      if (raw.length > 2000) return;
      const line = i + 1;
      const text = redact(raw.trim());
      if (kind !== "doc" && toolRegex.test(raw) && result.tools.length < 300) result.tools.push({ path, line, text });
      if ((kind === "code" || kind === "config") && consequentialRegex.test(raw) && result.consequential.length < 300) {
        result.consequential.push({ path, line, text });
      }
      for (const [room, regex] of Object.entries(roomRegex)) {
        if (!regex.test(raw)) continue;
        const bucket = result.rooms[room];
        const file = (bucket.files[path] ??= { path, kind, hits: 0, firstLine: line });
        file.hits++;
        if (bucket.samples.length < maxSamples * 4) bucket.samples.push({ path, line, kind, text });
      }
    });
  }

  // Rank files per room (code and tests before docs) and keep a bounded, diverse sample set.
  const kindRank = { code: 0, test: 1, config: 2, ci: 3, doc: 4 };
  for (const bucket of Object.values(result.rooms)) {
    const files = Object.values(bucket.files).sort((a, b) => kindRank[a.kind] - kindRank[b.kind] || b.hits - a.hits);
    bucket.fileCount = files.length;
    bucket.files = files.slice(0, maxFilesPerRoom);
    const perFile = new Map();
    bucket.samples = bucket.samples
      .sort((a, b) => kindRank[a.kind] - kindRank[b.kind])
      .filter((s) => {
        const n = perFile.get(s.path) ?? 0;
        perFile.set(s.path, n + 1);
        return n < 3;
      })
      .slice(0, maxSamples);
  }
  result.tests = result.tests.slice(0, 200);
  return result;
}

export function summarize(index) {
  const lines = [
    `Scanned ${index.files.scanned} files under ${index.root} (${Object.entries(index.files.byKind).map(([k, n]) => `${n} ${k}`).join(", ")}).`,
    `Frameworks: ${Object.keys(index.frameworks).join(", ") || "none detected"}.`,
    `Tool definitions: ${index.tools.length}${index.tools.length >= 300 ? "+" : ""} · consequential-action leads: ${index.consequential.length}${index.consequential.length >= 300 ? "+" : ""} · tests: ${index.tests.length} · CI files: ${index.ci.length}.`,
    "Room concept leads (files):",
    ...Object.entries(index.rooms).map(([room, b]) => `  ${room.padEnd(12)} ${String(b.fileCount).padStart(4)}  ${b.files.slice(0, 3).map((f) => f.path).join(", ")}`),
  ];
  return lines.join("\n");
}
