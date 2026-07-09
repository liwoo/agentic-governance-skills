# Skill 02 — The "Subtask Reliability" Validator

*Don't ship a chain until every link in it has independently proven it clears its own reliability bar — test the scaffolding, not just the demo.*

## Governance rationale

An agent is rarely one model call. It is a graph of subtasks — retrieve, extract, compute, decide, act — wired together so the output of one becomes the input of the next. End-to-end evaluation of that graph is necessary but deeply insufficient as a governance control: a passing end-to-end demo tells you the *happy path* worked once, and it hides *where* reliability is being lost. When you only measure the whole, a 95%-reliable retrieval step and a 95%-reliable reasoning step look like a single 90% system, and you have no idea which half to fix.

The mathematics of chaining is unforgiving. If a pipeline has *N* independent links each succeeding with probability *p*, the pipeline succeeds with probability *pᴺ*. Ten links at 95% each is `0.95¹⁰ ≈ 0.60` — a system that looks "pretty good" per-step is a coin-flip end-to-end. The governance implication is that per-step reliability is not a nice-to-have; it is the only lever that compounds. Raising each link from 95% to 99% takes the same ten-link chain from 60% to 90%. You cannot buy that back with a better final prompt.

There is a second reason to decompose: **separating deterministic failures from stochastic ones.** Scaffolding bugs — a mis-parsed tool response, an off-by-one in a chunker, a wrong units conversion — are deterministic and should be held to 100%. They are ordinary software defects wearing an "AI" costume, and letting them hide inside an aggregate "the agent is 88% accurate" number is how teams ship broken calculators and blame the model. This skill operationalizes a governance principle — *demonstrated component reliability before composition* — as a build-time gate: a chain may not be assembled in production unless every constituent link carries a fresh, passing reliability certificate.

## What "good" looks like

- Every graph node, tool, and workflow step is individually addressable and individually tested in isolation, with its dependencies mocked.
- Every such subtask has a linked evaluation suite; no node ships without one, and CI fails if a node has no eval.
- Each subtask class carries a threshold appropriate to its nature: deterministic transforms at 100%, I/O contracts at 100% against mocks, reasoning steps at a calibrated floor (e.g. ≥99%) computed over a large-enough eval set.
- Reliability is recorded as a signed **certificate** — score, sample size, timestamp, eval-set hash, and source hash — not a green checkmark someone remembers seeing.
- Production wiring refuses to assemble the chain if any link's certificate is missing, below threshold, or stale (source or eval set changed since it was measured).
- Thresholds are backed by enough samples to be meaningful, and the sample count travels with the certificate so reviewers can see whether "99%" means 99/100 or 990/1000.

## Taxonomy of subtasks

Not all subtasks fail the same way, so they cannot be validated the same way. Classify every node into one of three families and apply the matching evaluation strategy.

| Class | Examples | Failure nature | Evaluation strategy | Target |
|-------|----------|----------------|---------------------|--------|
| **Deterministic transform** | unit conversion, date math, JSON reshaping, scoring formulas | Deterministic — a bug is a bug every time | Exact-match / schema assertions on fixed inputs; property-based tests | 100% |
| **I/O & information gathering** | retrieval, tool calls, DB reads, API fetches | Contract/integration failures; flaky dependencies | Contract tests against **mocked** dependencies; schema validation of responses; separate live-smoke tests | 100% on mocks |
| **Reasoning (LLM call)** | classification, extraction, planning, tool selection | Stochastic — same input, varying output | Labeled eval set + accuracy threshold; self-consistency for flaky steps; LLM-as-judge where no ground truth | ≥ configured floor (e.g. 99%) |

The critical mistake is treating a deterministic or I/O subtask with a reasoning-style "eyeball a few examples" eval, or treating a reasoning subtask with a single golden assertion that passes by luck of the sampling temperature. Tag each node with its class so the harness knows which validator to run and which threshold to enforce.

## Deterministic checks

### 1. Every subtask must declare an eval suite

Maintain a registry that maps each addressable subtask (by stable id) to its class, its threshold, and the eval file that validates it. This is the single source of truth the scanner and the runner both consult.

```ts
// governance/subtask-registry.ts
export type SubtaskClass = "deterministic" | "io" | "reasoning";

export interface SubtaskEntry {
  /** Stable id, e.g. "retrieve_customer" or graph node name. */
  id: string;
  /** Module + export where the subtask handler is defined. */
  module: string;
  class: SubtaskClass;
  /** Path to the eval suite that validates this subtask in isolation. */
  evalSuite: string;
  /** Minimum reliability in [0,1]. Deterministic/io default to 1.0. */
  threshold: number;
  /** Minimum eval samples required for the score to count. */
  minSamples: number;
}

export const SUBTASK_REGISTRY: SubtaskEntry[] = [
  { id: "retrieve_customer", module: "src/nodes/retrieve.ts", class: "io",
    evalSuite: "evals/retrieve_customer.eval.ts", threshold: 1.0, minSamples: 50 },
  { id: "compute_apr", module: "src/nodes/computeApr.ts", class: "deterministic",
    evalSuite: "evals/compute_apr.eval.ts", threshold: 1.0, minSamples: 200 },
  { id: "classify_intent", module: "src/nodes/classifyIntent.ts", class: "reasoning",
    evalSuite: "evals/classify_intent.eval.ts", threshold: 0.99, minSamples: 300 },
];
```

### 2. A structural scanner that fails on any node lacking an eval

Enumerate the graph nodes / tools / workflow steps actually declared in the codebase, and fail the build if any is not covered by a registry entry with a real eval file. This is what prevents "someone added a node and forgot to test it" from ever reaching production.

```ts
// scripts/scan-subtask-coverage.ts
import { Project, SyntaxKind } from "ts-morph";
import { existsSync } from "node:fs";
import { SUBTASK_REGISTRY } from "../governance/subtask-registry";

const project = new Project({ tsConfigFilePath: "tsconfig.json" });
const registered = new Map(SUBTASK_REGISTRY.map((e) => [e.id, e]));
const problems: string[] = [];

// Discover declared subtasks. Convention: nodes are registered via
// `.addNode("id", fn)` (LangGraph), tools via `tool({ name: "id", ... })`
// (LlamaIndex), and workflow steps via a `@step("id")`-style marker.
const declaredIds = new Set<string>();

for (const sf of project.getSourceFiles("src/**/*.ts")) {
  sf.forEachDescendant((node) => {
    if (node.getKind() !== SyntaxKind.CallExpression) return;
    const call = node.asKindOrThrow(SyntaxKind.CallExpression);
    const expr = call.getExpression().getText();

    // LangGraph node registration: graph.addNode("id", handler)
    if (expr.endsWith("addNode")) {
      const arg0 = call.getArguments()[0];
      if (arg0?.getKind() === SyntaxKind.StringLiteral) {
        declaredIds.add(arg0.getText().slice(1, -1));
      }
    }
    // LlamaIndex tool({ name: "id", ... })
    if (expr === "tool" || expr === "FunctionTool.from") {
      const objArg = call.getArguments()[0];
      const nameProp = objArg?.getText().match(/name:\s*["'`]([^"'`]+)["'`]/);
      if (nameProp) declaredIds.add(nameProp[1]);
    }
  });
}

// Every declared subtask must be registered with a real eval file.
for (const id of declaredIds) {
  const entry = registered.get(id);
  if (!entry) {
    problems.push(`Subtask "${id}" is declared but missing from SUBTASK_REGISTRY.`);
    continue;
  }
  if (!existsSync(entry.evalSuite)) {
    problems.push(`Subtask "${id}" references eval "${entry.evalSuite}" which does not exist.`);
  }
}

// Every registry entry must correspond to a real declared subtask (no rot).
for (const entry of SUBTASK_REGISTRY) {
  if (!declaredIds.has(entry.id)) {
    problems.push(`Registry entry "${entry.id}" no longer matches any declared subtask.`);
  }
}

if (problems.length) {
  console.error("Subtask coverage check FAILED:\n" + problems.map((p) => `  - ${p}`).join("\n"));
  process.exit(1);
}
console.log(`Subtask coverage OK: ${declaredIds.size} subtasks, all covered.`);
```

The scanner detecting node registration by call shape (`addNode`, `tool(...)`) is far more robust than grepping for names, because it discovers nodes that were added without anyone updating a list — which is exactly the drift you are trying to catch.

### 3. An isolation harness that scores each subtask

Each subtask runs against its eval set with dependencies mocked, and the harness computes a score per the subtask's class.

```ts
// governance/run-subtask-eval.ts
import { createHash } from "node:crypto";

export interface EvalCase<I, O> {
  input: I;
  expected?: O;                       // for exact-match classes
  check?: (out: O) => boolean;        // for reasoning / property checks
}

export interface EvalResult {
  id: string;
  score: number;      // fraction passed in [0,1]
  samples: number;
  evalSetHash: string;
}

export async function runSubtaskEval<I, O>(
  id: string,
  handler: (input: I) => Promise<O> | O,
  cases: EvalCase<I, O>[],
): Promise<EvalResult> {
  let passed = 0;
  for (const c of cases) {
    const out = await handler(c.input);
    const ok = c.check
      ? c.check(out)
      : JSON.stringify(out) === JSON.stringify(c.expected);
    if (ok) passed++;
  }
  const evalSetHash = createHash("sha256")
    .update(JSON.stringify(cases))
    .digest("hex")
    .slice(0, 16);
  return { id, score: passed / cases.length, samples: cases.length, evalSetHash };
}
```

## Reliability scoring & thresholds

The reliability score is simply the fraction of eval cases a subtask passes when run in isolation. Two subtleties make this a governance control rather than a vanity metric.

**Sample size gates the claim.** A score of "100%" on 3 cases is noise; "99%" on 500 cases is a signal. Treat the score as an estimate with a confidence interval. As a rough floor, to *claim* a reliability of `p` you want enough samples `n` that the lower bound of the Wilson interval still clears your threshold. Practically: require `minSamples` per class (deterministic can be small since failures are systematic; reasoning needs hundreds because you are estimating a probability), and record `samples` in the certificate so reviewers can judge.

**Class sets the target.**

- *Deterministic:* 100%. Any failing case is a code bug — fix it, don't average it away.
- *I/O contract (mocked):* 100%. The subtask must correctly parse and validate every mocked dependency response shape. Live flakiness is a separate reliability concern handled by retries/circuit-breakers (see [Skill 04](./04-circuit-breaker-kill-switch.md)), not by lowering this bar.
- *Reasoning:* a calibrated floor (commonly 99% for high-stakes selection/extraction, lower for tolerant tasks). Set it from data, not vibes — measure the distribution of scores across seeds and pick a floor the step can actually hold.

**Flaky reasoning steps** should not be waved through by re-rolling until green. Two legitimate options: (a) make the step *more reliable* via self-consistency — sample the reasoning `k` times and take the majority, which raises effective accuracy and is itself measurable; or (b) accept a lower threshold *with a written justification in the registry* and compensate downstream (a verifier node, or an uncertainty gate — see [Skill 06](./06-uncertainty-threshold-guard.md)). What you may not do is silently retry inside the eval to inflate the number.

## Grounding action — the chaining gate

The enforcement point is composition. When the production graph is assembled, refuse to wire it unless every link presents a valid, fresh, passing certificate. This turns "we tested the pieces" from a claim into an invariant checked at boot.

```ts
// governance/certificate.ts
export interface ReliabilityCertificate {
  id: string;
  score: number;
  threshold: number;
  samples: number;
  minSamples: number;
  evalSetHash: string;
  sourceHash: string;   // hash of the subtask's source module
  measuredAt: string;   // ISO timestamp
}
```

```ts
// governance/assert-chain-reliable.ts
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { SUBTASK_REGISTRY } from "./subtask-registry";
import type { ReliabilityCertificate } from "./certificate";

const CERT_DIR = "governance/certs";
const MAX_AGE_MS = 1000 * 60 * 60 * 24 * 14; // 14 days

function hashSource(module: string): string {
  return createHash("sha256").update(readFileSync(module)).digest("hex").slice(0, 16);
}

/** Throws if any link in the chain cannot prove it is reliable and current. */
export function assertChainReliable(chainNodeIds: string[], now: number): void {
  const failures: string[] = [];

  for (const id of chainNodeIds) {
    const entry = SUBTASK_REGISTRY.find((e) => e.id === id);
    if (!entry) { failures.push(`${id}: no registry entry`); continue; }

    const certPath = `${CERT_DIR}/${id}.json`;
    if (!existsSync(certPath)) { failures.push(`${id}: no reliability certificate`); continue; }

    const cert: ReliabilityCertificate = JSON.parse(readFileSync(certPath, "utf8"));

    if (cert.score < entry.threshold)
      failures.push(`${id}: score ${cert.score} < threshold ${entry.threshold}`);
    if (cert.samples < entry.minSamples)
      failures.push(`${id}: ${cert.samples} samples < required ${entry.minSamples}`);
    if (now - Date.parse(cert.measuredAt) > MAX_AGE_MS)
      failures.push(`${id}: certificate is stale (measured ${cert.measuredAt})`);
    if (cert.sourceHash !== hashSource(entry.module))
      failures.push(`${id}: source changed since certification — re-run evals`);
  }

  if (failures.length) {
    throw new Error(
      "Chain assembly BLOCKED — unreliable or uncertified links:\n" +
        failures.map((f) => `  - ${f}`).join("\n"),
    );
  }
}
```

The `sourceHash` check is what makes the certificate honest: if the subtask's code changed after it was certified, the certificate is automatically invalid and the chain refuses to assemble until the eval is re-run. This closes the "we tested it three commits ago" loophole.

## Framework-specific enforcement

### LangGraph.js

Nodes in a `StateGraph` are plain functions `(state) => Partial<State>`. That makes them trivially isolatable: import the node function directly and invoke it with crafted state, no graph required. Register each node id in the subtask registry, and call `assertChainReliable` at graph-build time.

```ts
// evals/classify_intent.eval.ts
import { classifyIntent } from "../src/nodes/classifyIntent";
import { runSubtaskEval } from "../governance/run-subtask-eval";

const cases = [
  { input: { message: "cancel my card" }, check: (s: any) => s.intent === "card_cancel" },
  { input: { message: "what's my balance" }, check: (s: any) => s.intent === "balance" },
  // ... hundreds of labeled cases
];

export default () =>
  runSubtaskEval("classify_intent", classifyIntent, cases);
```

```ts
// buildGraph.ts — assemble only if every node is certified
import { assertChainReliable } from "./governance/assert-chain-reliable";

const NODE_IDS = ["retrieve_customer", "classify_intent", "compute_apr"];
assertChainReliable(NODE_IDS, Date.now());   // throws before the graph is compiled

const graph = new StateGraph(StateAnnotation)
  .addNode("retrieve_customer", retrieveCustomer)
  .addNode("classify_intent", classifyIntent)
  .addNode("compute_apr", computeApr)
  // ...edges
  .compile({ checkpointer });
```

### LlamaIndex.TS

Tools created with `tool({ name, execute })` and individual `Workflow` step handlers are ordinary functions. Test each `execute`/step in isolation with mocked I/O, and score it. LlamaIndex also ships evaluation utilities (faithfulness/relevancy evaluators) that fit the *reasoning* class where you lack exact ground truth.

```ts
// evals/retrieve_customer.eval.ts — I/O contract test with a mocked client
import { retrieveCustomer } from "../src/nodes/retrieve";
import { runSubtaskEval } from "../governance/run-subtask-eval";

const mockDb = { get: async (id: string) => ({ id, tier: "gold" }) };

const cases = [
  { input: { customerId: "c1", db: mockDb },
    check: (r: any) => r.tier === "gold" && typeof r.id === "string" },
  // malformed-response contract cases, missing-field cases, ...
];

export default () => runSubtaskEval("retrieve_customer", retrieveCustomer, cases);
```

### Microsoft Agent Framework

> Microsoft Agent Framework ships **only .NET and Python SDKs** — there is no official JS/TS package (do not import `@microsoft/agent-framework`; it does not exist). The pattern below is written in TypeScript to stay consistent with the rest of this guide and to document the *approach* for a Node port; if your Agent Framework agents are actually in Python/.NET, run the equivalent test there.

In both supported languages a function tool is a plain method (C# method with `[Description]`, or a decorated Python function) — the `@tool` decorator / `AIFunctionFactory.Create` only *wraps* it and leaves the underlying callable directly invocable. That means you unit-test the raw function with no agent in the loop, exactly as above:

```ts
// Illustrative Node port. In practice: pytest over the plain Python function,
// or xUnit over the plain C# method — the decorator/factory does not block direct calls.
import { computeApr } from "../src/nodes/computeApr";
import { runSubtaskEval } from "../governance/run-subtask-eval";

const cases = [
  { input: { principal: 1000, rateBps: 500, days: 365 }, expected: { apr: 5.0 } },
  { input: { principal: 0, rateBps: 500, days: 365 }, expected: { apr: 0 } },
];
export default () => runSubtaskEval("compute_apr", computeApr, cases); // deterministic → 100%
```

## CI/CD integration

Run the coverage scanner, then every subtask eval, write certificates as artifacts, and gate on them.

```json
// package.json
{
  "scripts": {
    "governance:scan-subtasks": "tsx scripts/scan-subtask-coverage.ts",
    "governance:eval-subtasks": "tsx scripts/run-all-evals.ts",
    "governance:gate": "tsx scripts/gate-certificates.ts"
  }
}
```

`run-all-evals.ts` executes each registry entry's eval, then writes `governance/certs/<id>.json` with score, samples, `evalSetHash`, `sourceHash`, and `measuredAt`. `gate-certificates.ts` runs `assertChainReliable` over the production chain and exits non-zero on any failure.

```yaml
# .github/workflows/subtask-reliability.yml
name: subtask-reliability
on: [pull_request]
jobs:
  reliability:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "20" }
      - run: npm ci
      - name: Every subtask has an eval
        run: npm run governance:scan-subtasks   # fails on uncovered node
      - name: Score each subtask in isolation
        run: npm run governance:eval-subtasks    # writes certificates
      - name: Block chain if any link is below threshold or stale
        run: npm run governance:gate
      - uses: actions/upload-artifact@v4
        if: always()
        with: { name: reliability-certificates, path: governance/certs/ }
```

Making all three a required status check means a new node without an eval, a reasoning step that dipped below its floor, or a code change that invalidated a certificate all block the merge.

## Failure modes & bypass risks

- **Overfitting to the eval set.** A reasoning step can be tuned to ace its fixed eval and fail in production. *Mitigation:* hold out a rotating eval slice never used during prompt iteration; periodically refresh cases from real (sanitized) traffic; track the gap between eval and production scores.
- **Stale certificates.** Code changes but the old green certificate lingers. *Mitigation:* the `sourceHash` binding — any source change invalidates the certificate automatically. Also bind `evalSetHash` so silently editing the eval set is visible.
- **Mocking away the real failure.** An I/O contract test that mocks the dependency into always-well-formed responses will never catch the malformed-response bug that actually bites. *Mitigation:* mock the *failure* shapes explicitly (timeouts, partial payloads, wrong types) as required cases; keep a separate live-smoke suite outside the gate.
- **Threshold gaming.** Lowering a reasoning threshold to make CI pass. *Mitigation:* thresholds live in a version-controlled registry; changes to them require review and a written justification, and drops are flagged in the PR diff.
- **Insufficient samples.** "100% reliable" on five cases. *Mitigation:* `minSamples` per class is enforced by the gate; the certificate carries `samples` so reviewers see the denominator.
- **Green pieces, broken whole.** Every link passes in isolation but the *interfaces* between them are mismatched. *Mitigation:* per-subtask reliability is necessary, not sufficient — keep a thin end-to-end suite on top, and validate the state/type contracts at node boundaries (Zod schemas on inputs/outputs).

## Enforcement checklist

- [ ] `governance/subtask-registry.ts` exists and every graph node / tool / workflow step is registered with a `class`, `threshold`, `minSamples`, and `evalSuite`.
- [ ] `scan-subtask-coverage.ts` runs in CI and fails on any declared subtask without a registry entry, any registry entry pointing at a missing eval file, and any registry entry that no longer matches a declared subtask.
- [ ] Each subtask is classified (`deterministic` | `io` | `reasoning`) and validated with the matching strategy and threshold.
- [ ] Deterministic and mocked-I/O subtasks are held to 100%; reasoning thresholds are set from measured score distributions, not guessed.
- [ ] Reasoning eval sets meet `minSamples`; the sample count is recorded in the certificate.
- [ ] Flaky reasoning steps are handled by self-consistency or an explicit, justified lower threshold — never by silent retry-until-green.
- [ ] `run-all-evals.ts` writes a signed/hashed certificate per subtask including `score`, `samples`, `evalSetHash`, `sourceHash`, and `measuredAt`.
- [ ] `assertChainReliable` runs at graph-build/boot time and blocks assembly on any missing, below-threshold, stale, or source-mismatched certificate.
- [ ] CI publishes certificates as artifacts and treats the scan + eval + gate steps as required, non-bypassable status checks.
- [ ] A held-out eval slice and a periodic refresh from sanitized production traffic guard against overfitting.
- [ ] A thin end-to-end suite and node-boundary schema validation complement per-subtask reliability to catch interface mismatches.
