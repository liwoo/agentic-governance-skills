# Skill 04 — The "Circuit Breaker" & Kill-Switch

*Every agent process must be interruptible, and every interruption must leave the world in a safe state — not just a stopped one.*

## Governance rationale

Autonomy without an off switch is not autonomy management, it's a bet. The core governance property this skill enforces is **corrigibility**: the guarantee that a human (or an automated supervisor) can stop an agent's execution and undo or neutralize its authority to act, regardless of what the agent "wants" to do next or how deep in a reasoning loop it currently is. Corrigibility is not a soft UX nicety — it is the last line of defense when every other control (prompt constraints, tool allowlists, budget caps) has failed to prevent goal drift, a prompt injection, a runaway tool-call loop, or a plain logic bug that sends the agent down an unintended path.

Bounded autonomy means an agent is trusted to act independently *within* a boundary, and the boundary must be enforceable from outside the agent's own reasoning process — because an agent that has deviated from its goal cannot be trusted to correctly decide when to stop itself. That decision has to be structurally external: a signal, a flag, a process boundary the agent's own token generation cannot talk its way around.

It's important to separate two failure-response concepts that get conflated:

- **Graceful stop** — the agent (or its host process) receives a signal, stops issuing new tool calls, finishes or aborts in-flight work cleanly, and runs teardown logic before exiting. This is the preferred path because teardown logic is exactly where you revoke credentials and notify people.
- **Hard kill** — the process is terminated by the OS or infrastructure layer (`SIGKILL`, pod eviction, VM reclaim) with no opportunity to run application code at all. This is the necessary backstop for when graceful stop doesn't happen fast enough or the process is unresponsive, but it means **no JavaScript will run** — no credential revocation, no ledger flush, no notification — unless that logic lives outside the process being killed.

This is why credential revocation and stakeholder notification on termination matter so much: an agent process holds *live* capabilities — API keys, OAuth tokens, database sessions, webhook URLs it can call. If you kill the process without revoking what it was holding, you've stopped the *reasoning* but not the *authority*. A terminated agent can still have consequences in flight: a scheduled webhook it registered, a payment it initiated, a long-lived token that's still valid for the next six hours. Killing the process is necessary but not sufficient; the governance requirement is killing the *blast radius*.

## What "good" looks like

- Every agent entrypoint process (CLI runner, worker, server handling agent invocations) registers a listener for `SIGTERM` and `SIGINT` before it starts doing agentic work, not as an afterthought.
- Every agent has a **tested** fallback/teardown routine — not just code that exists, but code that has been exercised in CI by actually sending the signal and asserting on outcomes (credentials revoked, notification sent, ledger flushed).
- A **remote kill channel** exists independent of the process's own signal handling — an out-of-band flag the agent polls — so a human or monitoring system can stop an agent even if it's running somewhere SIGTERM can't easily reach (a serverless function, a detached background job, a machine you don't have shell access to).
- Long-running loops and tool-call sequences honor an `AbortSignal` (or equivalent cancellation token) checked at every step boundary, not just at process start.
- Credentials issued to an agent are short-TTL by default, so that even a *failed* revocation self-heals within a bounded window.
- Circuit breakers trip automatically on anomaly signals (error rate, spend, step count, drift) without waiting for a human to notice.

## Threat model & stop taxonomy

Governance requires distinguishing four different "stop" mechanisms, because they have different triggers, different guarantees, and different failure modes. A mature deployment needs all four layered together — no single one is sufficient on its own.

**(a) Circuit breaker — automatic internal trip on anomaly.** This is *self-defense*: the agent process itself monitors its own behavior — error rate, consecutive tool failures, cumulative spend against a budget, step/loop count, or a drift signal fed from the behavioral-drift detector (Skill 08) — and trips itself into a halted state without any external actor pulling a switch. This is the fastest possible stop because it requires zero round-trip latency to anything outside the process. It is also the *weakest* guarantee, because it depends entirely on the process still being healthy enough to run its own monitoring code — a truly runaway or compromised agent process might have that logic bypassed or overwhelmed.

**(b) Graceful kill — `SIGTERM`/`SIGINT` → drain and teardown.** This is the standard "please stop" signal from the OS, an orchestrator (Kubernetes sending `SIGTERM` before a pod eviction deadline), or a human running `kill <pid>`. The process gets a window (Kubernetes defaults to 30s via `terminationGracePeriodSeconds`) to run its shutdown hooks before a forced `SIGKILL` follows. This is where the fallback/teardown script (Section 6) does its work: stop accepting new work, abort in-flight tool calls, revoke credentials, flush the ledger, notify.

**(c) Hard kill — `SIGKILL` / infrastructure-level termination.** This cannot be caught, handled, or delayed — the process disappears mid-instruction with zero opportunity to run application code. This happens on OOM kills, exceeded grace periods, forceful `docker kill -9`, spot-instance reclamation, or infra operators bypassing graceful shutdown entirely. **Because no JS handler can run here, teardown logic must also be achievable from *outside* the process** — a sidecar or control-plane component that revokes credentials on its behalf, and credentials that are short-TTL enough that even zero revocation self-expires quickly.

**(d) Remote kill switch — out-of-band flag the agent polls.** This is a control channel that doesn't rely on the OS being able to deliver a signal to the process at all — a Redis key, a database row, a feature flag, or a control-plane endpoint that the agent checks before each step or tool call. This is essential for agents running in environments where you can't easily send a Unix signal (serverless functions, agents running inside a third-party orchestration platform, distributed workers behind a load balancer) or where you want a human-operated "big red button" in a dashboard that doesn't require SSH access or `kubectl` privileges to pull.

You need all four layers because each one covers a gap the others leave open: the circuit breaker catches problems the fastest but can be blinded by the same failure that caused the problem; graceful kill lets you do real cleanup but assumes the process is still responsive; hard kill guarantees termination but guarantees nothing else; the remote switch gives you control when you can't reach the process directly at all. None of them, alone, gives you both *speed* and *safety*.

## Deterministic checks

The check is static analysis over the codebase: does every agent entrypoint actually wire up signal handling, and does a teardown module exist and get referenced from it? This is enforceable with `ts-morph`, walking the AST rather than grepping text, so it isn't fooled by comments, string literals, or handlers registered conditionally in unreachable branches.

```ts
// scripts/governance/check-kill-switch.ts
//
// Deterministic scanner: fails the build if any agent entrypoint lacks a
// SIGTERM/SIGINT listener, or if no teardown/fallback module is referenced
// from that listener.
//
// Run: npx ts-node scripts/governance/check-kill-switch.ts

import { Project, SyntaxKind, SourceFile, CallExpression } from "ts-morph";
import { globSync } from "glob";
import path from "node:path";

interface Violation {
  file: string;
  reason: string;
}

const ENTRYPOINT_GLOBS = [
  "src/agents/**/entrypoint.ts",
  "src/agents/**/*worker*.ts",
  "src/agents/**/server.ts",
  "src/agents/**/runner.ts",
];

const SIGNALS_REQUIRED = ["SIGTERM", "SIGINT"];

// Names we accept as evidence that teardown/revocation logic is wired in.
// Adjust to match your repo's actual exported symbol names.
const TEARDOWN_SYMBOL_HINTS = [
  "gracefulShutdown",
  "teardown",
  "revokeCredentials",
  "rotateApiKey",
];

function findProcessOnCalls(sf: SourceFile): CallExpression[] {
  return sf
    .getDescendantsOfKind(SyntaxKind.CallExpression)
    .filter((call) => {
      const expr = call.getExpression();
      // Matches: process.on("SIGTERM", handler)
      return (
        expr.getKind() === SyntaxKind.PropertyAccessExpression &&
        expr.getText() === "process.on"
      );
    });
}

function getSignalArg(call: CallExpression): string | undefined {
  const [first] = call.getArguments();
  if (!first) return undefined;
  const text = first.getText().replace(/["'`]/g, "");
  return text;
}

function callReferencesTeardown(call: CallExpression, sf: SourceFile): boolean {
  const handlerArg = call.getArguments()[1];
  if (!handlerArg) return false;

  // Case 1: process.on("SIGTERM", gracefulShutdown) — direct reference.
  const directText = handlerArg.getText();
  if (TEARDOWN_SYMBOL_HINTS.some((hint) => directText.includes(hint))) {
    return true;
  }

  // Case 2: process.on("SIGTERM", () => { ...gracefulShutdown()... }) — inline
  // arrow/function whose body calls a teardown symbol.
  const bodyText = handlerArg.getText();
  return TEARDOWN_SYMBOL_HINTS.some((hint) => bodyText.includes(hint));
}

function fileImportsTeardownModule(sf: SourceFile): boolean {
  return sf.getImportDeclarations().some((imp) => {
    const spec = imp.getModuleSpecifierValue();
    return /teardown|shutdown|kill-switch/i.test(spec);
  });
}

function checkEntrypoint(sf: SourceFile): Violation[] {
  const violations: Violation[] = [];
  const onCalls = findProcessOnCalls(sf);
  const registeredSignals = new Set(
    onCalls.map(getSignalArg).filter((s): s is string => !!s)
  );

  for (const required of SIGNALS_REQUIRED) {
    if (!registeredSignals.has(required)) {
      violations.push({
        file: sf.getFilePath(),
        reason: `Missing process.on("${required}", ...) listener.`,
      });
    }
  }

  const anyCallWiresTeardown = onCalls.some((c) => callReferencesTeardown(c, sf));
  const importsTeardown = fileImportsTeardownModule(sf);

  if (!anyCallWiresTeardown && !importsTeardown) {
    violations.push({
      file: sf.getFilePath(),
      reason:
        "Signal handler(s) present but no reference to a teardown/shutdown module found " +
        `(expected an import matching /teardown|shutdown|kill-switch/ or a call to one of: ${TEARDOWN_SYMBOL_HINTS.join(", ")}).`,
    });
  }

  return violations;
}

// Long-running loops (agent step loops) must honor an AbortSignal or a
// polled kill flag. We flag `while (true)` / unbounded `for` loops inside
// files that also contain agent step/tool-call invocation without any
// visible `signal.aborted` / `checkKillSwitch(` check in the same file.
function checkLoopsHonorAbort(sf: SourceFile): Violation[] {
  const violations: Violation[] = [];
  const text = sf.getFullText();
  const hasUnboundedLoop = /while\s*\(\s*true\s*\)/.test(text);
  const hasStepLikeCall = /\.(invoke|stream|run|step)\s*\(/.test(text);
  const honorsAbort = /signal\.aborted|checkKillSwitch\(|AbortSignal/.test(text);

  if (hasUnboundedLoop && hasStepLikeCall && !honorsAbort) {
    violations.push({
      file: sf.getFilePath(),
      reason:
        "Unbounded loop drives agent step/tool calls but no AbortSignal or " +
        "checkKillSwitch() check was found in the loop body.",
    });
  }
  return violations;
}

function main() {
  const project = new Project({
    tsConfigFilePath: path.resolve("tsconfig.json"),
  });

  const files = globSync(ENTRYPOINT_GLOBS, { cwd: process.cwd() });
  if (files.length === 0) {
    console.error("No agent entrypoints matched — check ENTRYPOINT_GLOBS.");
    process.exit(1);
  }

  const violations: Violation[] = [];
  for (const file of files) {
    const sf = project.addSourceFileAtPath(file);
    violations.push(...checkEntrypoint(sf));
    violations.push(...checkLoopsHonorAbort(sf));
  }

  if (violations.length > 0) {
    console.error(`\n✖ Kill-switch governance check failed (${violations.length} violation(s)):\n`);
    for (const v of violations) {
      console.error(`  ${v.file}\n    → ${v.reason}\n`);
    }
    process.exit(1);
  }

  console.log(`✓ Kill-switch governance check passed for ${files.length} entrypoint(s).`);
}

main();
```

This scanner is deliberately conservative: it looks for structural evidence (a `process.on` call, an import path, a symbol reference) rather than trying to fully evaluate control flow, because a static checker that tries to be too clever produces false negatives that are worse than a slightly noisy false positive a reviewer has to dismiss. Tune `TEARDOWN_SYMBOL_HINTS` and `ENTRYPOINT_GLOBS` to your repo's actual naming.

## Grounding action — the fallback/teardown script

The teardown routine is the piece that actually matters — a signal handler that just calls `process.exit()` provides no governance value at all. `gracefulShutdown()` must be **idempotent** (signals can arrive more than once, and Kubernetes may send `SIGTERM` followed later by `SIGKILL` — you don't want double credential rotation racing itself), and it must have a **hard timeout** so a hung teardown doesn't turn a graceful kill into an indefinite hang that just delays the inevitable `SIGKILL` anyway.

```ts
// src/agents/lifecycle/graceful-shutdown.ts

import { setTimeout as delay } from "node:timers/promises";

export interface ShutdownDeps {
  abortController: AbortController;
  revokeCredentials: (reason: string) => Promise<void>;
  flushActionLedger: () => Promise<void>; // see Skill 03 — action ledger
  notify: (event: ShutdownNotification) => Promise<void>;
  logger: Pick<Console, "info" | "error">;
}

export interface ShutdownNotification {
  agentId: string;
  reason: "SIGTERM" | "SIGINT" | "circuit_breaker" | "remote_kill_switch";
  timestamp: string;
  inFlightToolCalls: number;
}

const HARD_TIMEOUT_MS = 10_000;

let shutdownState: "idle" | "in_progress" | "complete" = "idle";
let inFlightToolCalls = 0;

export function trackToolCallStart() {
  inFlightToolCalls += 1;
}
export function trackToolCallEnd() {
  inFlightToolCalls = Math.max(0, inFlightToolCalls - 1);
}

/**
 * The single entrypoint for stopping an agent process cleanly.
 * Safe to call multiple times — subsequent calls are no-ops while a
 * shutdown is in progress or already complete.
 */
export async function gracefulShutdown(
  agentId: string,
  reason: ShutdownNotification["reason"],
  deps: ShutdownDeps
): Promise<void> {
  if (shutdownState !== "idle") {
    deps.logger.info(`[shutdown] Already ${shutdownState}, ignoring duplicate trigger (${reason}).`);
    return;
  }
  shutdownState = "in_progress";
  deps.logger.info(`[shutdown] Initiating graceful shutdown for ${agentId}, reason=${reason}`);

  // 1. Global halt flag — every step/tool-call gate checks this synchronously.
  //    Setting it first stops new work from starting while teardown runs.
  globalHaltFlag.halted = true;

  // 2. Abort in-flight tool calls. Any fetch/tool invocation that was given
  //    `deps.abortController.signal` will reject/unwind immediately.
  deps.abortController.abort(new Error(`shutdown: ${reason}`));

  const teardown = async () => {
    // 3. Revoke/rotate credentials FIRST — this is the step that actually
    //    shrinks the blast radius. Do it before the ledger flush so that
    //    even if the ledger flush hangs, credentials are already dead.
    await deps.revokeCredentials(reason);

    // 4. Flush the action ledger (Skill 03) so the audit trail captures
    //    everything up to the moment of termination — critical for
    //    post-incident review of what the agent did before it was killed.
    await deps.flushActionLedger();

    // 5. Notify stakeholders that the agent was terminated mid-sequence.
    await deps.notify({
      agentId,
      reason,
      timestamp: new Date().toISOString(),
      inFlightToolCalls,
    });
  };

  // Hard timeout: if teardown hangs (network partition to the secrets
  // manager, a webhook that never resolves), force-exit rather than let
  // the process linger until the orchestrator's SIGKILL grace period
  // expires with an unpredictable amount of teardown work half-done.
  const result = await Promise.race([
    teardown().then(() => "completed" as const),
    delay(HARD_TIMEOUT_MS).then(() => "timed_out" as const),
  ]);

  shutdownState = "complete";

  if (result === "timed_out") {
    deps.logger.error(
      `[shutdown] Teardown exceeded ${HARD_TIMEOUT_MS}ms hard timeout — force-exiting. ` +
        `Credential revocation may be incomplete; rely on short TTLs as backstop.`
    );
    process.exit(1);
  }

  deps.logger.info(`[shutdown] Graceful shutdown complete for ${agentId}.`);
  process.exit(0);
}

export const globalHaltFlag = { halted: false };

/** Wire this at process entrypoint, before any agent work begins. */
export function registerKillSwitch(agentId: string, deps: ShutdownDeps) {
  const handler = (signal: "SIGTERM" | "SIGINT") => () =>
    void gracefulShutdown(agentId, signal, deps);

  process.on("SIGTERM", handler("SIGTERM"));
  process.on("SIGINT", handler("SIGINT"));
}
```

Notes on the ordering choices above: credential revocation happens *before* the ledger flush and notification, deliberately — if teardown itself gets interrupted (another signal, an unrelated crash), you want the highest-value action (killing live credentials) to have already landed. Ledger completeness and notification are important but secondary to actually closing the blast radius.

## Circuit breaker (automatic trips)

The circuit breaker is the internal, zero-latency layer: it watches the agent's own behavior and trips without waiting for any external actor. Model it on the standard closed → open → half-open state machine used for service resilience, but trip on governance-relevant signals rather than just latency: error rate, consecutive tool failures, cumulative spend, step count, and drift score fed from the behavioral-drift detector (Skill 08).

```ts
// src/agents/lifecycle/circuit-breaker.ts

export type BreakerState = "closed" | "open" | "half_open";

export interface BreakerConfig {
  maxConsecutiveFailures: number;
  maxErrorRate: number;        // failures / total, over `window`
  window: number;              // rolling window size (call count)
  maxSpendUsd: number;         // cumulative budget cap
  maxSteps: number;            // loop/step-count cap
  halfOpenAfterMs: number;     // cool-down before probing again
  driftThreshold?: number;     // optional: Skill 08 drift score, 0..1
}

export interface BreakerEvent {
  type: "success" | "failure";
  costUsd?: number;
  driftScore?: number;
}

export class CircuitBreaker {
  private state: BreakerState = "closed";
  private consecutiveFailures = 0;
  private history: Array<"success" | "failure"> = [];
  private cumulativeSpend = 0;
  private stepCount = 0;
  private openedAt: number | null = null;

  constructor(
    private readonly config: BreakerConfig,
    private readonly onOpen: (reason: string) => void
  ) {}

  getState(): BreakerState {
    if (this.state === "open" && this.openedAt !== null) {
      const elapsed = Date.now() - this.openedAt;
      if (elapsed >= this.config.halfOpenAfterMs) {
        this.state = "half_open";
      }
    }
    return this.state;
  }

  /** Call before executing a tool call / step. Throws if the breaker is open. */
  assertClosed() {
    const state = this.getState();
    if (state === "open") {
      throw new CircuitOpenError("Circuit breaker is open — tool execution halted.");
    }
    if (this.stepCount >= this.config.maxSteps) {
      this.trip(`step cap exceeded (${this.stepCount}/${this.config.maxSteps})`);
      throw new CircuitOpenError("Step cap exceeded.");
    }
    if (this.cumulativeSpend >= this.config.maxSpendUsd) {
      this.trip(`spend cap exceeded ($${this.cumulativeSpend.toFixed(2)}/$${this.config.maxSpendUsd})`);
      throw new CircuitOpenError("Spend cap exceeded.");
    }
  }

  record(event: BreakerEvent) {
    this.stepCount += 1;
    this.cumulativeSpend += event.costUsd ?? 0;
    this.history.push(event.type);
    if (this.history.length > this.config.window) this.history.shift();

    if (event.type === "failure") {
      this.consecutiveFailures += 1;
    } else {
      this.consecutiveFailures = 0;
      // A success in half-open state closes the breaker again.
      if (this.state === "half_open") {
        this.state = "closed";
        this.openedAt = null;
      }
    }

    if (event.driftScore !== undefined && this.config.driftThreshold !== undefined) {
      if (event.driftScore >= this.config.driftThreshold) {
        this.trip(`drift score ${event.driftScore.toFixed(2)} >= threshold ${this.config.driftThreshold}`);
        return;
      }
    }

    if (this.consecutiveFailures >= this.config.maxConsecutiveFailures) {
      this.trip(`${this.consecutiveFailures} consecutive failures`);
      return;
    }

    const errorRate = this.history.filter((h) => h === "failure").length / this.history.length;
    if (this.history.length >= this.config.window && errorRate >= this.config.maxErrorRate) {
      this.trip(`error rate ${(errorRate * 100).toFixed(1)}% >= ${(this.config.maxErrorRate * 100).toFixed(1)}%`);
    }
  }

  private trip(reason: string) {
    if (this.state === "open") return;
    this.state = "open";
    this.openedAt = Date.now();
    this.onOpen(reason);
  }
}

export class CircuitOpenError extends Error {}
```

Gating a tool call through the breaker:

```ts
// src/agents/tools/gated-tool-call.ts
import { CircuitBreaker } from "../lifecycle/circuit-breaker";
import { gracefulShutdown } from "../lifecycle/graceful-shutdown";

export async function callToolWithBreaker<T>(
  breaker: CircuitBreaker,
  toolName: string,
  costUsd: number,
  fn: () => Promise<T>,
  onTrip: (reason: string) => Promise<void>
): Promise<T> {
  breaker.assertClosed(); // throws CircuitOpenError if tripped/capped

  try {
    const result = await fn();
    breaker.record({ type: "success", costUsd });
    return result;
  } catch (err) {
    breaker.record({ type: "failure", costUsd });
    throw err;
  }
}

// Wiring at agent construction time: when the breaker opens, decide whether
// to hand off to a human or go straight to graceful shutdown. A spend-cap
// or step-cap trip is usually a hard stop; a transient error-rate trip may
// only warrant pausing for human review.
const breaker = new CircuitBreaker(
  {
    maxConsecutiveFailures: 3,
    maxErrorRate: 0.4,
    window: 10,
    maxSpendUsd: 25,
    maxSteps: 200,
    halfOpenAfterMs: 60_000,
    driftThreshold: 0.8,
  },
  (reason) => {
    console.error(`[circuit-breaker] OPEN: ${reason}`);
    // For spend/step caps, escalate straight to shutdown rather than
    // waiting for a human — those are governance hard limits, not
    // recoverable transient errors.
    if (/spend cap|step cap|drift/.test(reason)) {
      void gracefulShutdown("agent-1", "circuit_breaker", shutdownDeps);
    }
  }
);
```

## Remote kill switch

The remote kill switch is control that doesn't depend on the OS being able to deliver a signal to the process — a flag stored outside the agent, polled from inside its own execution loop. This matters for agents you can't `kill -TERM` directly: serverless invocations, workers behind a queue, agents embedded in a third-party host.

```ts
// src/agents/lifecycle/kill-switch-poller.ts
import { gracefulShutdown, ShutdownDeps } from "./graceful-shutdown";

export interface KillSwitchStore {
  // Backed by Redis (GET), a DB row, or a feature-flag SDK (e.g. LaunchDarkly).
  isKillSwitchSet(agentId: string): Promise<boolean>;
}

/**
 * Call this at every step boundary and before every tool call.
 * Cheap by design (a single key lookup) so it's safe to call frequently;
 * still, prefer caching with a short TTL (1-2s) under high step throughput
 * to avoid turning the control plane into a bottleneck.
 */
export async function checkKillSwitch(
  agentId: string,
  store: KillSwitchStore,
  deps: ShutdownDeps
): Promise<void> {
  const killed = await store.isKillSwitchSet(agentId);
  if (killed) {
    await gracefulShutdown(agentId, "remote_kill_switch", deps);
  }
}
```

```ts
// Example Redis-backed store
import { Redis } from "ioredis";

export function redisKillSwitchStore(redis: Redis): KillSwitchStore {
  return {
    async isKillSwitchSet(agentId: string) {
      const value = await redis.get(`kill-switch:${agentId}`);
      return value === "1";
    },
  };
}
```

**Propagation latency is the core trade-off.** A remote kill switch is only as fast as your poll interval — if you check once per step and a step takes 30 seconds, worst case the agent keeps running for nearly 30 more seconds after a human flips the switch. Poll at every step/tool boundary (not on a separate timer) to keep latency bounded by step duration rather than by a poll interval you have to tune. For genuinely time-critical stops, don't rely on the remote switch alone — pair it with **hard infrastructure kill** (deleting the pod/task, revoking the network route) as the backstop, and issue agent credentials with **short TTLs** so that even a kill switch that hasn't propagated yet is bounded by how long the credential remains valid regardless of whether the process ever sees the flag.

## Framework-specific enforcement

### LangGraph.js

Thread an `AbortSignal` through the `LangGraphRunnableConfig` passed to `.invoke()`/`.stream()` — the config's `signal` field is honored by the runtime and by the LangChain runnables underneath it, so aborting the controller unwinds the in-flight run. Combine this with an explicit kill-switch check between graph nodes (a lightweight node, or logic at the top of a node function) so you don't rely solely on the abort signal reaching every downstream call correctly — abort propagation into arbitrary tool/node code has had rough edges in practice, so treat it as one layer, not the only layer. The checkpointer (`MemorySaver`/persistent checkpointer) means a graceful stop doesn't have to mean losing state — you can resume from the last checkpoint, or deliberately discard it if the run is being aborted for cause (e.g., a circuit-breaker trip) rather than resumed.

```ts
import { StateGraph } from "@langchain/langgraph";

const controller = new AbortController();
registerKillSwitch("agent-1", { ...shutdownDeps, abortController: controller });

const graph = new StateGraph(/* ...schema */)
  // Each node checks the remote kill switch and the halt flag itself —
  // don't assume signal propagation alone will stop node-internal work.
  .addNode("plan", async (state, config) => {
    await checkKillSwitch("agent-1", killSwitchStore, shutdownDeps);
    if (globalHaltFlag.halted) throw new Error("halted");
    return planStep(state, { signal: config?.signal });
  })
  .addNode("act", async (state, config) => {
    await checkKillSwitch("agent-1", killSwitchStore, shutdownDeps);
    return callToolWithBreaker(breaker, "act", 0.01, () =>
      actStep(state, { signal: config?.signal }), onTrip
    );
  })
  .compile({ checkpointer });

await graph.invoke(input, { signal: controller.signal, configurable: { thread_id: "run-1" } });
```

### LlamaIndex.TS

Workflow handlers in LlamaIndex.TS receive a `Context` object as their first argument that exposes `sendEvent`, `stream`, and a `signal` (an `AbortSignal`) reflecting whether the workflow run has been cancelled. Register `signal.onabort` for cleanup local to a step, and check the kill switch between workflow steps the same way as in LangGraph — the framework's own cancellation propagation handles the "stop dispatching new steps" case, but revocation/notification is still your teardown code's job, invoked from the abort handler.

```ts
import { Workflow, StartEvent, StopEvent } from "llamaindex";

const workflow = new Workflow();

workflow.addStep(
  { inputs: [StartEvent] },
  async (context, event) => {
    context.signal.onabort = () => {
      console.error(`[workflow] aborted: ${context.signal.reason}`);
      // Local cleanup only — the process-wide gracefulShutdown() handles
      // credential revocation and notification.
    };

    await checkKillSwitch("agent-1", killSwitchStore, shutdownDeps);
    if (context.signal.aborted) return new StopEvent({ result: "halted" });

    const result = await runAgentStep(event, { signal: context.signal });
    return new StopEvent({ result });
  }
);

const controller = new AbortController();
registerKillSwitch("agent-1", { ...shutdownDeps, abortController: controller });
await workflow.run(startEvent, { signal: controller.signal });
```

### Microsoft Agent Framework

Note: Microsoft Agent Framework ships **only .NET and Python SDKs** — there is **no official Node/TypeScript SDK** (`@microsoft/agent-framework` does not exist; the separate Microsoft 365 Agents SDK, `@microsoft/agents-hosting`, is a different product some JS teams reach for instead). The TypeScript below is a sketch of the middleware/cancellation shape Microsoft documents (agent-run and function-calling middleware wrapping execution with a `next()` delegate and a `CancellationToken`) so the teardown design ports cleanly — implement it as a `FunctionMiddleware`/`AgentMiddleware` in C#/Python and use the framework's cancellation token to abort in-flight invocations. Verify exact signatures against your installed package version.

```ts
// Illustrative: agent-run middleware intercepting execution with a
// cancellation-aware pipeline, mirroring the .NET/Python middleware shape
// (context object + next() delegate) documented for Agent Framework.
type AgentMiddleware = (
  context: { agentId: string; signal: AbortSignal },
  next: () => Promise<void>
) => Promise<void>;

const killSwitchMiddleware: AgentMiddleware = async (context, next) => {
  await checkKillSwitch(context.agentId, killSwitchStore, shutdownDeps);
  if (context.signal.aborted) {
    await gracefulShutdown(context.agentId, "remote_kill_switch", shutdownDeps);
    return; // do not call next() — halt the pipeline
  }
  await next();
};

// Function-calling middleware wraps individual tool invocations the same
// way callToolWithBreaker() does above — gate on the circuit breaker
// before letting the underlying function/tool call proceed.
```

## CI/CD integration

Two enforcement layers in CI: the static scanner (fails fast, no process execution needed) and an integration test that actually sends `SIGTERM` to a running instance and asserts on real side effects.

```json
// package.json
{
  "scripts": {
    "governance:kill-switch": "ts-node scripts/governance/check-kill-switch.ts",
    "test:shutdown": "vitest run test/integration/graceful-shutdown.test.ts"
  }
}
```

```ts
// test/integration/graceful-shutdown.test.ts
import { describe, it, expect, vi } from "vitest";
import { spawn } from "node:child_process";
import { once } from "node:events";

describe("SIGTERM triggers credential revocation and notification", () => {
  it("revokes credentials and notifies before exiting", async () => {
    const child = spawn("node", ["dist/agents/test-fixture-entrypoint.js"], {
      env: { ...process.env, KILL_SWITCH_TEST_MODE: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });

    // Wait for the fixture to signal it's mid-run (writes a marker line).
    await waitForStdout(child, "AGENT_READY");

    child.kill("SIGTERM");

    const [exitCode] = await once(child, "exit");
    expect(exitCode).toBe(0);

    // The fixture entrypoint writes structured JSON lines for each
    // teardown action so the test can assert on real side effects rather
    // than trusting the process merely exited cleanly.
    const log = readFixtureLog();
    expect(log).toContainEqual(expect.objectContaining({ action: "revoke_credentials" }));
    expect(log).toContainEqual(expect.objectContaining({ action: "notify", reason: "SIGTERM" }));
  });
});

async function waitForStdout(child: ReturnType<typeof spawn>, marker: string) {
  return new Promise<void>((resolve) => {
    child.stdout?.on("data", (chunk) => {
      if (chunk.toString().includes(marker)) resolve();
    });
  });
}

function readFixtureLog(): Array<{ action: string; reason?: string }> {
  // Fixture writes to a known path for the test to inspect post-exit.
  return JSON.parse(require("node:fs").readFileSync("/tmp/shutdown-fixture.log", "utf8"));
}
```

```yaml
# .github/workflows/governance.yml
name: governance-kill-switch
on:
  pull_request:
    paths:
      - "src/agents/**"
      - "scripts/governance/**"

jobs:
  kill-switch-checks:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - name: Static scan — every entrypoint has a signal handler + teardown
        run: npm run governance:kill-switch
      - name: Build fixtures
        run: npm run build
      - name: Integration test — SIGTERM actually revokes + notifies
        run: npm run test:shutdown
```

## Failure modes & bypass risks

- **`SIGKILL` / OOM kill — no JS handler runs at all.** This is the fundamental limit of process-internal teardown. Mitigate structurally, not by trying to catch the uncatchable: issue agent credentials with short TTLs so an un-revoked token expires on its own soon after; run an external sidecar or control-plane component that independently revokes credentials tied to an agent's lifecycle regardless of whether the agent process itself got to run cleanup; treat infra-level teardown (a Kubernetes preStop hook, an operator watching pod deletion events) as the credential-revocation backstop, not the app-level handler.
- **Teardown itself hangs** (secrets manager unreachable, notification webhook never resolves). Mitigate with the hard timeout + force-exit shown in Section 6 — a teardown that can hang indefinitely defeats the purpose of having a grace period at all, since it just delays the eventual `SIGKILL` without buying you anything.
- **Revocation needs network access, but network may be exactly what's failing.** If the agent is being killed *because* of a network partition, or the partition takes out the path to the secrets manager too, revocation can't complete. Mitigate by pre-issuing a **revocation capability** that doesn't require reaching the same network path the agent used — e.g., a separate out-of-band revocation service, or short TTLs that make the token self-expiring regardless of whether revocation ever lands.
- **Duplicate / racy shutdown.** Multiple signals (`SIGTERM` then `SIGINT`, or a circuit-breaker trip firing concurrently with a remote kill-switch poll) can trigger `gracefulShutdown()` more than once. Mitigate with the idempotency guard (`shutdownState` check) shown in Section 6 — without it, concurrent credential rotation calls can race and leave the system in an inconsistent state (e.g., double-rotating a key and only the caller of the second rotation knowing the current valid value).
- **Remote-kill poll latency.** A polled kill switch is bounded by how often you check it, not by when the human flips it. Mitigate by checking at every step/tool-call boundary rather than on a fixed timer, and pair with a hard external kill for cases where you can't tolerate even one more full step executing.
- **Signal handler registered too late.** If `registerKillSwitch()` runs after agent work has already started (e.g., after the first tool call is in flight), an early signal can race the setup. Mitigate by making signal registration the first statement in the entrypoint, before any async agent work begins — this is exactly what the AST scanner in Section 5 should be checking for as a stretch goal (ordering, not just presence).
- **Teardown module exists but isn't actually wired to the handler** (dead code — imported but never called, or called only in a code path that never executes for real signals). This is why the static scanner checks for a reference from *within* the `process.on` callback, not just an import anywhere in the file.

## Enforcement checklist

- [ ] Every agent entrypoint registers `process.on('SIGTERM', ...)` and `process.on('SIGINT', ...)` before any agentic work begins.
- [ ] `ts-morph` scanner (Section 5) runs in CI and fails the build if a handler or teardown wiring is missing.
- [ ] `gracefulShutdown()` is idempotent and guarded against duplicate/concurrent invocation.
- [ ] `gracefulShutdown()` has a hard timeout that force-exits if teardown hangs.
- [ ] Credential revocation happens before ledger flush/notification, and is tested to actually invalidate the credential (not just "call the revoke API").
- [ ] Action ledger (Skill 03) is flushed on every shutdown path, including circuit-breaker trips.
- [ ] Stakeholder notification fires on every termination reason (`SIGTERM`, `SIGINT`, circuit breaker, remote kill switch).
- [ ] `CircuitBreaker` gates every tool call, with configured caps for consecutive failures, error rate, cumulative spend, and step count.
- [ ] Circuit breaker is wired to escalate to `gracefulShutdown()` for hard-limit trips (spend/step cap, drift threshold).
- [ ] Remote kill switch (`checkKillSwitch`) is polled at every step/tool-call boundary in every framework integration (LangGraph.js nodes, LlamaIndex.TS workflow steps, Agent Framework middleware).
- [ ] Agent-issued credentials use short TTLs as a backstop against `SIGKILL`/hard-kill scenarios where no revocation code can run.
- [ ] An external, process-independent revocation path (sidecar/control-plane) exists for infra-level hard kills.
- [ ] Integration test sends real `SIGTERM` to a running fixture and asserts credential revocation + notification occurred.
- [ ] CI job runs both the static scanner and the SIGTERM integration test on every PR touching agent code.
- [ ] Long-running loops check `AbortSignal`/kill flag at every iteration, not just at loop entry.
