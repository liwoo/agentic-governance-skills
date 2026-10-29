// Assessment overlay for the Governance House checks.
// The site (engineering.js) owns each check's title, action, and verify text; this file adds
// what a codebase assessor needs: framework-agnostic evidence, what does not count, and the
// usual shape of a fix. Keys must match `<room>/<check-id>` in engineering.js exactly.
//
// provable: how far static reading can go.
//   code    — the code itself can show the control exists.
//   test    — needs a test (or CI job) in the repo that exercises the behaviour.
//   process — depends on a runbook, drill, or team practice; often `unknown` from code alone.

export const signals = {
  // ── Identity · The Passport Checkpoint ────────────────────────────────────
  "identity/owner-contract": {
    provable: "code",
    lookFor: [
      "A declared owner/team and agent build or version for each deployed agent (config, manifest, deployment metadata, env schema).",
      "Startup validation that refuses to run when owner or build identity is missing.",
    ],
    notEnough: ["An owner named only in a README or CODEOWNERS with nothing read at runtime."],
    fix: "Add a typed identity config (owner, agent name, build/version) loaded at startup and fail fast when any field is missing.",
  },
  "identity/instance-lifecycle": {
    provable: "code",
    lookFor: [
      "A fresh instance ID generated per process start (uuid at boot), distinct from the session/thread/conversation ID.",
      "The session ID propagated through tool calls, retries, and background/queued work.",
    ],
    notEnough: ["A single hard-coded agent name used as the only identifier."],
    fix: "Generate an instance ID at process start, keep the framework's session/thread ID, and pass both in a context object to every tool and queued job.",
  },
  "identity/trusted-issuer": {
    provable: "code",
    lookFor: [
      "Credentials obtained from a workload/managed identity, OIDC, or token service rather than static secrets.",
      "Signing keys and identity selection kept out of tools the model can call.",
    ],
    notEnough: [
      "A long-lived shared API key in env/config used by several agents.",
      "The agent choosing its own owner/principal from model output or request input.",
    ],
    fix: "Replace shared static keys with a per-agent workload identity (cloud managed identity, OIDC client credentials, SPIFFE) and keep issuance outside the agent process.",
  },
  "identity/verify-claims": {
    provable: "code",
    lookFor: [
      "Receiving services/tools/MCP servers validate token signature, issuer, audience, expiry, and required claims before acting.",
    ],
    notEnough: [
      "Trusting a plain header such as `X-Agent-Name` or a field in the request body.",
      "Verifying signature but not audience/expiry.",
    ],
    fix: "Validate a signed token at each tool/API boundary (signature + iss + aud + exp + required identity claims) and reject before any side effect.",
  },
  "identity/short-lived-revocable": {
    provable: "code",
    lookFor: ["Short token lifetimes, key rotation config, and a way to disable a single agent instance or principal."],
    notEnough: ["Tokens or keys with no expiry; rotation described only in prose."],
    fix: "Set an explicit maximum token lifetime, document rotation, and add a per-instance disable/deny list checked at the boundary.",
  },
  "identity/close-bypasses": {
    provable: "code",
    lookFor: [
      "All outbound HTTP/SDK/queue calls go through one wrapped client that attaches identity.",
      "Lint rules, scanners, or code review rules that forbid raw clients in agent code.",
    ],
    notEnough: ["A wrapper exists but tools also call `requests`/`httpx`/`fetch`/SDKs directly."],
    fix: "Route every tool's external call through one identity-attaching client and add a lint/scan rule that fails CI on raw client imports in agent modules.",
  },
  "identity/record-verified-identity": {
    provable: "code",
    lookFor: [
      "Logs/traces/audit records carry owner, build, instance, session, and a shared action ID.",
      "Bearer tokens are not written to logs.",
    ],
    notEnough: ["Logs with timestamps and messages but no attributable identity or correlation ID."],
    fix: "Attach verified identity fields and an action ID to the trace context and every ledger record; scrub Authorization headers from logs.",
  },
  "identity/compromised-identity-drill": {
    provable: "process",
    lookFor: ["A test or runbook that uses a valid identity for an unauthorized action and then revokes it."],
    notEnough: ["Unit tests that only cover the happy path for authentication."],
    fix: "Add a staging test: valid test identity + forbidden action must be denied and recorded, and calls must fail after revoking that instance.",
  },

  // ── Reliability · The Proof Bridge ────────────────────────────────────────
  "reliability/workflow-contracts": {
    provable: "code",
    lookFor: [
      "Typed input/output schemas between steps (Pydantic/dataclasses/TypedDict/Zod/JSON Schema), including tool schemas.",
      "A documented or code-defined workflow graph with owners and failure policy.",
    ],
    notEnough: ["Free-form dicts/strings passed between steps with no schema."],
    fix: "Give every retrieval, model, and tool step a typed input/output contract and document the step graph with an owner and failure policy per step.",
  },
  "reliability/stage-test-suites": {
    provable: "test",
    lookFor: ["Separate tests per stage (retrieval, tool, transformation, model step) that run in isolation, with mocks for neighbours."],
    notEnough: ["Only an end-to-end smoke test or a notebook demo."],
    fix: "Create one test module per workflow stage with its own expected outcomes and failure cases, and run them in CI.",
  },
  "reliability/deterministic-invariants": {
    provable: "test",
    lookFor: ["Boundary, arithmetic, schema, and state-transition tests for deterministic code (e.g. refund amounts, date windows); property-based tests where useful."],
    notEnough: ["Tests that only assert the function returns without error."],
    fix: "Add boundary and property tests for money, dates, limits, and state transitions, and block release on failure.",
  },
  "reliability/io-failure-tests": {
    provable: "test",
    lookFor: [
      "Tests that inject timeouts, malformed payloads, rate limits, duplicates, and partial failures.",
      "Bounded retries with idempotency keys for side-effecting calls.",
    ],
    notEnough: ["Unbounded or blind retries around writes; `except Exception: pass`."],
    fix: "Bound retries, add idempotency keys to side-effecting calls, and test timeout-after-write recovery.",
  },
  "reliability/model-eval-thresholds": {
    provable: "test",
    lookFor: [
      "An evaluation dataset (golden set) with domain-specific metrics and pass thresholds (promptfoo, deepeval, ragas, inspect, LangSmith, Braintrust, vendor evals, or custom).",
      "Consequential failure cases in the dataset, not just happy paths.",
    ],
    notEnough: ["Manual spot checks; eval scripts with no threshold that can fail."],
    fix: "Create an eval dataset with consequential edge cases, define per-metric thresholds, and make the eval job fail when a threshold is missed.",
  },
  "reliability/version-bound-release": {
    provable: "code",
    lookFor: ["Model, prompt, tool schema, and code versions pinned and recorded together with the eval results that justified the release."],
    notEnough: ["Floating model aliases (e.g. `latest`) and prompts edited inline with no version."],
    fix: "Pin model and prompt versions, record them in a release manifest with eval results, and re-run evals when any of them change.",
  },
  "reliability/integration-gate": {
    provable: "test",
    lookFor: ["Interface/contract tests between stages and representative end-to-end scenarios that run in CI and block merge/deploy."],
    notEnough: ["Integration tests that exist but are not part of any CI gate."],
    fix: "Add contract tests for each handoff and an end-to-end scenario suite as a required CI check.",
  },
  "reliability/production-drift-drill": {
    provable: "process",
    lookFor: [
      "Production monitoring of error rates and quality (sampled evals, trace analytics) with alert thresholds and owners.",
      "Alerts wired to a hold or a supervised stop (drift → shutdown).",
    ],
    notEnough: ["Dashboards with no alert thresholds or owners."],
    fix: "Define production error/drift alerts with owners and connect sustained breaches to the uncertainty hold or the stop path.",
  },

  // ── Permission · The Single-Use Vault ─────────────────────────────────────
  "permission/capability-policy": {
    provable: "code",
    lookFor: [
      "An explicit registry of tools/actions with risk level, allowed destinations, and required approval.",
      "Deny-by-default for unknown tools or destinations.",
    ],
    notEnough: ["All tools registered equally with no risk classification."],
    fix: "Create a tool registry that classifies each tool (read / internal write / consequential), lists allowed destinations, and blocks anything unclassified.",
  },
  "permission/execution-boundary": {
    provable: "code",
    lookFor: [
      "Authorization enforced inside the tool wrapper, gateway, or receiving service — where the side effect happens.",
      "No direct credentials or raw SDK/HTTP paths that can perform the consequential action without the check.",
    ],
    notEnough: [
      "A system prompt telling the model to ask first.",
      "A framework interrupt/confirm UI that the tool function itself does not depend on.",
    ],
    fix: "Move the approval check into the consequential tool's execution path (wrapper or receiving API) so the side effect cannot run without it, and remove bypass paths.",
  },
  "permission/exact-request-binding": {
    provable: "code",
    lookFor: ["Approvals bound to the exact operation and arguments (canonical hash of tool + args), target, session, and expiry; mismatch is rejected."],
    notEnough: ["A boolean `approved=True` flag or a generic 'allow this tool' permission."],
    fix: "Issue approvals as signed tokens containing a hash of the canonical tool name + arguments + session + expiry, and verify the hash against the actual call.",
  },
  "permission/human-review-context": {
    provable: "code",
    lookFor: ["An approval UI/message showing the exact action, arguments, evidence, and consequences, with a clear deny, restricted to authorized reviewers."],
    notEnough: ["A generic 'Agent wants to use tool X — Allow?' prompt; any user able to approve."],
    fix: "Render the exact proposed action with its arguments, evidence, and impact, require an authorized reviewer role, and offer an explicit deny.",
  },
  "permission/atomic-consumption": {
    provable: "code",
    lookFor: ["Approval state stored outside the agent (DB/cache) with short expiry, consumed atomically (compare-and-set / unique nonce / jti), plus an execution idempotency key."],
    notEnough: ["Approvals kept in process memory or reusable until restart."],
    fix: "Store approvals in a durable store, consume each nonce atomically before executing, enforce expiry, and pass an idempotency key to the side-effecting API.",
  },
  "permission/review-load": {
    provable: "process",
    lookFor: ["Policy on which actions need review vs bounded autonomy, queue ownership, escalation, and handling when reviewers are overloaded."],
    notEnough: ["Every tool call prompting for approval (fatigue) or none of them."],
    fix: "Limit approval to consequential actions, define the reviewer queue owner and capacity, and make overload hold or escalate rather than auto-approve.",
  },
  "permission/authorization-evidence": {
    provable: "code",
    lookFor: ["Proposal, decision (who/when), token consumption, denial, and execution outcome recorded under one action ID."],
    notEnough: ["Logging that an approval happened without the approver, arguments, or outcome."],
    fix: "Write proposal, decision, consumption, and outcome events to the ledger under a shared action ID with the verified reviewer identity (not the bearer token).",
  },
  "permission/bad-approval-drill": {
    provable: "process",
    lookFor: ["A test or runbook that approves a bounded harmful test action, then triggers stop and compensation."],
    notEnough: ["Tests that only cover denied or correctly approved actions."],
    fix: "Add a staging drill: approve a bounded bad action, trigger the stop, and verify revocation and the remediation list from the ledger.",
  },

  // ── Uncertainty · The Clarification Junction ──────────────────────────────
  "uncertainty/decision-inventory": {
    provable: "code",
    lookFor: ["A list (code or doc) of consequential decisions with required evidence/fields and what happens when they are missing or ambiguous."],
    notEnough: ["Tool parameters that are optional or free text for consequential identifiers (customer, recipient, amount)."],
    fix: "Enumerate the consequential decisions, make their identifying fields required and typed, and define the hold/reject path for each.",
  },
  "uncertainty/uncertainty-gateway": {
    provable: "code",
    lookFor: ["One enforced pre-execution check (resolver/validator/guard node) that consequential actions must pass, including retries and background jobs."],
    notEnough: ["Asking the model 'are you sure?' or relying on prompt instructions to ask when unsure."],
    fix: "Add a pre-execution gate in code that checks required fields, uniqueness of targets, and source agreement before any consequential tool runs, on every path.",
  },
  "uncertainty/validate-signals": {
    provable: "code",
    lookFor: ["Evidence checks beyond model self-confidence: grounding/citation checks, schema validation, uniqueness lookups, cross-source agreement."],
    notEnough: ["A model-reported confidence score as the only signal."],
    fix: "Combine deterministic signals (unique lookup, schema validity, source agreement, grounding) and let any failed signal hold the action regardless of model confidence.",
  },
  "uncertainty/missing-signal-policy": {
    provable: "code",
    lookFor: ["Explicit timeouts and a conservative hold/reject path when an evidence source is unavailable or contradictory."],
    notEnough: ["A missing score defaulting to pass; exceptions swallowed so execution continues."],
    fix: "Treat missing or conflicting evidence as a hold (never a pass), with a timeout and an escalation path.",
  },
  "uncertainty/calibration-and-load": {
    provable: "test",
    lookFor: ["Thresholds chosen against labelled cases, with measured unsafe-pass and unnecessary-question rates."],
    notEnough: ["Magic-number thresholds with no data behind them."],
    fix: "Build a labelled set of ambiguous and clear cases, measure unsafe passes and unnecessary questions, and record the chosen thresholds with that evidence.",
  },
  "uncertainty/targeted-clarification": {
    provable: "code",
    lookFor: ["Clarification that names the missing field and the valid choices (e.g. 'order 4817 or 6234?'), validates the answer, and caps retries."],
    notEnough: ["Generic 'please provide more context' prompts or unbounded clarification loops."],
    fix: "Generate a question naming the unresolved field and the valid options, validate the reply against them, and escalate after a fixed number of attempts.",
  },
  "uncertainty/safe-resumption": {
    provable: "code",
    lookFor: ["Pending actions persisted (checkpointer, durable workflow, DB) with version and expiry; re-validation on resume; resume at most once."],
    notEnough: ["Held state kept only in memory; resuming without re-checking evidence or permission."],
    fix: "Persist the held action with a version and expiry, re-run the gate on resume, consume the resume once, and still require Permission for consequential actions.",
  },
  "uncertainty/clarification-feedback": {
    provable: "process",
    lookFor: ["Holds, questions, answers, delays, and outcomes recorded and reviewed by an owner."],
    notEnough: ["Clarifications that leave no record."],
    fix: "Record each hold and clarification in the ledger and add a periodic review of recurring questions and missed errors.",
  },

  // ── Ledger · The Evidence Press ───────────────────────────────────────────
  "ledger/event-contract": {
    provable: "code",
    lookFor: ["A versioned schema for action events: action ID, event type, verified identities, timestamps, policy/build versions, redacted inputs, outcome references."],
    notEnough: ["Unstructured log lines or print statements."],
    fix: "Define a versioned action-event schema and emit intent, success, failure, and unknown events that validate against it.",
  },
  "ledger/durable-intent": {
    provable: "code",
    lookFor: ["An intent record written and acknowledged before each consequential external call; the call is held if the write fails (write-ahead / outbox pattern)."],
    notEnough: ["Logging only after the call completes; fire-and-forget logging."],
    fix: "Write and await a durable intent record before every consequential call, and block the call if the write is not acknowledged.",
  },
  "ledger/outcome-reconciliation": {
    provable: "code",
    lookFor: ["Outcomes appended under the same action ID, including `unknown`; a reconciler for stale intents using provider receipts or idempotency keys."],
    notEnough: ["Treating timeouts as failures and retrying blindly."],
    fix: "Append success/failure/unknown outcomes under the action ID and add a reconciler that resolves stale intents via provider receipts or idempotency keys.",
  },
  "ledger/write-access-boundary": {
    provable: "code",
    lookFor: ["Append-only storage or permissions: the agent cannot update/delete records; admin and read rights separated; retention configured."],
    notEnough: ["Audit rows in the same writable table the agent's credentials can update or delete."],
    fix: "Store action events in an append-only store (or grant the agent insert-only rights) and separate read and admin access.",
  },
  "ledger/independent-integrity": {
    provable: "code",
    lookFor: ["Hash-chained events with periodic checkpoints or signatures anchored in a separately controlled store (e.g. a confidential/immutable ledger)."],
    notEnough: ["Hashes stored only alongside the data the same writer controls."],
    fix: "Hash-link events and periodically anchor the chain root in a store the agent's writer cannot modify, documenting the anchoring interval.",
  },
  "ledger/data-minimization": {
    provable: "code",
    lookFor: ["Field allowlists or redaction before persistence/telemetry; secrets and PII scrubbed; retention rules."],
    notEnough: ["Logging full prompts, tool payloads, or customer messages by default."],
    fix: "Add a redaction step (field allowlist + secret/PII scrubbing) before anything reaches logs, traces, or the ledger, and set retention.",
  },
  "ledger/investigation-query": {
    provable: "code",
    lookFor: ["A query, script, or tool that reconstructs one action by ID across identity, intent, approval/clarification, execution receipt, and outcome."],
    notEnough: ["Correlation IDs that exist but nothing that joins them."],
    fix: "Provide an investigation query or CLI that takes an action ID and returns the linked history, marking missing evidence and model-supplied reasons separately.",
  },
  "ledger/evidence-failure-drill": {
    provable: "process",
    lookFor: ["Alerts on aged intents, integrity failures, or ledger outages, wired to a hold or stop."],
    notEnough: ["Ledger write failures that are logged and ignored."],
    fix: "Alert on overdue intents and integrity failures and connect critical evidence failures to a hold or supervised stop; rehearse it in staging.",
  },

  // ── Shutdown · The Emergency Power Room ───────────────────────────────────
  "shutdown/independent-control": {
    provable: "code",
    lookFor: ["An authenticated stop endpoint, flag, or control-plane action outside the agent's reasoning loop (feature flag, DB flag, admin API, orchestration terminate)."],
    notEnough: ["Ctrl-C, redeploying, or asking the agent to stop."],
    fix: "Add an operator-only stop control (durable flag + authenticated admin endpoint) that does not depend on the agent's cooperation.",
  },
  "shutdown/stop-before-dispatch": {
    provable: "code",
    lookFor: ["The durable stop state checked before each step, retry, queue consumption, and tool call; signal handlers registered before work starts."],
    notEnough: ["A stop flag checked only at startup or held only in memory."],
    fix: "Check the durable stop flag in the dispatch loop and inside every consequential tool wrapper, so it also holds across restarts.",
  },
  "shutdown/enforced-limits": {
    provable: "code",
    lookFor: ["Hard limits on steps/iterations, errors, wall time, tokens, and spend (e.g. max_iterations, recursion_limit, budget/quota/rate limits) that stop dispatch."],
    notEnough: ["Limits that only log or alert; unbounded loops."],
    fix: "Set explicit step, error, time, and spend limits enforced by the runner (not the model), with the stop reason recorded.",
  },
  "shutdown/cancel-inflight": {
    provable: "code",
    lookFor: ["Cancellation tokens/signals and deadlines passed to tools and workers; tracking of non-cancellable requests to an outcome."],
    notEnough: ["Killing the loop while tool calls run on with no timeout."],
    fix: "Pass cancellation and deadlines into every tool call and record in-flight requests that cannot be cancelled so they reconcile to a known outcome.",
  },
  "shutdown/authority-revocation": {
    provable: "code",
    lookFor: ["Stop procedure that revokes or disables the agent's credentials and invalidates pending approvals."],
    notEnough: ["Stopping compute while credentials and approvals stay valid."],
    fix: "Make the stop path disable the agent's credentials/role assignments and invalidate pending approvals before best-effort cleanup.",
  },
  "shutdown/bounded-cleanup": {
    provable: "code",
    lookFor: ["Idempotent cleanup steps with individual deadlines that cannot block revocation or notification."],
    notEnough: ["A single shutdown hook that can hang indefinitely."],
    fix: "Split shutdown into idempotent steps with per-step deadlines, run revocation and notification first, and report unfinished steps.",
  },
  "shutdown/reconcile-incident": {
    provable: "code",
    lookFor: ["After a stop: compare in-flight work with ledger intents and receipts, list completed/failed/unknown effects, and notify an owner."],
    notEnough: ["Stopping silently with no owner notification or reconciliation."],
    fix: "On stop, generate an incident summary from ledger intents vs receipts (completed / failed / unknown) and notify the agent's owner.",
  },
  "shutdown/controlled-restart": {
    provable: "process",
    lookFor: ["Tests/runbooks for graceful stop, hard kill, and restart; the agent stays stopped until an authorized recovery with fresh credentials."],
    notEnough: ["The agent auto-resuming queued work after a restart."],
    fix: "Persist the stopped state across restarts, require an authorized recovery action with fresh credentials, and drill hard-kill and restart in staging.",
  },
};

// Keyword concepts used by `scorecard.mjs discover` to build a reading index.
// These are deliberately broad and framework-agnostic; hits are leads, not verdicts.
export const discoveryConcepts = {
  identity: [
    "agent[_-]?id", "instance[_-]?id", "session[_-]?id", "thread[_-]?id", "conversation[_-]?id",
    "principal", "managed[_ -]?identity", "workload[_ -]?identity", "DefaultAzureCredential", "ManagedIdentityCredential",
    "jwks?", "\\bjwt\\b", "audience", "issuer", "oidc", "spiffe", "client[_-]?credentials", "api[_-]?key", "Bearer", "\\bowner\\b",
  ],
  reliability: [
    "\\bevals?\\b", "evaluat", "golden", "test[_-]?cases?", "dataset", "threshold", "promptfoo", "deepeval", "ragas",
    "langsmith", "braintrust", "inspect_ai", "BaseModel", "TypedDict", "zod", "json[_ -]?schema", "contract",
    "prompt[_-]?version", "model[_-]?version", "drift", "idempoten",
  ],
  permission: [
    "approv", "human[_ -]?in[_ -]?the[_ -]?loop", "\\bhitl\\b", "interrupt", "confirm", "allow[_-]?list", "deny[_-]?list",
    "\\bpolicy\\b", "authori[sz]", "require[sd]?_approval", "\\bnonce\\b", "\\bjti\\b", "single[_ -]?use", "egress", "\\bscopes?\\b",
  ],
  uncertainty: [
    "confidence", "uncertain", "ambigu", "clarif", "ask[_-]?(the[_-]?)?user", "human[_-]?input", "disambig",
    "grounded(ness)?", "\\bhold\\b", "pending", "resume", "external[_ -]?event", "wait[_-]?for",
  ],
  ledger: [
    "\\baudit", "ledger", "append[_ -]?only", "event[_ -]?store", "outbox", "\\bintent\\b", "\\boutcome\\b",
    "opentelemetry", "\\botel\\b", "tracer", "\\bspan\\b", "app(lication)?[_ ]?insights", "hash[_ -]?chain", "sha256",
    "redact", "\\bpii\\b", "retention", "correlation[_-]?id", "action[_-]?id", "request[_-]?id",
  ],
  shutdown: [
    "kill[_ -]?switch", "circuit[_ -]?breaker", "SIGTERM", "SIGINT", "signal\\.signal", "cancel", "abort", "deadline",
    "timeout", "max[_-]?(steps|iterations|turns)", "recursion[_-]?limit", "budget", "rate[_ -]?limit", "quota",
    "revoke", "terminate", "shutdown", "graceful", "stop[_-]?(flag|state|event)",
  ],
};

// Signals that a tool or code path has real-world consequences (money, deletion,
// external communication, access changes, code execution).
export const consequentialPatterns = [
  "refund", "payout", "transfer", "\\bcharge\\b", "payment", "invoice", "\\bwire\\b", "stripe",
  "send[_-]?(email|mail|message|sms|notification)", "smtp", "sendgrid", "twilio", "chat\\.postMessage",
  "\\bdelete\\b", "\\bdrop\\s+table\\b", "truncate", "rmtree", "unlink", "rm -rf",
  "grant", "assign[_-]?role", "set[_-]?permission", "deploy", "publish",
  "subprocess", "os\\.system", "exec\\(", "eval\\(", "execute[_-]?sql", "shell",
  // Database writes (ORMs, query builders, raw SQL).
  "\\.(insert|upsert)\\(", "table\\([^)]*\\)\\s*\\.\\s*(update|delete)\\(", "\\bINSERT\\s+INTO\\b", "\\bUPDATE\\s+\\w+\\s+SET\\b",
  "\\bDELETE\\s+FROM\\b", "session\\.(add|delete|commit)\\(", "\\.objects\\.(create|update|delete)", "bulk_write", "put_item", "\\.upload\\(",
  // Data sent to a hosted model is a disclosure, even when nothing else changes.
  "messages\\.create\\(", "chat\\.completions\\.create\\(", "responses\\.create\\(", "generate_content\\(",
];

// Patterns that mark a tool definition across common agent frameworks.
export const toolPatterns = [
  "@tool\\b", "@function_tool", "@kernel_function", "@mcp\\.tool", "@ai_function", "FunctionTool",
  "StructuredTool", "BaseTool", "Tool\\(", "tool\\(", "bind_tools", "ToolNode", "tools\\s*=\\s*\\[",
  "register_function", "@agent\\.tool", "@server\\.tool", "createTool", "defineTool",
];

// Dependency/import names → framework label.
export const frameworkPatterns = {
  "LangGraph": ["langgraph", "@langchain/langgraph"],
  "LangChain": ["langchain"],
  "LlamaIndex": ["llama_index", "llama-index", "llamaindex"],
  "CrewAI": ["crewai"],
  "AutoGen / AG2": ["autogen", "\\bag2\\b"],
  "Microsoft Agent Framework": ["agent_framework", "agent-framework", "Microsoft\\.Agents\\.AI"],
  "Semantic Kernel": ["semantic_kernel", "semantic-kernel", "Microsoft\\.SemanticKernel"],
  "OpenAI Agents SDK": ["openai-agents", "from agents import", "@openai/agents"],
  "Pydantic AI": ["pydantic_ai", "pydantic-ai"],
  "smolagents": ["smolagents"],
  "Google ADK": ["google\\.adk", "google-adk"],
  "Strands Agents": ["strands-agents", "from strands"],
  "Haystack": ["haystack"],
  "DSPy": ["\\bdspy\\b"],
  "Anthropic SDK": ["\\banthropic\\b", "@anthropic-ai/sdk", "claude_agent_sdk", "claude-agent-sdk"],
  "OpenAI SDK": ["\\bopenai\\b"],
  "Vercel AI SDK": ["from ['\"]ai['\"]", "@ai-sdk/"],
  "Mastra": ["@mastra/"],
  "MCP": ["\\bmcp\\b", "@modelcontextprotocol/"],
  "Azure AI Foundry": ["azure-ai-projects", "azure\\.ai\\.projects", "azure-ai-agents", "azure\\.ai\\.agents"],
  "Temporal / Durable workflows": ["temporalio", "azure-functions-durable", "durabletask"],
};

// ── Relevance ───────────────────────────────────────────────────────────────
// Before assessing, the assessor answers each trait about the agent, with evidence.
// Rooms and checks declare which traits make them apply, so an agent is never marked
// down for lacking a control it has no use for (e.g. approvals on a read-only agent).
// Traits are ordered from broad to narrow; `implies` lists traits that must also be true.

export const traits = [
  {
    id: "acts",
    label: "Takes actions",
    question: "Does the agent write, send or change anything outside its own run?",
    trueWhen: "It writes to a database, file or queue, calls an API that changes something, or sends a message. Calling a model API on its own doesn't count.",
    whenFalse: "it only returns text and changes nothing outside its own run",
    implies: [],
  },
  {
    id: "consequential",
    label: "Consequential actions",
    question: "Can any action be hard to undo, or affect people outside the team?",
    trueWhen: "It moves money, deletes or overwrites records other people rely on, contacts people outside the system, changes access or permissions, runs generated code, or publishes something.",
    whenFalse: "none of its actions is hard to undo or affects people outside the team",
    implies: ["acts"],
  },
  {
    id: "unreviewed_consequential",
    label: "Consequential actions without review",
    question: "Does any consequential action take effect before a person approves that specific action?",
    trueWhen: "The agent executes the action itself. False only when every consequential output lands as a draft or proposal that a person approves before it takes effect.",
    whenFalse: "every consequential output is a draft that a person approves before it takes effect",
    implies: ["consequential"],
  },
  {
    id: "model_decides",
    label: "Model makes decisions",
    question: "Does model output choose a target, amount, category, priority or route that is acted on or recorded?",
    trueWhen: "A model's answer decides what happens next or what gets stored, beyond being shown to a person as free text.",
    whenFalse: "model output is only shown to a person and never decides an action or a stored value",
    implies: [],
  },
  {
    id: "ambiguous_targets",
    label: "Resolves ambiguous targets",
    question: "Does the agent work out who or what to act on from free text or fuzzy matching?",
    trueWhen: "It turns names, descriptions or phrases like \"my last order\" into a specific customer, record, recipient or file.",
    whenFalse: "every target it acts on arrives as an explicit identifier",
    implies: [],
  },
];

// Which traits make each room apply. `null` means the room always applies.
export const roomRelevance = {
  identity: ["acts"],
  reliability: null,
  permission: ["consequential"],
  uncertainty: ["model_decides"],
  ledger: ["acts"],
  shutdown: ["acts"],
};

// Checks that need a narrower trait than their room. A check applies when ANY listed trait is true.
export const checkRelevance = {
  "identity/compromised-identity-drill": ["consequential"],
  // Approval mechanics only matter when the agent executes consequential actions itself.
  "permission/exact-request-binding": ["unreviewed_consequential"],
  "permission/atomic-consumption": ["unreviewed_consequential"],
  "permission/authorization-evidence": ["unreviewed_consequential"],
  "permission/bad-approval-drill": ["unreviewed_consequential"],
  "uncertainty/targeted-clarification": ["ambiguous_targets"],
  // Holds exist when the agent waits for a clarification or an approval.
  "uncertainty/safe-resumption": ["ambiguous_targets", "unreviewed_consequential"],
  "ledger/durable-intent": ["consequential"],
  "ledger/outcome-reconciliation": ["consequential"],
  "ledger/independent-integrity": ["consequential"],
  "shutdown/reconcile-incident": ["consequential"],
};
