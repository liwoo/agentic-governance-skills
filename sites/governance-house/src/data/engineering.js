// Implementation guidance for the illustrated architecture, not mandated controls.
// Stable check IDs identify acceptance criteria; change an ID if its meaning changes.
export const engineering = {
  identity: {
    limitation: {
      title: "A valid identity can still perform a harmful action.",
      body: "The passport proves which credential acted, not whether the action was permitted or correct. A compromised credential can produce correctly signed requests; even complete attribution cannot prevent harm on its own.",
      companions: [
        { roomId: "permission", reason: "Limit what the identified caller can do, even when its signature is valid." },
        { roomId: "ledger", reason: "Preserve the verified identity with intent and outcome so an incident can be reconstructed." },
        { roomId: "shutdown", reason: "Revoke the compromised instance’s authority and block further work." },
      ],
    },
    checks: [
      { id: "owner-contract", title: "Define the identity contract", action: "Publish a schema for accountable owner, agent build, instance, and session; assign an owner to each deployed agent.", verify: "Start an agent without its owner or build identity. Startup must fail with a diagnosable error." },
      { id: "instance-lifecycle", title: "Separate process and session lifetimes", action: "Generate a fresh instance ID at process start and propagate the framework’s session ID across tools, retries, and queues.", verify: "Restart the process and run two sessions. Instance IDs must change on restart; sessions must remain distinguishable across asynchronous work." },
      { id: "trusted-issuer", title: "Issue claims outside the agent’s trust boundary", action: "Use a trusted identity issuer; keep signing keys out of model-accessible tools and prevent the agent from selecting another owner.", verify: "Request a token for a different owner and submit a self-signed claim. The issuer or receiving service must reject each attempt." },
      { id: "verify-claims", title: "Verify claims at every receiving boundary", action: "Validate signature, trusted issuer, intended audience, expiry, and required identity fields before accepting a request.", verify: "Send altered, expired, wrong-audience, and missing-field tokens. Every receiving service must reject them before any side effect." },
      { id: "short-lived-revocable", title: "Bound token lifetime and revocation delay", action: "Choose a maximum token lifetime and revocation deadline; document key rotation and how active instances are disabled.", verify: "Rotate a key and disable a test instance. Confirm old authority stops working within the documented deadline." },
      { id: "close-bypasses", title: "Route all external calls through enforcement", action: "Inventory HTTP, SDK, queue, and tool paths; require verified identity at destinations and restrict direct network or credential bypasses.", verify: "Attempt an external action with a raw client and a direct SDK call. Neither may bypass identity verification." },
      { id: "record-verified-identity", title: "Carry verified identity into the ledger", action: "Attach receiver-verified identity and a shared action ID to the intent, execution trace, and outcome; avoid logging bearer tokens.", verify: "Trace one queued action end to end. All records must resolve to the same owner, build, instance, session, and action without exposing credentials." },
      { id: "compromised-identity-drill", title: "Exercise a compromised-credential scenario", action: "In staging, combine a valid test identity with an unauthorized action, then revoke that instance through Shutdown.", verify: "Permission must deny the action, Ledger must preserve the denial, and subsequent calls must fail after the revocation deadline." },
    ],
  },
  reliability: {
    limitation: {
      title: "Passing parts can still form a failing system.",
      body: "Tests sample known conditions. Interfaces, production drift, and unfamiliar inputs can defeat a workflow whose components all passed. A certificate is evidence for a tested version and context, not a guarantee of future correctness.",
      companions: [
        { roomId: "uncertainty", reason: "Hold decisions when required evidence is missing or outside the validated operating range." },
        { roomId: "ledger", reason: "Capture production failures and their versions so evaluation suites can learn from them." },
        { roomId: "shutdown", reason: "Contain a live failure when monitoring crosses a defined error or impact limit." },
      ],
    },
    checks: [
      { id: "workflow-contracts", title: "Map the workflow and its contracts", action: "List every retrieval, transformation, model decision, and tool call with an owner, input/output schema, dependencies, and failure policy.", verify: "Trace a representative request through the map. Every executable stage and interface must have a contract and owner." },
      { id: "stage-test-suites", title: "Create isolated tests for each stage", action: "Classify each stage as deterministic, I/O, or model-based; build a repeatable suite with expected outcomes and representative failure cases.", verify: "Run each suite independently in CI and inject a known defect. Its stage must fail without relying on the end-to-end suite." },
      { id: "deterministic-invariants", title: "Gate deterministic code on required invariants", action: "Test schema handling, boundary values, arithmetic, and state transitions; block release when any required deterministic case fails.", verify: "Run boundary and property tests where appropriate. All required assertions must pass; record the tested scope rather than claiming universal correctness." },
      { id: "io-failure-tests", title: "Inject dependency failures", action: "Test malformed payloads, timeouts, rate limits, duplicate responses, and partial failures; specify bounded retries and idempotency for side effects.", verify: "Simulate an ambiguous timeout after a write. Recovery must reconcile the result or retry idempotently without duplicating the effect." },
      { id: "model-eval-thresholds", title: "Set measurable model acceptance criteria", action: "Choose domain-specific error limits, representative data slices, and a justified sample size; record uncertainty in the measured results.", verify: "Evaluate held-out cases, including consequential failure modes. Results and confidence bounds must satisfy the predeclared release criteria." },
      { id: "version-bound-release", title: "Bind release evidence to the deployed version", action: "Record code, model, prompt, data, configuration, and evaluation versions in a release manifest; invalidate affected evidence when they change.", verify: "Change a prompt or dependency after evaluation. The release gate must require fresh evidence for the affected stages." },
      { id: "integration-gate", title: "Test joins and complete journeys", action: "Run interface contract tests and representative end-to-end scenarios in CI, including authorization, retries, cancellation, and malformed handoffs.", verify: "Introduce an incompatible interface while keeping each isolated suite green. The integration gate must block release." },
      { id: "production-drift-drill", title: "Rehearse failure after a passing release", action: "Set production error and drift alerts with owners and response deadlines; connect them to uncertainty holds or a supervised stop.", verify: "Inject an out-of-range input and a sustained failure burst in staging. Confirm the hold or stop, retained ledger evidence, and an assigned investigation." },
    ],
  },
  permission: {
    limitation: {
      title: "Approval fatigue can turn a strong lock into a formality.",
      body: "Exact, single-use approval enforces a person’s decision, including a mistaken one. Excessive prompts, weak evidence, or time pressure can encourage rubber-stamping. The other rooms support review and containment; reviewer capacity still needs its own design.",
      companions: [
        { roomId: "uncertainty", reason: "Resolve missing facts before requesting approval, so the reviewer sees one well-specified action." },
        { roomId: "ledger", reason: "Record proposals and decisions; review approval volume and outcomes for signs that oversight is failing." },
        { roomId: "shutdown", reason: "Stop further execution if an approved action starts causing harm; completed effects may still need remediation." },
      ],
    },
    checks: [
      { id: "capability-policy", title: "Inventory and classify executable capabilities", action: "Create a tool/action matrix listing risk, allowed destinations, required reviewer role, and deny-by-default behavior for unknown actions.", verify: "Register an unclassified tool or destination. Execution must remain blocked until its policy is explicitly defined." },
      { id: "execution-boundary", title: "Enforce policy where the side effect occurs", action: "Put authorization in the tool gateway or receiving service; remove direct credentials and restrict egress that could bypass it.", verify: "Attempt the same dangerous action through the normal tool, a raw SDK, and a direct HTTP request. All paths must enforce the policy." },
      { id: "exact-request-binding", title: "Bind approval to the complete action", action: "Canonicalize and sign the operation, target, arguments, instance/session, request ID, and expiry; include relevant resource version or preconditions.", verify: "Change an amount, recipient, argument, or resource version after approval. Execution must reject the mismatch and request fresh approval." },
      { id: "human-review-context", title: "Build a review screen that supports refusal", action: "Show the exact proposed change, supporting evidence, uncertainty, and consequences to an authenticated, authorized reviewer; offer a clear deny action.", verify: "An unauthorized reviewer cannot approve. An authorized reviewer can inspect the change and deny it without a side effect occurring." },
      { id: "atomic-consumption", title: "Consume approvals atomically", action: "Store approval state outside the agent, enforce short expiry, and atomically reserve or consume it; use an execution idempotency key for retries.", verify: "Submit the same approval concurrently, then replay it after a timeout. At most one side effect may occur; expired approvals must fail." },
      { id: "review-load", title: "Design and measure the review workload", action: "Define which consequential actions require review, queue ownership, capacity limits, and escalation; keep low-risk work within bounded policy instead of prompting indiscriminately.", verify: "Load-test the approval queue with representative reviewers. Overload must hold or escalate work, never silently approve it; record volume, delay, and decision quality." },
      { id: "authorization-evidence", title: "Record the authorization lifecycle", action: "Link each proposal, human decision, token consumption, denial, and execution outcome in the ledger using one action ID and verified identities.", verify: "For an approved action and a rejected replay, reconstruct who decided, what was authorized, and what actually executed without storing the bearer approval token." },
      { id: "bad-approval-drill", title: "Test containment after a mistaken approval", action: "In staging, approve a bounded harmful test action, trigger the independent stop, and follow the documented compensation or incident process.", verify: "New work must stop, credentials must be revoked within the defined deadline, and the ledger must identify completed effects requiring remediation." },
    ],
  },
  uncertainty: {
    limitation: {
      title: "More questions can mean less meaningful human attention.",
      body: "Aggressive thresholds can overload people with clarifications; permissive thresholds let unsafe guesses through. Even a timely answer may be wrong. Clarification resolves missing information—it does not authorize the resulting action.",
      companions: [
        { roomId: "reliability", reason: "Calibrate the gate on representative cases and measure both missed errors and unnecessary questions." },
        { roomId: "permission", reason: "Require separate authorization when the clarified action is consequential." },
        { roomId: "ledger", reason: "Retain holds, answers, and outcomes to identify repeated questions, fatigue, and calibration drift." },
      ],
    },
    checks: [
      { id: "decision-inventory", title: "Identify decisions that must not guess", action: "List consequential decision points, required evidence, ambiguity conditions, and the owner responsible for each hold or escalation policy.", verify: "Remove a required field from every listed decision type. Each must reach an explicit hold or rejection path before execution." },
      { id: "uncertainty-gateway", title: "Put the uncertainty gate before execution", action: "Route consequential decisions through one enforced evaluation step, including retries and background jobs; prevent alternate tool paths from skipping it.", verify: "Submit an ambiguous action through interactive and queued paths. Neither may execute while its decision state is unresolved." },
      { id: "validate-signals", title: "Measure evidence quality beyond model confidence", action: "Combine grounding checks, schema validation, and calibrated predictors where useful; measure signal correlation rather than assuming independent evidence.", verify: "Use examples where the model reports high confidence but grounding or required fields fail. The gate must still hold the action." },
      { id: "missing-signal-policy", title: "Define behavior when a signal is unavailable", action: "Set timeouts and a hold, reject, or human-escalation path for missing or conflicting evidence; never silently treat a missing score as a pass.", verify: "Disable an evidence service and inject contradictory inputs. The action must follow the documented conservative policy." },
      { id: "calibration-and-load", title: "Calibrate for errors and reviewer workload", action: "On labeled domain cases, choose thresholds against unsafe-pass and unnecessary-question rates; set review capacity and recalibration triggers.", verify: "Measure both rates on held-out cases and load-test the human queue. Breached limits must trigger review or a hold, not automatic threshold relaxation." },
      { id: "targeted-clarification", title: "Ask for the specific missing fact", action: "Show the unresolved field, valid choices, and why it matters; validate the answer and limit repeated clarification attempts before escalation.", verify: "Test ambiguous, malformed, contradictory, and absent answers. No invalid answer may silently select a route or create an endless prompt loop." },
      { id: "safe-resumption", title: "Persist holds and revalidate before resuming", action: "Store the pending action with a version and expiry; on answer, recheck evidence and resource state, then apply Permission separately when required.", verify: "Restart while waiting, then answer twice or after the target changes. Resume at most once with current evidence and the required authorization." },
      { id: "clarification-feedback", title: "Close the loop with outcome evidence", action: "Record hold reasons, questions, answers, delays, and eventual outcomes; assign an owner to review recurring questions and missed errors.", verify: "Run an ambiguous consequential action end to end. Verify the hold, clarification, separate approval, ledger trail, and an alert when the chosen review limits are exceeded." },
    ],
  },
  ledger: {
    limitation: {
      title: "An intact record can still describe a harmful or misleading action.",
      body: "Hash links make changes detectable under a defined trust model; they do not make records truthful or prevent harm. A writer controlling the whole chain can rewrite it without an independent anchor. More evidence can also create a privacy liability.",
      companions: [
        { roomId: "identity", reason: "Attach identities verified at the boundary instead of trusting the agent’s claimed author." },
        { roomId: "permission", reason: "Control both consequential actions and access to evidence; recording an action cannot authorize it." },
        { roomId: "reliability", reason: "Test crash recovery and integrity checks, and reconcile records against actual tool outcomes." },
      ],
    },
    checks: [
      { id: "event-contract", title: "Define a versioned action-event schema", action: "Specify action ID, event type, verified identities, timestamps, policy and build versions, redacted inputs, decision evidence, and outcome references.", verify: "Validate sample intent, success, failure, and unknown-outcome events against the schema. Missing correlation or identity fields must be rejected." },
      { id: "durable-intent", title: "Acknowledge durable intent before execution", action: "Place a durable intent write ahead of each governed external side effect; hold the action when the ledger cannot acknowledge that write.", verify: "Make storage unavailable before the intent acknowledgment. The external action must not execute." },
      { id: "outcome-reconciliation", title: "Reconcile incomplete and ambiguous outcomes", action: "Append outcomes under the same action ID; set a deadline for unresolved intents and use tool receipts or idempotency keys to reconcile them safely.", verify: "Crash after the external write but before the outcome append. Recovery must identify the actual result or mark it unknown without blindly repeating the effect." },
      { id: "write-access-boundary", title: "Separate append, read, and administration rights", action: "Deny the agent update/delete access, isolate storage administration, and enforce approved retention controls on the evidence store.", verify: "Try to alter and delete an existing event as the agent and as a reader. Both must fail; authorized administrative changes must be auditable." },
      { id: "independent-integrity", title: "Anchor integrity outside the writer’s control", action: "Hash-link events and periodically sign or checkpoint chain roots into a separately controlled store; document the interval and unanchored-tail exposure.", verify: "Alter, remove, or reorder an anchored event, then rewrite the local chain. Verification against the independent checkpoint must detect the inconsistency." },
      { id: "data-minimization", title: "Set redaction, access, and retention rules", action: "Allowlist necessary fields, redact secrets before persistence, restrict readers, and define expiry/deletion handling with privacy and security owners.", verify: "Inject a test secret and personal-data marker. Forbidden values must not persist; test reader isolation and the approved retention workflow." },
      { id: "investigation-query", title: "Make one action reconstructable", action: "Provide an investigation query joining identity, intent, approval or clarification, execution receipt, and outcome; separate observed facts from model-provided reasons.", verify: "Give a reviewer an action ID. They must retrieve the complete linked history and identify missing evidence without treating a generated rationale as proof." },
      { id: "evidence-failure-drill", title: "Exercise evidence failure across the controls", action: "Define owners and alerts for aged intents, integrity failures, and verification outages; connect critical evidence failures to a hold or supervised stop.", verify: "Inject a broken checkpoint or overdue intent in staging. Confirm the alert, preserved evidence, assigned investigation, and the configured hold or stop." },
    ],
  },
  shutdown: {
    limitation: {
      title: "Stopping now cannot undo what already happened.",
      body: "A kill switch can contain further work, but a completed transfer or sent message remains. In-flight effects, hanging cleanup, and a failed control plane can leave uncertainty. Safe recovery requires evidence and a deliberate restart decision.",
      companions: [
        { roomId: "permission", reason: "Constrain irreversible effects before they happen and require authorization for consequential recovery actions." },
        { roomId: "identity", reason: "Target the affected instance’s authority without losing track of who operated it." },
        { roomId: "ledger", reason: "Identify what completed, failed, or remains unknown so an owner can reconcile the incident." },
      ],
    },
    checks: [
      { id: "independent-control", title: "Provision an independent stop path", action: "Expose an authenticated stop through a supervisor or control plane outside the agent process; define who can invoke it and how to reach it during an outage.", verify: "Deadlock or disconnect the agent in staging. An authorized operator must still be able to activate the external stop; unauthorized callers must fail." },
      { id: "stop-before-dispatch", title: "Check stop state before dispatch", action: "Gate scheduling, retries, queue consumers, and tool calls on a durable stopped state; register shutdown handlers before agent work begins.", verify: "Stop during a queued workflow. No new step may dispatch after the enforced stop boundary, including after process restart." },
      { id: "enforced-limits", title: "Set enforceable runtime limits", action: "Configure step, error, elapsed-time, and spend limits in the supervisor; assign owners and explicit escalation behavior for breached limits.", verify: "Trigger each limit in staging. Further dispatch must stop within the documented deadline, with a reason recorded for the operator." },
      { id: "cancel-inflight", title: "Propagate cancellation and track in-flight work", action: "Pass cancellation to tools and workers, set deadlines, and inventory providers that cannot cancel an accepted request.", verify: "Stop during a slow tool call and a non-cancellable request. Cancel the former; track the latter to a confirmed or explicitly unknown outcome." },
      { id: "authority-revocation", title: "Revoke authority through the supervisor", action: "Revoke instance credentials and pending approvals before best-effort application cleanup; bound residual token validity when immediate revocation is unavailable.", verify: "Kill the process without running its handlers. Saved credentials and approvals must become unusable within the documented revocation bound." },
      { id: "bounded-cleanup", title: "Make cleanup repeatable and time-bounded", action: "Implement idempotent cleanup steps with independent deadlines and escalation; prevent one hanging step from blocking revocation or incident notification.", verify: "Invoke shutdown twice and hang one cleanup dependency. The procedure must reach its deadline, preserve stop state, and report unfinished work." },
      { id: "reconcile-incident", title: "Reconcile effects and notify an owner", action: "Compare in-flight work with ledger intents and tool receipts; list completed, failed, and unknown effects with an assigned incident owner and remediation plan.", verify: "Stop immediately after a test side effect. The incident report must include it even if the agent never appended its outcome." },
      { id: "controlled-restart", title: "Drill termination and deliberate recovery", action: "Exercise graceful stop, hard kill, network loss, and supervisor restart; require an authorized recovery decision and fresh scoped credentials before resuming.", verify: "The agent must stay stopped across each restart. After authorized recovery, old credentials, approvals, and queued work must not silently resume." },
    ],
  },
};

// Editorial priorities: the first three actions to surface, not the whole safeguard.
export const priorityCheckIds = {
  identity: ["trusted-issuer", "verify-claims", "close-bypasses"],
  reliability: ["stage-test-suites", "version-bound-release", "integration-gate"],
  permission: ["execution-boundary", "exact-request-binding", "atomic-consumption"],
  uncertainty: ["uncertainty-gateway", "calibration-and-load", "safe-resumption"],
  ledger: ["durable-intent", "outcome-reconciliation", "independent-integrity"],
  shutdown: ["independent-control", "stop-before-dispatch", "authority-revocation"],
};
