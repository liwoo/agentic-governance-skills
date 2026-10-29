// Validate an assessor-written report against the catalogue, then score it.

import { existsSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { checkIndex, loadCatalog } from "./catalog.mjs";

export const STATUSES = ["present", "partial", "missing", "not_applicable", "unknown"];
const POINTS = { present: 1, partial: 0.5, missing: 0, unknown: 0 };
const CONFIDENCE = ["high", "medium", "low"];
export const SEVERITIES = ["critical", "high", "medium", "low"];

// Severity is the assessor's judgement of harm for *this* agent; default from the catalogue priority.
export const severityOf = (entry, check) => entry.severity ?? (check.priority ? "high" : "medium");

const isText = (v) => typeof v === "string" && v.trim().length > 0;

export function validateReport(report, { root } = {}) {
  const errors = [];
  const warnings = [];
  const catalog = loadCatalog();
  const index = checkIndex(catalog);

  if (!report || typeof report !== "object") return { errors: ["Report must be a JSON object."], warnings };
  if (report.schemaVersion !== 1) errors.push("schemaVersion must be 1.");
  if (!isText(report.project?.name)) errors.push("project.name is required.");
  if (!isText(report.project?.summary)) errors.push("project.summary is required: one or two sentences on what the agent does.");
  if (!Array.isArray(report.checks)) errors.push("checks must be an array.");
  if (report.consequentialActions !== undefined && !Array.isArray(report.consequentialActions)) {
    errors.push("consequentialActions must be an array when present.");
  }

  const seen = new Set();
  for (const [i, entry] of (report.checks ?? []).entries()) {
    const where = `checks[${i}]${entry?.id ? ` (${entry.id})` : ""}`;
    if (!index.has(entry?.id)) {
      errors.push(`${where}: unknown check id. Use ids from references/catalog.json, e.g. "permission/atomic-consumption".`);
      continue;
    }
    if (seen.has(entry.id)) errors.push(`${where}: duplicate check id.`);
    seen.add(entry.id);

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

  const missingIds = [...index.keys()].filter((id) => !seen.has(id));
  if (missingIds.length) errors.push(`Every check must be assessed. Missing ${missingIds.length}: ${missingIds.join(", ")}`);

  return { errors, warnings };
}

export function bandFor(score) {
  if (score === null) return { label: "Not assessed", tone: "muted" };
  if (score >= 85) return { label: "Well governed", tone: "good" };
  if (score >= 60) return { label: "Partly governed", tone: "fair" };
  if (score >= 30) return { label: "Thinly governed", tone: "weak" };
  return { label: "Largely ungoverned", tone: "poor" };
}

const emptyCounts = () => Object.fromEntries(STATUSES.map((s) => [s, 0]));

export function scoreReport(report) {
  const catalog = loadCatalog();
  const byId = new Map(report.checks.map((c) => [c.id, c]));
  const totals = { earned: 0, possible: 0, counts: emptyCounts() };

  const rooms = catalog.rooms.map((room) => {
    const counts = emptyCounts();
    let earned = 0;
    let possible = 0;
    for (const check of room.checks) {
      const { status } = byId.get(check.id);
      counts[status]++;
      totals.counts[status]++;
      if (status === "not_applicable") continue;
      const weight = check.priority ? 2 : 1;
      earned += weight * POINTS[status];
      possible += weight;
    }
    totals.earned += earned;
    totals.possible += possible;
    const score = possible ? Math.round((100 * earned) / possible) : null;
    return { id: room.id, score, band: bandFor(score), counts };
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
  const fixOrder = report.checks.filter((c) => c.status === "missing" || c.status === "partial").sort(compare).map((c) => c.id);
  const questions = report.checks.filter((c) => c.status === "unknown").sort(compare).map((c) => c.id);

  return {
    catalogVersion: catalog.catalogVersion,
    overall: { score: overall, band: bandFor(overall), counts: totals.counts },
    rooms,
    fixOrder,
    questions,
  };
}
