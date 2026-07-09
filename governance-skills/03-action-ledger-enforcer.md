# Skill 03 — The "Action Ledger" Enforcer

*Every action an agent takes on the external world must land in an append-only, tamper-evident record before it is trusted — or the build fails.*

## Governance rationale

An autonomous agent that can call tools, hit APIs, write to memory, or mutate external state is only as governable as the paper trail it leaves behind. "Legibility" — the property that a system's behavior can be read, understood, and reconstructed by a human or auditor after the fact — is not a byproduct of good logging. It is an engineering requirement that has to be enforced the same way type safety or test coverage is enforced, because logging is exactly the kind of concern that developers under deadline pressure will skip for "obviously safe" tool calls.

The Action Ledger exists to guarantee four properties:

- **Auditability.** Any external action (tool call, API request, memory write, file mutation, payment, email send) must be reconstructable: what was asked, what was decided, what happened, and why. Without this, "the agent did X" is an unfalsifiable claim.
- **Non-repudiation.** Once a record is written, neither the agent, the operator, nor an attacker with write access should be able to silently alter or delete it. This is what turns a log into evidence.
- **Post-incident forensics.** When an agent causes harm — a bad trade, a leaked secret, a wrong medical suggestion acted on downstream — the ledger is the only artifact that lets you answer "what did the model believe, and what tool call did that belief cause?" A log line with no reasoning trace tells you *what* happened but not *why*, which is the question that actually matters for remediation.
- **Regulatory traceability.** Frameworks like the EU AI Act (Article 12, record-keeping for high-risk AI systems), SOC 2 change-management controls, and financial-services model-risk-management guidance (SR 11-7-style expectations extended to LLM agents) require automated systems making consequential decisions to produce records that a third party can inspect without relying on the vendor's goodwill.

Append-only / immutable matters specifically because a mutable log is not evidence — it is a claim. If an agent (or an engineer debugging it, or an attacker who has compromised the agent's runtime) can rewrite history, the ledger cannot be used to establish non-repudiation, cannot satisfy an auditor, and cannot be trusted as ground truth in an incident postmortem. The whole point of Skill 03 is to make "every external action produces a record, and that record cannot be quietly changed" a property enforced by construction and verified by static analysis — not a convention engineers are asked to remember.

## What "good" looks like

In a compliant codebase:

- Every function that crosses the trust boundary into the external world — a tool handler, an HTTP call, a database write, a filesystem mutation, a message send — is either (a) wrapped by a single ledger middleware/choke-point, or (b) explicitly and narrowly exempted via an auditable allowlist.
- Every ledger record captures input, output, timing, status, and the agent's natural-language reasoning trace for that specific action — not just a stack trace or a status code.
- Ledger records are append-only: no `UPDATE` or `DELETE` path exists in the write path, and the storage layer enforces this independently of application code (WORM bucket policy, DB grants, hash chain).
- Tampering — reordering, deleting, or editing a past record — is *detectable*, not merely discouraged, via a verifiable hash chain (and optionally a signature).
- A deterministic CI check fails the build when a side-effecting function is added or modified without a corresponding ledger write, so the guarantee doesn't erode as the codebase grows.
- Sensitive fields (secrets, PII, raw customer data) are redacted per the data-minimization policy before they are persisted to the ledger, so "log everything" doesn't become its own compliance liability.

## The ledger record schema

Every ledger entry is a single, versioned, self-describing record. Version the schema explicitly (`schemaVersion`) so that ledger consumers (SIEM, audit tooling, replay harnesses) can evolve independently of producers.

```ts
/**
 * A single immutable record in the Action Ledger.
 * One record per external interaction: tool call, API call, memory write,
 * file mutation, or outbound message.
 */
export type ActionType =
  | "tool_call"
  | "api_call"
  | "memory_write"
  | "memory_read_sensitive"
  | "file_write"
  | "db_write"
  | "message_send"
  | "human_handoff";

export interface LedgerRecord {
  /** Schema version for forward/backward-compatible readers. */
  schemaVersion: "1.0";

  /** Unique id for this ledger entry (ULID recommended: sortable + unique). */
  ledgerId: string;

  /** Logical agent identity (e.g. "billing-triage-agent"). Stable across deployments. */
  agentId: string;

  /**
   * The specific runtime instance emitting this record.
   * Cross-link: Skill 05 (Instance ID) mints and attests this value; the
   * ledger MUST reject records whose instanceId cannot be resolved to a
   * live or recently-live attested instance.
   */
  instanceId: string;

  /** Conversation / run correlation, matches the orchestrator's session concept. */
  sessionId: string;

  /** Framework-native thread identifier, when applicable (e.g. LangGraph thread_id). */
  threadId?: string;

  /** ISO-8601 UTC timestamp, captured at the ledger boundary, not client-reported. */
  timestamp: string;

  actionType: ActionType;

  /** Name of the tool / endpoint / resource acted on, e.g. "send_email", "POST /orders". */
  tool: string;

  /**
   * Input passed to the action, AFTER redaction.
   * Cross-link: Skill 07 (Data Minimization) defines the redaction policy;
   * this field must already be redacted by the time it reaches the ledger writer.
   */
  input: Record<string, unknown>;

  /** Output/result of the action, after redaction. Omit or truncate large payloads; store a content hash instead. */
  output: Record<string, unknown> | null;

  /**
   * The agent's natural-language justification for taking this action —
   * the chain-of-thought / rationale attributable to this specific step,
   * not the full transcript. See "Capturing the reasoning trace" below.
   */
  reasoningTrace: string;

  status: "success" | "error" | "denied" | "timeout";

  /** Error detail when status !== "success"; redacted like input/output. */
  errorMessage?: string;

  /** Wall-clock duration of the underlying action, in milliseconds. */
  latencyMs: number;

  /** Ties this record to an upstream request / trace (OpenTelemetry trace id, request id). */
  correlationId: string;

  /** SHA-256 hash of the previous record in this ledger's chain (see Immutability). */
  prevHash: string;

  /** SHA-256 hash of this record (prevHash + canonicalized record body). */
  hash: string;

  /** Optional detached signature over `hash`, for non-repudiation beyond the chain itself. */
  signature?: string;
}
```

Notes:

- `input`/`output` are typed as `Record<string, unknown>`, not `unknown` or `any` — the ledger writer should refuse records where these fields aren't already structured, since unstructured blobs are where secrets hide.
- `reasoningTrace` is mandatory (`string`, not `string | undefined`). A missing reasoning trace is a first-class ledger violation, not a warning — see "Deterministic checks."
- `hashChain` as described in the skill brief is implemented here as the pair `prevHash`/`hash` rather than a separate field, because the chain has to be walkable record-by-record; see the next section for the construction.

## Immutability & tamper-evidence

### Append-only storage

Pick a storage layer that makes mutation structurally hard, not just discouraged by convention:

- **Object Lock / WORM bucket** (S3 Object Lock in Compliance mode, GCS Bucket Lock, Azure Immutable Blob Storage) for the durable, long-retention copy. Compliance mode means *even the account root user* cannot delete or shorten the retention period before it expires.
- **Append-only database table**: a Postgres table with `INSERT`-only grants for the application role (no `UPDATE`/`DELETE` GRANT at all), optionally backed by a `BEFORE UPDATE OR DELETE` trigger that raises an exception, so even a bug or a compromised ORM cannot mutate history.
- **Dedicated ledger/event store** (e.g. an event-sourcing store, a Kafka compacted-off topic used as a durable log, or a purpose-built audit log service) where the write API itself has no update verb.

In practice, use two tiers: a fast, queryable append-only DB table for operational access (dashboards, incident response), and periodic batch export to WORM object storage for long-term, regulator-facing immutability. The hash chain (below) is what lets you prove the DB tier hasn't been tampered with, independent of which storage backend is in front of an investigator.

### Hash chain

Each record embeds the hash of the previous record, so any retroactive edit — even a single byte — breaks every subsequent hash and is detectable by replaying the chain.

```ts
import { createHash } from "node:crypto";
import { ulid } from "ulid";

/** Deterministic JSON canonicalization so hashing is stable across field order. */
function canonicalize(record: Omit<LedgerRecord, "hash" | "signature">): string {
  const sortedKeys = Object.keys(record).sort();
  const ordered: Record<string, unknown> = {};
  for (const k of sortedKeys) ordered[k] = (record as Record<string, unknown>)[k];
  return JSON.stringify(ordered);
}

function sha256(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

export interface LedgerStore {
  /** Returns the hash of the most recently appended record for this chain (session or agent scope). */
  getHeadHash(chainKey: string): Promise<string>;
  /** Physically persists the record. MUST NOT expose update/delete. */
  persist(record: LedgerRecord): Promise<void>;
}

export async function appendToLedger(
  store: LedgerStore,
  chainKey: string,
  partial: Omit<LedgerRecord, "ledgerId" | "timestamp" | "prevHash" | "hash" | "schemaVersion">,
): Promise<LedgerRecord> {
  const prevHash = await store.getHeadHash(chainKey);

  const withoutHash: Omit<LedgerRecord, "hash" | "signature"> = {
    schemaVersion: "1.0",
    ledgerId: ulid(),
    timestamp: new Date().toISOString(),
    prevHash,
    ...partial,
  };

  const hash = sha256(prevHash + canonicalize(withoutHash));
  const record: LedgerRecord = { ...withoutHash, hash };

  await store.persist(record);
  return record;
}

/** Walk a chain and verify no record was altered, inserted, or removed. */
export function verifyChain(records: LedgerRecord[]): { valid: boolean; brokenAt?: string } {
  let expectedPrev = records[0]?.prevHash ?? sha256(""); // genesis
  for (const record of records) {
    if (record.prevHash !== expectedPrev) {
      return { valid: false, brokenAt: record.ledgerId };
    }
    const { hash, signature, ...rest } = record;
    const recomputed = sha256(record.prevHash + canonicalize(rest));
    if (recomputed !== hash) {
      return { valid: false, brokenAt: record.ledgerId };
    }
    expectedPrev = hash;
  }
  return { valid: true };
}
```

Chain scope is a design choice: chain per `sessionId`/`threadId` for cheap, parallelizable verification, or chain globally per `agentId` (or across the whole deployment) for a stronger, single-timeline guarantee at the cost of write contention on `getHeadHash`. A common middle ground is a two-level scheme — per-session chains that are themselves periodically checkpointed into a global Merkle root (batch every N records or T seconds), giving you cheap local verification plus a single root hash you can notarize externally (e.g. publish to a transparency log or timestamp service).

### Optional signing

A hash chain proves internal consistency (nothing was altered *after the fact within the store*) but not that the store operator didn't rebuild history wholesale. For that, add a detached signature (Ed25519 recommended) over each record's `hash`, produced by a key the ledger-writing service holds but the application/agent code never touches — ideally in an HSM or KMS-backed signer, so a compromised agent process cannot forge new "valid" history even if it could write to the store.

## Deterministic checks

The static check answers one question: **does every function that touches the external environment have a reachable path to a ledger write?** This is implemented as an AST scan using `ts-morph`, run against the compiled tool/handler source, not the runtime.

Strategy:

1. **Registry of side-effecting surfaces.** Maintain (or derive) a list of what counts as "touches the external environment": every exported tool handler (functions passed to a tool-definition helper), every module-level HTTP client call, every DB write call. Prefer deriving this from framework metadata (e.g. every function passed to `tool({...})`) over a hand-maintained list, since hand-maintained lists rot.
2. **Positive marker.** Require every side-effecting function to either be wrapped by `withLedger(...)` (see next section) at its point of registration, or to carry an explicit `/** @ledgered */` JSDoc marker plus a call to `ledger.append(...)` reachable in its body. The scanner treats "wrapped by `withLedger`" as sufficient proof and skips body inspection; anything not wrapped must prove it logs manually, which is intentionally the harder path.
3. **Bypass detection.** Independently flag raw `fetch(`, `axios.` , `http.request(`, `pg.Pool`/`prisma.$executeRaw`-style calls made outside the instrumented client wrapper, since these are the most common way engineers accidentally route around the ledger.

```ts
// scripts/check-action-ledger.ts
import { Project, SyntaxKind, Node, CallExpression } from "ts-morph";
import path from "node:path";

const project = new Project({ tsConfigFilePath: "tsconfig.json" });
const sourceFiles = project.getSourceFiles(["src/tools/**/*.ts", "src/agents/**/*.ts"]);

type Violation = { file: string; line: number; message: string };
const violations: Violation[] = [];

const RAW_CLIENT_CALLEES = new Set(["fetch", "axios", "axios.get", "axios.post", "axios.request"]);
const LEDGER_WRAPPER_NAMES = new Set(["withLedger", "ledgeredTool"]);
const LEDGER_APPEND_CALL = "ledger.append";

for (const file of sourceFiles) {
  // --- Check 1: tool handlers registered via tool({ ... , func: handler }) or similar ---
  const toolCalls = file
    .getDescendantsOfKind(SyntaxKind.CallExpression)
    .filter((call) => isToolDefinitionCall(call));

  for (const call of toolCalls) {
    const handlerArg = getHandlerArgument(call); // resolves `func`/`execute`/`invoke` property
    if (!handlerArg) continue;

    const wrappedByLedger = isWrappedBy(handlerArg, LEDGER_WRAPPER_NAMES);
    const callsLedgerAppend = wrappedByLedger ? true : containsCallTo(handlerArg, LEDGER_APPEND_CALL);

    if (!wrappedByLedger && !callsLedgerAppend) {
      violations.push({
        file: file.getFilePath(),
        line: call.getStartLineNumber(),
        message:
          "Tool handler is not wrapped by withLedger(...) and contains no ledger.append(...) call. " +
          "Every tool handler must be instrumented — wrap it with withLedger() at registration.",
      });
    }
  }

  // --- Check 2: raw HTTP/DB clients bypassing the instrumented client ---
  for (const call of file.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const calleeText = call.getExpression().getText();
    if (RAW_CLIENT_CALLEES.has(calleeText) && !fileImportsInstrumentedClientOnly(file)) {
      violations.push({
        file: file.getFilePath(),
        line: call.getStartLineNumber(),
        message: `Raw call to '${calleeText}' bypasses the instrumented HTTP client. Use the ledgered http client from 'src/lib/ledgered-http.ts'.`,
      });
    }
  }
}

function isToolDefinitionCall(call: CallExpression): boolean {
  const callee = call.getExpression().getText();
  return ["tool", "createTool", "defineTool"].includes(callee);
}

function getHandlerArgument(call: CallExpression): Node | undefined {
  const arg = call.getArguments().find((a) => Node.isObjectLiteralExpression(a));
  if (!arg || !Node.isObjectLiteralExpression(arg)) return undefined;
  const prop = arg.getProperty("func") ?? arg.getProperty("execute") ?? arg.getProperty("invoke");
  return prop;
}

function isWrappedBy(node: Node, wrapperNames: Set<string>): boolean {
  const text = node.getText();
  return [...wrapperNames].some((name) => text.includes(`${name}(`));
}

function containsCallTo(node: Node, calleeText: string): boolean {
  return node
    .getDescendantsOfKind(SyntaxKind.CallExpression)
    .some((c) => c.getExpression().getText() === calleeText);
}

function fileImportsInstrumentedClientOnly(file: ReturnType<Project["getSourceFiles"]>[number]): boolean {
  return file
    .getImportDeclarations()
    .some((imp) => imp.getModuleSpecifierValue().includes("ledgered-http"));
}

if (violations.length > 0) {
  console.error(`\nAction Ledger Enforcer: ${violations.length} violation(s) found:\n`);
  for (const v of violations) {
    console.error(`  ${path.relative(process.cwd(), v.file)}:${v.line}\n    ${v.message}\n`);
  }
  process.exit(1);
} else {
  console.log("Action Ledger Enforcer: all external-facing functions are instrumented.");
}
```

This scanner is deliberately conservative: it is easy to fool with enough indirection (a handler that calls a helper three files away which itself calls `ledger.append`). Treat it as a high-recall tripwire that catches the common, accidental case — the un-ledgered new tool — not as a proof system. The real guarantee comes from the next section: making it structurally hard to register a tool *without* going through the wrapper at all.

## Grounding action — instrumentation by construction

Static scanning is a safety net; the actual grounding action is to remove the choice. Provide a single `withLedger()` wrapper (or equivalent framework middleware — see the next section) that every tool handler is *required* to pass through by the tool-registration API itself, so "forgetting to log" stops being a mistake an engineer can make.

```ts
// src/lib/with-ledger.ts
import { appendToLedger, type LedgerStore, type ActionType } from "./ledger";

export interface LedgeredContext {
  agentId: string;
  instanceId: string;   // from Skill 05's instance-identity provider
  sessionId: string;
  correlationId: string;
  /** Supplied by the calling agent step: the model's stated rationale for this action. */
  reasoningTrace: string;
}

type ToolFn<Input, Output> = (input: Input, ctx: LedgeredContext) => Promise<Output>;

export function withLedger<Input extends Record<string, unknown>, Output extends Record<string, unknown> | null>(
  toolName: string,
  actionType: ActionType,
  fn: ToolFn<Input, Output>,
  deps: { store: LedgerStore; redact: (v: unknown) => Record<string, unknown> },
): ToolFn<Input, Output> {
  return async (input, ctx) => {
    const start = performance.now();
    const chainKey = ctx.sessionId;

    if (!ctx.reasoningTrace || ctx.reasoningTrace.trim().length === 0) {
      // Fail closed: an action with no rationale is exactly what this skill exists to prevent.
      throw new LedgerViolationError(
        `Refusing to invoke tool '${toolName}': no reasoningTrace was supplied for this action.`,
      );
    }

    try {
      const output = await fn(input, ctx);
      await appendToLedger(deps.store, chainKey, {
        agentId: ctx.agentId,
        instanceId: ctx.instanceId,
        sessionId: ctx.sessionId,
        actionType,
        tool: toolName,
        input: deps.redact(input),
        output: output ? deps.redact(output) : null,
        reasoningTrace: ctx.reasoningTrace,
        status: "success",
        latencyMs: performance.now() - start,
        correlationId: ctx.correlationId,
      });
      return output;
    } catch (err) {
      await appendToLedger(deps.store, chainKey, {
        agentId: ctx.agentId,
        instanceId: ctx.instanceId,
        sessionId: ctx.sessionId,
        actionType,
        tool: toolName,
        input: deps.redact(input),
        output: null,
        reasoningTrace: ctx.reasoningTrace,
        status: "error",
        errorMessage: String((err as Error)?.message ?? err),
        latencyMs: performance.now() - start,
        correlationId: ctx.correlationId,
      });
      throw err;
    }
  };
}

export class LedgerViolationError extends Error {}
```

Two things make this "by construction" rather than "by convention":

1. **The tool factory refuses raw handlers.** If your internal `defineTool()` helper's type signature only accepts `ToolFn` values produced by `withLedger(...)` (e.g. by branding the return type as `LedgeredToolFn`), an engineer physically cannot register an un-instrumented handler and have it typecheck — the AST scanner in the previous section becomes a defense-in-depth backstop, not the primary control.
2. **Missing rationale fails closed at the call site**, not just at audit time. This is the piece that most logging middlewares skip: they'll happily log `reasoningTrace: undefined`. Throwing here means a tool call with no attributable reasoning simply cannot execute, which is a much stronger guarantee than "we noticed it wasn't logged after the fact."

## Capturing the reasoning trace

The hardest field to get right is `reasoningTrace`, because it doesn't come from the tool call itself — it comes from the model's generation *around* the tool call, which lives in a different part of the stack (the orchestrator/graph layer) than the tool executor.

Practical sourcing patterns:

- **Explicit rationale parameter.** The most reliable approach: require every tool schema to include a `rationale: string` (or `reasoning: string`) input field the model must fill in as part of the tool call arguments, in addition to the tool's real parameters. This makes the reasoning trace part of the structured tool-call payload itself rather than something scraped from surrounding free text, so it survives even if the framework doesn't expose a separate "thought" channel. The tradeoff is a few extra output tokens per call and a slightly larger tool schema.
- **Framework "scratchpad"/thought capture.** Where the orchestration layer exposes a distinct reasoning/thinking step before the tool-call step (a planning node, a ReAct "Thought:" segment, an extended-thinking block), capture that segment and thread it into the `LedgeredContext` for the *next* tool call the plan resolves to, keyed by correlating the plan step to the tool invocation (e.g. via a step id).
- **Fallback synthesis.** If neither is available, at minimum capture the immediately preceding assistant message content up to the tool call as `reasoningTrace`, clearly flagged (e.g. a `reasoningTraceSource: "inferred"` companion field) so auditors know it's a best-effort reconstruction, not an explicit rationale. Treat "inferred" traces as a build warning, not a pass — they indicate the integration hasn't wired an explicit rationale channel yet.

**The reasoning trace is itself sensitive and must be access-controlled.** Chain-of-thought frequently contains information the model was given but the user shouldn't see re-surfaced verbatim — internal system prompt fragments, other users' data pulled into context, or the model's own uncertainty/hedging in a way that undermines trust if shown raw. Treat `reasoningTrace` as a privileged field:

- Restrict read access to the ledger's `reasoningTrace` column/field to auditors and incident responders, not general application read paths.
- Never pipe `reasoningTrace` back into a user-facing UI, a downstream agent's context window, or a support ticket without an explicit, reviewed redaction step — leaking raw CoT downstream is both a data-minimization violation (Skill 07) and, for models where CoT is provided under a "for safety research, not for end-user display" expectation, a policy violation in its own right.
- Apply the same redaction pipeline used for `input`/`output` to `reasoningTrace` before persistence, since models will readily restate sensitive tool inputs inside their rationale ("I'll email jane@... her SSN ... because...").

## Framework-specific enforcement

### LangGraph.js

LangGraph.js tool execution flows through `ToolNode` (or a custom node that calls `tool.invoke(...)`), and tools themselves are typically created with `tool()` from `@langchain/core/tools`. The most reliable choke point is wrapping each tool's `func`/`invoke` implementation with `withLedger()` at the point the tool array is assembled, before it's bound to the model or passed into `ToolNode`. Correlate records with LangGraph's own `thread_id` (part of the `RunnableConfig` passed to every node when using a checkpointer like `MemorySaver`/`PostgresSaver`), which maps naturally onto `LedgerRecord.threadId` and gives you ledger-to-checkpoint correlation for replay debugging.

```ts
// Illustrative — verify exact tool()/ToolNode signatures against your installed
// @langchain/core / @langchain/langgraph version.
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { withLedger } from "../lib/with-ledger";

const sendEmailTool = tool(
  withLedger("send_email", "tool_call", async (input, ctx) => {
    return sendEmailImpl(input, ctx);
  }, { store: ledgerStore, redact }) as any, // adapt LedgeredContext<->RunnableConfig at the call boundary
  {
    name: "send_email",
    description: "Send an email to a customer.",
    schema: z.object({
      to: z.string(),
      body: z.string(),
      rationale: z.string().describe("Why this email is being sent, for the audit ledger."),
    }),
  },
);

// A BaseCallbackHandler registered on the graph's RunnableConfig gives a second,
// framework-native observation point (handleToolStart/handleToolEnd) — useful as a
// defense-in-depth cross-check that every ToolNode invocation has a matching ledger
// record, independent of whether withLedger() was applied correctly.
```

Because LangGraph.js also exposes a callback-handler interface (`handleToolStart`/`handleToolEnd`/`handleToolError` on a `BaseCallbackHandler`, attachable globally via `RunnableConfig.callbacks`), you can additionally register a ledger-verifying callback handler as a second, independent observation point — not as the primary logging path (callbacks can be dropped or skipped depending on how a node invokes a tool), but as a runtime consistency check that flags any `ToolNode` execution with no matching `ledger.append` call in the same window.

### LlamaIndex.TS

LlamaIndex.TS tools are defined with the `tool()` helper (a name, a Zod `parameters` schema, and an `execute` function), consumed by `agent()`/workflow constructs. As in LangGraph.js, the robust integration point is wrapping the `execute` function with `withLedger()` at tool-definition time, so instrumentation travels with the tool regardless of which workflow assembles it.

```ts
// Illustrative — verify exact tool()/agent() signatures against your installed
// llamaindex version; the framework's workflow/step APIs have moved across releases.
import { tool } from "llamaindex";
import { z } from "zod";
import { withLedger } from "../lib/with-ledger";

const lookupOrderTool = tool({
  name: "lookup_order",
  description: "Look up an order by id.",
  parameters: z.object({
    orderId: z.string(),
    rationale: z.string().describe("Why this lookup is needed, for the audit ledger."),
  }),
  execute: withLedger("lookup_order", "tool_call", async (input, ctx) => {
    return lookupOrderImpl(input, ctx);
  }, { store: ledgerStore, redact }),
});
```

LlamaIndex.TS also ships an instrumentation module (`getDispatcher()` and a span/event system under `llamaindex`'s observability surface, plus a `Settings.callbackManager` on older APIs) that emits structured events around LLM calls and tool/step execution. Register a dispatcher event handler as the same kind of second-line, runtime cross-check used in the LangGraph.js section above: it can assert that every emitted "tool call" span has a corresponding ledger write within the same trace, catching cases where a workflow step invokes tool logic directly rather than through the registered `tool()` wrapper.

### Microsoft Agent Framework

The Microsoft Agent Framework (the successor unifying Semantic Kernel and AutoGen concepts) centers tool-call interception on a **function-invocation middleware** concept — a hook that runs around every function/tool call the framework dispatches, with access to the invocation context (function name, arguments) and the ability to short-circuit or annotate the result. This is the direct analogue of Semantic Kernel's legacy `IFunctionInvocationFilter`.

> **Language note:** Microsoft Agent Framework ships **only .NET and Python SDKs** (`Microsoft.Agents.AI` on NuGet, `agent-framework` on PyPI). There is **no official JS/TS package** — `@microsoft/agent-framework` does not exist, and the unrelated `@microsoft/agents-hosting` (Microsoft 365 Agents SDK) is a different product. The TypeScript snippet below documents the *pattern* for a Node port so the ledger design carries over; if your Agent Framework agents are actually in .NET/Python, implement `ledgerMiddleware` there as a `FunctionMiddleware` / function-calling middleware registered via `.AsBuilder().Use(...)`.

```ts
// Illustrative Node port — NOT a real import. Microsoft Agent Framework has no
// JS/TS SDK; implement this as a FunctionMiddleware in C#/Python. Types below are
// a hypothetical shape mirroring the documented .NET/Python middleware pattern.
import type { FunctionInvocationContext, FunctionInvocationMiddleware } from "./maf-shim"; // local shim, not @microsoft/agent-framework
import { appendToLedger } from "../lib/ledger";

export const ledgerMiddleware: FunctionInvocationMiddleware = async (context: FunctionInvocationContext, next) => {
  const start = performance.now();
  const reasoningTrace = context.metadata?.rationale ?? "";

  if (!reasoningTrace) {
    throw new Error(`Refusing function call '${context.functionName}': no rationale in invocation metadata.`);
  }

  try {
    const result = await next(context);
    await appendToLedger(ledgerStore, context.sessionId, {
      agentId: context.agentId,
      instanceId: context.instanceId,
      sessionId: context.sessionId,
      actionType: "tool_call",
      tool: context.functionName,
      input: redact(context.arguments),
      output: redact(result),
      reasoningTrace,
      status: "success",
      latencyMs: performance.now() - start,
      correlationId: context.correlationId,
    });
    return result;
  } catch (err) {
    // ... mirror the error-path append shown in withLedger() above
    throw err;
  }
};

// Registered once, applied to every function the agent can call —
// the same "single choke point" principle as withLedger() and ToolNode wrapping.
```

Because this middleware is registered once at the agent/kernel level rather than per tool, it is architecturally the strongest of the three choke points against forgetting to instrument a new tool — provided the team enforces that all tools are invoked through the framework's function-calling path rather than ad hoc direct calls from within a handler, which the raw-client bypass check in "Deterministic checks" is designed to catch.

## CI/CD integration

```json
// package.json
{
  "scripts": {
    "check:ledger": "tsx scripts/check-action-ledger.ts",
    "test:ledger-coverage": "vitest run test/ledger-coverage.integration.test.ts"
  }
}
```

```yaml
# .github/workflows/governance.yml
name: governance-checks

on:
  pull_request:
  push:
    branches: [main]

jobs:
  action-ledger-enforcer:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - name: Static scan — every external action must be ledgered
        run: npm run check:ledger
      - name: Runtime coverage — replay fixture sessions and verify ledger completeness
        run: npm run test:ledger-coverage
      - name: Verify hash chain integrity on sample fixtures
        run: npm run check:ledger -- --verify-chain fixtures/sample-ledger.json
```

The runtime "ledger coverage" integration test is the complement to the static scan: run a fixture agent session end-to-end against mocked tools, then assert that the number of external calls the mocks recorded equals the number of `ledger.append` records produced for that `sessionId`, and that `verifyChain()` passes over the resulting records. This catches indirection the AST scanner can't see (dynamic tool dispatch, tools constructed at runtime from config) at the cost of only covering the flows your fixtures exercise.

## Failure modes & bypass risks

- **Un-instrumented raw HTTP clients.** An engineer imports `axios` directly inside a tool handler "just for this one call." Mitigation: the bypass-detection half of the AST scanner, plus an ESLint rule (`no-restricted-imports` on `axios`/`node-fetch`/global `fetch` outside `src/lib/ledgered-http.ts`) that fails fast in the editor rather than in CI.
- **Logging after the side effect.** If the process crashes between the external call succeeding and the `ledger.append` write landing, the action happened but was never recorded — the worst failure mode for a governance control, since it's silent. Mitigate with a **write-ahead intent record**: append a `status: "pending"` ledger entry *before* invoking the tool, then a second record (or an update-via-append, never an in-place mutation) marking `success`/`error` afterward. A `pending` record with no matching resolution becomes a monitorable anomaly ("orphaned intents") rather than a silent gap.
- **Reasoning trace absent or hallucinated.** A model can be prompted to fill `rationale` with boilerplate ("Calling tool as required") that satisfies the schema but carries no real audit value. Static checks can't catch this — mitigate with periodic sampling: an offline job that scores a sample of `reasoningTrace` values for specificity/relevance (even a cheap classifier or LLM-judge pass) and flags agents/prompts whose traces trend toward boilerplate.
- **Ledger store unavailability — fail-closed vs fail-open.** If the ledger store is down, does the agent block (fail-closed: no record, no action) or proceed without logging (fail-open: action happens, gap in the record)? For consequential actions (payments, irreversible external side effects), fail-closed is the correct default despite the availability cost — an unlogged consequential action is a worse outcome than a temporarily unavailable agent. For low-stakes, easily-replayed actions, a bounded local write-ahead buffer (flush to the durable store once it recovers) can allow a narrow fail-open with recovery, but this should be an explicit, reviewed exception per action type, not a blanket policy.
- **PII/secrets leaking into the ledger.** The ledger is an attractive, high-value target precisely because it aggregates every action's input/output — an under-redacted ledger can become a bigger compliance liability than having no ledger at all. Mitigation: route `input`/`output`/`reasoningTrace` through the same redaction pipeline Skill 07 enforces on outbound data *before* they reach `appendToLedger`, never after; treat the ledger store itself as in-scope for the same data classification and access controls as the production database it's auditing.
- **Reasoning trace re-exposure downstream.** As noted above, treat `reasoningTrace` as privileged; a common bypass is a well-meaning debug UI that dumps raw ledger records (including reasoning traces) to a support engineer's browser without going through the redaction/access-control layer.

## Enforcement checklist

- [ ] `LedgerRecord` schema is versioned, typed, and includes `reasoningTrace` as a required (non-optional) field.
- [ ] Ledger storage is append-only at the infrastructure layer (WORM bucket, no-`UPDATE`/`DELETE` DB grants or trigger), not just by application convention.
- [ ] Every record participates in a verifiable hash chain (`prevHash`/`hash`); `verifyChain()` (or equivalent) runs in CI against fixture data and periodically in production.
- [ ] Ledger writes are signed by a key the agent process cannot access (KMS/HSM-backed), if non-repudiation must survive a fully compromised agent runtime.
- [ ] A single `withLedger()` wrapper (or framework-native middleware/filter) is the only sanctioned way to register a tool handler; the tool-factory type signature makes un-wrapped handlers a compile error where feasible.
- [ ] `ts-morph` static scanner runs in CI and fails the build on (a) un-ledgered tool handlers, (b) raw HTTP/DB client usage outside the instrumented client.
- [ ] ESLint restricts direct imports of raw HTTP/DB clients outside the instrumented wrapper modules.
- [ ] A runtime "ledger coverage" integration test asserts recorded-action-count == mock-call-count for fixture sessions, and passes chain verification.
- [ ] Missing/empty `reasoningTrace` fails the tool call at runtime (fail closed), not just a scanner warning.
- [ ] `reasoningTrace` (and `input`/`output`) pass through the Skill 07 redaction pipeline before persistence, and are access-controlled separately from general application data on read.
- [ ] `instanceId` on every record resolves to an attested instance per Skill 05; orphaned/unattested `instanceId` values are flagged.
- [ ] A documented, reviewed fail-closed/fail-open policy exists per action type for ledger-store unavailability, with write-ahead intent records used to close the crash-before-log gap.
- [ ] Framework-specific choke points (LangGraph.js tool wrapping + callback cross-check, LlamaIndex.TS `tool()` wrapping + dispatcher cross-check, MS Agent Framework function-invocation middleware) are wired at the point tools are registered, not scattered per call site.
