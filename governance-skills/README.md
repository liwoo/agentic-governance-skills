# Agentic Governance Skills

A set of **eight deterministic governance controls** ("skills") for production agentic AI
codebases. Each skill pairs a **deterministic check** (something a scanner or CI job can prove,
without asking a model) with a **grounding action** (a runtime mechanism that enforces the
constraint on the live agent).

The guides target a **Node.js / TypeScript** stack and show enforcement against the three
mainstream agent frameworks that expose the needed primitives — **memory, tool calls, and
interrupts / human-in-the-loop**:

- **LangGraph.js** — `StateGraph`, `ToolNode`, checkpointers, dynamic `interrupt()` / `Command`.
- **LlamaIndex.TS** — `agent()`, `tool()` / `FunctionTool`, `Workflow` steps & events, callbacks.
- **Microsoft Agent Framework** — `AIAgent`, function-invocation middleware / filters, cancellation.

> The framework APIs shown are illustrative of the real primitives. Pin versions and confirm exact
> signatures against the installed SDK before shipping.

## Design philosophy

1. **Deterministic first.** Every skill has a static/preflight check that fails a build or a deploy.
   Governance you cannot enforce in CI is governance you do not have.
2. **Choke points, not vigilance.** Enforce at instrumented boundaries (one HTTP client, one tool
   wrapper, one memory writer) and *forbid* raw bypasses with a scanner — never rely on developers
   remembering to call the guard.
3. **Fail closed on the high-stakes path.** Unwrapped high-risk calls, missing kill switches, and
   un-ledgered side effects break the build rather than shipping.
4. **Layer defenses.** No single control is sufficient; the skills cross-reference and reinforce
   each other (e.g. the ledger feeds drift detection; the kill switch is the drift actuator).

## The eight skills

| # | Skill | Deterministic check | Grounding action |
|---|-------|---------------------|------------------|
| 01 | [Action-Space Constraint](./01-action-space-constraint.md) | Scan for high-risk function calls | Mandatory signed-token human-in-the-loop wrapper + network egress allowlist |
| 02 | [Subtask Reliability Validator](./02-subtask-reliability-validator.md) | Isolate & test each module; require an eval suite per node | Composition gate: no chaining until each link meets its reliability threshold |
| 03 | [Action Ledger Enforcer](./03-action-ledger-enforcer.md) | Every external interaction pipes to a standard immutable log | Build fails if any side-effecting call lacks a log-to-ledger with input/output/reasoning |
| 04 | [Circuit Breaker & Kill-Switch](./04-circuit-breaker-kill-switch.md) | Verify a registered `SIGTERM` / kill listener | Fallback teardown: revoke credentials + notify on mid-sequence termination |
| 05 | [Instance ID Stamper](./05-instance-id-stamper.md) | Pre-deploy check that `AGENT_ID` / principal env is present | Signed identity header on every outbound request & tool call |
| 06 | [Uncertainty Threshold Guard](./06-uncertainty-threshold-guard.md) | Prompts/logic require a confidence score | `RequestClarification` when confidence falls below a hard floor on high-stakes actions |
| 07 | [Data Minimization Filter](./07-data-minimization-filter.md) | Scan tool payloads for PII / secrets | Redact / block / tokenize sensitive egress unless task-authorized |
| 08 | [Drift Detection Sidecar](./08-drift-detection-sidecar.md) | Compare live reasoning traces to a golden set | Alert or auto-trip the circuit breaker on significant strategy deviation |

## How the skills reinforce each other

```
                 ┌─────────────────────────────────────────────┐
                 │  05 Instance ID  →  stamps every action      │
                 └───────────────┬─────────────────────────────┘
                                 │ identity on every entry
                                 ▼
  01 Action-Space ──gates──▶ 03 Action Ledger ──feeds──▶ 08 Drift Detection
  06 Uncertainty  ──gates──▶ (immutable record)            │ deviation signal
  07 Data Minim.  ──scrubs─▶                               ▼
                                              04 Circuit Breaker / Kill-Switch
                                              (the actuator: stop + revoke + notify)
  02 Subtask Reliability ── proves each link before any of the above is wired into a chain
```

- **05** stamps identity so **03** can attribute every entry to an instance and principal.
- **01 / 06 / 07** gate the *inputs* to actions (authorization, certainty, privacy).
- **03** is the immutable source of truth that **08** consumes to detect drift.
- **04** is the shared actuator that **08** (and any breaker trip) calls to stop the agent safely.
- **02** ensures the scaffolding each of the above depends on is individually reliable first.

## Recommended adoption order

1. **05 Instance ID** + **03 Action Ledger** — you cannot govern what you cannot see or attribute.
2. **04 Circuit Breaker / Kill-Switch** — get a reliable stop before granting autonomy.
3. **01 Action-Space** + **07 Data Minimization** — bound what actions and data can leave.
4. **06 Uncertainty Guard** — add ask-don't-assume on the high-stakes path.
5. **02 Subtask Reliability** + **08 Drift Detection** — quality-gate the pipeline and watch it over time.

## Each guide contains

- Governance rationale and the enforced end-state invariants.
- A **deterministic check** with runnable TypeScript (AST scanning via `ts-morph`, preflight validators, regression suites).
- A **grounding action** — the runtime wrapper / middleware / interrupt that enforces the control.
- **Framework-specific** wiring for LangGraph.js, LlamaIndex.TS, and the Microsoft Agent Framework.
- **CI/CD integration** (npm scripts + GitHub Actions) that fails the build on violation.
- **Failure modes & bypass risks** with mitigations, and a copy-paste **enforcement checklist**.
