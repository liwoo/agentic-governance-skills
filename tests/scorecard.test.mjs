import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { loadCatalog } from "../skills/agent-governance-scorecard/scripts/lib/catalog.mjs";
import { discover, redact } from "../skills/agent-governance-scorecard/scripts/lib/discover.mjs";
import { renderHtml } from "../skills/agent-governance-scorecard/scripts/lib/html.mjs";
import { scoreReport, validateReport } from "../skills/agent-governance-scorecard/scripts/lib/report.mjs";

const fixtureReport = () => JSON.parse(readFileSync("examples/northstar-refunds/.governance-scorecard/report.json", "utf8"));

test("catalogue is generated from the current site data", () => {
  execFileSync("node", ["tools/catalog/build.mjs", "--check"], { stdio: "pipe" });
  const catalog = loadCatalog();
  assert.equal(catalog.rooms.length, 6);
  assert.equal(catalog.rooms.flatMap((r) => r.checks).length, 48);
  for (const check of catalog.rooms.flatMap((r) => r.checks)) {
    assert.ok(check.lookFor?.length && check.fix && check.provable, `${check.id} has assessment signals`);
  }
});

test("the Northstar fixture report is valid and scores as largely ungoverned", () => {
  const report = fixtureReport();
  const { errors } = validateReport(report, { root: "examples/northstar-refunds" });
  assert.deepEqual(errors, []);
  const scored = scoreReport(report);
  assert.equal(scored.overall.band.label, "Largely ungoverned");
  assert.ok(scored.fixOrder.slice(0, 3).includes("permission/execution-boundary"), "critical gaps lead the fix list");
});

test("validation rejects incomplete reports", () => {
  const report = fixtureReport();
  report.checks.pop();
  report.checks[0] = { id: report.checks[0].id, status: "partial", finding: "x", evidence: [] };
  report.checks.push({ id: "permission/not-a-check", status: "present" });
  const { errors } = validateReport(report);
  assert.ok(errors.some((e) => e.includes("unknown check id")));
  assert.ok(errors.some((e) => e.includes("needs at least one evidence item")));
  assert.ok(errors.some((e) => e.includes("needs fix.summary")));
  assert.ok(errors.some((e) => e.includes("Every check must be assessed")));
});

test("scoring weights priority checks double and excludes not_applicable", () => {
  const report = fixtureReport();
  const priority = new Set(loadCatalog().rooms.flatMap((r) => r.checks.filter((c) => c.priority).map((c) => c.id)));
  report.checks = report.checks.map((c) => (priority.has(c.id) ? { ...c, status: "present" } : { ...c, status: "not_applicable", reason: "n/a" }));
  assert.equal(scoreReport(report).overall.score, 100);
});

test("discover finds frameworks, tools and consequential leads, and redacts secrets", async () => {
  const index = await discover("examples/northstar-refunds");
  assert.ok(index.frameworks.LangGraph);
  assert.ok(index.tools.some((t) => t.path === "northstar/tools.py"));
  assert.ok(index.consequential.some((t) => t.text.includes("stripe.Refund.create")));
  assert.ok(!index.consequential.some((t) => t.path.startsWith(".governance-scorecard/")), "never indexes its own output");
  assert.equal(redact('api_key = "sk-live-abcdefghijklmnopqrstuvwxyz"'), "api_key = «redacted»");
  assert.ok(!redact("token: ghp_abcdefghijklmnopqrstuvwxyz123").includes("ghp_"));
});

test("HTML escapes report content", () => {
  const report = fixtureReport();
  report.project.name = '<script>alert("x")</script>';
  const html = renderHtml(report, scoreReport(report));
  assert.ok(!html.includes("<script>alert"));
  assert.ok(html.includes("&lt;script&gt;"));
});

test("CLI template → validate fails until filled; render honours --fail-under", () => {
  const dir = mkdtempSync(join(tmpdir(), "scorecard-"));
  const cli = "skills/agent-governance-scorecard/scripts/scorecard.mjs";
  execFileSync("node", [cli, "template", dir], { stdio: "pipe" });
  assert.throws(() => execFileSync("node", [cli, "validate", join(dir, ".governance-scorecard/report.json")], { stdio: "pipe" }));
  const reportPath = join(dir, "report.json");
  writeFileSync(reportPath, JSON.stringify(fixtureReport()));
  const result = (() => {
    try {
      execFileSync("node", [cli, "render", reportPath, "--root", "examples/northstar-refunds", "--out", dir, "--fail-under", "50"], { stdio: "pipe" });
      return 0;
    } catch (error) {
      return error.status;
    }
  })();
  assert.equal(result, 2);
  assert.ok(readFileSync(join(dir, "scorecard.html"), "utf8").includes("northstar-refunds"));
});
