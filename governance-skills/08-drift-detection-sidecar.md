# Skill 08 — The "Drift Detection" Sidecar

*Continuously compare what the agent is actually doing against what it was approved to do, and trip a breaker before silent strategy drift becomes an incident.*

## Governance rationale

Every other skill in this series governs a single decision or a single action at the moment it happens: is this tool call allowed (Skill 02), is this action logged (Skill 03), should this circuit be open (Skill 04). Drift detection governs something different — the *shape of behavior over time*. An agent can pass every per-action policy check and still be a governance failure, because the aggregate pattern of its decisions has quietly moved away from what was validated during testing.

This matters specifically for agentic systems because they are not static call graphs. Behavior is a function of:

- **The model** — a provider-side model update, a router change, or a fallback to a secondary model after a rate limit can change tool-selection habits overnight, with no code deploy on your side.
- **The prompt/context** — prompt edits, RAG corpus updates, or growing conversation/memory context change what the model "sees" and therefore what it decides to do.
- **The tool surface** — adding, removing, or reordering tools, or a tool's own behavior changing upstream, can shift which paths the agent takes to the same goal.
- **Learned or adaptive components** — few-shot example stores, memory writes, preference learning, or self-improving prompts (anything in the system that mutates based on runtime experience) can accumulate small changes into a materially different policy.

None of this shows up as a crash, an exception, or a failed unit test. The agent still "works." It still returns plausible-looking output. That is exactly the danger: **drift is a silent regression.** The agent that used to always call `verify_identity` before `issue_refund` might, six weeks and one model swap later, skip verification in 15% of cases — and every one of those calls still returns HTTP 200.

**Benign adaptation vs. unsafe drift.** Not all behavioral change is bad. An agent legitimately gets better at a task, learns a shorter valid path, or adapts to a genuinely new tool. The governance problem is not "prevent all change" — it's "make behavioral change visible, attributable, and reviewable" rather than allowing it to accumulate unnoticed. Drift detection doesn't block change; it forces change to be *seen* and, above a threshold, *approved* the same way a code change would be.

**Why an out-of-band sidecar, not just build-time checks.** Build-time regression tests (see [Deterministic checks](#deterministic-checks-build-time-gate)) catch drift introduced by a deploy — a new prompt, a new model pin, a new tool. They cannot catch drift that emerges *between* deploys: gradual memory accumulation, upstream model behavior changes behind a stable API version string, or context-window creep on long-running sessions. That class of drift only shows up in production traffic, over time, as a distributional property — which is precisely what a runtime sidecar is built to observe. The sidecar is deliberately a *separate* process from the agent's hot path: it consumes the same event stream the agent already produces for other reasons, so it adds monitoring without adding request-path latency or coupling agent correctness to monitoring correctness.

**Where this skill plugs into the rest of the series:**

- **Skill 03 (Action Ledger)** is the data source. The sidecar does not instrument the agent itself; it *reads* the same append-only, structured record of tool calls, decisions, and reasoning traces that Skill 03 mandates every action be written to. If Skill 03 isn't emitting rich-enough events (tool name, args, timing, reasoning trace reference), this skill has nothing to consume.
- **Skill 04 (Circuit Breaker)** is the actuator. Drift detection does not itself stop the agent — it raises a signal. When that signal crosses a hard threshold, this skill's job is to *trip* the breaker defined in Skill 04, converting a statistical observation into a concrete, enforced state change (pause, degrade, human handoff).

Drift detection is therefore the connective tissue between "we log everything" (03) and "we can stop everything" (04): it's the decision function that decides *when* logging should become stopping.

## What "good" looks like

A system with a working drift detection sidecar exhibits these end-state invariants:

- **A versioned golden set exists** and is treated as a governed artifact (reviewed, approved, stored with provenance) — not an ad hoc folder of "some traces we liked."
- **Every production run's behavior is comparable** to the golden set on a defined, computable metric — not just "eyeballed" by an engineer reading logs.
- **Drift is measured continuously in production**, on a rolling window, not only at deploy time. A regression that appears three weeks after a clean deploy is still caught.
- **There are two distinct response bands**: a *warn* band that pages a human without interrupting service, and a *trip* band that automatically engages the circuit breaker. The system never silently tolerates deviation past the trip threshold.
- **Alerts are attributable.** When drift fires, the on-call engineer can see *which* dimension moved (tool distribution? sequence shape? reasoning semantics?) and pull the specific live traces that triggered it — not just a scalar "drift score = 0.83."
- **Legitimate change has a sanctioned path.** Updating the golden set is itself a reviewed, auditable action (who approved it, why, against which eval run) — so "intended improvement" and "unauthorized drift" are structurally distinguishable in the system's history, not just in someone's memory.
- **The build-time gate and the runtime sidecar share the same metric definitions.** A regression caught in CI and a regression caught in production three weeks later are measured the same way, so engineers build one mental model of "what drift means here," not two.

## What "drift" means here

"Strategy drift" is a change in the *distribution* of agent behavior relative to an approved baseline, observed along several independent dimensions. A single anomalous trace is not drift — drift is a *statistically or semantically significant shift in aggregate behavior* over a window of executions.

**Observable dimensions:**

1. **Tool-selection distribution** — which tools the agent calls, and how often, across many runs. E.g., `search_knowledge_base` used in 80% of golden runs vs. 40% in live traffic; a new, ungoverned tool appearing that wasn't in the golden set at all.
2. **Action/step sequences (trajectories)** — the *order and structure* of tool calls and decision points, not just their frequency. Two agents can have an identical tool-usage histogram while one always verifies-then-acts and the other sometimes acts-then-verifies. Sequence shape matters as much as sequence content.
3. **Reasoning-trace semantics** — the content/intent of the agent's intermediate reasoning (chain-of-thought, planning steps, tool-call justifications), independent of which tools were actually called. Two runs can call the same tools for different, and differently risky, reasons.
4. **Output distribution** — the shape of final responses: length, refusal rate, sentiment, structured-output schema adherence, confidence-score distribution, task-success rate against known criteria.
5. **Cost/latency/step-count profile** — number of LLM calls per task, tokens consumed, wall-clock latency, tool-call count per run. A sudden jump often signals the agent has started looping, retrying, or taking a more exploratory (and more expensive, more failure-prone) path.
6. **Policy-violation rate** — the rate at which actions are being *blocked or flagged* by other governance skills (Skill 02's policy gate, Skill 04's breaker itself). A rising near-miss rate is a leading indicator of drift before an actual violation occurs.

**Drift types, along two independent axes:**

| | Sudden | Gradual |
|---|---|---|
| **Cause examples** | Model/provider swap, prompt deploy, tool schema change, config flag flip | Memory/context accumulation, RAG corpus drift, upstream data distribution shift, few-shot store growth |
| **Detection posture** | Compare against golden set immediately post-deploy; build-time gate is the first line of defense | Requires rolling-window statistics over days/weeks; only the runtime sidecar can see this |

| | Benign | Harmful |
|---|---|---|
| **Signature** | Shift is consistent with an intended change (matches a recent, approved golden-set update or changelog entry) | Shift has no corresponding approved change, or moves specifically toward higher-risk actions (skipping verification, escalating privilege, contacting more external systems) |
| **Response** | Update golden set through review process | Alert / trip breaker |

The practical job of this skill is to make the *sudden vs. gradual* and *benign vs. harmful* distinctions computable rather than left to intuition — even though, as covered below, the metrics used are heuristics that require tuning and human judgment at the boundary.

## The golden set

The golden set is the reference distribution everything else is measured against. It is built once per model/prompt/tool-set version, during the testing/eval phase, and is itself a versioned, governed artifact — not a live-updating cache.

**What goes into it:**

- **Approved trajectories** — full tool-call sequences (ordered, with arguments and results) from evaluation runs that a human or an eval suite has certified as correct, safe behavior.
- **Reasoning traces** — the model's intermediate reasoning/planning output associated with each trajectory, captured at the same time.
- **Provenance metadata** — the exact model identifier (including version/snapshot, not just family name), a hash of the prompt/system-instruction set in effect, the tool registry version (names + schemas), and the eval suite version that generated the run.

**Trajectory signature.** Rather than storing and comparing raw transcripts (expensive, noisy, and overly literal), each golden run is reduced to a *signature*: a structured, comparable representation with three parts —

1. The ordered list of tool calls (tool name + a normalized/bucketed representation of arguments — not literal argument values, which vary run to run).
2. The decision points — places where the agent chose between multiple valid next actions, recorded as (state, choice) pairs.
3. An embedding vector of the reasoning trace text, for semantic comparison independent of exact wording.

```ts
// governance/drift/golden-types.ts

/** A single tool invocation within a trajectory, normalized for comparison. */
interface GoldenToolCall {
  toolName: string;
  /** Bucketed/normalized args — e.g. {"amount": "range:0-100"} not {"amount": 42.17} */
  argSignature: Record<string, string>;
  /** Ordinal position within the trajectory */
  step: number;
}

/** A branch point the agent faced, and which branch the approved run took. */
interface GoldenDecisionPoint {
  step: number;
  /** Short label for the decision context, e.g. "post-lookup:found-vs-not-found" */
  context: string;
  chosenBranch: string;
  availableBranches: string[];
}

/** One approved reference run, reduced to a comparable signature. */
interface GoldenTrajectoryRecord {
  id: string;
  goldenSetVersion: string;       // e.g. "2026.06.1"
  capturedAt: string;             // ISO 8601
  scenario: string;               // eval scenario/task id this run answers
  provenance: {
    modelId: string;              // exact snapshot, e.g. "claude-sonnet-5-20260115"
    promptHash: string;           // sha256 of system/instruction set
    toolRegistryVersion: string;  // hash or semver of the tool schema set
    evalSuiteVersion: string;
  };
  toolCalls: GoldenToolCall[];
  decisionPoints: GoldenDecisionPoint[];
  reasoningTraceEmbedding: number[]; // fixed-dim embedding of concatenated reasoning text
  outcome: {
    success: boolean;
    reviewedBy: string;           // human approver of this reference run
  };
}

/** The versioned artifact: an immutable, reviewed collection of golden runs. */
interface GoldenSet {
  version: string;
  createdAt: string;
  approvedBy: string[];
  changeNote: string;             // why this version differs from the previous one
  records: GoldenTrajectoryRecord[];
}
```

The golden set is stored as a versioned artifact (a file in version control, or a row in a governed table with an immutable history) — never mutated in place. A new version is a new artifact with an explicit `changeNote` and `approvedBy`, so "the baseline changed" is itself an audit event.

## Measuring deviation

Deviation is measured on several independent metrics, each catching a different dimension from the list above. None of these alone is sufficient — a system that only checks tool-distribution can miss a sequence-order regression, and vice versa.

**(a) Trajectory / sequence distance.** Treat each trajectory as a sequence of tool-call tokens and compute edit distance (Levenshtein over the tool-name sequence, optionally cost-weighted so swapping a low-risk tool is cheaper than skipping a verification step) against the nearest-matching golden trajectory for that scenario.

**(b) Tool-distribution divergence.** Aggregate tool-usage frequency across a window of live runs into a probability distribution, and compare it to the golden set's distribution using Jensen-Shannon divergence (symmetric, bounded [0,1], well-behaved for this) or Population Stability Index (PSI — standard in model-monitoring contexts, with conventional bands: <0.1 stable, 0.1–0.25 moderate shift, >0.25 significant shift).

**(c) Reasoning-trace semantic drift.** Embed the live run's reasoning trace with the same embedding model used to build the golden set, and compute cosine distance to the nearest golden trace for that scenario. Optionally supplement with an LLM-judge prompt — "given this approved reasoning example and this live reasoning trace for the same task, is the live trace consistent with the approved approach? yes/no + rationale" — as a higher-cost, higher-precision check on ambiguous cases the embedding distance flags but doesn't resolve.

**(d) Output/score drift.** Compare distributions of output-level signals (response length, structured-output schema-validation pass rate, task-success rate from any available ground truth or user feedback signal) between live and golden using the same divergence measures as (b).

**(e) Thresholds and anomaly bands.** Every metric above produces a continuous score, not a boolean. Each is mapped to a *warn* band and a *trip* band (see [Grounding action](#grounding-action--alert--auto-breaker)) tuned per-metric, because a JS-divergence of 0.15 and an edit-distance of 15 are not comparable numbers and should not share a threshold.

```ts
// governance/drift/metrics.ts

/** Levenshtein edit distance over ordered tool-call name sequences. */
function toolSequenceEditDistance(live: string[], golden: string[]): number {
  const dp: number[][] = Array.from({ length: live.length + 1 }, () =>
    new Array(golden.length + 1).fill(0)
  );
  for (let i = 0; i <= live.length; i++) dp[i][0] = i;
  for (let j = 0; j <= golden.length; j++) dp[0][j] = j;

  for (let i = 1; i <= live.length; i++) {
    for (let j = 1; j <= golden.length; j++) {
      if (live[i - 1] === golden[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
  }
  return dp[live.length][golden.length];
}

/** Normalized edit distance in [0,1], comparable across trajectories of different length. */
function normalizedSequenceDrift(live: string[], golden: string[]): number {
  const maxLen = Math.max(live.length, golden.length, 1);
  return toolSequenceEditDistance(live, golden) / maxLen;
}

/** Jensen-Shannon divergence between two discrete tool-usage distributions. */
function jsDivergence(
  liveDist: Record<string, number>,
  goldenDist: Record<string, number>
): number {
  const keys = new Set([...Object.keys(liveDist), ...Object.keys(goldenDist)]);
  const p: number[] = [];
  const q: number[] = [];
  for (const k of keys) {
    p.push(liveDist[k] ?? 0);
    q.push(goldenDist[k] ?? 0);
  }
  const m = p.map((pi, i) => (pi + q[i]) / 2);

  const klDiv = (a: number[], b: number[]) =>
    a.reduce((sum, ai, i) => (ai > 0 && b[i] > 0 ? sum + ai * Math.log2(ai / b[i]) : sum), 0);

  return (klDiv(p, m) + klDiv(q, m)) / 2; // bounded [0, 1]
}

/** Population Stability Index — common industry threshold: >0.25 = significant shift. */
function populationStabilityIndex(
  liveDist: Record<string, number>,
  goldenDist: Record<string, number>
): number {
  const keys = new Set([...Object.keys(liveDist), ...Object.keys(goldenDist)]);
  let psi = 0;
  for (const k of keys) {
    const live = Math.max(liveDist[k] ?? 1e-6, 1e-6);
    const golden = Math.max(goldenDist[k] ?? 1e-6, 1e-6);
    psi += (live - golden) * Math.log(live / golden);
  }
  return psi;
}
```

**Be honest about limits.** These are heuristics, not ground truth. Edit distance penalizes benign reordering as harshly as harmful reordering unless you weight it. JS-divergence and PSI need a large-enough live sample to be stable — on low-traffic agents, apply these over daily or weekly windows, not per-request. Embedding-based semantic distance inherits whatever blind spots the embedding model has. Every threshold in this section needs tuning against your own traffic and should be revisited whenever the golden set or the embedding/judge model changes.

## Deterministic checks (build-time gate)

Before drift ever reaches production, a regression job replays the golden eval set against the *current build* — current model pin, current prompt, current tool registry — and fails if deviation exceeds tolerance. This is a **behavioral snapshot test**: conceptually the same idea as UI snapshot testing, except the "snapshot" is a trajectory/reasoning signature instead of a rendered DOM tree, and the diff is a distance metric instead of a byte-for-byte comparison.

```ts
// governance/drift/assert-no-drift.ts
import { normalizedSequenceDrift, jsDivergence } from "./metrics";
import type { GoldenSet, GoldenTrajectoryRecord } from "./golden-types";

interface LiveRunResult {
  scenario: string;
  toolCallSequence: string[];
  reasoningEmbedding: number[];
}

interface DriftTolerance {
  maxSequenceDrift: number;      // e.g. 0.15 — normalized edit distance
  maxToolDistJsDivergence: number; // e.g. 0.1
  maxReasoningCosineDistance: number; // e.g. 0.2
}

interface DriftFinding {
  scenario: string;
  metric: "sequence" | "toolDistribution" | "reasoningSemantic";
  score: number;
  tolerance: number;
}

function cosineDistance(a: number[], b: number[]): number {
  const dot = a.reduce((s, ai, i) => s + ai * b[i], 0);
  const magA = Math.sqrt(a.reduce((s, ai) => s + ai * ai, 0));
  const magB = Math.sqrt(b.reduce((s, bi) => s + bi * bi, 0));
  return 1 - dot / (magA * magB);
}

function toDistribution(seq: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const tool of seq) counts[tool] = (counts[tool] ?? 0) + 1;
  const total = seq.length || 1;
  for (const k of Object.keys(counts)) counts[k] /= total;
  return counts;
}

/**
 * Replays `current` (this build's live-equivalent runs, one per golden scenario)
 * against `goldenSet` and throws with a structured report if any scenario
 * exceeds tolerance. Intended to run in CI as a required gate.
 */
export function assertNoBehavioralDrift(
  goldenSet: GoldenSet,
  current: LiveRunResult[],
  tolerance: DriftTolerance
): void {
  const findings: DriftFinding[] = [];

  for (const golden of goldenSet.records) {
    const match = current.find((r) => r.scenario === golden.scenario);
    if (!match) {
      throw new Error(
        `Behavioral drift gate: no current run for golden scenario "${golden.scenario}" ` +
          `(golden set ${goldenSet.version}). Regression suite is out of sync with golden set.`
      );
    }

    const seqDrift = normalizedSequenceDrift(
      match.toolCallSequence,
      golden.toolCalls.map((c) => c.toolName)
    );
    if (seqDrift > tolerance.maxSequenceDrift) {
      findings.push({ scenario: golden.scenario, metric: "sequence", score: seqDrift, tolerance: tolerance.maxSequenceDrift });
    }

    const jsDiv = jsDivergence(
      toDistribution(match.toolCallSequence),
      toDistribution(golden.toolCalls.map((c) => c.toolName))
    );
    if (jsDiv > tolerance.maxToolDistJsDivergence) {
      findings.push({ scenario: golden.scenario, metric: "toolDistribution", score: jsDiv, tolerance: tolerance.maxToolDistJsDivergence });
    }

    const semDist = cosineDistance(match.reasoningEmbedding, golden.reasoningTraceEmbedding);
    if (semDist > tolerance.maxReasoningCosineDistance) {
      findings.push({ scenario: golden.scenario, metric: "reasoningSemantic", score: semDist, tolerance: tolerance.maxReasoningCosineDistance });
    }
  }

  if (findings.length > 0) {
    throw new Error(
      `Behavioral drift gate FAILED against golden set ${goldenSet.version}:\n` +
        findings.map((f) => `  [${f.scenario}] ${f.metric}: ${f.score.toFixed(3)} > tolerance ${f.tolerance}`).join("\n")
    );
  }
}
```

**Determinism caveats — this comparison is only meaningful if the "current" run is actually reproducible enough to compare:**

- **Pin the model snapshot**, not a floating alias. Comparing against `model: "latest"` makes every run a moving target; use an explicit versioned model id in the regression job.
- **Set temperature to 0 (or as low as the model allows)** for the regression replay specifically. You are not trying to sample the model's creative range here — you are trying to get the most likely trajectory so it's comparable run-to-run. Production traffic can run at a different temperature; the *gate* should not.
- **Mock or replay-record external tools** so a live API's own nondeterminism (search results changing, a database row being different today) doesn't get misattributed to agent drift. The gate should isolate *agent* behavior change from *environment* change.
- **Run each scenario multiple times (e.g. n=3–5)** and take the majority/median trajectory, or compare against a small tolerance band, because even temperature-0 LLM calls are not perfectly deterministic across infrastructure. Treat a single-sample mismatch as noise; treat a majority mismatch as a finding.
- **Fix the tool registry version** used in the replay to the one the build actually ships, so a tool schema change is caught as a *cause* of drift rather than silently changing what "current" means.

## The runtime sidecar

The build-time gate only catches drift that correlates with a deploy. Gradual drift — memory accumulation, upstream data shift, slow context creep on long sessions — only shows up as a distributional property of production traffic over time, and only a runtime process watching the live event stream can see it.

The sidecar is architecturally a **separate process/service**, not a middleware hook inside the agent's request path. It consumes the action ledger (Skill 03) or an equivalent event stream (Kafka topic, log sink, event table) asynchronously, computes windowed metrics, and compares them to the golden baseline. Keeping it out-of-band matters for two reasons: it cannot add latency or failure modes to the agent's live request path, and its own bugs or slowness cannot be mistaken for, or cause, agent-side outages.

```ts
// governance/drift/sidecar.ts
import { jsDivergence, populationStabilityIndex } from "./metrics";
import type { GoldenSet } from "./golden-types";

interface LedgerEvent {
  runId: string;
  scenario: string;
  toolName: string;
  timestamp: string;
  reasoningTraceEmbedding?: number[];
}

interface DriftSignal {
  windowStart: string;
  windowEnd: string;
  metric: "toolDistribution" | "reasoningSemantic";
  score: number;
  band: "ok" | "warn" | "trip";
}

interface SidecarConfig {
  windowSizeMs: number;          // e.g. 15 minutes rolling window
  warnThreshold: number;
  tripThreshold: number;
  onSignal: (signal: DriftSignal) => Promise<void>;
}

/**
 * Long-running loop: ingest ledger events -> bucket into rolling windows ->
 * compute drift metrics per window -> compare to golden baseline -> act.
 * Runs as its own process (e.g. a small worker service), independent of
 * the agent runtime.
 */
export async function runDriftSidecar(
  goldenSet: GoldenSet,
  eventSource: AsyncIterable<LedgerEvent>,
  config: SidecarConfig
): Promise<void> {
  const goldenToolDist = buildGoldenToolDistribution(goldenSet);
  let windowEvents: LedgerEvent[] = [];
  let windowStart = Date.now();

  for await (const event of eventSource) {
    windowEvents.push(event);

    const elapsed = Date.now() - windowStart;
    if (elapsed >= config.windowSizeMs) {
      const liveDist = toToolDistribution(windowEvents);
      const score = jsDivergence(liveDist, goldenToolDist);
      const band = classify(score, config.warnThreshold, config.tripThreshold);

      const signal: DriftSignal = {
        windowStart: new Date(windowStart).toISOString(),
        windowEnd: new Date().toISOString(),
        metric: "toolDistribution",
        score,
        band,
      };

      if (band !== "ok") {
        await config.onSignal(signal);
      }

      windowEvents = [];
      windowStart = Date.now();
    }
  }
}

function classify(score: number, warn: number, trip: number): "ok" | "warn" | "trip" {
  if (score >= trip) return "trip";
  if (score >= warn) return "warn";
  return "ok";
}

function toToolDistribution(events: LedgerEvent[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const e of events) counts[e.toolName] = (counts[e.toolName] ?? 0) + 1;
  const total = events.length || 1;
  for (const k of Object.keys(counts)) counts[k] /= total;
  return counts;
}

function buildGoldenToolDistribution(goldenSet: GoldenSet): Record<string, number> {
  const counts: Record<string, number> = {};
  let total = 0;
  for (const record of goldenSet.records) {
    for (const call of record.toolCalls) {
      counts[call.toolName] = (counts[call.toolName] ?? 0) + 1;
      total++;
    }
  }
  for (const k of Object.keys(counts)) counts[k] /= total || 1;
  return counts;
}
```

In practice the sidecar computes several metrics per window (tool distribution, sequence drift against nearest golden scenario, reasoning-embedding centroid distance, cost/step-count percentiles) and emits one `DriftSignal` per metric per window, rather than a single collapsed score — so the alert payload stays attributable to a specific dimension (see [What "good" looks like](#what-good-looks-like)).

## Grounding action — alert & auto-breaker

Every drift signal is classified into one of two bands, with distinct, pre-agreed responses. The bands must be defined *before* an incident, not tuned reactively during one.

- **Warn band** — deviation is elevated but not yet dangerous. Action: notify/page on-call (non-blocking), attach the specific window's traces and the metric breakdown, and log the signal for trend review. The agent keeps running.
- **Trip band** — deviation crosses a threshold considered unsafe to leave running unattended. Action: automatically trip the circuit breaker defined in Skill 04 (pause the agent, force degraded/human-in-the-loop mode, or fail closed on the specific capability that's drifting), *and* page on-call with the same evidence. Recovery requires the same human-approval path Skill 04 defines for any other breaker trip — drift-triggered trips are not silently self-healing.

```ts
// governance/drift/grounding-action.ts
import type { DriftSignal } from "./sidecar";
import { tripBreaker } from "../breaker/breaker"; // Skill 04's actuator
import { pageOnCall } from "../alerting/pager";

export async function handleDriftSignal(signal: DriftSignal): Promise<void> {
  if (signal.band === "warn") {
    await pageOnCall({
      severity: "warn",
      summary: `Drift warn: ${signal.metric} score ${signal.score.toFixed(3)} in window ${signal.windowStart}-${signal.windowEnd}`,
      blocking: false,
    });
    return;
  }

  if (signal.band === "trip") {
    await tripBreaker({
      reason: "behavioral_drift",
      metric: signal.metric,
      score: signal.score,
      window: { start: signal.windowStart, end: signal.windowEnd },
      // Requires the same human-approved reset path as any other breaker trip.
      autoReset: false,
    });
    await pageOnCall({
      severity: "critical",
      summary: `Circuit breaker tripped: ${signal.metric} drift score ${signal.score.toFixed(3)} exceeded trip threshold`,
      blocking: true,
    });
  }
}
```

Threshold values are not prescribed here — they must be tuned per metric against your own traffic (see the honesty note in [Measuring deviation](#measuring-deviation)) — but the *shape* of the policy (two bands, non-blocking warn, blocking trip, no silent auto-reset) should be fixed and reviewed like any other production incident-response policy.

## Framework-specific enforcement

### LangGraph.js

`StateGraph` executes as a sequence of node transitions, and `.stream()` (with `streamMode: "updates"` or `"debug"`) already emits per-node events containing the node name and its state delta as the graph runs — this is the natural place to capture a trajectory without adding separate instrumentation. Combine that with a checkpointer (`MemorySaver` or a custom `BaseCheckpointSaver`) if you also want persisted, replayable state per step, and with `RunnableConfig.callbacks` (LangChain's callback mechanism, which LangGraph.js inherits) to hook tool-call start/end events directly.

```ts
// illustrative — verify exact stream event shape against current LangGraph.js docs
const stream = await graph.stream(input, {
  streamMode: "updates",
  callbacks: [
    {
      handleToolStart: async (tool, input) => {
        await ledger.record({ type: "tool_call_start", tool: tool.name, input });
      },
      handleToolEnd: async (output) => {
        await ledger.record({ type: "tool_call_end", output });
      },
    },
  ],
});

for await (const update of stream) {
  // `update` is keyed by node name -> partial state delta for that node
  const [nodeName, delta] = Object.entries(update)[0];
  await ledger.record({ type: "node_transition", node: nodeName, delta });
  // The sidecar consumes `ledger` independently — this loop just captures the trace.
}
```

The sidecar never talks to the graph directly; it only ever reads what the ledger recorded. A comparison callback (invoked either inline during eval replay, or async in the sidecar) diffs the live per-node path against the golden trajectory's `toolCalls`/`decisionPoints` for the matching scenario.

### LlamaIndex.TS

LlamaIndex.TS's agent workflows (`agent()` / `AgentWorkflow`) run as an event-driven workflow, and running one via `.run()` gives you an async-iterable stream of workflow events (step starts, tool-call events, agent-output events) alongside the final result — this is the equivalent hook point to LangGraph's stream. There is also a global `Settings.callbackManager` / `CallbackManager` mechanism for cross-cutting observability hooks (illustrative — confirm the exact event-type names against the current LlamaIndex.TS observability docs, as these have moved across versions).

```ts
// illustrative — verify exact event/type names against current LlamaIndex.TS docs
const run = agentWorkflow.run(userInput);

for await (const event of run) {
  if (isToolCallEvent(event)) {
    await ledger.record({
      type: "tool_call",
      tool: event.toolName,
      input: event.toolKwargs,
    });
  }
  if (isAgentStepEvent(event)) {
    await ledger.record({
      type: "reasoning_step",
      text: event.reasoning, // captured for embedding + golden-set comparison
    });
  }
}
```

The sidecar treats this exactly like the LangGraph stream: it's a source of `tool_call` and `reasoning_step` events into the same ledger schema, so downstream metric code (edit distance, JS divergence, cosine distance) is framework-agnostic.

### Microsoft Agent Framework

Microsoft Agent Framework (the unified successor to Semantic Kernel's agent APIs and AutoGen) is built around OpenTelemetry-native tracing and a function-invocation middleware pattern: you can register a middleware that wraps every function/tool call the agent makes, observing name, arguments, and result before/after invocation, and OTel spans are emitted for agent runs and tool calls out of the box. **Language note:** it ships **only .NET and Python SDKs** — there is **no official JS/TS package** (`@microsoft/agent-framework` does not exist). The best drift-export seam is therefore its native OpenTelemetry output: point the OTel exporter at your collector and have the sidecar consume trajectory spans from there, regardless of implementation language. The TypeScript snippet below documents the middleware-export pattern for a Node port.

```ts
// illustrative — Microsoft Agent Framework TS surface is newer; verify exact
// middleware/filter API against current docs before relying on this shape
agent.use(async (context, next) => {
  await ledger.record({
    type: "tool_call",
    tool: context.functionName,
    input: context.arguments,
  });
  const result = await next();
  await ledger.record({
    type: "tool_call_result",
    tool: context.functionName,
    output: result,
  });
  return result;
});
```

Because tracing is OTel-native, an alternative integration path is to point an OTel collector/exporter at the sidecar (or at a pipeline that feeds the sidecar) instead of writing a bespoke middleware — letting the sidecar consume spans directly rather than a custom ledger schema. Either path, the invariant is the same as the other two frameworks: tool-call sequence and reasoning content flow into the same comparable event shape the metrics in this doc expect.

## CI/CD integration

The behavioral-snapshot regression (`assertNoBehavioralDrift`) is a required, blocking gate on any change that can plausibly move agent behavior: prompt edits, tool registry changes, model version pins, and dependency bumps that touch the agent runtime. It is **not** a gate that fails silently and gets skipped — a failing drift gate should block merge exactly like a failing unit test, with the one sanctioned override being an explicit, reviewed golden-set update.

```json
{
  "scripts": {
    "drift:replay": "tsx governance/drift/replay-golden-set.ts",
    "drift:gate": "tsx governance/drift/run-gate.ts --tolerance governance/drift/tolerance.json",
    "drift:update-golden-set": "tsx governance/drift/update-golden-set.ts --require-approval"
  }
}
```

```yaml
# .github/workflows/behavioral-drift-gate.yml
name: Behavioral Drift Gate

on:
  pull_request:
    paths:
      - "agents/**"
      - "prompts/**"
      - "tools/**"
      - "governance/drift/golden-set/**"

jobs:
  drift-gate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - run: npm ci

      - name: Replay golden set against current build
        run: npm run drift:replay
        env:
          MODEL_ID: ${{ vars.PINNED_MODEL_ID }}
          TEMPERATURE: "0"
          MOCK_EXTERNAL_TOOLS: "true"

      - name: Assert no behavioral drift beyond tolerance
        run: npm run drift:gate

      - name: Require explicit golden-set review if this PR touches golden-set/
        if: contains(github.event.pull_request.changed_files, 'governance/drift/golden-set/')
        run: |
          echo "This PR modifies the golden set. Requires review from @governance-owners."
          gh pr edit ${{ github.event.pull_request.number }} --add-reviewer governance-owners
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

The golden-set-update path (`drift:update-golden-set`) is deliberately separate from the gate itself and requires its own review — this is how "we intended this change" (update the baseline, reviewed) stays structurally distinct from "the gate is annoying so we raised the tolerance" (which should itself require the same review weight, since it has the same effect).

## Failure modes & bypass risks

- **Golden set staleness.** A golden set frozen at initial launch becomes an increasingly unrealistic baseline as the product legitimately evolves, producing constant false-positive drift alerts that teams learn to ignore. *Mitigation:* scheduled golden-set review cadence (e.g. quarterly), and golden-set updates are cheap and reviewable rather than a rare, heavyweight event.
- **Golden set overfitting.** A golden set built from too few or too narrow eval scenarios treats any traffic outside that narrow slice as "drift," even when it's normal variation. *Mitigation:* build the golden set from a broad, representative eval suite, not a handful of happy-path examples; track scenario coverage explicitly.
- **Legitimate change flagged as drift.** An intentional improvement (better tool selection, a genuinely shorter valid path) trips the same alarm as a regression. *Mitigation:* this is by design at the alerting layer — the fix is process, not suppression: legitimate changes go through the human-approved golden-set-update path *before* or *alongside* the deploy, so the gate passes because the baseline moved, not because detection was weakened.
- **LLM nondeterminism creating noise.** Even at temperature 0, models are not bit-for-bit deterministic across infra, and normal request-to-request variation can look like drift on small samples. *Mitigation:* windowed, statistical comparison (JS-divergence/PSI over many runs) rather than single-run comparison for the runtime sidecar; multi-sample majority voting for the build-time gate.
- **The embedding/judge model itself drifts.** If reasoning-trace semantic drift is measured via an embedding model or LLM-judge that is itself updated upstream, the *measurement instrument* changes independent of the *agent* — producing phantom drift signals unrelated to agent behavior. *Mitigation:* pin the embedding/judge model version with the same discipline as the agent's own model pin; re-baseline the golden set's embeddings whenever the embedding model version changes.
- **Alert fatigue.** Poorly tuned thresholds that fire constantly train on-call engineers to dismiss drift alerts, defeating the entire mechanism. *Mitigation:* start thresholds conservative (wide bands), tune down deliberately based on real false-positive rate, and track alert-to-actionable ratio as a metric on the monitoring system itself.
- **Adversarial slow drift under thresholds.** A sufficiently gradual shift (or an adversarial actor probing for the threshold) can stay just under the warn band indefinitely, accumulating meaningful behavioral change that never trips an alert. *Mitigation:* track cumulative drift over long windows (e.g. month-over-month baseline comparison, not just rolling 15-minute windows) in addition to short-window bands, so slow creep is caught even when no single window crosses a threshold.
- **Sidecar becomes a single point of trust without its own oversight.** If the sidecar's own logic has a bug (wrong metric, stale golden set reference, silent exception swallowing events), drift detection silently stops working while looking healthy. *Mitigation:* the sidecar emits its own liveness/heartbeat signal and event-ingestion-lag metric, monitored independently — "the drift monitor is still running and current" is itself a governed invariant.

## Enforcement checklist

- [ ] A versioned golden set exists, built from a broad eval suite, with provenance (model id, prompt hash, tool registry version) recorded per record.
- [ ] Golden trajectories are reduced to comparable signatures (tool-call sequence, decision points, reasoning-trace embeddings) — not raw transcripts.
- [ ] Golden-set updates go through an explicit, reviewed, auditable process distinct from normal code review.
- [ ] A build-time regression job (`assertNoBehavioralDrift` or equivalent) runs on every PR touching agent/prompt/tool code, with a pinned model, temperature 0, and mocked external tools.
- [ ] The build-time gate is a required, blocking CI check — not advisory.
- [ ] A runtime sidecar consumes the action ledger (Skill 03) or equivalent event stream as a separate process, out of the agent's request path.
- [ ] The sidecar computes windowed metrics across all defined dimensions: tool distribution, sequence drift, reasoning-semantic drift, output drift, cost/latency/step profile.
- [ ] Warn-band and trip-band thresholds are explicitly defined per metric, tuned against real traffic, and documented.
- [ ] Warn-band signals page on-call non-blocking; trip-band signals automatically engage the circuit breaker (Skill 04) and page on-call as critical.
- [ ] Breaker trips from drift require human-approved reset — no silent auto-recovery.
- [ ] Drift alerts are attributable: the on-call engineer can retrieve the specific metric, window, and underlying traces that triggered the signal.
- [ ] The sidecar's own health (event-ingestion lag, heartbeat) is independently monitored.
- [ ] Framework-level event capture (LangGraph.js stream/callbacks, LlamaIndex.TS workflow events, Microsoft Agent Framework middleware/OTel) is wired to emit tool-call and reasoning-trace data into the ledger in the shape the drift metrics expect.
- [ ] Thresholds and golden-set version are reviewed on a defined cadence, not left static indefinitely.
