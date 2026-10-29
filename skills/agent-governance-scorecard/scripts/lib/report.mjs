// Validate an assessor-written report against the catalogue, then score it.
//
// Scope comes first: the report's `profile` answers a few yes/no traits about the agent
// (with evidence), and each room and check declares which traits make it apply. Checks
// that don't apply are left out of the score, so an agent is never marked down for a
// control it has no use for.

import { existsSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { checkIndex, loadCatalog } from "./catalog.mjs";

export const SCHEMA_VERSION = 2;
export const STATUSES = ["present", "partial", "missing", "not_applicable", "unknown"];
const POINTS = { present: 1, partial: 0.5, missing: 0, unknown: 0 };
const CONFIDENCE = ["high", "medium", "low"];
export const SEVERITIES = ["critical", "high", "medium", "low"];
// Effects that make an action consequential by definition.
const CONSEQUENTIAL_EFFECTS = ["money", "communication", "access", "code-execution"];

// Severity is the assessor's judgement of harm for *this* agent; default from the catalogue priority.
export const severityOf = (entry, check) => entry.severity ?? (check.priority ? "high" : "medium");

const isText = (v) => typeof v === "string" && v.trim().length > 0;

// ── Scope ────────────────────────────────────────────────────────────────────

export function traitValues(report) {
  const traits = report?.profile?.traits ?? {};
  return Object.fromEntries(loadCatalog().traits.map((t) => [t.id, traits[t.id]?.value]));
}

function applies(list, values) {
  return !list || list.some((id) => values[id] === true);
}

// For every room and check: does it apply to this agent, and if not, which false traits rule it out.
export function relevance(report) {
  const catalog = loadCatalog();
  const values = traitValues(report);
  const rooms = new Map();
  const checks = new Map();
  for (const room of catalog.rooms) {
    const roomApplies = applies(room.relevantWhen, values);
    rooms.set(room.id, { applies: roomApplies, because: roomApplies ? [] : room.relevantWhen });
    for (const check of room.checks) {
      const ok = roomApplies && applies(check.appliesWhen, values);
      checks.set(check.id, { applies: ok, because: ok ? [] : roomApplies ? check.appliesWhen : room.relevantWhen });
    }
  }
  return { rooms, checks };
}

export function validateProfile(report) {
  const errors = [];
  const warnings = [];
  const { traits } = loadCatalog();
  const given = report?.profile?.traits;
  if (!given || typeof given !== "object") {
    return { errors: ["profile.traits is required. Answer each trait in references/assessment-method.md before assessing checks."], warnings };
  }
  for (const trait of traits) {
    const where = `profile.traits.${trait.id}`;
    const answer = given[trait.id];
    if (typeof answer?.value !== "boolean") {
      errors.push(`${where}.value must be true or false. ${trait.question}`);
      continue;
    }
    if (!isText(answer.reason)) {
      errors.push(`${where}.reason is required. ${answer.value ? "Say what the agent does." : "Say what you searched for and didn't find."}`);
    }
    if (answer.value && !(answer.evidence?.length > 0)) errors.push(`${where} is true, so it needs at least one evidence item.`);
  }
  for (const trait of traits) {
    if (given[trait.id]?.value !== true) continue;
    for (const dep of trait.implies) {
      if (given[dep]?.value === false) errors.push(`profile.traits.${trait.id} is true, so ${dep} must be true as well.`);
    }
  }
  const listed = (report.consequentialActions ?? []).filter((a) => CONSEQUENTIAL_EFFECTS.includes(a.effect));
  if (listed.length && given.consequential?.value === false) {
    errors.push(`consequentialActions lists ${listed.map((a) => a.name).join(", ")}, but profile.traits.consequential is false.`);
  }
  if (given.acts?.value === false && (report.consequentialActions ?? []).length) {
    warnings.push("consequentialActions is not empty, but profile.traits.acts is false. Check the profile.");
  }
  return { errors, warnings };
}

// ── Validation ───────────────────────────────────────────────────────────────

export function validateReport(report, { root } = {}) {
  const errors = [];
  const warnings = [];
  const catalog = loadCatalog();
  const index = checkIndex(catalog);

  if (!report || typeof report !== "object") return { errors: ["Report must be a JSON object."], warnings };
  if (report.schemaVersion !== SCHEMA_VERSION) errors.push(`schemaVersion must be ${SCHEMA_VERSION}.`);
  if (!isText(report.project?.name)) errors.push("project.name is required.");
  if (!isText(report.project?.summary)) errors.push("project.summary is required: one or two sentences on what the agent does.");
  if (!Array.isArray(report.checks)) errors.push("checks must be an array.");
  if (report.consequentialActions !== undefined && !Array.isArray(report.consequentialActions)) {
    errors.push("consequentialActions must be an array when present.");
  }

  const profile = validateProfile(report);
  errors.push(...profile.errors);
  warnings.push(...profile.warnings);
  if (profile.errors.length) return { errors, warnings };

  const scope = relevance(report);
  const seen = new Set();
  for (const [i, entry] of (report.checks ?? []).entries()) {
    const where = `checks[${i}]${entry?.id ? ` (${entry.id})` : ""}`;
    if (!index.has(entry?.id)) {
      errors.push(`${where}: unknown check id. Use ids from references/catalog.json, e.g. "permission/atomic-consumption".`);
      continue;
    }
    if (seen.has(entry.id)) errors.push(`${where}: duplicate check id.`);
    seen.add(entry.id);
    if (!scope.checks.get(entry.id).applies) {
      warnings.push(`${where}: doesn't apply to this agent (${scope.checks.get(entry.id).because.join(" / ")} is false), so it's ignored. Run \`scope\` to tidy the report.`);
      continue;
    }

    if (!STATUSES.includes(entry.status)) {
      errors.push(`${where}: status must be one of ${STATUSES.join(", ")}.`);
      continue;
    }
    if (entry.confidence !== undefined && !CONFIDENCE.includes(entry.confidence)) {
      errors.push(`${where}: confidence must be one of ${CONFIDENCE.join(", ")}.`);
    }
    if (entry.severity !== undefined && !SEVERITIES.includes(entry.severity)) {
      errors.push(`${where}: severity must be one of ${SEVERITIES.join(", ")}.`);
    }
    const evidence = entry.evidence ?? [];
    if (!Array.isArray(evidence)) errors.push(`${where}: evidence must be an array.`);

    switch (entry.status) {
      case "not_applicable":
        if (!isText(entry.reason)) errors.push(`${where}: not_applicable needs a reason.`);
        break;
      case "unknown":
        if (!isText(entry.question)) errors.push(`${where}: unknown needs a question for the team.`);
        break;
      default:
        if (!isText(entry.finding)) errors.push(`${where}: finding is required.`);
    }
    if (["present", "partial"].includes(entry.status) && evidence.length === 0) {
      errors.push(`${where}: ${entry.status} needs at least one evidence item ({ path, line, note }).`);
    }
    if (["missing", "partial"].includes(entry.status)) {
      if (entry.severity === undefined) {
        warnings.push(`${where}: no severity set; it defaults to ${index.get(entry.id).check.priority ? "high" : "medium"}. Set it so the fix order reflects your judgement.`);
      }
      if (!isText(entry.fix?.summary)) errors.push(`${where}: ${entry.status} needs fix.summary.`);
      if (!Array.isArray(entry.fix?.steps) || entry.fix.steps.length === 0) {
        warnings.push(`${where}: add fix.steps so the team knows exactly what to change.`);
      }
    }
    for (const [j, item] of (Array.isArray(evidence) ? evidence : []).entries()) {
      if (!isText(item?.path)) {
        errors.push(`${where}: evidence[${j}].path is required.`);
        continue;
      }
      if (item.line !== undefined && !(Number.isInteger(item.line) && item.line > 0)) {
        errors.push(`${where}: evidence[${j}].line must be a positive integer.`);
      }
      if (isAbsolute(item.path)) warnings.push(`${where}: evidence[${j}].path should be relative to the repo root.`);
      else if (root && !existsSync(join(root, item.path))) warnings.push(`${where}: evidence path not found: ${item.path}`);
    }
  }

  const missingIds = [...scope.checks].filter(([id, s]) => s.applies && !seen.has(id)).map(([id]) => id);
  if (missingIds.length) {
    errors.push(`Every check that applies must be assessed. Missing ${missingIds.length}: ${missingIds.join(", ")}`);
  }
  return { errors, warnings };
}

// ── Scoring ──────────────────────────────────────────────────────────────────

export function bandFor(score) {
  if (score === null) return { label: "Not relevant", tone: "muted" };
  if (score >= 85) return { label: "Well governed", tone: "good" };
  if (score >= 60) return { label: "Partly governed", tone: "fair" };
  if (score >= 30) return { label: "Thinly governed", tone: "weak" };
  return { label: "Largely ungoverned", tone: "poor" };
}

const emptyCounts = () => Object.fromEntries([...STATUSES, "not_relevant"].map((s) => [s, 0]));

export function scoreReport(report) {
  const catalog = loadCatalog();
  const scope = relevance(report);
  const byId = new Map(report.checks.filter((c) => scope.checks.get(c.id)?.applies).map((c) => [c.id, c]));
  const totals = { earned: 0, possible: 0, counts: emptyCounts(), applicable: 0 };

  const rooms = catalog.rooms.map((room) => {
    const counts = emptyCounts();
    let earned = 0;
    let possible = 0;
    for (const check of room.checks) {
      const entry = byId.get(check.id);
      const status = entry ? entry.status : "not_relevant";
      counts[status]++;
      totals.counts[status]++;
      if (status === "not_relevant" || status === "not_applicable") continue;
      totals.applicable++;
      const weight = check.priority ? 2 : 1;
      earned += weight * POINTS[status];
      possible += weight;
    }
    totals.earned += earned;
    totals.possible += possible;
    const score = possible ? Math.round((100 * earned) / possible) : null;
    const { applies, because } = scope.rooms.get(room.id);
    return { id: room.id, applies, because, score, band: bandFor(score), counts };
  });

  const overall = totals.possible ? Math.round((100 * totals.earned) / totals.possible) : null;

  const adoption = new Map(catalog.adoptionOrder.map((id, i) => [id, i]));
  const order = new Map(catalog.rooms.flatMap((r) => r.checks.map((c) => c.id)).map((id, i) => [id, i]));
  const meta = checkIndex(catalog);
  const rank = (entry) => {
    const { check } = meta.get(entry.id);
    return [
      SEVERITIES.indexOf(severityOf(entry, check)),
      check.priority ? 0 : 1,
      entry.status === "missing" ? 0 : 1,
      adoption.get(check.room),
      order.get(entry.id),
    ];
  };
  const compare = (a, b) => {
    const [ra, rb] = [rank(a), rank(b)];
    for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return ra[i] - rb[i];
    return 0;
  };
  const assessed = [...byId.values()];
  const fixOrder = assessed.filter((c) => c.status === "missing" || c.status === "partial").sort(compare).map((c) => c.id);
  const questions = assessed.filter((c) => c.status === "unknown").sort(compare).map((c) => c.id);
  const notRelevant = [...scope.checks].filter(([, s]) => !s.applies).map(([id, s]) => ({ id, because: s.because }));

  return {
    catalogVersion: catalog.catalogVersion,
    overall: { score: overall, band: bandFor(overall), counts: totals.counts, applicable: totals.applicable },
    rooms,
    fixOrder,
    questions,
    notRelevant,
  };
}
