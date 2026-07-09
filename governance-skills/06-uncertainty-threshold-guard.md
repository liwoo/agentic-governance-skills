# Skill 06 — The "Uncertainty Threshold" Guard

*Make "ask, don't guess" the enforced default whenever an agent's confidence in a chosen action falls below a hard-coded floor — especially in healthcare, finance, and other high-stakes domains.*

## Governance rationale

Autonomous agents fail silently in a specific, dangerous way: they don't refuse ambiguous tasks, they *resolve* the ambiguity themselves, silently, in whatever direction the sampling process happens to land, and then act on that resolution with the same fluency and confidence as if the task had been unambiguous. There is no visible seam between "the model understood the request" and "the model guessed and moved on." That seam is exactly what this skill forces into existence.

**Ask-don't-assume as the default, not the exception.** Left to its own devices, an LLM-based agent treats every prompt as fully specified — it does not have a native "I don't have enough information" reflex the way a well-trained human professional does. Human experts in regulated domains are trained to escalate or clarify under ambiguity precisely because the cost of a wrong guess is asymmetric with the cost of a clarifying question. Agents need the same reflex engineered in, because it will not emerge from instruction-following alone.

**Cost asymmetry in high-stakes domains.** In a healthcare or finance context, the cost of one extra clarifying turn is measured in seconds of user friction. The cost of a wrong autonomous action — a medication dosage suggestion based on a misread symptom, a trade executed against the wrong account, a loan-eligibility determination based on a misparsed document — is measured in harm, liability, and regulatory exposure. Any system where the expected cost of asking is lower than the expected cost of a low-confidence action *and* the model does not reliably know its own error rate should never let the model make that trade-off unsupervised. The threshold has to be imposed from outside the model's own judgment.

**Calibration vs. overconfidence in LLMs.** This is the crux of why this skill needs to be a deterministic code path rather than a prompted behavior: LLMs are frequently *miscalibrated* — their expressed confidence (verbal or logit-derived) often does not track their actual probability of being correct, and this gap widens after RLHF/instruction-tuning, which tends to push models toward fluent, decisive-sounding answers regardless of underlying certainty. A model can be "confidently wrong" in natural language while never emitting a token that signals doubt. You cannot fix this by asking the model nicely to "let us know when it's not sure" — that instruction competes with the model's learned prior toward helpful-sounding closure, and it will lose more often than a governance program can tolerate.

**Why a hard-coded floor beats trusting the model to volunteer uncertainty.** A prompt instruction ("if unsure, ask") is a *suggestion* the model can ignore, misjudge, or forget under prompt pressure, long context, or adversarial input. A hard-coded threshold check is a **control**, not a suggestion: it runs outside the model's discretion, on a signal that is computed (not self-reported-and-trusted), and it fails closed — if the uncertainty signal cannot be computed at all, the gate should default to blocking, not to proceeding. This is the same design principle as a circuit breaker: the breaker doesn't ask the circuit if it feels overloaded.

## What "good" looks like

- Every `highStakes`-tagged action (tool call, state transition, or terminal response) in the codebase passes through a single, auditable uncertainty gate before execution — no ad hoc, per-node confidence checks scattered through business logic.
- The gate computes an **aggregate uncertainty score** from multiple independent signals (never from self-reported confidence alone) and compares it to a domain-specific, version-controlled threshold.
- Below threshold, the system emits a `RequestClarification` event that suspends execution via the framework's native interrupt/HITL primitive — it does not silently retry, does not silently pick the highest-probability guess, and does not degrade to a hedge-worded response that still executes the action.
- The clarifying question is *targeted* — it names the specific ambiguity (which entity, which of two plausible readings, which missing parameter) rather than asking the user to "please provide more detail."
- Thresholds are calibrated against a labeled dataset per domain, not chosen by intuition, and are re-validated on a cadence as the underlying model or prompt changes.
- A CI job fails the build if a `highStakes`-tagged action is reachable without passing through the gate, or if a system prompt governing a high-stakes agent lacks the required confidence-emission instruction and schema.
- The gate's false-clarification rate and missed-error rate are monitored in production, not just at threshold-selection time.

## Measuring uncertainty (the hard part — be honest)

There is no first-class, provider-guaranteed "confidence" number for an LLM's chosen action. Every technique below is a heuristic proxy, each with known failure modes. Treat this section as an inventory of signals to combine, not a menu to pick one from.

**(a) Token / sequence logprobs, where exposed.** Some providers (notably OpenAI's chat completions API with `logprobs: true` / `top_logprobs`) expose per-token log-probabilities. You can derive a sequence-level score (e.g., mean token logprob, or the probability mass on the top alternative token at each decision point) as a rough signal of how "confident" the decoding process was. Limits: not all providers expose this at all (many hosted/aggregated APIs, and most tool-calling paths, do not); logprobs reflect *token-level* fluency, not semantic/factual correctness — a model can be highly confident about a fluent, wrong answer; and logprobs are essentially unavailable for the structured tool-call arguments that matter most for agentic actions.

**(b) Self-reported confidence via structured output.** Require the model to emit a `confidence: number` (and ideally a `rationale: string`) field alongside its chosen action, constrained by a schema (Zod / JSON Schema) so it cannot be omitted or free-text. This is cheap, works with any provider, and works for tool-call arguments, not just free text. Its critical limit: it is *self-reported* — the same miscalibration and overconfidence bias discussed above applies directly to this number. Models tend to cluster self-reported confidence in a narrow high band (e.g., "85–95%" regardless of actual correctness) unless explicitly rubric-anchored. Mitigate by giving a concrete rubric in the prompt (e.g., "0.9+ only if every required parameter was explicitly stated by the user; below 0.5 if you inferred a required parameter") and by treating this signal as one input to the aggregate score, never the sole gate.

**(c) Self-consistency / sampling agreement.** Run the same decision N times (temperature > 0, or varied few-shot ordering) and measure agreement across samples — e.g., majority-vote fraction, or entropy over the distribution of distinct chosen actions/parameter values. High disagreement across samples is a strong, model-architecture-agnostic uncertainty signal because it doesn't rely on the model *reporting* anything. Cost: N× latency and N× token spend, which is often unacceptable for interactive-latency agent turns — reserve this for the specific high-stakes decision points where the added latency is justified, not for every model call in the graph.

**(d) LLM-as-judge verifier score.** A second, independent model call (ideally a different model or at least a fresh context) evaluates whether the proposed action is well-supported by the available context and flags ambiguity or missing information. This decouples "does the action look reasonable" from the same generation process that produced the action, which helps with some (not all) miscalibration modes — a judge model can still share correlated blind spots with the actor model, especially if they're the same underlying model family.

**(e) Retrieval grounding score.** For RAG-backed actions, does the retrieved context actually contain support for the claim/parameter the model is about to act on? Signals here include retrieval similarity scores against the specific claim (not just the query), citation coverage (can every asserted fact be traced to a retrieved chunk), or a lightweight entailment check between the retrieved passage and the generated claim. Absence of grounding for a high-stakes factual claim is itself a strong uncertainty signal, independent of how confident the model sounds.

**(f) Tool/schema validation certainty.** Did the model's structured tool-call arguments pass schema validation cleanly on the first attempt, or did they require repair (missing required fields, type coercion, enum mismatches)? Frequent schema-validation failures or the presence of placeholder-like values (e.g., a `patientId` that doesn't match any known ID pattern, a suspiciously round dollar amount) are cheap, deterministic, high-signal proxies for "the model didn't actually have this information."

**Combining signals into an aggregate score.** None of (a)–(f) is reliable alone. A practical aggregate is a weighted combination — e.g., `score = w1*selfReported + w2*(1 - sampleDisagreement) + w3*groundingScore + w4*schemaCleanliness`, with weights and the final threshold determined empirically per domain (see [Calibration & tuning](#calibration--tuning)), not guessed. Whatever combination you choose, document it as a versioned function so a threshold change is a reviewable diff, not a silent tweak buried in a prompt.

## Deterministic checks

Three static/build-time checks turn "the team said they'd add confidence checks" into something CI actually verifies.

**(a) Policy: every `highStakes`-tagged action must pass through the gate.** Establish a convention — a decorator, a naming convention, or an explicit tag in a node/tool registry — that marks actions requiring the gate:

```ts
// action-registry.ts
export interface ActionSpec {
  name: string;
  highStakes: boolean;         // domain owner sets this explicitly
  domain: "healthcare" | "finance" | "general";
  handler: (input: unknown, ctx: ActionContext) => Promise<unknown>;
}

export const sendPrescriptionOrder: ActionSpec = {
  name: "sendPrescriptionOrder",
  highStakes: true,
  domain: "healthcare",
  handler: uncertaintyGate(sendPrescriptionOrderImpl, { domain: "healthcare" }),
};
```

The rule: `highStakes: true` implies `handler` must be the *result of wrapping* the raw implementation in `uncertaintyGate(...)` (or the framework-native equivalent) — never the raw implementation directly.

**(b) AST scanner that fails the build on an unwrapped high-stakes action.** Use `ts-morph` to statically verify the wrapping. This example scans object literals assigned to a type annotated (or inferable) as `ActionSpec`, checks `highStakes: true`, and asserts the `handler` property is a call expression to `uncertaintyGate` (directly, or transitively through a small allow-listed chain of known-safe wrappers like `withLogging(uncertaintyGate(...))`).

```ts
// scripts/check-uncertainty-gate.ts
import { Project, SyntaxKind, ObjectLiteralExpression } from "ts-morph";

const ALLOWED_OUTER_WRAPPERS = new Set(["withLogging", "withTracing"]);
const GATE_FN_NAME = "uncertaintyGate";

function findsGateCall(expr: import("ts-morph").Expression): boolean {
  if (expr.getKind() !== SyntaxKind.CallExpression) return false;
  const call = expr.asKindOrThrow(SyntaxKind.CallExpression);
  const calleeName = call.getExpression().getText();

  if (calleeName === GATE_FN_NAME) return true;
  if (ALLOWED_OUTER_WRAPPERS.has(calleeName)) {
    // recurse into the first argument — allow known-safe wrapper chains
    const [firstArg] = call.getArguments();
    return firstArg ? findsGateCall(firstArg) : false;
  }
  return false;
}

function main() {
  const project = new Project({ tsConfigFilePath: "tsconfig.json" });
  const failures: string[] = [];

  for (const sourceFile of project.getSourceFiles("src/**/*.ts")) {
    const objectLiterals = sourceFile.getDescendantsOfKind(
      SyntaxKind.ObjectLiteralExpression,
    );

    for (const obj of objectLiterals) {
      const highStakesProp = obj.getProperty("highStakes");
      if (!highStakesProp) continue;

      const highStakesInit = highStakesProp
        .asKind(SyntaxKind.PropertyAssignment)
        ?.getInitializer();
      if (highStakesInit?.getText() !== "true") continue;

      const nameProp = obj.getProperty("name");
      const actionName =
        nameProp
          ?.asKind(SyntaxKind.PropertyAssignment)
          ?.getInitializer()
          ?.getText() ?? "<unknown action>";

      const handlerProp = obj.getProperty("handler");
      const handlerInit = handlerProp
        ?.asKind(SyntaxKind.PropertyAssignment)
        ?.getInitializer();

      if (!handlerInit || !findsGateCall(handlerInit)) {
        const { line } = sourceFile.getLineAndColumnAtPos(obj.getPos());
        failures.push(
          `${sourceFile.getFilePath()}:${line} — action ${actionName} is ` +
            `highStakes: true but its handler is not wrapped in ${GATE_FN_NAME}(...)`,
        );
      }
    }
  }

  if (failures.length > 0) {
    console.error("Uncertainty gate policy violations:\n" + failures.join("\n"));
    process.exit(1);
  }
  console.log(`Uncertainty gate check passed.`);
}

main();
```

This is illustrative — adapt the traversal to however your codebase actually declares actions (decorators, a builder pattern, a config object registry, LangGraph node functions, etc.). The invariant to enforce doesn't change: statically prove that the code path from "tagged high-stakes" to "executed" cannot bypass the gate.

**(c) Prompt linter for the required confidence instruction and schema.** System prompts for high-stakes agents must instruct the model to emit a calibrated confidence field and must be paired with a structured-output schema that makes that field mandatory. Lint both:

```ts
// scripts/lint-prompts.ts
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const REQUIRED_PHRASES = [
  /confidence/i,
  /ask (the user|for clarification)|request clarification/i,
];

const PROMPT_DIR = "src/prompts/high-stakes";

function lintPromptFile(path: string): string[] {
  const text = readFileSync(path, "utf8");
  const missing = REQUIRED_PHRASES.filter((re) => !re.test(text));
  return missing.map(
    (re) => `${path}: missing required instruction pattern ${re}`,
  );
}

function main() {
  const failures = readdirSync(PROMPT_DIR)
    .filter((f) => f.endsWith(".prompt.md") || f.endsWith(".ts"))
    .flatMap((f) => lintPromptFile(join(PROMPT_DIR, f)));

  if (failures.length > 0) {
    console.error("Prompt lint failures:\n" + failures.join("\n"));
    process.exit(1);
  }
  console.log("Prompt lint passed.");
}

main();
```

Pair this with a schema-presence check (e.g., statically verifying that every high-stakes agent's structured-output Zod schema includes a required `confidence` field — see the schema in the next section) so a prompt cannot claim to ask for confidence while the output schema silently makes the field optional.

## Grounding action — the clarification gate

The gate is the single choke point every high-stakes action must pass through. It computes the aggregate uncertainty score, compares it to a domain threshold, and branches to either execution or a `RequestClarification` event.

```ts
// uncertainty-gate.ts
import { z } from "zod";

export const ActionDecisionSchema = z.object({
  action: z.string(),
  parameters: z.record(z.unknown()),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe(
      "Calibrated confidence 0-1 that every required parameter was " +
        "explicitly grounded in user input or retrieved evidence, not inferred.",
    ),
  rationale: z
    .string()
    .min(1)
    .describe("One sentence: what evidence supports this confidence level."),
});
export type ActionDecision = z.infer<typeof ActionDecisionSchema>;

// Domain-specific thresholds — version-controlled, not tuned inline.
// See "Calibration & tuning" for how these numbers are derived.
export const DOMAIN_THRESHOLDS: Record<string, number> = {
  healthcare: 0.9,
  finance: 0.85,
  general: 0.6,
};

export interface ActionContext {
  domain: keyof typeof DOMAIN_THRESHOLDS | string;
  retrievalGroundingScore?: number;  // (e) 0-1, from RAG pipeline
  sampleAgreement?: number;          // (c) 0-1, from self-consistency pass
  schemaCleanliness?: number;        // (f) 0-1, 1.0 = validated on first try
}

export interface RequestClarificationEvent {
  type: "RequestClarification";
  reason: string;
  question: string;
  proposedAction: ActionDecision;
  aggregateScore: number;
  threshold: number;
}

function aggregateUncertainty(
  decision: ActionDecision,
  ctx: ActionContext,
): number {
  const weights = { selfReported: 0.35, grounding: 0.3, agreement: 0.2, schema: 0.15 };
  const grounding = ctx.retrievalGroundingScore ?? 0.5;   // unknown = neutral, not confident
  const agreement = ctx.sampleAgreement ?? 0.5;
  const schema = ctx.schemaCleanliness ?? 0.5;

  return (
    weights.selfReported * decision.confidence +
    weights.grounding * grounding +
    weights.agreement * agreement +
    weights.schema * schema
  );
}

function draftClarifyingQuestion(decision: ActionDecision): string {
  // In production this is typically itself a small LLM call constrained to
  // "name the single most ambiguous required parameter and ask one targeted
  // question about it" — kept separate from the action-generation call so a
  // low-confidence decision doesn't also produce a low-quality question.
  return (
    `Before I ${decision.action}, I need to confirm: ${decision.rationale} ` +
    `Can you clarify the specifics?`
  );
}

export async function uncertaintyGate<TResult>(
  impl: (input: unknown, ctx: ActionContext) => Promise<TResult>,
  gateConfig: { domain: string },
) {
  return async function gated(
    decision: ActionDecision,
    ctx: ActionContext,
  ): Promise<TResult | RequestClarificationEvent> {
    const parsed = ActionDecisionSchema.parse(decision); // fail closed on malformed output
    const threshold =
      DOMAIN_THRESHOLDS[gateConfig.domain] ?? DOMAIN_THRESHOLDS.general;
    const score = aggregateUncertainty(parsed, ctx);

    if (score < threshold) {
      return {
        type: "RequestClarification",
        reason: `Aggregate uncertainty ${score.toFixed(2)} below ` +
          `${gateConfig.domain} threshold ${threshold}`,
        question: draftClarifyingQuestion(parsed),
        proposedAction: parsed,
        aggregateScore: score,
        threshold,
      };
    }

    return impl(parsed.parameters, ctx);
  };
}
```

Note the fail-closed details: a malformed decision (missing `confidence`) throws via `.parse()` rather than defaulting to a permissive value, and missing upstream signals (`ctx.retrievalGroundingScore` etc.) default to a neutral `0.5`, not to `1.0` — an absent signal must never read as confident.

## Wiring `RequestClarification` to human-in-the-loop

`RequestClarification` is an event, not a UI action — it needs to be wired to whatever interrupt/pause primitive the host framework provides so the run actually suspends (not just logs a warning and continues), waits for a real human answer, and resumes with that answer merged back into state. The shape is consistent across frameworks even though the primitive names differ:

1. Gate returns a `RequestClarification` event instead of a result.
2. The orchestration layer (graph/workflow engine) treats that event as a signal to invoke the framework's native interrupt/pause primitive, surfacing `question` (and ideally `proposedAction`/`rationale` for transparency) to the human.
3. Execution suspends — not polls, not retries with a lower bar — until a human response arrives.
4. The human's answer is merged into the graph/workflow state and the *same* action decision step re-runs (or is fed the clarified parameters directly), re-entering the gate rather than bypassing it on resume.

The framework-specific wiring for step 2–4 is shown next.

## Framework-specific enforcement

### LangGraph.js

Route on the gate's output using a conditional edge, and use `interrupt()` inside the `request_clarification` node so the graph genuinely pauses (durable, checkpointed) rather than just branching in-memory. Resume by re-invoking with a `Command({ resume: ... })`.

```ts
// graph.ts (illustrative — verify exact interrupt()/Command signatures
// against your installed @langchain/langgraph version; the interrupt/resume
// contract has evolved across releases)
import { StateGraph, Annotation, interrupt, Command } from "@langchain/langgraph";

const State = Annotation.Root({
  decision: Annotation<ActionDecision | undefined>,
  aggregateScore: Annotation<number>,
  clarificationAnswer: Annotation<string | undefined>,
});

async function proposeAction(state: typeof State.State) {
  // ... model call + gate scoring, populates decision/aggregateScore
  return state;
}

function routeOnConfidence(state: typeof State.State) {
  return state.aggregateScore < DOMAIN_THRESHOLDS.healthcare
    ? "request_clarification"
    : "execute_action";
}

async function requestClarificationNode(state: typeof State.State) {
  // interrupt() halts the graph and surfaces its payload to the caller;
  // the graph resumes here with whatever value the caller passes back
  // via Command({ resume: ... }).
  const answer = interrupt({
    question: draftClarifyingQuestion(state.decision!),
    proposedAction: state.decision,
  });
  return { clarificationAnswer: answer };
}

const graph = new StateGraph(State)
  .addNode("propose_action", proposeAction)
  .addNode("request_clarification", requestClarificationNode)
  .addNode("execute_action", executeActionNode)
  .addConditionalEdges("propose_action", routeOnConfidence, {
    request_clarification: "request_clarification",
    execute_action: "execute_action",
  })
  .addEdge("request_clarification", "propose_action") // re-enter the gate, don't bypass it
  .compile({ checkpointer });

// Resuming after a human answers, in a later request:
// await graph.invoke(new Command({ resume: humanAnswerText }), config);
```

The important governance detail is the edge back from `request_clarification` to `propose_action` (re-scoring with the clarified input), not directly to `execute_action` — the clarification answer must be re-evaluated by the gate, not trusted to have fully resolved the ambiguity.

### LlamaIndex.TS

Use structured chat output with a required `confidence` field, and branch within a workflow step to a human-input step when the score is below threshold. LlamaIndex.TS workflows are built from custom events and step handlers; the exact event/workflow API surface (`workflowEvent`, `.handle`, and how a step pauses for external/human input) has moved across package versions — confirm current names against your installed version before wiring this in production.

```ts
// workflow.ts (illustrative — confirm current workflow package/event API
// against your installed LlamaIndex.TS version)
import { openai } from "@llamaindex/openai";
import { z } from "zod";

const ActionDecisionSchema = z.object({
  action: z.string(),
  parameters: z.record(z.unknown()),
  confidence: z.number().min(0).max(1),
  rationale: z.string(),
});

async function proposeActionStructured(input: string) {
  const llm = openai({ model: "gpt-4.1" });
  // Structured/JSON-schema-constrained output — parameter name and shape
  // vary by LlamaIndex.TS version; treat as illustrative.
  const response = await llm.chat({
    messages: [{ role: "user", content: input }],
    responseFormat: ActionDecisionSchema,
  });
  return ActionDecisionSchema.parse(response.message.content);
}

// Inside a workflow step: score the decision, and instead of returning a
// StopEvent that executes the action, emit a clarification-request event
// that the host application surfaces to the user and awaits a response for,
// re-entering the workflow with the human's answer on the next step.
async function decisionStep(decision: ActionDecision, ctx: ActionContext) {
  const score = aggregateUncertainty(decision, ctx);
  if (score < DOMAIN_THRESHOLDS[ctx.domain]) {
    return { type: "RequestClarification", question: draftClarifyingQuestion(decision) };
  }
  return { type: "ExecuteAction", decision };
}
```

Whatever the current human-input primitive is named in your installed workflow package, the governance requirement is unchanged: the branch that fires below threshold must suspend the workflow for a real external response, not synthesize one internally.

### Microsoft Agent Framework

Model the gate as middleware that inspects the agent's structured output before a function/tool invocation is allowed to proceed, short-circuiting to a clarification path when confidence is below threshold. **Language note:** Microsoft Agent Framework ships **only .NET and Python SDKs** — there is **no official JS/TS package** (`@microsoft/agent-framework` does not exist). The TypeScript below documents the gate pattern for a Node port; if your agents are in .NET/Python, implement it as a `FunctionMiddleware` (Python `@function_middleware` / .NET function-calling middleware registered via `.AsBuilder().Use(...)`) that reads the structured `confidence` field and short-circuits to the clarification path. Verify current type and method names against your installed SDK version.

```ts
// middleware.ts (illustrative — confirm exact middleware interface and
// package name against your installed Agent Framework SDK version)
interface AgentMiddlewareContext {
  proposedAction: ActionDecision;
  domain: string;
  actionContext: ActionContext;
  next: () => Promise<unknown>;
  requestClarification: (question: string) => Promise<unknown>;
}

async function uncertaintyThresholdMiddleware(mw: AgentMiddlewareContext) {
  const score = aggregateUncertainty(mw.proposedAction, mw.actionContext);
  const threshold = DOMAIN_THRESHOLDS[mw.domain] ?? DOMAIN_THRESHOLDS.general;

  if (score < threshold) {
    // Short-circuits the pipeline: the wrapped function/tool call never
    // executes; control returns to the host's HITL/approval surface instead.
    return mw.requestClarification(draftClarifyingQuestion(mw.proposedAction));
  }
  return mw.next();
}
```

The governance-relevant property to verify, regardless of exact API shape: middleware must be able to **prevent** `next()` from running (a true short-circuit), not merely observe and log after the fact — an after-the-fact-only middleware cannot serve as an enforcement point.

## Calibration & tuning

A threshold with no empirical backing is a placebo — it looks like governance in a code review but tells you nothing about actual risk. Calibrate it like any other classifier threshold:

1. **Build a labeled set.** Collect (or construct) a representative sample of past decisions in the domain, each labeled with ground truth: was the action the model chose actually correct/appropriate? Include a deliberately high proportion of ambiguous/edge cases — that's where the gate earns its keep, and where an unrepresentative sample (all easy cases) will make any threshold look fine.
2. **Plot confidence vs. correctness — a reliability diagram.** Bucket predictions by aggregate uncertainty score (e.g., deciles) and plot actual accuracy within each bucket against the bucket's mean predicted score. A perfectly calibrated system sits on the diagonal. LLM-derived confidence signals are frequently *not* on the diagonal — expect to see over-confidence (accuracy below the diagonal) especially in the 0.7–0.95 range, which is exactly the range that matters most for threshold placement.
3. **Pick the threshold at an acceptable risk level**, not at the point of maximum accuracy. In healthcare/finance, the operating question is "what's the minimum score at which the *false-negative* rate (confidently-wrong actions that proceed) is below our risk tolerance" — this is a business/compliance decision informed by the reliability diagram, not a pure ML metric.
4. **Monitor the gate's precision/recall in production**, treating "clarification fires" as a classifier prediction:
   - *False clarifications* (gate fires on a genuinely unambiguous case) — measured by clarification-request rate and, ideally, sampled human review of whether the question was actually necessary. High rates cause clarification fatigue and erode user trust in the system's competence.
   - *Missed errors* (gate passes a case that later turns out to have been acted on incorrectly) — measured via downstream error/incident review, tied back to the aggregate score that was computed at decision time (log it even when the gate passes).
5. **Recalibrate on a cadence**, and immediately after any change to the underlying model, prompt, or retrieval pipeline — calibration drifts when any upstream component changes, even if the threshold constant in code doesn't.

Never ship a threshold that exists only as an inline magic number chosen by intuition (`if (confidence < 0.8)`) with no labeled-set validation behind it — that number should be traceable to a specific calibration run, versioned, and owned by whoever is accountable for the domain's risk tolerance.

## CI/CD integration

Wire the deterministic checks and a behavioral eval into the pipeline so a high-stakes action skipping the gate, or a prompt missing the confidence instruction, fails the build — and so a regression in the gate's actual firing behavior is caught before merge, not in production.

```json
// package.json (excerpt)
{
  "scripts": {
    "governance:uncertainty-scan": "tsx scripts/check-uncertainty-gate.ts",
    "governance:prompt-lint": "tsx scripts/lint-prompts.ts",
    "governance:gate-eval": "vitest run test/uncertainty-gate.eval.test.ts"
  }
}
```

```ts
// test/uncertainty-gate.eval.test.ts — asserts the gate actually fires
// on a known-ambiguous fixture set, not just that it compiles.
import { describe, it, expect } from "vitest";
import { uncertaintyGate, DOMAIN_THRESHOLDS } from "../src/uncertainty-gate";
import { AMBIGUOUS_HEALTHCARE_FIXTURES, UNAMBIGUOUS_HEALTHCARE_FIXTURES } from "./fixtures";

describe("uncertainty gate — healthcare", () => {
  it("fires RequestClarification on known-ambiguous cases", async () => {
    for (const fixture of AMBIGUOUS_HEALTHCARE_FIXTURES) {
      const gated = await uncertaintyGate(fixture.impl, { domain: "healthcare" });
      const result = await gated(fixture.decision, fixture.ctx);
      expect((result as { type?: string }).type).toBe("RequestClarification");
    }
  });

  it("does not fire on well-grounded, unambiguous cases", async () => {
    for (const fixture of UNAMBIGUOUS_HEALTHCARE_FIXTURES) {
      const gated = await uncertaintyGate(fixture.impl, { domain: "healthcare" });
      const result = await gated(fixture.decision, fixture.ctx);
      expect((result as { type?: string }).type).not.toBe("RequestClarification");
    }
  });
});
```

```yaml
# .github/workflows/governance.yml
name: governance-checks
on:
  pull_request:
    paths:
      - "src/**"
      - "scripts/check-uncertainty-gate.ts"
      - "scripts/lint-prompts.ts"

jobs:
  uncertainty-threshold-guard:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - name: AST scan — high-stakes actions must be gated
        run: npm run governance:uncertainty-scan
      - name: Prompt lint — confidence instruction required
        run: npm run governance:prompt-lint
      - name: Gate eval — fires on known-ambiguous fixtures
        run: npm run governance:gate-eval
```

Scope the workflow to `pull_request` on paths touching action registries, gate implementation, or prompts, so this doesn't run (and doesn't get ignored as noise) on unrelated changes — but treat any failure here as a merge blocker, not a warning, since a silently unwrapped high-stakes action is exactly the failure mode this skill exists to prevent.

## Failure modes & bypass risks

- **Self-confidence is miscalibrated or gameable.** A model under prompt pressure (long context, adversarial framing, or simply repeated exposure to the same rubric) can learn to emit high `confidence` values regardless of actual certainty, especially if the rubric is static and visible in a fine-tuned or heavily-cached system prompt. *Mitigation:* never let self-reported confidence be the sole or dominant signal in the aggregate score; weight grounding and schema-cleanliness signals, which are harder to game because they're computed independently of the model's own assertion.
- **Logprobs unavailable on many APIs.** Several major providers and most tool-calling/function-calling code paths don't expose usable logprobs at all, and aggregating providers often strip them. *Mitigation:* design the aggregate score to degrade gracefully — treat missing signals as neutral (not confident), and don't build a gate architecture that hard-depends on a signal only one provider offers.
- **Self-consistency cost and latency.** N-way sampling multiplies both cost and user-facing latency, which is often incompatible with interactive agent turns. *Mitigation:* reserve self-consistency sampling for the specific decision points flagged as highest-stakes within an already-high-stakes domain (e.g., irreversible actions), not as a blanket policy on every model call.
- **Threshold too high → clarification fatigue.** An overly conservative threshold causes the agent to interrupt constantly, including on genuinely unambiguous requests, which trains users to blindly click through clarification prompts — defeating the control's purpose by habituating the human to ignore it. *Mitigation:* the precision-monitoring loop in [Calibration & tuning](#calibration--tuning) exists specifically to catch and correct this; treat a rising false-clarification rate as a real incident, not just an annoyance.
- **Threshold too low → unsafe autonomy.** The inverse failure — a threshold calibrated (or drifted) too permissively lets confidently-wrong actions through unchallenged, which is the exact harm this skill exists to prevent. *Mitigation:* recalibrate after any upstream model/prompt/retrieval change, not only on a fixed calendar cadence, and alert on missed-error findings from incident review, feeding them back into the labeled calibration set.
- **Adversarial inputs inflating confidence.** A crafted input (prompt injection, or a legitimate-looking but subtly wrong document in a RAG pipeline) can push both the model's self-reported confidence and its grounding score high simultaneously, defeating the aggregate. *Mitigation:* this skill does not substitute for input validation and prompt-injection defenses — the uncertainty gate is one layer; it should sit alongside, not instead of, content/provenance checks on retrieved evidence and user input.

## Enforcement checklist

- [ ] Every action reachable from a high-stakes domain is explicitly tagged (`highStakes: true`) in a single, auditable registry — not inferred implicitly from code location.
- [ ] An AST scanner (ts-morph or equivalent) runs in CI and fails the build if any `highStakes` action's handler is not wrapped by `uncertaintyGate` (or the framework-native equivalent enforcement point).
- [ ] A prompt linter runs in CI and fails the build if a high-stakes system prompt lacks the required confidence-emission and ask-when-unsure instructions.
- [ ] The structured-output schema for every high-stakes agent has a **required** (not optional) `confidence` field plus a `rationale`, enforced by a schema library (Zod/JSON Schema), not by prompt instruction alone.
- [ ] The aggregate uncertainty score combines at least two independent signal families (e.g., self-reported confidence + grounding, or + self-consistency) — no gate ships on self-reported confidence alone.
- [ ] Missing/unavailable upstream signals default to neutral, never to "confident" — the gate fails closed.
- [ ] `RequestClarification` is wired to the framework's real interrupt/HITL primitive (LangGraph `interrupt()`/`Command`, LlamaIndex.TS workflow human-input step, or Agent Framework middleware short-circuit) — not a log line, not a silent retry.
- [ ] The clarification path re-enters the gate on resume rather than trusting the human's answer to bypass re-scoring.
- [ ] Domain thresholds are calibrated against a labeled dataset with a reliability diagram, versioned in source control, and owned by a named accountable party — not an inline magic number.
- [ ] Production monitoring tracks both false-clarification rate and missed-error rate for the gate, feeding back into recalibration.
- [ ] A CI eval asserts the gate actually fires on a known-ambiguous fixture set and does not fire on known-unambiguous fixtures — not just that the code compiles and types check.
- [ ] Threshold and weighting changes are reviewed as governance changes (not routine PRs) given their direct bearing on user safety and regulatory exposure.
