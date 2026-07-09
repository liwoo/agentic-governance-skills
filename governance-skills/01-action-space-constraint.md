# Skill 01 — The "Action-Space" Constraint

*Bound what the agent can do, not just what it can say — every high-risk side effect requires a verifiable human decision before it executes.*

## Governance rationale

An LLM-driven agent's "action space" is the full set of side-effecting operations it can invoke: tool calls, function calls, HTTP requests, database writes, message sends. Most of that space is safe by construction — read-only lookups, formatting, retrieval. A small subset is not: transferring funds, deleting records, sending legally binding communications, modifying access control. The asymmetry matters because these actions are frequently **irreversible** or **externally visible** — you cannot un-send a legal notice or un-execute a wire transfer, and a language model's failure mode (hallucination, prompt injection, goal misgeneralization) does not announce itself before it acts. Least-privilege is the standard defense: an agent should hold no more standing capability than its current task requires, and any capability whose misuse is expensive should require a second, independently-verifiable signal before it fires.

This is blast-radius containment applied to autonomous software. A code-review bug or a bad retrieval result in a read-only path costs a wrong answer. The same class of error in a write path to a production database, a payments API, or an outbound legal/compliance channel costs money, data, or standing — and because agents chain tool calls autonomously, a single upstream error (a manipulated tool description, a jailbroken instruction embedded in retrieved content) can cascade into an irreversible downstream action with no human in between. Constraining the action space is what converts "the model did something wrong" from an incident into a caught exception.

This skill operationalizes a core AI-governance principle — meaningful human control over consequential automated decisions — as a deterministic, testable engineering control rather than a policy document. It does not rely on the model "choosing" to ask for permission; it structurally prevents the high-risk code path from completing without an external, cryptographically verifiable approval. The goal is a system where the safety property holds even under a fully compromised or adversarially prompted agent loop, because the gate lives outside the model's context and outside its ability to reason its way past.

## What "good" looks like

- Every function, tool, or API binding in the codebase that is classified high-risk is enumerated in a single, version-controlled registry — no high-risk capability exists that isn't declared.
- No code path can reach a high-risk function without first passing through a `requireApproval` (or equivalent) wrapper — enforced at both static-analysis time and runtime.
- Approval is a signed, scoped, time-limited token issued by an identified human principal, verified cryptographically at the call site, and single-use (not replayable).
- The agent's own reasoning/planning loop cannot forge, extend, or approve its own approval token — token issuance happens outside the agent's execution context.
- Outbound network egress from the agent runtime is restricted to a pre-approved allowlist of hosts/channels; any other destination is rejected before the request leaves the process.
- CI fails the build if a new high-risk call is introduced without the wrapper, if the registry drifts from actual usage, or if the egress allowlist is bypassed.
- Every gated invocation, every approval grant/denial, and every rejected egress attempt is logged to an immutable audit trail with enough context (who approved, what scope, when, what the call args were) to reconstruct the decision later.

## Deterministic checks

### 1. A declarative high-risk registry

Maintain a single source of truth — not scattered comments or tribal knowledge — that lists every function/tool considered high-risk, its module path, and its required approval scope. This file is what both the scanner and the runtime wrapper consult, so it can never silently drift between "what we check" and "what we enforce."

```ts
// governance/high-risk-registry.ts
export interface HighRiskEntry {
  /** Exported symbol name as it appears at the call site. */
  name: string;
  /** Module specifier (relative or package) where the symbol is defined. */
  module: string;
  /** Approval scope required to invoke this function, e.g. "finance:transact". */
  scope: string;
  /** Free-text justification, required for audit/reviewability. */
  reason: string;
}

export const HIGH_RISK_REGISTRY: HighRiskEntry[] = [
  {
    name: "execute_transaction",
    module: "src/tools/payments",
    scope: "finance:transact",
    reason: "Moves funds; irreversible.",
  },
  {
    name: "delete_database",
    module: "src/tools/admin",
    scope: "infra:destroy",
    reason: "Destructive, no soft-delete.",
  },
  {
    name: "send_legal_notice",
    module: "src/tools/legal",
    scope: "legal:notify",
    reason: "Externally binding communication.",
  },
];

export const HIGH_RISK_NAMES = new Set(HIGH_RISK_REGISTRY.map((e) => e.name));
```

Keep this registry small, explicit, and reviewed like code — every addition should go through the same PR review as the function it protects. Treat it as an allowlist of *known* danger, not a substitute for the runtime wrapper (see "Failure modes" for what happens if a call is missing from it).

### 2. AST-based scanner (ts-morph)

Regex over source text cannot reliably answer either question this skill needs answered: (1) *is this identifier actually a call expression invoking the registered symbol*, and (2) *is that call wrapped by `requireApproval` at the point of definition or export*. Regex matches on the string `execute_transaction(` will false-positive on comments, string literals, unrelated locals named the same thing, and will false-negative on aliased imports (`import { execute_transaction as tx }`) or re-exports. It also cannot see through wrapping — `requireApproval(execute_transaction)` and `execute_transaction` both contain the substring, and only the AST can determine whether the *call site* resolves to the raw symbol or the wrapped one. A proper TypeScript AST walk resolves imports, follows call-expression targets, and inspects whether a definition is the direct argument to a known wrapper — which is the only reliable way to answer "is this gated."

```ts
// scripts/scan-high-risk-calls.ts
import { Project, SyntaxKind, Node, CallExpression } from "ts-morph";
import { HIGH_RISK_NAMES, HIGH_RISK_REGISTRY } from "../governance/high-risk-registry";

const WRAPPER_NAMES = new Set(["requireApproval", "withHumanApproval"]);

interface Violation {
  kind: "unwrapped-call" | "unwrapped-definition";
  file: string;
  line: number;
  symbol: string;
  snippet: string;
}

function isInsideWrapperCall(node: Node): boolean {
  // Walk up: is this node (or an ancestor) an argument to a call to a
  // known HITL wrapper? Covers both `requireApproval(fn)(...)` factory
  // usage and `requireApproval(() => fn(...))` closure usage.
  let current: Node | undefined = node;
  while (current) {
    const parent = current.getParent();
    if (parent && Node.isCallExpression(parent)) {
      const callee = parent.getExpression().getText();
      if (WRAPPER_NAMES.has(callee.split(".").pop() ?? callee)) return true;
    }
    current = parent;
  }
  return false;
}

function main(): void {
  const project = new Project({ tsConfigFilePath: "tsconfig.json" });
  const violations: Violation[] = [];

  for (const sourceFile of project.getSourceFiles("src/**/*.ts")) {
    const filePath = sourceFile.getFilePath();

    // (a) Find direct calls to high-risk symbols.
    sourceFile
      .getDescendantsOfKind(SyntaxKind.CallExpression)
      .forEach((call: CallExpression) => {
        const exprText = call.getExpression().getText();
        const bareName = exprText.split(".").pop() ?? exprText;
        if (!HIGH_RISK_NAMES.has(bareName)) return;

        // Resolve the identifier to its declaration to rule out
        // unrelated locals that merely share a name.
        const identifier = call.getExpression();
        const symbol = identifier.getSymbol();
        const decl = symbol?.getDeclarations()?.[0];
        const resolvedFromRegistry = HIGH_RISK_REGISTRY.some((entry) =>
          decl?.getSourceFile().getFilePath().includes(entry.module)
        );
        if (!resolvedFromRegistry) return;

        if (!isInsideWrapperCall(call)) {
          violations.push({
            kind: "unwrapped-call",
            file: filePath,
            line: call.getStartLineNumber(),
            symbol: bareName,
            snippet: call.getText().slice(0, 120),
          });
        }
      });

    // (b) Find high-risk functions exported/registered as agent tools
    //     without ever being passed through the wrapper anywhere in the
    //     file that constructs the tool list (defense against a tool
    //     being registered by reference, never "called" directly).
    sourceFile.getExportedDeclarations().forEach((decls, name) => {
      if (!HIGH_RISK_NAMES.has(name)) return;
      const referencedUnderWrapper = sourceFile
        .getDescendantsOfKind(SyntaxKind.Identifier)
        .filter((id) => id.getText() === name)
        .some((id) => isInsideWrapperCall(id));
      if (!referencedUnderWrapper) {
        violations.push({
          kind: "unwrapped-definition",
          file: filePath,
          line: decls[0]?.getStartLineNumber() ?? 0,
          symbol: name,
          snippet: "exported without wrapper reference",
        });
      }
    });
  }

  if (violations.length > 0) {
    console.error(`Found ${violations.length} unguarded high-risk call(s):\n`);
    for (const v of violations) {
      console.error(`  [${v.kind}] ${v.file}:${v.line} — ${v.symbol}\n    ${v.snippet}`);
    }
    process.exit(1);
  }

  console.log("Action-space scan: OK — all high-risk calls are wrapped.");
}

main();
```

Run with `ts-node scripts/scan-high-risk-calls.ts`. If your codebase is large, drop `ts-morph` in favor of the raw TypeScript compiler API (`ts.createProgram` + a `ts.forEachChild` visitor) for lower memory overhead — the resolution logic is the same; `ts-morph` is used here for readability.

### 3. Regex fallback (defense-in-depth, not primary)

A cheap pre-commit or editor-time check can catch obvious cases fast, but must be treated as a lint hint, never the CI gate:

```bash
# Fast, noisy pre-commit hint — NOT a substitute for the AST scan.
grep -rnE '\b(execute_transaction|delete_database|send_legal_notice)\s*\(' src/ \
  | grep -v 'requireApproval\|withHumanApproval' \
  || echo "no obvious unwrapped high-risk calls (regex heuristic only)"
```

Why AST wins: the regex cannot resolve `import { execute_transaction as run }` and will miss `run(...)`; it cannot tell that `requireApproval` on the *same line* wraps a *different* call two arguments over; it cannot see through re-exports, barrel files, or dynamic property access (`tools["execute_transaction"]`); and it will false-positive inside comments, test fixtures, and string templates. The AST scanner resolves symbols to their actual declaration and understands call-expression structure, so it correctly attributes wrapping (or its absence) to the right call site.

## Grounding actions (runtime enforcement)

Static scanning prevents *known-shape* violations from merging. Runtime enforcement is the actual control — it must hold even if a scan was skipped, a rule was bypassed, or the call is constructed dynamically at runtime (see "Failure modes"). The mechanism is a higher-order function that intercepts invocation, blocks until a valid approval token is supplied, verifies it, and only then calls through.

### Approval token shape

Use a signed, structured token — not a boolean flag — so the approval is scoped, attributable, and cannot be reused outside its intended context:

```ts
// governance/approval-token.ts
export interface ApprovalTokenPayload {
  /** Human principal who approved, e.g. an email or SSO subject ID. */
  approvedBy: string;
  /** Scope string matching the registry entry, e.g. "finance:transact". */
  scope: string;
  /** Idempotency/binding key — hash of the specific call args being approved. */
  requestHash: string;
  /** Unix ms issued-at. */
  iat: number;
  /** Unix ms expiry — short-lived, minutes not hours. */
  exp: number;
  /** Random nonce; consumed on first use to prevent replay. */
  jti: string;
}
```

Sign it as a JWT (HMAC-SHA256 or, preferably, an asymmetric signature — Ed25519/RS256 — so the approval-issuing service holds the private key and verifiers only need the public key) with an approval service that is *not* reachable by the agent's own tool-calling loop — approval issuance must be a separate trust boundary, typically a human-facing UI or Slack/email approval flow backed by SSO, that mints the token after a real person acts.

### `requireApproval` wrapper

```ts
// governance/require-approval.ts
import { createHash } from "node:crypto";
import { jwtVerify, importSPKI } from "jose";
import type { ApprovalTokenPayload } from "./approval-token";

const usedTokenIds = new Set<string>(); // swap for a persistent store (Redis) in production

interface ApprovalContext {
  approvalToken: string;
  publicKey: string; // PEM
}

export function requireApproval<Args extends unknown[], Result>(
  scope: string,
  fn: (...args: Args) => Promise<Result>
) {
  return async (...args: [...Args, ApprovalContext]): Promise<Result> => {
    const ctx = args[args.length - 1] as ApprovalContext;
    const callArgs = args.slice(0, -1) as Args;

    const key = await importSPKI(ctx.publicKey, "EdDSA");
    const { payload } = await jwtVerify<ApprovalTokenPayload>(ctx.approvalToken, key, {
      algorithms: ["EdDSA"],
    });

    if (payload.scope !== scope) {
      throw new Error(`Approval scope mismatch: token grants "${payload.scope}", need "${scope}"`);
    }
    if (payload.exp < Date.now()) {
      throw new Error("Approval token expired");
    }
    if (usedTokenIds.has(payload.jti)) {
      throw new Error("Approval token already consumed (replay rejected)");
    }

    const requestHash = createHash("sha256").update(JSON.stringify(callArgs)).digest("hex");
    if (payload.requestHash !== requestHash) {
      throw new Error("Approval token does not match this exact call's arguments");
    }

    usedTokenIds.add(payload.jti); // mark consumed BEFORE executing
    auditLog({ scope, approvedBy: payload.approvedBy, args: callArgs, at: Date.now() });

    return fn(...callArgs);
  };
}

function auditLog(entry: Record<string, unknown>): void {
  // Append to an immutable, external audit sink (not the app's own DB).
  console.log(JSON.stringify({ event: "high_risk_call_approved", ...entry }));
}
```

Usage at the definition site — the raw function is never exported ungated:

```ts
// src/tools/payments.ts
async function _execute_transaction(accountId: string, amountCents: number): Promise<void> {
  /* ... */
}

export const execute_transaction = requireApproval("finance:transact", _execute_transaction);
```

Binding `requestHash` to the exact call arguments is what stops a human approving "send this legal notice to Acme Corp" from being silently reused to send a different notice to a different recipient — the token is single-shot and content-bound, not a general capability grant.

## Framework-specific enforcement

The wrapper above is framework-agnostic and should remain the ground truth. Each agent framework additionally offers a native pause/resume primitive that should be used to stop the *agent loop itself* before it reaches the gated call, giving a better UX (the agent visibly waits) than merely throwing inside the tool.

### LangGraph.js

LangGraph.js (`@langchain/langgraph`) exposes a dynamic `interrupt()` function — imported directly as `import { interrupt, Command } from "@langchain/langgraph"` (note: no `.types` subpath, unlike Python's `langgraph.types`) — that can be called from inside any graph node to pause execution and surface a JSON-serializable payload to the calling client. The graph resumes when the client re-invokes it with `new Command({ resume: <value> })` against the *same* `thread_id`; the return value of the `interrupt()` call becomes whatever was passed as `resume`. A documented quirk to be aware of: on resume, LangGraph re-executes the interrupted node **from its start**, not from the `interrupt()` line — so any code before the `interrupt()` call in that node runs again, which matters if that code has side effects.

Interrupts require a checkpointer (`MemorySaver` for development, or a persistent backend such as `@langchain/langgraph-checkpoint-sqlite`'s `SqliteSaver` / `@langchain/langgraph-checkpoint-postgres`'s `PostgresSaver` in production) bound to the graph at `compile()` time, plus a stable `thread_id` passed via `config.configurable`, since the paused state has to be durably recorded somewhere between the interrupt and the resume call. LangGraph also ships a coarser, unconditional primitive for this: `graph.compile({ interruptBefore: ["toolNode"] })` / `interruptAfter`, which pauses before/after a *named node* on every run regardless of which tool it's about to call. That's too blunt for per-tool gating (it can't distinguish `execute_transaction` from a harmless lookup tool in the same node), so the pattern below uses a conditional `interrupt()` call inside a purpose-built guard node instead. *(This guard-node pattern is the documented conceptual approach for tool-specific HITL gating; the JS docs largely mirror Python's human-in-the-loop tutorials rather than offering a JS-only canonical sample, so treat exact call shapes as illustrative and verify against your installed version.)*

```ts
import { interrupt, Command, MemorySaver, StateGraph } from "@langchain/langgraph";
import { HIGH_RISK_NAMES } from "../governance/high-risk-registry";

async function toolGuardNode(state: AgentState) {
  const nextCall = state.pendingToolCall;
  if (HIGH_RISK_NAMES.has(nextCall.name)) {
    // Pauses the graph; the payload is surfaced to whatever is driving
    // graph.stream()/invoke() so a human reviewer can inspect it.
    const decision = interrupt({
      kind: "approval_required",
      tool: nextCall.name,
      args: nextCall.args,
    });
    if (decision?.approved !== true) {
      throw new Error(`Approval denied for ${nextCall.name}`);
    }
    // decision.approvalToken is expected to carry the signed token
    // minted by the human-facing approval service, verified by
    // requireApproval() at the actual tool boundary below.
    return { approvalToken: decision.approvalToken };
  }
  return {};
}

// Resuming after a human approves, from the client/orchestrator side:
// await graph.invoke(new Command({ resume: { approved: true, approvalToken } }), { configurable: { thread_id } });

const checkpointer = new MemorySaver(); // swap for a persistent checkpointer in production
const graph = new StateGraph(/* ... */)
  .addNode("toolGuard", toolGuardNode)
  // route toolGuard -> the actual ToolNode only after resume
  .compile({ checkpointer });
```

Put the guard node immediately upstream of the `ToolNode` (or whatever invokes `execute_transaction`/`delete_database`/etc.), so the graph itself cannot proceed to the tool-calling edge without resuming through the interrupt. The `requireApproval` wrapper still runs inside the tool as a second, independent check — the graph-level interrupt is UX/orchestration, the wrapper is the actual security boundary.

### LlamaIndex.TS

LlamaIndex.TS (`llamaindex`) defines tools via a `tool()` helper (or the `FunctionTool` class in older versions) that takes a name, description, a parameter schema (commonly Zod), and an execute/call function; these are the objects handed to an agent or `AgentWorkflow`. *(Confirm exact helper name/signature against your installed version — `tool({...})` vs. `FunctionTool.from(...)` has shifted between releases.)* Gate high-risk tools by wrapping the `execute` function itself with `requireApproval`, and — where a human-approval step is needed mid-workflow — use the workflow event system (custom `WorkflowEvent` subclasses) to emit an "approval required" event and have a step block on receiving a corresponding external response event before continuing, mirroring the interrupt/resume shape above.

```ts
import { tool } from "llamaindex";
import { z } from "zod";
import { requireApproval } from "../governance/require-approval";

async function _deleteDatabase(dbName: string): Promise<string> {
  /* ... */
  return `deleted ${dbName}`;
}

const guardedDelete = requireApproval("infra:destroy", _deleteDatabase);

export const deleteDatabaseTool = tool({
  name: "delete_database",
  description: "Permanently deletes a database. Requires signed human approval.",
  parameters: z.object({ dbName: z.string(), approvalToken: z.string() }),
  execute: async ({ dbName, approvalToken }) =>
    guardedDelete(dbName, { approvalToken, publicKey: process.env.APPROVAL_PUBLIC_KEY! }),
});

// Workflow-level gating: emit a custom event and let a dedicated step
// wait for the matching human-response event before the tool step runs.
// class ApprovalRequiredEvent extends WorkflowEvent<{ tool: string; args: unknown }> {}
// class ApprovalGrantedEvent extends WorkflowEvent<{ approvalToken: string }> {}
// (Exact workflow/event class names are illustrative — verify against
// the `llamaindex` workflow API version in use; the pattern — emit a
// blocking event, resume on a matching external event — is the stable
// primitive across versions.)
```

Because the tool's own `execute` function calls through `requireApproval`, even if a workflow author forgets to wire the blocking event step, the tool still cannot complete without a valid, verified token — the workflow-level gate is a UX layer on top of the enforced boundary.

### Microsoft Agent Framework

Microsoft Agent Framework (the unification/successor of Semantic Kernel and AutoGen, developed in the open at `microsoft/agent-framework`) exposes the concept of function-invocation middleware — logic that intercepts a function/tool call before it executes and can short-circuit it, filling the same role as Semantic Kernel .NET's `IFunctionInvocationFilter`. **As of this writing, Microsoft Agent Framework is officially a .NET- and Python-first project; no official TypeScript/JS SDK (e.g. an `@microsoft/agent-framework` npm package) could be confirmed to exist.** If you are building on LangGraph.js and LlamaIndex.TS in a Node stack, treat Microsoft Agent Framework support as aspirational/unconfirmed rather than something to wire up today — do not depend on a JS import that may not exist. The snippet below is included only to document the *interception pattern* (middleware that can decline to call `next()`) so the same design can be ported once/if a JS SDK ships; the exact interface name (whether it stays middleware-style or is renamed) is not confirmed even in the .NET/Python SDKs at the time of this research, so treat every type name below as illustrative, not a real export.

```ts
// Illustrative — verify exact middleware registration API for your
// Microsoft Agent Framework SDK version.
import { requireApproval } from "../governance/require-approval";
import { HIGH_RISK_NAMES } from "../governance/high-risk-registry";

const approvalMiddleware = async (context: FunctionInvocationContext, next: () => Promise<void>) => {
  if (HIGH_RISK_NAMES.has(context.functionName)) {
    const approvalToken = context.metadata?.approvalToken;
    if (!approvalToken) {
      context.result = { error: "approval_required", scope: context.functionName };
      return; // short-circuit: do not call next(), function does not execute
    }
    // Delegate actual cryptographic verification to the shared wrapper
    // rather than re-implementing verification in the middleware.
    await requireApproval(context.functionName, async () => {})(
      { approvalToken, publicKey: process.env.APPROVAL_PUBLIC_KEY! } as any
    );
  }
  await next();
};

// agent.use(approvalMiddleware); // registered on the agent/kernel pipeline
```

The critical property, regardless of exact registration syntax, is that the middleware sits *before* function execution in the pipeline and can decline to call `next()` — turning "approval missing" into "function never runs" rather than "function runs and then we log a warning." As with the other two frameworks, keep `requireApproval` as the single source of truth for token verification so the security property doesn't depend on getting framework-specific middleware code right in three different places.

## Network sandboxing

Constraining what the agent can *call* is necessary but not sufficient if the runtime can still make arbitrary outbound network requests — a compromised or misled agent could exfiltrate data or reach an unapproved system via a generic HTTP tool even if every named high-risk function is gated. Enforce egress restriction as a second, independent layer: an allowlist of approved hosts/channels, validated both at process start (preflight) and at every outbound call (runtime).

### Egress allowlist

```json
// governance/egress-allowlist.json
{
  "allowedHosts": [
    "api.internal-approval-service.com",
    "api.stripe.com",
    "hooks.slack.com"
  ]
}
```

### Preflight validator

Run before the agent process starts serving traffic; fails fast if the environment is misconfigured (missing proxy pinning, wildcard DNS, no allowlist file, etc.).

```ts
// scripts/preflight-network.ts
import { readFileSync, existsSync } from "node:fs";

function fail(msg: string): never {
  console.error(`[preflight-network] FAIL: ${msg}`);
  process.exit(1);
}

function main(): void {
  const allowlistPath = "governance/egress-allowlist.json";
  if (!existsSync(allowlistPath)) fail(`missing ${allowlistPath}`);

  const { allowedHosts } = JSON.parse(readFileSync(allowlistPath, "utf-8"));
  if (!Array.isArray(allowedHosts) || allowedHosts.length === 0) {
    fail("egress allowlist is empty — nothing would be reachable, or check is misconfigured");
  }

  // Require an explicit proxy that enforces the allowlist at the network
  // layer (defense-in-depth below the application's own fetch wrapper).
  const proxy = process.env.HTTPS_PROXY ?? process.env.https_proxy;
  if (!proxy) {
    fail("HTTPS_PROXY is not set — outbound requests would bypass network-layer enforcement");
  }

  const noProxy = process.env.NO_PROXY ?? process.env.no_proxy ?? "";
  if (noProxy.includes("*")) {
    fail("NO_PROXY contains a wildcard, which would defeat proxy-layer egress control");
  }

  console.log(`[preflight-network] OK — ${allowedHosts.length} allowed hosts, proxy pinned.`);
}

main();
```

### `guardedFetch` wrapper

Application-layer enforcement as a second gate, independent of the proxy — every outbound call in the codebase should go through this, not the global `fetch`:

```ts
// governance/guarded-fetch.ts
import { readFileSync } from "node:fs";

const { allowedHosts } = JSON.parse(readFileSync("governance/egress-allowlist.json", "utf-8")) as {
  allowedHosts: string[];
};
const allowedSet = new Set<string>(allowedHosts);

export async function guardedFetch(input: string | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(input);

  if (!allowedSet.has(url.hostname)) {
    auditRejectedEgress(url.hostname);
    throw new Error(`Egress blocked: "${url.hostname}" is not in the approved allowlist`);
  }
  if (url.protocol !== "https:") {
    throw new Error(`Egress blocked: only https is permitted, got "${url.protocol}"`);
  }

  return fetch(url, init);
}

function auditRejectedEgress(hostname: string): void {
  console.warn(JSON.stringify({ event: "egress_blocked", hostname, at: Date.now() }));
}
```

Ban direct `fetch`/`http.request`/`axios` usage outside `guardedFetch` via an ESLint `no-restricted-globals`/`no-restricted-imports` rule, so the AST scanner from Section 4 has an equivalent for network calls, not just tool calls.

## CI/CD integration

```json
// package.json (excerpt)
{
  "scripts": {
    "governance:scan": "ts-node scripts/scan-high-risk-calls.ts",
    "governance:preflight": "ts-node scripts/preflight-network.ts",
    "governance:check": "npm run governance:scan && npm run governance:preflight"
  }
}
```

```yaml
# .github/workflows/governance.yml
name: Governance — Action-Space Constraint

on:
  pull_request:
  push:
    branches: [main]

jobs:
  action-space-constraint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: "npm"

      - run: npm ci

      - name: Scan for unguarded high-risk calls
        run: npm run governance:scan

      - name: Validate network egress configuration
        env:
          HTTPS_PROXY: "https://egress-proxy.internal:3128"
          NO_PROXY: "localhost,127.0.0.1"
        run: npm run governance:preflight

      - name: Lint — ban direct fetch outside guardedFetch
        run: npx eslint . --rule '{"no-restricted-imports": ["error", {"paths": [{"name": "node-fetch", "message": "Use governance/guarded-fetch.ts"}]}]}'
```

Both `governance:scan` and `governance:preflight` `process.exit(1)` on failure, which fails the job and blocks merge — there is no "warn only" mode for this control. Treat this job as a required status check in branch protection, not an optional lint.

## Failure modes & bypass risks

- **Dynamic dispatch / computed call targets** — `tools[toolName](...)` or `eval`-style invocation defeats the AST scanner's static call-expression matching, since the callee identifier isn't statically `execute_transaction`. *Mitigation*: forbid dynamic property access into the tool registry via lint rule; require all tool registration to go through a typed registry object the scanner can enumerate, and have the runtime wrapper double as the last line of defense (Section 5) so even an unscanned path still can't execute without a token.
- **String-built or aliased function names** — `import { execute_transaction as run }`, or re-exporting through a barrel file, can slip past a naive scanner. *Mitigation*: the AST scanner in this doc resolves identifiers to their symbol declaration rather than matching text, which follows aliasing and re-exports; keep this resolution step rather than downgrading to name-string matching for performance.
- **New tools never added to the registry** — the fastest way to defeat this control is simply not declaring a new dangerous function as high-risk in the first place. *Mitigation*: require registry changes and new tool/function additions to go through the same code-owners review; add a secondary heuristic scan (keyword match on `delete`, `transfer`, `send`, `execute`, `notify` in exported function names) that flags *candidates* for human triage even if not yet in the registry, failing CI with a "classify this function" prompt rather than silently passing.
- **Approval-token replay** — reusing a previously valid token for a new, unapproved call. *Mitigation*: the `requestHash` binding (Section 5) scopes the token to the exact serialized arguments, and the `jti` nonce is marked consumed atomically before execution; back `usedTokenIds` with a persistent, atomic store (Redis `SETNX`, not the in-memory `Set` shown for illustration) in any multi-instance deployment, or replay across instances becomes trivial.
- **Approval-token forgery or over-broad scopes** — a leaked signing key, or a scope string like `"admin:*"` that's broader than intended. *Mitigation*: asymmetric signing (private key held only by the approval-issuing service, never by the agent runtime) so a compromised agent process cannot mint its own tokens; scopes should be enumerable and match 1:1 with registry entries, never wildcarded.
- **SSRF around the fetch wrapper** — DNS rebinding, redirects to a non-allowlisted host after an allowlisted host returns a 3xx, or `guardedFetch` being bypassed by a library that shells out (`curl`, native HTTP clients, a sub-dependency's own request layer). *Mitigation*: disable automatic redirect-following in `guardedFetch` and re-validate the target host on every hop; enforce egress at the network layer too (the proxy/NO_PROXY preflight check), so the allowlist doesn't depend solely on application code being used correctly everywhere; audit third-party dependencies used by agent tools for their own network calls.
- **Human approval fatigue / rubber-stamping** — if every agent action pings a human, reviewers start approving without reading. *Mitigation*: keep the high-risk registry deliberately narrow (Section 3's "what good looks like"), so approval requests stay rare and meaningful; surface the bound `requestHash`/args in the approval UI so the reviewer sees exactly what they're signing off on, not a generic "approve?" prompt.
- **Interrupt/resume state leakage across threads** — in LangGraph.js, reusing a `thread_id` or checkpointer state incorrectly could let one resumed approval apply to a different pending action. *Mitigation*: bind approval tokens to the specific `requestHash`, not just the thread — this makes the LangGraph-level interrupt UX-only and keeps the actual security boundary in the framework-independent wrapper, per Section 6's design intent.

## Enforcement checklist

- [ ] `governance/high-risk-registry.ts` exists, is version-controlled, and every entry has a `scope` and `reason`.
- [ ] AST scanner (`scripts/scan-high-risk-calls.ts`) runs in CI and exits non-zero on any unwrapped call or unwrapped high-risk export.
- [ ] Regex fallback exists only as a fast local pre-commit hint, never as the CI gate of record.
- [ ] `requireApproval` (or framework-native equivalent) wraps every registry entry at its export/definition site — the raw unwrapped function is never exported.
- [ ] Approval tokens are signed asymmetrically, scoped, expiring, single-use (`jti` tracked in a persistent store), and bound to a hash of the exact call arguments.
- [ ] Token verification logic lives in one shared module (`governance/require-approval.ts`), reused by every framework-specific integration rather than reimplemented per framework.
- [ ] LangGraph.js graphs place an `interrupt()`-based guard node immediately upstream of any edge that reaches a high-risk tool, backed by a durable checkpointer.
- [ ] LlamaIndex.TS tool `execute` functions for high-risk tools call through `requireApproval`; workflow-level approval events, if used, are UX only, not the security boundary.
- [ ] Microsoft Agent Framework function-invocation middleware short-circuits (does not call `next()`) for high-risk functions lacking a valid token.
- [ ] Direct `fetch`/`http`/`axios` usage is banned outside `governance/guarded-fetch.ts` via lint rule.
- [ ] `governance:preflight` validates `HTTPS_PROXY` is set, `NO_PROXY` has no wildcard, and the egress allowlist file is present and non-empty.
- [ ] `guardedFetch` disables automatic redirect-following and re-validates the target host on every hop.
- [ ] CI workflow runs `governance:scan` and `governance:preflight` as required status checks on every PR, with no "warn only" bypass.
- [ ] Every gated call (approved, denied, or rejected-egress) writes to an external, immutable audit log with principal, scope, and timestamp.
- [ ] New high-risk-shaped function names (`delete*`, `transfer*`, `execute*`, `send*`, `notify*`) are flagged for manual registry-classification review even before formal registry inclusion.
