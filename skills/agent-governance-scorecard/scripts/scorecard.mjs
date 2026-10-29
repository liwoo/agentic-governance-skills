#!/usr/bin/env node
// agent-governance-scorecard — zero-dependency helper for the skill.
//
//   scorecard.mjs discover [root]            index the codebase  → .governance-scorecard/discovery.json
//   scorecard.mjs template [root]            report skeleton     → .governance-scorecard/report.json
//   scorecard.mjs validate <report.json>     check the report is complete and well-formed
//   scorecard.mjs render   <report.json>     score it            → scorecard.json + scorecard.html
//
// Options: --out <dir|file>  --root <repo>  --link-base <url>  --fail-under <0-100>

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { checkIndex, loadCatalog } from "./lib/catalog.mjs";
import { discover, summarize } from "./lib/discover.mjs";
import { renderHtml } from "./lib/html.mjs";
import { scoreReport, validateReport } from "./lib/report.mjs";

const OUT_DIR = ".governance-scorecard";

function parseArgs(argv) {
  const positional = [];
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) options[key] = true;
      else options[key] = argv[++i];
    } else positional.push(arg);
  }
  return { positional, options };
}

async function writeOut(path, content) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
  return path;
}

const show = (path) => relative(process.cwd(), path) || path;

async function readReport(path) {
  if (!path) throw new UsageError("Pass the report path, e.g. `.governance-scorecard/report.json`.");
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new UsageError(`Could not read ${path}: ${error.message}`);
  }
}

function printValidation({ errors, warnings }) {
  for (const w of warnings) console.error(`  ! ${w}`);
  for (const e of errors) console.error(`  ✗ ${e}`);
}

class UsageError extends Error {}

const commands = {
  async discover({ positional, options }) {
    const root = resolve(positional[0] ?? options.root ?? ".");
    const index = await discover(root);
    const out = resolve(options.out ?? join(root, OUT_DIR, "discovery.json"));
    await writeOut(out, `${JSON.stringify(index, null, 2)}\n`);
    console.log(summarize(index));
    console.log(`\n→ ${show(out)}`);
  },

  async template({ positional, options }) {
    const root = resolve(positional[0] ?? options.root ?? ".");
    const out = resolve(options.out ?? join(root, OUT_DIR, "report.json"));
    if (existsSync(out) && !options.force) throw new UsageError(`${show(out)} already exists. Pass --force to overwrite.`);
    const catalog = loadCatalog();
    const skeleton = {
      schemaVersion: 1,
      catalogVersion: catalog.catalogVersion,
      assessedAt: new Date().toISOString(),
      assessor: "",
      project: { name: basename(root), summary: "", languages: [], frameworks: [], commit: "" },
      agents: [{ name: "", entrypoint: "path/to/file.py:1", description: "" }],
      consequentialActions: [{ name: "", effect: "money | data | communication | access | code-execution | other", location: "path:line", note: "" }],
      checks: catalog.rooms.flatMap((room) =>
        room.checks.map((check) => ({
          id: check.id,
          status: null,
          confidence: "medium",
          finding: "",
          evidence: [],
          fix: { summary: "", steps: [], files: [] },
        })),
      ),
      notes: [],
    };
    await writeOut(out, `${JSON.stringify(skeleton, null, 2)}\n`);
    console.log(`Report skeleton with ${skeleton.checks.length} checks → ${show(out)}`);
  },

  async validate({ positional, options }) {
    const path = positional[0];
    const report = await readReport(path);
    const root = resolve(options.root ?? dirname(dirname(resolve(path))));
    const result = validateReport(report, { root });
    printValidation(result);
    if (result.errors.length) {
      console.error(`\n✗ ${result.errors.length} error(s). Fix them and run validate again.`);
      process.exitCode = 1;
      return;
    }
    console.log(`✓ Report is valid (${report.checks.length} checks${result.warnings.length ? `, ${result.warnings.length} warning(s)` : ""}).`);
  },

  async render({ positional, options }) {
    const path = positional[0];
    const report = await readReport(path);
    const root = resolve(options.root ?? dirname(dirname(resolve(path))));
    const result = validateReport(report, { root });
    printValidation(result);
    if (result.errors.length) {
      console.error(`\n✗ Not rendering: ${result.errors.length} error(s).`);
      process.exitCode = 1;
      return;
    }
    const scored = scoreReport(report);
    const outDir = resolve(options.out ?? dirname(resolve(path)));
    const index = checkIndex();
    const jsonOut = await writeOut(
      join(outDir, "scorecard.json"),
      `${JSON.stringify(
        {
          ...report,
          scores: scored,
          fixFirst: scored.fixOrder.map((id) => ({ id, title: index.get(id).check.title, status: report.checks.find((c) => c.id === id).status })),
        },
        null,
        2,
      )}\n`,
    );
    const htmlOut = await writeOut(join(outDir, "scorecard.html"), renderHtml(report, scored, { linkBase: options["link-base"] }));

    console.log(`Overall ${scored.overall.score ?? "—"}/100 · ${scored.overall.band.label}`);
    for (const room of scored.rooms) console.log(`  ${room.id.padEnd(12)} ${String(room.score ?? "—").padStart(3)}  ${room.band.label}`);
    console.log(`\n→ ${show(htmlOut)}\n→ ${show(jsonOut)}`);

    const floor = options["fail-under"] !== undefined ? Number(options["fail-under"]) : null;
    if (floor !== null && (scored.overall.score ?? 0) < floor) {
      console.error(`✗ Overall score ${scored.overall.score} is below --fail-under ${floor}.`);
      process.exitCode = 2;
    }
  },
};

const { positional, options } = parseArgs(process.argv.slice(2));
const command = positional.shift();
if (!commands[command]) {
  console.log(`Usage: scorecard.mjs <discover|template|validate|render> [path] [--out …] [--root …] [--link-base …] [--fail-under N]`);
  process.exit(command ? 1 : 0);
}
try {
  await commands[command]({ positional, options });
} catch (error) {
  if (!(error instanceof UsageError)) throw error;
  console.error(`✗ ${error.message}`);
  process.exit(1);
}
