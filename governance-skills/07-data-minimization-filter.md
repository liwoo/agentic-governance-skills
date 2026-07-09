# Skill 07 — The "Data Minimization" Filter

*Ensure the agent only ever handles the data a task strictly requires — everything else is redacted, blocked, or tokenized before it leaves the boundary.*

## Governance rationale

Data minimization is not a compliance checkbox — it's a structural constraint on what an agent is *allowed to touch*, independent of what it *could* touch. GDPR Art. 5(1)(c) and CCPA both codify the same idea from different angles: collect and process only what is adequate, relevant, and limited to what is necessary for the stated purpose ("purpose limitation"). An agent that reads a full customer record to answer "what's the delivery status?" and forwards that record — name, address, card digits, order history — into a third-party tool call or a vector store has violated minimization even if nothing "bad" happened. The violation is structural, not behavioral.

Agentic systems make this categorically worse than traditional software for three reasons:

- **Data fan-out.** A single user turn can trigger a dozen tool calls, each with its own request payload. Every payload is a potential PII exfiltration point — to a search API, a CRM, a code sandbox, a webhook, an email send. Traditional apps have a handful of well-audited egress points; agents generate egress points dynamically at runtime via tool selection.
- **Model memory is a data store you don't control.** Anything placed in the prompt context or in a `checkpointer`/vector memory persists — in logs, in provider-side caching, in long-term memory indexes — often beyond the lifetime of the original request and outside the retention policy that governed the source system.
- **Cross-system correlation.** An LLM will happily combine a name from one tool result with an address from another and a phone number from a third into a single coherent record in its context window — recreating exactly the kind of aggregated PII exposure that minimization is designed to prevent, even if no single tool call was individually risky.

Minimizing what flows through the agent also shrinks the blast radius of every other failure: a prompt injection that tricks the agent into exfiltrating data can only exfiltrate what's present in context; a compromised tool credential can only leak what passed through it; a leaked log can only expose what was written to it. Data minimization is a governance skill that pays off even when every other control fails — it's the last line of defense, not just the first.

## What "good" looks like

- Every outbound tool payload, HTTP request body, prompt injected into an LLM call, and write to persistent memory has passed through a single, auditable minimization filter — no code path bypasses it.
- Structured PII (card numbers, SSNs, IBANs, phone numbers, emails) is detected with high precision (validated, not just pattern-matched) and is redacted, tokenized, or blocked by default.
- Secrets and credentials accidentally present in tool arguments or model output (API keys, bearer tokens, private keys) never reach a third-party API, a log, or a checkpoint.
- Every redaction/block/tokenize decision emits a structured event to the governance ledger (see Skill 03) — minimization actions are themselves auditable, not silent.
- Authorization to see or forward a specific sensitive field is explicit, scoped to a task, and time-bound — never an ambient default.
- Long-term memory (vector stores, summarization buffers, checkpoints) contains no raw PII beyond what the task's authorization explicitly permits.
- False positives are tunable per data class and destination — the filter degrades gracefully (mask, don't hard-fail) for low-risk destinations, and hard-fails only for genuinely dangerous egress (public APIs, third-party logging).

## What to detect

No single technique catches all sensitive data. Build a layered detector, cheapest and highest-precision checks first:

**1. Structured PII with validators (regex + checksum/format validation).** Regex alone over-fires — `\d{16}` matches phone numbers, order IDs, and tracking numbers, not just card numbers. Pair every structured-PII regex with a validator:
- **Credit card numbers** — regex for digit groups (13–19 digits, common prefixes) + **Luhn checksum** to eliminate the majority of false positives.
- **US SSN** — `\d{3}-\d{2}-\d{4}` shape + range validation (area number not 000/666/900-999).
- **IBAN** — country-code prefix + **mod-97 checksum** validation.
- **Phone numbers** — libphonenumber-style parsing (region-aware), not bare digit regex.
- **Email addresses** — RFC-shape regex; low false-positive rate on its own, still worth gating by destination.

**2. Secrets & credentials (regex + entropy).** API keys and tokens usually have recognizable prefixes (`sk-`, `ghp_`, `AKIA`, `xox[bp]-`) — match those directly. For generic secrets with no prefix, use **Shannon entropy** over candidate substrings (base64/hex-looking tokens above a length and entropy threshold) to catch what prefix-matching misses. Entropy checks are inherently noisier — treat entropy-only hits as lower-confidence findings that route to warn/mask rather than hard-block.

**3. Unstructured PII (names, addresses, health/financial free text).** This is the category regex fundamentally cannot solve. A name in free text ("please ship this to John at 44 Elm Street") has no fixed shape. This class requires **NER (Named Entity Recognition)** or a trained PII classifier — regex should not be trusted here beyond a keyword allowlist for known-sensitive domains (health terms, financial terms) as a cheap pre-filter that escalates to the classifier.

**Layered pipeline, in order of cost:**

```
1. Regex + validator pass       (cheap, deterministic, high precision)   -- always on
2. Entropy scan for secrets      (cheap, moderate precision)              -- always on
3. NER / PII classifier          (moderate cost, catches unstructured PII) -- on by default, tunable
4. DLP service (Presidio / Cloud DLP / AWS Comprehend PII)  -- optional, for regulated data classes
                                  (high cost, highest recall, use for high-risk destinations)
```

Be explicit with engineering stakeholders: **regex is necessary but not sufficient.** Ship it as layer 1 because it's fast, deterministic, and testable, but treat "we have a PII regex" as a false sense of security if layers 3–4 aren't wired in for any pipeline that touches unstructured user text (support tickets, chat transcripts, uploaded documents).

## The detection engine

```ts
// governance/minimization/detect.ts

export type SensitiveType =
  | "credit_card"
  | "ssn"
  | "iban"
  | "email"
  | "phone"
  | "api_key"
  | "high_entropy_secret"
  | "person_name"   // populated by NER backend, not regex
  | "health_term";

export interface Finding {
  type: SensitiveType;
  value: string;        // the raw matched substring (handle with care — don't log this directly)
  span: [number, number]; // start/end offset in the payload string
  confidence: number;   // 0–1
  source: "regex" | "validator" | "entropy" | "ner" | "dlp";
}

// ---------- Layer 1: regex + validators ----------

function luhnCheck(digits: string): boolean {
  let sum = 0;
  let shouldDouble = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = parseInt(digits[i], 10);
    if (shouldDouble) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    shouldDouble = !shouldDouble;
  }
  return sum % 10 === 0;
}

const CARD_RE = /\b(?:\d[ -]*?){13,19}\b/g;
const SSN_RE = /\b(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b/g;
const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const API_KEY_RE = /\b(sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{36}|AKIA[0-9A-Z]{16})\b/g;

function detectCreditCards(payload: string): Finding[] {
  const findings: Finding[] = [];
  for (const match of payload.matchAll(CARD_RE)) {
    const digits = match[0].replace(/[ -]/g, "");
    if (digits.length < 13 || digits.length > 19) continue;
    if (!luhnCheck(digits)) continue; // Luhn cuts false positives on order IDs, tracking numbers, etc.
    findings.push({
      type: "credit_card",
      value: match[0],
      span: [match.index!, match.index! + match[0].length],
      confidence: 0.97,
      source: "validator",
    });
  }
  return findings;
}

function detectSsn(payload: string): Finding[] {
  return [...payload.matchAll(SSN_RE)].map((m) => ({
    type: "ssn" as const,
    value: m[0],
    span: [m.index!, m.index! + m[0].length] as [number, number],
    confidence: 0.9,
    source: "validator" as const,
  }));
}

function detectEmails(payload: string): Finding[] {
  return [...payload.matchAll(EMAIL_RE)].map((m) => ({
    type: "email" as const,
    value: m[0],
    span: [m.index!, m.index! + m[0].length] as [number, number],
    confidence: 0.85,
    source: "regex" as const,
  }));
}

function detectApiKeys(payload: string): Finding[] {
  return [...payload.matchAll(API_KEY_RE)].map((m) => ({
    type: "api_key" as const,
    value: m[0],
    span: [m.index!, m.index! + m[0].length] as [number, number],
    confidence: 0.95,
    source: "regex" as const,
  }));
}

// ---------- Layer 2: entropy scan for un-prefixed secrets ----------

function shannonEntropy(s: string): number {
  const freq = new Map<string, number>();
  for (const ch of s) freq.set(ch, (freq.get(ch) ?? 0) + 1);
  let entropy = 0;
  for (const count of freq.values()) {
    const p = count / s.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

const TOKEN_CANDIDATE_RE = /\b[A-Za-z0-9+/_=-]{24,}\b/g;
const ENTROPY_THRESHOLD = 4.0; // bits/char; tune against your corpus

function detectHighEntropySecrets(payload: string): Finding[] {
  const findings: Finding[] = [];
  for (const match of payload.matchAll(TOKEN_CANDIDATE_RE)) {
    const candidate = match[0];
    const entropy = shannonEntropy(candidate);
    if (entropy >= ENTROPY_THRESHOLD) {
      findings.push({
        type: "high_entropy_secret",
        value: candidate,
        span: [match.index!, match.index! + candidate.length],
        confidence: Math.min(0.5 + (entropy - ENTROPY_THRESHOLD) * 0.1, 0.85),
        source: "entropy",
      });
    }
  }
  return findings;
}

// ---------- Composition ----------

/**
 * Layer 3/4 (NER / DLP) is intentionally pluggable — regex+entropy alone
 * cannot find unstructured PII ("ship it to John at 44 Elm Street").
 * Wire a real backend (e.g. Microsoft Presidio, GCP Cloud DLP, AWS
 * Comprehend PII) behind this interface for any pipeline handling
 * free-form user or document text.
 */
export interface NerBackend {
  scan(payload: string): Promise<Finding[]>;
}

export async function scanForSensitiveData(
  payload: string,
  opts: { ner?: NerBackend } = {}
): Promise<Finding[]> {
  const findings: Finding[] = [
    ...detectCreditCards(payload),
    ...detectSsn(payload),
    ...detectEmails(payload),
    ...detectApiKeys(payload),
    ...detectHighEntropySecrets(payload),
  ];

  if (opts.ner) {
    findings.push(...(await opts.ner.scan(payload)));
  }

  // De-duplicate overlapping spans, preferring higher-confidence findings.
  return dedupeBySpan(findings);
}

function dedupeBySpan(findings: Finding[]): Finding[] {
  const sorted = [...findings].sort((a, b) => a.span[0] - b.span[0] || b.confidence - a.confidence);
  const result: Finding[] = [];
  let lastEnd = -1;
  for (const f of sorted) {
    if (f.span[0] >= lastEnd) {
      result.push(f);
      lastEnd = f.span[1];
    }
  }
  return result;
}
```

## Redaction vs blocking vs tokenization

Not all findings warrant the same response. Four distinct policy actions, escalating in strictness:

| Action | Reversible? | When to use |
|---|---|---|
| **Redact / mask** | No | Value isn't needed downstream — logs, prompts sent to the LLM, ledger entries, memory writes. Replace with `[REDACTED:credit_card]` or a partial mask (`****-****-****-1234`). |
| **Tokenize / pseudonymize** | Yes, via vault | Value *is* needed later in the workflow (e.g., an order-processing tool genuinely needs the card to charge it) but shouldn't sit in the LLM's context or long-term memory. Swap for an opaque token; only the vault can resolve it back, and only for authorized callers. |
| **Block** | N/A (halts) | Destination is untrusted or the data class is never allowed to leave this boundary regardless of task (e.g., SSN going to a third-party search API). Halt the call, raise a governance event, do not silently continue. |
| **Allow with authorization** | N/A | An explicit, scoped grant exists for this exact task + data class + destination (e.g., a payments tool is pre-authorized to receive card data for the `charge_card` task). Absent a grant, default to redact or block. |

The policy is a function of **(data class, destination, task authorization)** — never of data class alone. The same SSN might be blocked outbound to a web-search tool, tokenized when passed to an internal fraud-check tool, and allowed in full only inside a narrowly-scoped, pre-authorized compliance-report tool.

```ts
// governance/minimization/policy.ts
import type { Finding, SensitiveType } from "./detect";

export type PolicyAction = "redact" | "tokenize" | "block" | "allow";

export interface Destination {
  kind: "llm_prompt" | "tool_call" | "http_egress" | "memory_write" | "ledger_write";
  name: string; // e.g. tool name, host, memory store id
}

export interface TaskAuthorization {
  taskId: string;
  grantedTypes: SensitiveType[];      // data classes explicitly authorized
  grantedDestinations: string[];      // destination names covered by the grant
  expiresAt: number;                  // epoch ms — grants are always time-bound
}

// Default policy table: (data class × destination kind) -> action.
// Authorization (below) can only relax "redact"/"block" toward "allow"/"tokenize" —
// never the other way — and only for entries with an explicit grant.
const DEFAULT_POLICY: Record<SensitiveType, Record<Destination["kind"], PolicyAction>> = {
  credit_card:          { llm_prompt: "block",  tool_call: "tokenize", http_egress: "block",  memory_write: "block",  ledger_write: "redact" },
  ssn:                   { llm_prompt: "block",  tool_call: "tokenize", http_egress: "block",  memory_write: "block",  ledger_write: "redact" },
  iban:                  { llm_prompt: "redact", tool_call: "tokenize", http_egress: "block",  memory_write: "block",  ledger_write: "redact" },
  email:                 { llm_prompt: "allow",  tool_call: "allow",    http_egress: "redact", memory_write: "redact", ledger_write: "redact" },
  phone:                 { llm_prompt: "allow",  tool_call: "allow",    http_egress: "redact", memory_write: "redact", ledger_write: "redact" },
  api_key:               { llm_prompt: "block",  tool_call: "block",    http_egress: "block",  memory_write: "block",  ledger_write: "block"  },
  high_entropy_secret:   { llm_prompt: "redact", tool_call: "redact",   http_egress: "block",  memory_write: "block",  ledger_write: "redact" },
  person_name:           { llm_prompt: "allow",  tool_call: "allow",    http_egress: "redact", memory_write: "redact", ledger_write: "redact" },
  health_term:           { llm_prompt: "redact", tool_call: "block",    http_egress: "block",  memory_write: "block",  ledger_write: "redact" },
};

export function resolvePolicy(
  finding: Finding,
  destination: Destination,
  auth?: TaskAuthorization
): PolicyAction {
  const base = DEFAULT_POLICY[finding.type][destination.kind];

  const hasGrant =
    auth &&
    auth.expiresAt > Date.now() &&
    auth.grantedTypes.includes(finding.type) &&
    auth.grantedDestinations.includes(destination.name);

  if (hasGrant) {
    // Explicit authorization relaxes block/redact to allow; never escalates.
    return base === "block" || base === "redact" ? "allow" : base;
  }

  return base;
}
```

## Where to enforce (the choke points)

Data minimization only works if it's structurally impossible to bypass — that means enforcing at a small number of **choke points** rather than sprinkling checks through business logic:

1. **Before every LLM call** — scrub the assembled prompt (system + history + tool results) before it's sent to the model. This includes injected memory/RAG context, not just the current user turn.
2. **On every outbound tool payload** — anything crossing a tool boundary (function-call arguments, HTTP request bodies, database queries built from agent output) passes through the filter before it leaves the process.
3. **On ledger/log writes** — the audit trail itself must not become a PII leak. Cross-link **Skill 03 (Immutable Ledger)**: every event written to the ledger goes through the same minimization filter first, so the system of record for governance doesn't itself become the largest unredacted store of sensitive data in the stack.
4. **On writes to long-term memory** — vector store upserts, conversation summarization buffers, and checkpointer snapshots are durable and often outlive the originating request's retention policy. Treat memory writes as egress, not as "internal" storage.

The only reliable way to guarantee coverage is a **single instrumented client** per choke point (one LLM client wrapper, one `fetch`/HTTP client wrapper, one ledger writer, one memory writer) that every code path is forced to go through — combined with the static AST scanner in the next section to catch any code that tries to route around it.

## Deterministic checks

Runtime middleware only helps if nothing bypasses it. Enforce that statically with a `ts-morph` scanner that fails the build if it finds a raw `fetch`/HTTP client call, a raw LLM client invocation, or a memory-store write that doesn't go through the `dataMinimization` wrapper.

```ts
// governance/minimization/scan-egress.ts
import { Project, SyntaxKind, CallExpression } from "ts-morph";

const RAW_EGRESS_CALLS = ["fetch", "axios.post", "axios.get", "axios.request", "httpClient.request"];
const RAW_MEMORY_WRITE_CALLS = ["vectorStore.upsert", "checkpointer.put", "memory.add"];
const APPROVED_WRAPPERS = ["filteredFetch", "withDataMinimization", "minimizedMemoryWrite"];

interface Violation {
  file: string;
  line: number;
  call: string;
  reason: string;
}

export function scanForUnfilteredEgress(tsConfigPath: string): Violation[] {
  const project = new Project({ tsConfigFilePath: tsConfigPath });
  const violations: Violation[] = [];

  for (const sourceFile of project.getSourceFiles()) {
    if (sourceFile.getFilePath().includes("governance/minimization/")) continue; // wrapper impl itself

    const calls = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression);
    for (const call of calls) {
      const text = call.getExpression().getText();

      const isRawEgress = RAW_EGRESS_CALLS.some((pattern) => text.includes(pattern));
      const isRawMemoryWrite = RAW_MEMORY_WRITE_CALLS.some((pattern) => text.includes(pattern));
      if (!isRawEgress && !isRawMemoryWrite) continue;

      if (isWrappedByApproved(call)) continue;

      violations.push({
        file: sourceFile.getFilePath(),
        line: call.getStartLineNumber(),
        call: text,
        reason: isRawEgress
          ? "Raw outbound call bypasses dataMinimization filter"
          : "Raw memory write bypasses dataMinimization filter",
      });
    }
  }
  return violations;
}

function isWrappedByApproved(call: CallExpression): boolean {
  // Walk up: is this call an argument to, or inside the body of, an approved wrapper?
  let node = call.getParent();
  while (node) {
    const text = node.getText();
    if (APPROVED_WRAPPERS.some((w) => text.startsWith(w))) return true;
    node = node.getParent();
  }
  return false;
}

if (require.main === module) {
  const violations = scanForUnfilteredEgress("./tsconfig.json");
  if (violations.length > 0) {
    console.error(`Found ${violations.length} unfiltered egress/memory-write call(s):`);
    for (const v of violations) {
      console.error(`  ${v.file}:${v.line} — ${v.call} — ${v.reason}`);
    }
    process.exit(1);
  }
  console.log("No unfiltered egress or memory-write calls found.");
}
```

Pair the static scanner with a **regression corpus** of known-PII fixtures the detector must never miss — this catches regressions in the regex/entropy layers when someone "simplifies" a pattern:

```ts
// governance/minimization/__tests__/fixtures.ts
export const PII_FIXTURES: Array<{ payload: string; expectType: string; mustDetect: boolean }> = [
  { payload: "4111 1111 1111 1111", expectType: "credit_card", mustDetect: true },   // valid Luhn test card
  { payload: "4111 1111 1111 1112", expectType: "credit_card", mustDetect: false },  // fails Luhn -> not flagged
  { payload: "078-05-1120", expectType: "ssn", mustDetect: true },
  { payload: "order-id 123-45-6789-0", expectType: "ssn", mustDetect: false },       // wrong shape
  { payload: "jane.doe@example.com", expectType: "email", mustDetect: true },
  { payload: "sk-abcdEFGH1234567890abcdEFGH", expectType: "api_key", mustDetect: true },
  { payload: "DE89370400440532013000", expectType: "iban", mustDetect: true },
];

// governance/minimization/__tests__/detect.test.ts
import { scanForSensitiveData } from "../detect";
import { PII_FIXTURES } from "./fixtures";

describe("scanForSensitiveData regression corpus", () => {
  for (const fixture of PII_FIXTURES) {
    it(`${fixture.mustDetect ? "detects" : "does not flag"}: "${fixture.payload}"`, async () => {
      const findings = await scanForSensitiveData(fixture.payload);
      const matched = findings.some((f) => f.type === fixture.expectType);
      expect(matched).toBe(fixture.mustDetect);
    });
  }
});
```

## Grounding action — the runtime filter middleware

The static scanner guarantees *coverage*; this middleware is what actually *acts* at runtime. It runs detection, resolves policy per finding, applies the action, and emits a ledger event — every time, at every choke point.

```ts
// governance/minimization/middleware.ts
import { scanForSensitiveData, Finding } from "./detect";
import { resolvePolicy, Destination, TaskAuthorization, PolicyAction } from "./policy";
import { tokenize } from "./vault";
import { appendLedgerEvent } from "../ledger"; // Skill 03

export class DataMinimizationBlockError extends Error {
  constructor(public findings: Finding[], public destination: Destination) {
    super(`Blocked egress to ${destination.kind}:${destination.name} — ${findings.length} sensitive finding(s)`);
  }
}

export interface MinimizationResult {
  sanitizedPayload: string;
  findings: Finding[];
  actions: PolicyAction[];
}

export async function applyDataMinimization(
  payload: string,
  destination: Destination,
  auth?: TaskAuthorization
): Promise<MinimizationResult> {
  const findings = await scanForSensitiveData(payload);
  let sanitized = payload;
  const actions: PolicyAction[] = [];

  // Apply in reverse span order so earlier offsets stay valid as we splice the string.
  for (const finding of [...findings].sort((a, b) => b.span[0] - a.span[0])) {
    const action = resolvePolicy(finding, destination, auth);
    actions.push(action);

    if (action === "block") {
      await appendLedgerEvent({
        type: "data_minimization.block",
        destination,
        findingType: finding.type,
        confidence: finding.confidence,
        taskId: auth?.taskId,
      });
      throw new DataMinimizationBlockError(findings, destination);
    }

    if (action === "redact") {
      sanitized = spliceRedact(sanitized, finding);
    } else if (action === "tokenize") {
      const token = await tokenize(finding.value, finding.type);
      sanitized = splice(sanitized, finding.span, token);
    }
    // "allow" leaves the substring untouched.
  }

  await appendLedgerEvent({
    type: "data_minimization.applied",
    destination,
    findingCount: findings.length,
    actions,
    taskId: auth?.taskId,
  });

  return { sanitizedPayload: sanitized, findings, actions };
}

function spliceRedact(payload: string, finding: Finding): string {
  const mask = `[REDACTED:${finding.type}]`;
  return splice(payload, finding.span, mask);
}

function splice(payload: string, [start, end]: [number, number], replacement: string): string {
  return payload.slice(0, start) + replacement + payload.slice(end);
}

// ---- Choke-point wrappers ----

/** Wrap any tool function so its stringified arguments are minimized before execution. */
export function withDataMinimization<Args extends unknown[], Ret>(
  toolFn: (...args: Args) => Promise<Ret>,
  destination: Destination,
  auth?: TaskAuthorization
) {
  return async (...args: Args): Promise<Ret> => {
    const serialized = JSON.stringify(args);
    const { sanitizedPayload } = await applyDataMinimization(serialized, destination, auth);
    const sanitizedArgs = JSON.parse(sanitizedPayload) as Args;
    return toolFn(...sanitizedArgs);
  };
}

/** Drop-in replacement for fetch that minimizes the outbound request body. */
export async function filteredFetch(
  url: string,
  init: RequestInit & { destinationName?: string; auth?: TaskAuthorization } = {}
): Promise<Response> {
  const destination: Destination = { kind: "http_egress", name: init.destinationName ?? new URL(url).host };

  if (typeof init.body === "string") {
    const { sanitizedPayload } = await applyDataMinimization(init.body, destination, init.auth);
    init = { ...init, body: sanitizedPayload };
  }
  return fetch(url, init);
}
```

## Framework-specific enforcement

### LangGraph.js

Enforce minimization in two places: a **pre-model hook** that scrubs `state.messages` before the LLM node runs, and inside `withDataMinimization`-wrapped tool nodes. If you use a `checkpointer`, scrub before the checkpoint write, not after — the checkpoint is itself a memory write choke point.

```ts
import { StateGraph, MessagesAnnotation } from "@langchain/langgraph";
import { applyDataMinimization } from "./governance/minimization/middleware";

async function scrubBeforeModel(state: typeof MessagesAnnotation.State) {
  const scrubbed = await Promise.all(
    state.messages.map(async (m) => {
      const { sanitizedPayload } = await applyDataMinimization(
        String(m.content),
        { kind: "llm_prompt", name: "primary-model" }
      );
      return { ...m, content: sanitizedPayload };
    })
  );
  return { messages: scrubbed };
}

const graph = new StateGraph(MessagesAnnotation)
  .addNode("scrub", scrubBeforeModel)
  .addNode("agent", callModel)              // model only ever sees scrubbed messages
  .addNode("tools", toolNode)               // tool node wraps each tool in withDataMinimization
  .addEdge("scrub", "agent")
  .compile({ checkpointer }); // checkpointer persists only the already-scrubbed state
```

### LlamaIndex.TS

Two choke points: a **`NodePostprocessor`** that runs before nodes are inserted into an index (so raw PII never lands in the vector store), and a tool-call wrapper matching the pattern above for any `FunctionTool`/`QueryEngineTool` invocation.

```ts
import { NodeWithScore, TextNode } from "llamaindex";
import { applyDataMinimization } from "./governance/minimization/middleware";

export class DataMinimizationPostprocessor {
  async postprocessNodes(nodes: NodeWithScore<TextNode>[]): Promise<NodeWithScore<TextNode>[]> {
    return Promise.all(
      nodes.map(async (n) => {
        const { sanitizedPayload } = await applyDataMinimization(
          n.node.getContent(),
          { kind: "memory_write", name: "vector-index" }
        );
        n.node.setContent(sanitizedPayload);
        return n;
      })
    );
  }
}

// Apply at ingestion (before VectorStoreIndex.insertNodes) and at retrieval time
// (as a postprocessor in the query engine's response synthesis pipeline) — indexing
// is a memory write, retrieval re-injects that content back into an LLM prompt.
```

### Microsoft Agent Framework

Use the framework's **function-invocation middleware** (wraps every tool/function call, before and after execution) and **chat middleware** (wraps every request/response to the chat client) as the two enforcement seams — structurally analogous to the LangGraph pre-model hook and tool-node wrapper above.

> **Language note:** Microsoft Agent Framework ships **only .NET and Python SDKs** — there is **no official JS/TS package** (`@microsoft/agent-framework` does not exist; `@microsoft/agents-hosting` is the unrelated Microsoft 365 Agents SDK). The three middleware seams are real in both supported languages (`FunctionMiddleware` / `ChatMiddleware` / `AgentMiddleware`). The TypeScript below documents the filter pattern for a Node port; implement it as a `FunctionMiddleware` + `ChatMiddleware` pair in C#/Python.

```ts
// Illustrative Node port — NOT a real import (Agent Framework has no JS/TS SDK).
// Implement as FunctionMiddleware + ChatMiddleware in C#/Python; the shape below
// mirrors the documented middleware pipeline.
const agent = new ChatAgent({
  chatClient,
  functionInvocationMiddleware: [
    async (context, next) => {
      const dest = { kind: "tool_call" as const, name: context.functionName };
      const { sanitizedPayload } = await applyDataMinimization(
        JSON.stringify(context.arguments), dest
      );
      context.arguments = JSON.parse(sanitizedPayload);
      await next(context);
    },
  ],
  chatMiddleware: [
    async (context, next) => {
      const dest = { kind: "llm_prompt" as const, name: context.modelId };
      context.messages = await minimizeMessages(context.messages, dest);
      await next(context);
    },
  ],
});
```

## CI/CD integration

Both the static scanner and the PII regression corpus are build gates — a PR that introduces a raw egress call or weakens a detector to miss a known fixture must fail CI, not just log a warning.

```json
// package.json (excerpt)
{
  "scripts": {
    "governance:scan-egress": "ts-node governance/minimization/scan-egress.ts",
    "governance:test-fixtures": "jest governance/minimization/__tests__/detect.test.ts",
    "governance:minimization": "npm run governance:scan-egress && npm run governance:test-fixtures"
  }
}
```

```yaml
# .github/workflows/governance-data-minimization.yml
name: Governance - Data Minimization
on:
  pull_request:
    branches: [main]

jobs:
  minimization-gate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - name: Static scan for unfiltered egress / memory writes
        run: npm run governance:scan-egress
      - name: PII detector regression corpus
        run: npm run governance:test-fixtures
```

Treat both jobs as **required status checks** on the default branch — a red build here means either new PII-leaking code shipped, or someone weakened the detector, both of which should block merge unconditionally.

## Failure modes & bypass risks

- **Regex false negatives — obfuscation and encoding.** PII split across chunks ("4111 1111" in one tool call, "1111 1111" in the next), base64/hex-encoded payloads, or PII with inserted whitespace/unicode homoglyphs will slip past regex. Mitigate: decode common encodings before scanning (base64, URL-encoding), and scan across the full assembled payload rather than per-chunk where feasible; treat multi-turn aggregation as a design risk, not just a detection gap (see cross-tool aggregation below).
- **False positives — over-redaction breaking the task.** Aggressive entropy thresholds or broad regexes will mask legitimate data (order IDs, hashes, non-PII tokens), silently breaking downstream tool calls. Mitigate: keep entropy-only and NER-only findings at lower confidence with a review/override path; make policy actions destination-aware (mask for logs, allow for internal high-trust tools) rather than applying one blanket rule; track redaction-triggered task failures as a metric and tune thresholds against it.
- **Unstructured PII missed entirely by regex.** Names, addresses, and free-text health/financial disclosures have no fixed shape — regex-only deployments will systematically miss this class. Mitigate: this is not a tuning problem, it's an architecture gap — a NER/classifier backend (layer 3) is mandatory for any pipeline touching free-form user or document text, not optional.
- **Tokenization vault as a new attack surface.** Centralizing "reversible" sensitive values in a vault creates a high-value target — a compromised vault undoes every tokenization decision made across the system at once. Mitigate: scope vault read access per task/caller identity, expire tokens aggressively, and audit every detokenization call through the same ledger as the minimization events themselves.
- **PII already resident in model memory/context.** Once sensitive data has entered an LLM's context window (before the filter caught it, or via an earlier turn), a provider-side cache, fine-tuning pipeline, or conversation summarizer may retain it beyond the current request. Mitigate: enforce at the pre-model hook, not just at tool boundaries, so nothing reaches the model unfiltered in the first place; treat summarization/compaction as its own choke point requiring the same filter.
- **Cross-tool aggregation re-identifies minimized data.** Individually redacted or tokenized fields, when several tool results land in the same context window, can let the model (or a downstream reader) reconstruct the full record — a masked email plus an unmasked name plus a partial phone number is often enough to re-identify someone. Mitigate: minimization policy should consider *cumulative* context state, not just each payload in isolation; where feasible, tag redacted/tokenized fields so a session-level check can flag when too many partial identifiers co-occur.

## Enforcement checklist

- [ ] Regex + validator detectors implemented for all structured PII classes in scope (credit card w/ Luhn, SSN, IBAN w/ mod-97, phone, email).
- [ ] Secret/credential detection covers known-prefix patterns and an entropy-based fallback for un-prefixed tokens.
- [ ] A NER/PII-classifier (or DLP service) backend is wired in for any pipeline handling unstructured user or document text — regex-only is not accepted as sufficient for this class.
- [ ] Policy table (data class × destination × authorization) is defined, versioned, and reviewed by whoever owns privacy/compliance sign-off.
- [ ] `resolvePolicy` only relaxes toward `allow`/`tokenize` with an explicit, time-bound `TaskAuthorization` grant — never by default.
- [ ] `withDataMinimization` / `filteredFetch` wrap every tool call and outbound HTTP request; no raw client call exists outside the wrapper implementation itself.
- [ ] LLM prompt assembly (including injected memory/RAG context) passes through the filter before every model call — LangGraph pre-model hook, LlamaIndex postprocessor, or Agent Framework chat middleware as applicable.
- [ ] Memory writes (vector store upserts, checkpointer snapshots, summarization buffers) pass through the filter before persistence.
- [ ] Ledger/log writes are minimized before being appended — the audit trail (Skill 03) does not become an unredacted PII store.
- [ ] `ts-morph` static scanner runs in CI and fails the build on any raw egress or memory-write call outside an approved wrapper.
- [ ] PII regression fixture corpus runs in CI and fails the build if any known-PII fixture goes undetected or a Luhn-invalid fixture is wrongly flagged.
- [ ] Every redact/block/tokenize decision emits a structured event to the governance ledger, including destination, finding type, confidence, and task ID.
- [ ] Tokenization vault access is scoped per task/caller, time-bound, and every detokenization call is itself logged.
- [ ] False-positive/false-negative rates are tracked as operational metrics, with an explicit review process for tuning thresholds — not ad hoc regex edits under deadline pressure.
