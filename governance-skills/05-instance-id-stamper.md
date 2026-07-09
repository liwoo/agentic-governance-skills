# Skill 05 — The "Instance ID" Stamper (Attributability)

*Every outbound action an agent takes must carry a verifiable, unforgeable claim of "which agent, which run, whose accountability."*

## Governance rationale

Non-human actors that can call tools, spend money, write to production systems, or talk to third parties create a new category of operational risk: **unattributable action**. When a human employee sends a malformed API request or a corrupted invoice, there is a name in an access log, a badge swipe, an email thread. When an autonomous agent does the same thing, the naive default is a shared service account, a generic `Bearer` token, and a log line that says `POST /orders 500` with no indication of *which* deployed agent, *which* running instance, *which* conversation, or *which human is accountable for that agent existing at all*.

The Instance ID Stamper closes that gap by treating identity as a **mandatory, structural property of every egress call and tool invocation** — not an optional logging nicety. This matters for four concrete reasons:

- **Incident attribution.** When something goes wrong — a bad tool call, a runaway loop, a data exfiltration attempt — the first question is "which process did this, and who owns it?" Without a stamped identity, answering that question means grepping infra logs and hoping metadata survived. With it, the answer is in the request itself.
- **Third-party auditing.** External services (payment processors, partner APIs, regulators) increasingly require that automated callers be distinguishable from human ones and traceable to an accountable party. A stamped, signed identity header is the mechanism by which a third party can independently verify "this call came from a known, registered agent instance" without trusting your infrastructure's word for it.
- **The agent identity chain.** Attributability isn't just "this call came from *an* agent" — it's a chain: `PRINCIPAL_ID` (accountable human/org) owns `AGENT_ID` (a deployed agent type/build) which spawned `INSTANCE_ID` (this specific running process) which is executing `SESSION_ID`/`THREAD_ID` (this specific conversation or run). Break any link in that chain and you lose the ability to answer "who is responsible for this." This mirrors emerging "agent identity" work in the industry (e.g., workload identity federation extended to agents, SPIFFE/SPIRE-style identities for non-human actors, and OAuth-adjacent proposals for delegated agent credentials) — the common thread is that agents need a *first-class, non-human identity* that is still traceable to a human or organizational owner, not an anonymous service account.
- **Non-repudiation for governance controls.** This skill is the connective tissue for the other governance skills in this series. **Skill 03 (the ledger)** is only as trustworthy as the identity attached to each entry — an unstamped ledger entry is just an unverified claim. **Skill 04 (the kill switch)** operates *by instance*: you cannot selectively halt "this misbehaving agent instance" if instances aren't uniquely and reliably identified. The Instance ID Stamper is the prerequisite that makes both of those controls meaningful rather than aspirational.

The failure mode this skill prevents is not just "sloppy logs" — it's the structural inability to answer "who do we hold accountable" after an incident, which is precisely the question every post-mortem, audit, and regulatory inquiry starts with.

## What "good" looks like

When this skill is fully enforced, the following invariants hold:

- No process can boot into a serving state without a valid `AGENT_ID`, `PRINCIPAL_ID`, and signing key configured. Missing or malformed identity config is a **hard startup failure**, not a warning.
- Every outbound HTTP request — to internal services, third-party APIs, or LLM providers — carries a signed identity claim, injected by a single choke-point client. There is no code path that constructs and sends a raw `fetch`/`axios` request that bypasses the stamp.
- Every tool invocation (function call, retrieval, code execution) is wrapped such that the identity — plus session/thread context — is attached to the invocation record before it reaches the ledger (Skill 03) or any external system.
- The identity claim is **signed and time-bound** (short-lived JWT or HMAC token), so a captured header cannot be replayed indefinitely or forged by a party without the signing key.
- `INSTANCE_ID` is generated fresh per process (never reused, never hardcoded), guaranteeing that two concurrently running copies of the same agent are distinguishable.
- CI fails the build if (a) an AST scan finds a raw HTTP client bypassing the stamped wrapper, or (b) required identity environment variables are absent from the deployment manifest.
- Downstream systems — logs, traces, the ledger, partner services — can all correlate a single user-facing incident back to one specific process, one specific run, and one accountable human, using the same set of IDs end-to-end.

## The identity model

Attributability requires decomposing "identity" into four distinct concepts that are frequently conflated in ad hoc implementations. Conflating them is itself a governance failure: if `AGENT_ID` and `INSTANCE_ID` are the same string, you can't tell two crashed-and-restarted replicas apart; if `PRINCIPAL_ID` is missing, you have an identity with no accountable owner.

| Field | Definition | Lifetime | Example |
|---|---|---|---|
| `AGENT_ID` | The deployed agent *type* or *build* — what code is running. Stable across restarts and replicas of the same deployment. | Per deployment/build (set at deploy time via env/config) | `support-triage-agent` or `support-triage-agent@2026.07.03-a1b2c3` |
| `INSTANCE_ID` | This specific running *process*. Ephemeral — unique per process lifetime, regenerated on every restart. | Per process (generated at boot, never persisted/reused) | `inst_01J9F8QZK3M7XG5R6T2P8N4C1V` (ULID) |
| `SESSION_ID` / `THREAD_ID` | A single conversation, task, or graph run executed by an instance. An instance may handle many sessions sequentially or concurrently. | Per conversation/run | `thread_9c3f2a...` |
| `PRINCIPAL_ID` | The accountable human or organizational owner — who is responsible if this agent does something wrong. Not a technical artifact; a governance one. | Per deployment (set by whoever owns the deploy pipeline / config) | `jeremiahchienda@gmail.com` or `team:platform-eng` |

These compose into a single verifiable identity claim: *"Instance `INSTANCE_ID` of agent `AGENT_ID`, executing session `SESSION_ID`, deployed and owned by `PRINCIPAL_ID`, asserts the following action."* Every one of the four fields is required — an identity claim missing `PRINCIPAL_ID` is not an identity claim, it's an anonymous technical fingerprint.

```ts
// identity/types.ts

/** The full, composable identity of a running agent process. */
export interface AgentIdentity {
  /** Deployed agent type/build. Stable across restarts. Set via env at deploy time. */
  agentId: string;
  /** This process's unique, ephemeral identifier. Generated fresh at boot. */
  instanceId: string;
  /** The accountable human/org principal. Set via env/secret at deploy time. */
  principalId: string;
  /** Unix seconds this identity was minted (process boot time). */
  bootedAt: number;
  /** Hostname/pod name, for collision diagnostics — not a substitute for instanceId. */
  host: string;
}

/** Per-run identity, layering session context onto the process identity. */
export interface RunIdentity extends AgentIdentity {
  sessionId: string; // a.k.a threadId in LangGraph terms
}
```

```ts
// identity/factory.ts
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { ulid } from "ulid"; // or any ULID/UUIDv7 lib — see "Failure modes" re: collision resistance

/**
 * Assembles the process-level AgentIdentity exactly once at boot.
 * This is intentionally a singleton — an instance has exactly one identity
 * for its entire process lifetime. It is NOT regenerated per request.
 */
let cachedIdentity: AgentIdentity | undefined;

export function loadAgentIdentity(): AgentIdentity {
  if (cachedIdentity) return cachedIdentity;

  const agentId = process.env.AGENT_ID;
  const principalId = process.env.PRINCIPAL_ID;

  if (!agentId || !principalId) {
    // Deliberately thrown, not logged-and-continued: identity is load-bearing.
    // See "Deterministic checks" for the dedicated preflight that catches this
    // before the process ever reaches request-serving code.
    throw new Error(
      "Missing AGENT_ID or PRINCIPAL_ID — refusing to boot an unattributable agent instance."
    );
  }

  cachedIdentity = {
    agentId,
    instanceId: process.env.INSTANCE_ID ?? `inst_${ulid()}`, // prefer injected value (see CI/CD section)
    principalId,
    bootedAt: Math.floor(Date.now() / 1000),
    host: hostname(),
  };

  return cachedIdentity;
}

export function deriveRunIdentity(sessionId: string): RunIdentity {
  return { ...loadAgentIdentity(), sessionId };
}
```

Note the deliberate asymmetry: `instanceId` is *preferably* injected by the orchestrator (pod name, task ARN, etc. — see CI/CD section) so it's correlatable with infra-level logs, but falls back to a locally generated ULID so the invariant "every instance has an id" holds even on bare processes. `agentId` and `principalId` have no such fallback — they are governance-critical and must come from explicit configuration, never be guessed.

## Signed identity, not just a header

A plain `X-Agent-Id: support-triage-agent` header is trivially spoofable — any client can set it. For attributability to hold up under adversarial conditions (a compromised dependency, a malicious insider, a misconfigured proxy), the identity claim must be **cryptographically signed** by the deploying environment's key, so a receiving service or audit gateway can verify *"this claim was actually minted by a process holding the deployment's signing key"* rather than merely trusting a self-reported string.

The pattern: mint a short-lived signed token (JWT is the natural fit, HMAC-SHA256 over a compact payload works too if you want to avoid a JWT library) carrying the identity claim, attached on every request alongside the human-readable header for quick log grepping.

```ts
// identity/sign.ts
import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import { loadAgentIdentity } from "./factory";

const ALG = "HS256";
const TTL_SECONDS = 300; // short-lived: a leaked token is useless within minutes

interface IdentityClaims extends JWTPayload {
  agentId: string;
  instanceId: string;
  principalId: string;
  sessionId?: string;
}

function getSigningKey(): Uint8Array {
  const secret = process.env.AGENT_IDENTITY_SIGNING_KEY;
  if (!secret || secret.length < 32) {
    throw new Error(
      "AGENT_IDENTITY_SIGNING_KEY missing or too short (min 32 bytes) — cannot mint signed identity."
    );
  }
  return new TextEncoder().encode(secret);
}

/** Mints a fresh, short-lived signed identity token for the current process/session. */
export async function mintIdentityToken(sessionId?: string): Promise<string> {
  const identity = loadAgentIdentity();
  const claims: IdentityClaims = {
    agentId: identity.agentId,
    instanceId: identity.instanceId,
    principalId: identity.principalId,
    ...(sessionId ? { sessionId } : {}),
  };

  return new SignJWT(claims)
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setExpirationTime(`${TTL_SECONDS}s`)
    .setIssuer(identity.agentId)
    .sign(getSigningKey());
}

/** Verifier — runs in the receiving service or a dedicated audit gateway. */
export async function verifyIdentityToken(token: string): Promise<IdentityClaims> {
  const { payload } = await jwtVerify(token, getSigningKey(), {
    algorithms: [ALG],
  });
  return payload as IdentityClaims;
}
```

On the wire, every stamped request carries both forms:

```
X-Agent-Identity: eyJhbGciOiJIUzI1NiJ9.eyJhZ2VudElkIjoic3VwcG9ydC10cmlhZ2UtYWdlbnQi...   (signed JWT — verifiable)
X-Agent-Id: support-triage-agent                                                          (human-readable — for grep/log dashboards only, never trusted alone)
X-Instance-Id: inst_01J9F8QZK3M7XG5R6T2P8N4C1V
```

**Key management notes:**

- `AGENT_IDENTITY_SIGNING_KEY` is a *per-deployment* secret (one key per environment/agent-type, not shared globally) — a compromise of one agent's key shouldn't unmask or forge every other agent's identity.
- Store it in the same secrets manager as other production credentials (e.g., cloud KMS-backed secret store), injected as an env var at container start — never committed, never baked into an image.
- Rotate on a schedule and immediately on suspected leak; because TTL is short (minutes), rotation has a small, bounded blast radius — old tokens simply expire.
- For cross-organization verification (a genuine third party checking your agent's identity, not just an internal service), consider asymmetric signing (RS256/EdDSA) with a published public key/JWKS endpoint instead of shared-secret HMAC, so the verifier never needs your private key.

## Deterministic checks (pre-deployment)

Two independent, automatable gates. Neither is optional — the boot check catches missing configuration, the AST scan catches missing *usage* of the stamping wrapper elsewhere in the code, which the boot check cannot see.

**(a) Boot-time / preflight identity validator.** Runs before the process accepts any traffic. Fails fast and loud.

```ts
// scripts/preflight-identity-check.ts
/**
 * Run as the first step of the container entrypoint / npm "prestart" hook.
 * Exits non-zero (crashes the deploy) if identity cannot be established.
 */

interface CheckResult {
  ok: boolean;
  errors: string[];
}

function checkIdentityConfig(env: NodeJS.ProcessEnv): CheckResult {
  const errors: string[] = [];

  const agentId = env.AGENT_ID;
  const principalId = env.PRINCIPAL_ID;
  const signingKey = env.AGENT_IDENTITY_SIGNING_KEY;

  if (!agentId) {
    errors.push("AGENT_ID is not set.");
  } else if (!/^[a-z0-9][a-z0-9-_.]{2,63}$/.test(agentId)) {
    errors.push(`AGENT_ID "${agentId}" fails naming convention (lowercase, alnum, -_. , 3-64 chars).`);
  }

  if (!principalId) {
    errors.push("PRINCIPAL_ID is not set — no accountable human/owner configured.");
  } else if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$|^team:[a-z0-9-]+$/.test(principalId)) {
    errors.push(`PRINCIPAL_ID "${principalId}" is not a recognizable email or "team:<slug>".`);
  }

  if (!signingKey) {
    errors.push("AGENT_IDENTITY_SIGNING_KEY is not set — identity claims cannot be signed.");
  } else if (Buffer.byteLength(signingKey, "utf8") < 32) {
    errors.push("AGENT_IDENTITY_SIGNING_KEY is present but shorter than 32 bytes — too weak.");
  }

  return { ok: errors.length === 0, errors };
}

function main(): void {
  const result = checkIdentityConfig(process.env);
  if (!result.ok) {
    // eslint-disable-next-line no-console
    console.error("[preflight-identity-check] BLOCKING DEPLOY — attributability gate failed:");
    for (const err of result.errors) console.error(`  - ${err}`);
    process.exit(1);
  }
  // eslint-disable-next-line no-console
  console.log("[preflight-identity-check] OK — identity config valid.");
}

main();
```

```json
// package.json (excerpt)
{
  "scripts": {
    "prestart": "tsx scripts/preflight-identity-check.ts",
    "start": "node dist/server.js"
  }
}
```

**(b) AST scanner for un-stamped HTTP clients.** A boot check only proves config *exists* — it says nothing about whether every call site actually uses the stamping wrapper. This scanner walks the TypeScript AST with `ts-morph` and flags any direct `fetch(...)` or `axios` usage outside the sanctioned `identity/http-client.ts` module, so a raw, unsigned outbound call can never sneak into the codebase.

```ts
// scripts/scan-unstamped-http.ts
import { Project, SyntaxKind, type CallExpression } from "ts-morph";
import path from "node:path";

const ALLOWED_FILES = new Set([
  path.resolve("src/identity/http-client.ts"), // the ONE place raw fetch/axios may appear
]);

const FLAGGED_CALLEES = new Set(["fetch", "axios", "axios.get", "axios.post", "axios.put", "axios.delete", "axios.patch"]);

function calleeText(call: CallExpression): string {
  return call.getExpression().getText();
}

function main(): void {
  const project = new Project({ tsConfigFilePath: "tsconfig.json" });
  const violations: { file: string; line: number; callee: string }[] = [];

  for (const sourceFile of project.getSourceFiles("src/**/*.ts")) {
    const filePath = sourceFile.getFilePath();
    if (ALLOWED_FILES.has(path.resolve(filePath))) continue;
    if (filePath.includes(".test.") || filePath.includes(".spec.")) continue; // tests may mock raw clients

    for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const callee = calleeText(call);
      if (FLAGGED_CALLEES.has(callee) || callee.startsWith("axios.")) {
        violations.push({
          file: filePath,
          line: call.getStartLineNumber(),
          callee,
        });
      }
    }

    // Also flag `import axios from "axios"` / raw `new Axios(...)` client construction outside the wrapper.
    for (const imp of sourceFile.getImportDeclarations()) {
      if (imp.getModuleSpecifierValue() === "axios") {
        violations.push({ file: filePath, line: imp.getStartLineNumber(), callee: "import axios" });
      }
    }
  }

  if (violations.length > 0) {
    console.error("[scan-unstamped-http] BLOCKING BUILD — raw HTTP clients bypass identity stamping:");
    for (const v of violations) {
      console.error(`  ${v.file}:${v.line} -> ${v.callee}`);
    }
    console.error(`\nRoute all outbound calls through identity/http-client.ts's stampedFetch().`);
    process.exit(1);
  }

  console.log("[scan-unstamped-http] OK — no un-stamped HTTP clients found.");
}

main();
```

```json
// package.json (excerpt)
{
  "scripts": {
    "scan:unstamped-http": "tsx scripts/scan-unstamped-http.ts"
  }
}
```

## Grounding action — stamping every egress & tool call

The grounding action is a **single choke-point client**: every part of the codebase that needs to make an outbound HTTP call or invoke a tool goes through one wrapper, and that wrapper — not the caller — is responsible for attaching the signed identity. This is enforced structurally (only one file is allowed to touch `fetch`/`axios`, per the scanner above) rather than by convention/documentation.

```ts
// identity/http-client.ts
import { mintIdentityToken } from "./sign";
import { loadAgentIdentity } from "./factory";

export interface StampedFetchOptions extends RequestInit {
  sessionId?: string;
}

/**
 * The ONLY sanctioned way to make an outbound HTTP call from this codebase.
 * Every request is stamped with a signed, short-lived identity claim.
 */
export async function stampedFetch(url: string, options: StampedFetchOptions = {}): Promise<Response> {
  const identity = loadAgentIdentity();
  const token = await mintIdentityToken(options.sessionId);

  const headers = new Headers(options.headers);
  headers.set("X-Agent-Identity", token);
  headers.set("X-Agent-Id", identity.agentId);
  headers.set("X-Instance-Id", identity.instanceId);
  if (options.sessionId) headers.set("X-Session-Id", options.sessionId);

  return fetch(url, { ...options, headers });
}
```

```ts
// identity/tool-wrapper.ts
import { deriveRunIdentity, type RunIdentity } from "./factory";
import { appendLedgerEntry } from "../ledger"; // Skill 03 — the ledger

export interface ToolInvocation<TArgs, TResult> {
  name: string;
  args: TArgs;
  execute: (args: TArgs) => Promise<TResult>;
}

/**
 * Wraps any tool function so that every invocation carries the run's identity
 * and is recorded to the ledger BEFORE and AFTER execution, attributed to a
 * specific instance and session — never anonymous.
 */
export function withIdentity<TArgs, TResult>(
  tool: ToolInvocation<TArgs, TResult>,
  sessionId: string
) {
  return async (args: TArgs): Promise<TResult> => {
    const identity: RunIdentity = deriveRunIdentity(sessionId);

    await appendLedgerEntry({
      type: "tool_call_started",
      tool: tool.name,
      args,
      identity, // agentId, instanceId, principalId, sessionId — all attached
      timestamp: new Date().toISOString(),
    });

    try {
      const result = await tool.execute(args);
      await appendLedgerEntry({
        type: "tool_call_completed",
        tool: tool.name,
        identity,
        timestamp: new Date().toISOString(),
      });
      return result;
    } catch (err) {
      await appendLedgerEntry({
        type: "tool_call_failed",
        tool: tool.name,
        identity,
        error: err instanceof Error ? err.message : String(err),
        timestamp: new Date().toISOString(),
      });
      throw err;
    }
  };
}
```

The choke-point pattern is the load-bearing part here: `stampedFetch` and `withIdentity` are not "recommended helpers," they are the *only* code paths capable of reaching the network or a tool. Combined with the AST scanner in the previous section, this makes "an agent action left the process unattributed" a compile-/build-time impossibility rather than a code-review hope.

## Framework-specific enforcement

### LangGraph.js

LangGraph.js threads per-invocation context through the `configurable` field of a `RunnableConfig`, which every node function receives as its second argument. This is also the mechanism checkpointers (`MemorySaver`, `SqliteSaver`, Postgres-backed savers, etc.) use for `thread_id` — the field that scopes persisted state to a conversation. Treat `configurable` as the natural carrier for `RunIdentity`: set it once when the graph is invoked, and every node — including tool nodes — can read it back out.

```ts
import { StateGraph, MemorySaver } from "@langchain/langgraph";
import { deriveRunIdentity } from "./identity/factory";

const checkpointer = new MemorySaver();
const graph = new StateGraph(/* ...schema... */).compile({ checkpointer });

const sessionId = "thread_9c3f2a...";
const identity = deriveRunIdentity(sessionId);

await graph.invoke(
  { messages: [/* ... */] },
  {
    configurable: {
      thread_id: sessionId,          // checkpointer's own correlation key
      agentIdentity: identity,       // our attributability claim, riding alongside it
    },
  }
);

// Inside any node or tool node:
async function toolNode(state: typeof StateAnnotation.State, config: RunnableConfig) {
  const identity = config.configurable?.agentIdentity;
  // use `identity` when calling stampedFetch / withIdentity from within this node
}
```

Because `thread_id` is already the checkpointer's native correlation key, aligning `SESSION_ID` with `thread_id` (rather than inventing a parallel identifier) keeps the identity model and LangGraph's own persistence model pointing at the same conversation — one less place for drift between "what the ledger says happened" and "what the checkpointer persisted."

### LlamaIndex.TS

LlamaIndex.TS centralizes cross-cutting config in the global `Settings` object (`Settings.llm`, `Settings.embedModel`, etc.) and defines tools via `FunctionTool`/`tool()` helpers that wrap a plain async function with a schema. Neither primitive has a built-in "outbound identity" concept, so enforcement means (1) never letting a tool's implementation function touch `fetch`/`axios` directly — route it through `stampedFetch` — and (2) propagating identity through workflow `Context` state for multi-step agent workflows.

```ts
import { tool } from "llamaindex";
import { z } from "zod";
import { stampedFetch } from "./identity/http-client";
import { withIdentity } from "./identity/tool-wrapper";

const lookupOrder = tool({
  name: "lookupOrder",
  description: "Fetch order details from the orders service.",
  parameters: z.object({ orderId: z.string() }),
  execute: withIdentity(
    {
      name: "lookupOrder",
      execute: async ({ orderId }: { orderId: string }) => {
        const res = await stampedFetch(`https://orders.internal/api/orders/${orderId}`);
        return res.json();
      },
    },
    currentSessionId // threaded in from the enclosing workflow Context
  ),
});
```

For multi-step `Workflow`s, carry `RunIdentity` in the workflow's `Context` state (the mechanism LlamaIndex.TS uses to pass data between step handlers via custom events/state) so every step — not just the entry point — can derive the same identity without re-reading environment variables mid-run.

### Microsoft Agent Framework

Microsoft's Agent Framework (the unified successor spanning Semantic Kernel's agent runtime and AutoGen's multi-agent patterns) exposes **middleware hooks** around function/tool invocation and agent run steps — conceptually an `IFunctionInvocationFilter`/agent-middleware pattern that wraps every function call the same way ASP.NET middleware wraps requests. *(Language note: Microsoft Agent Framework ships **only .NET and Python SDKs** — there is **no official JS/TS package** (`@microsoft/agent-framework` does not exist; the separate Microsoft 365 Agents SDK, `@microsoft/agents-hosting`, is a different product). The TypeScript snippet below documents the identity-stamping pattern for a Node port; if your agents are in .NET/Python, register the stamper as a `FunctionMiddleware`/agent middleware there.)*

```ts
// Illustrative — confirm exact middleware/filter API against current MAF TS docs.
import { deriveRunIdentity } from "./identity/http-client";

const identityMiddleware = {
  async onFunctionInvocation(context, next) {
    const identity = deriveRunIdentity(context.sessionId);
    context.metadata.set("agentIdentity", identity);   // carried into the invocation record
    context.headers.set("X-Agent-Identity", await mintIdentityToken(context.sessionId));
    return next(context); // proceed only after stamping
  },
};

// registered once on the agent/kernel so it applies to every function call, not opt-in per call
agent.use(identityMiddleware);
```

The principle carries regardless of exact API surface: identity stamping belongs in **middleware that wraps every function invocation and outbound call by construction**, with the accountable `principalId` carried in the agent's run context so it's available to every step, not re-derived ad hoc per call site.

## Propagation & correlation

Attributability is only useful if the identity survives the full path from "agent decided to act" to "action landed in a system of record." That means the same IDs need to show up in four places, using the same values, so a human investigating an incident can pivot between them without translation:

- **The ledger (Skill 03).** Every ledger entry includes the full `RunIdentity` (as shown in `withIdentity` above), not just a free-text "agent" string. This is what makes the ledger queryable by instance, session, or principal.
- **Logs.** Structured log lines should include `agentId`, `instanceId`, `sessionId` as top-level fields (not buried in a message string), so log aggregation tools can filter/group by them directly.
- **Traces.** Propagate identity as OpenTelemetry **resource attributes** (`service.instance.id` mapped to `instanceId`, a custom `agent.id` / `agent.principal_id` attribute) set once at tracer-provider init, plus **baggage** for values that need to travel across service boundaries within a single request (e.g., `sessionId`) using the **W3C Trace Context** (`traceparent`/`tracestate`) and **W3C Baggage** (`baggage` header) standards. Baggage is the correct mechanism specifically because it propagates automatically through instrumented HTTP clients across service hops, whereas resource attributes are fixed per-process.
- **Downstream service calls.** Because `stampedFetch` sets `X-Agent-Identity`/`X-Agent-Id`/`X-Instance-Id`/`X-Session-Id` on every egress call (see above), any downstream service that also adopts this pattern gets the identity for free — and can extend the correlation chain further by re-stamping *its own* `INSTANCE_ID` while forwarding the inbound `PRINCIPAL_ID`/`SESSION_ID` unchanged, preserving the original accountability chain across a multi-service call graph.

The practical test: given one user complaint ("the bot did X at 14:32"), you should be able to start from a trace ID or a ledger entry and, without cross-referencing anything outside these four systems, land on the exact instance, the exact session, and the exact accountable principal.

## CI/CD integration

Both deterministic checks from earlier become required, blocking CI jobs — not advisory lint warnings — plus a runtime step that injects `INSTANCE_ID` at container start from orchestrator-provided values (pod name, task ARN) rather than trusting the image to generate one that's meaningfully correlatable with infra logs.

```json
// package.json (excerpt)
{
  "scripts": {
    "preflight:identity": "tsx scripts/preflight-identity-check.ts",
    "scan:unstamped-http": "tsx scripts/scan-unstamped-http.ts",
    "gate:attributability": "npm run scan:unstamped-http && npm run preflight:identity"
  }
}
```

```yaml
# .github/workflows/attributability-gate.yml
name: Attributability Gate

on:
  pull_request:
  push:
    branches: [main]

jobs:
  scan-unstamped-http:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - name: Fail build on un-stamped HTTP clients
        run: npm run scan:unstamped-http

  preflight-identity-staging:
    runs-on: ubuntu-latest
    needs: scan-unstamped-http
    env:
      AGENT_ID: ${{ vars.STAGING_AGENT_ID }}
      PRINCIPAL_ID: ${{ vars.STAGING_PRINCIPAL_ID }}
      AGENT_IDENTITY_SIGNING_KEY: ${{ secrets.STAGING_AGENT_IDENTITY_SIGNING_KEY }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - name: Verify identity config resolves before deploy proceeds
        run: npm run preflight:identity
```

Runtime injection of `INSTANCE_ID` belongs in the deployment manifest, not the application image — the orchestrator knows the replica identity before the process starts:

```yaml
# k8s deployment.yaml (excerpt)
env:
  - name: AGENT_ID
    value: "support-triage-agent"
  - name: INSTANCE_ID
    valueFrom:
      fieldRef:
        fieldPath: metadata.name   # pod name — unique per replica, correlatable with kubectl/infra logs
  - name: PRINCIPAL_ID
    valueFrom:
      configMapKeyRef:
        name: agent-ownership
        key: principal-id
  - name: AGENT_IDENTITY_SIGNING_KEY
    valueFrom:
      secretKeyRef:
        name: agent-identity-signing-key
        key: key
```

If the platform doesn't expose a stable name (e.g., a bare `docker run`), generate a UUIDv4/ULID at container entrypoint *before* the app process starts and export it as `INSTANCE_ID`, so the value is still fixed for the process's whole lifetime rather than regenerated per request by the fallback in `loadAgentIdentity()`.

## Failure modes & bypass risks

| Risk | Mitigation |
|---|---|
| **Spoofed/forged headers** — a caller sets `X-Agent-Id` manually without holding the signing key. | Never trust the plain `X-Agent-Id`/`X-Instance-Id` headers for authorization or audit decisions — only the verified `X-Agent-Identity` JWT. `verifyIdentityToken` must reject anything that doesn't validate against the deployment's key. |
| **Leaked signing key** — key ends up in a log, repo, or compromised secret store. | Short TTL (minutes) bounds the blast radius of a leaked *token*; for a leaked *key*, immediate rotation procedure (new key, redeploy, revoke old) and treat as a security incident, not routine rotation. Never let the signing key itself appear in logs or error messages. |
| **Instance ID collisions** — two processes end up with the same `INSTANCE_ID`, corrupting attribution. | Use UUIDv4/ULID (128-bit, collision probability negligible) rather than incrementing counters or short random strings; prefer orchestrator-provided identifiers (pod name, task ARN) which are unique by construction over self-generated ones where possible. |
| **Raw HTTP clients bypassing the wrapper** — a new dependency or a developer under deadline pressure calls `fetch` directly. | The `ts-morph` AST scanner (Deterministic Checks §b) is a blocking CI gate, not a lint suggestion — treat any PR that adds a raw client outside `identity/http-client.ts` as a failed build, same severity as a failing test. |
| **Third-party/SDK internals making their own HTTP calls** — an LLM provider SDK, a vector DB client, etc. may not route through `stampedFetch`. | Wrap or configure the third-party SDK's HTTP transport hook (most modern SDKs expose a custom `fetch` injection point) to route through `stampedFetch` rather than exempting it from the scanner; document any unavoidable exemption explicitly with a compensating control (e.g., network-level egress allowlisting). |
| **`PRINCIPAL_ID` set to a non-accountable placeholder** (e.g., `platform-team@company.com` distribution list nobody reads, or a bot account). | This is an organizational control, not a code control — pair the technical enforcement with a process requirement that `PRINCIPAL_ID` be reviewed at deploy-approval time and mapped to a real, on-call-reachable owner; consider a periodic audit job that flags principals with no activity/response history. |
| **Session/thread ID reused across unrelated conversations**, muddying correlation. | Derive `SESSION_ID` from the framework's own native conversation identifier (e.g., LangGraph's `thread_id`) rather than inventing a separate one, so uniqueness guarantees inherited from the framework's checkpointer/persistence layer carry over. |

## Enforcement checklist

- [ ] `AGENT_ID`, `PRINCIPAL_ID`, and `AGENT_IDENTITY_SIGNING_KEY` are required env vars; process refuses to boot if any is missing or malformed.
- [ ] `INSTANCE_ID` is generated fresh per process (preferably orchestrator-injected pod/task name), never hardcoded, never reused across restarts.
- [ ] `preflight-identity-check.ts` runs as a blocking step before the process serves traffic (`prestart` hook / init container).
- [ ] `scan-unstamped-http.ts` (ts-morph AST scan) runs in CI on every PR and fails the build on any raw `fetch`/`axios` usage outside the sanctioned wrapper.
- [ ] All outbound HTTP calls route through a single `stampedFetch`-style choke-point client that injects `X-Agent-Identity` (signed JWT), `X-Agent-Id`, and `X-Instance-Id`.
- [ ] All tool/function invocations are wrapped (`withIdentity` or framework-native middleware) so identity is attached before the call executes and recorded to the ledger (Skill 03) on start/complete/fail.
- [ ] Identity tokens are short-lived (minutes, not hours) and signed with a per-deployment key stored in a secrets manager, never committed or baked into images.
- [ ] Receiving services / audit gateways verify `X-Agent-Identity` cryptographically and never trust the plain-text `X-Agent-Id`/`X-Instance-Id` headers alone for attribution decisions.
- [ ] `SESSION_ID`/`THREAD_ID` is aligned with the framework's native conversation identifier (e.g., LangGraph `thread_id`) rather than a separately invented value.
- [ ] Identity propagates into logs (structured fields), traces (OTel resource attributes + W3C baggage for cross-service `sessionId`), and downstream service calls consistently.
- [ ] Signing key rotation procedure is documented and rehearsed; leaked-key response is treated as a security incident.
- [ ] `PRINCIPAL_ID` values are reviewed at deploy-approval time to ensure they map to a real, reachable, accountable owner — not a placeholder or unmonitored distribution list.
- [ ] Kill switch (Skill 04) can target a halt by `INSTANCE_ID`, confirming the identity emitted here is the same identifier the kill switch consumes.
