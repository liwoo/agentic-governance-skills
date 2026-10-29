# Assessment method

Rules that keep scorecards comparable across codebases and assessors.

## Choosing a status

| Status | Use when | Required fields |
|---|---|---|
| `present` | The control exists **and is enforced on every relevant path**, as far as you can tell from the code. Tests or config back it up where the check calls for them. | `finding`, `evidence` ≥ 1 |
| `partial` | Some of it is there: it covers only some paths, lacks a required element (e.g. approval without argument binding), is implemented but untested where the check needs a test, or the framework hook exists but the side effect can bypass it. | `finding`, `evidence` ≥ 1, `fix` |
| `missing` | You looked properly (discovery leads, your own search, reading the relevant paths) and found nothing that implements the concept. | `finding`, `fix` |
| `not_applicable` | The check really cannot apply. For example, there's no consequential action, so single-use approval doesn't matter, or there are no clarification paths because the agent takes no decisions. Use it sparingly. | `reason` |
| `unknown` | The answer lives outside the code: a team process, a cloud setting that isn't in the repo, a staging drill. | `question` (specific and answerable), optionally `finding`/`evidence` for what you did see |

When torn between two statuses, pick the less generous one and explain why in the
`finding`.

## What counts as evidence

**Counts**
- Code on the execution path, such as a wrapper, middleware, guard node,
  validator, DB constraint, or receiving-API check.
- Tests that exercise the behaviour, and CI jobs that run them as a gate.
- Configuration and infrastructure-as-code checked into the repo, such as limits,
  identity, retention, or alert rules.
- A runbook or drill script in the repo. This only counts for checks marked
  `provable: process`, and the runbook has to be specific.

**Doesn't count on its own (at most `partial`)**
- Instructions in a system prompt: "always ask before refunding", "be careful".
  A prompt is a request to the model, not a control.
- A framework approval or confirm UI that the side-effecting function doesn't
  depend on, when another path can reach the function without it.
- Comments, TODOs, ADRs, READMEs, or design docs describing something that isn't
  implemented.
- Dead code, unused helpers, or a control that only exists in an example or demo
  folder and isn't wired into the agent.
- Logging that happens *after* the side effect, when the check is about intent
  *before* it.

**Confirm every lead.** Open the file and follow the call path. A discovery hit on
`approve` might be a variable name in an unrelated module.

## How each kind of check is proved

Each check in the room files has a `provable` value:
- `code`: the code alone can establish `present`.
- `test`: `present` needs a test or CI gate in the repo that exercises the
  behaviour. Code without a test is `partial`.
- `process`: this depends on drills or team practice. Give `present` only if the
  repo contains the test, drill script, or a specific runbook. Otherwise use
  `unknown` with a question, or `missing` if the prerequisite controls don't exist
  at all. For example, the controlled-restart drill can't exist without a stop
  mechanism.

## Deciding what applies

Answer these traits before assessing any check. Rooms and checks declare which
traits make them apply, and `scope` removes the rest. This is how the scorecard
avoids marking an agent down for a control it has no use for.

| Trait | True when | Rooms and checks it switches on |
|---|---|---|
| `acts` | It writes to a database, file or queue, calls an API that changes something, or sends a message. Calling a model API on its own doesn't count. | Identity, Ledger, Shutdown |
| `consequential` | An action moves money, deletes or overwrites records other people rely on, contacts people outside the system, changes access or permissions, runs generated code, or publishes something. Implies `acts`. | Permission, plus intent-before-execution, reconciliation and integrity in Ledger and Shutdown |
| `unreviewed_consequential` | A consequential action takes effect before a person approves that specific action. False only when every consequential output lands as a draft or proposal that a person approves first. Implies `consequential`. | The approval mechanics: request binding, single-use consumption, authorization records, the bad-approval drill |
| `model_decides` | Model output picks a target, amount, category, priority or route that is acted on or stored. | Uncertainty |
| `ambiguous_targets` | It turns names, descriptions or phrases like "my last order" into a specific customer, record, recipient or file. | Targeted clarification and safe resumption |

Reliability always applies.

Rules for answering:
- **Answer from the code, with evidence.** `true` needs at least one `path:line`. `false` needs a reason that says what you looked for ("No tool writes anywhere; every function under `tools/` is a GET").
- **When unsure, answer `true`.** A wrong `false` silently removes checks; a wrong `true` only costs some extra assessment.
- **A downstream review counts only if it gates the effect.** If the agent writes a draft that a person must approve before it reaches anyone, `unreviewed_consequential` is false. If the agent applies the change and a person can undo it later, it's true.
- **Don't answer for the future.** "We'll add refunds next quarter" doesn't make `consequential` true today. The scorecard should be re-run when that ships.

`validate` rejects a profile that contradicts itself (e.g. `consequential` true but `acts` false) or contradicts `consequentialActions` (e.g. a `money` action with `consequential` false).

`not_applicable` on an individual check is still allowed for a case the profile can't express. Give a specific reason, and never use it because a check is hard or because "the framework handles it" without evidence.

## Writing findings and fixes

- **Use this codebase's names.** Write "`tools/refunds.py:issue_refund` calls
  `stripe.Refund.create` directly; nothing checks an approval", not "high-risk
  functions lack approval".
- **Make fixes concrete and native to the framework.** If the project uses
  LangGraph, suggest an `interrupt()` guard node *plus* enforcement inside the tool,
  because the room files explain that framework hooks alone aren't the boundary.
  If it's a custom loop, suggest a wrapper or decorator. Point to the file and
  function to change in `fix.files`.
- **Write steps a developer can follow.** Two to five steps, each one a code or
  config change, ending with how to verify it (usually a test drawn from the
  check's *verify* text).
- **Don't overstate.** Static reading can't prove runtime behaviour. Use the
  `confidence` field (`high` / `medium` / `low`) honestly.
- **Write it plainly.** The report is read by the engineers who own the code, so
  write it the way a good reviewer writes a PR comment:
  - Lead with what can go wrong, then why: "Answering \"no\" still issues the
    refund: the edge from `confirm` to `tools` is unconditional."
  - Keep a finding to one or two short sentences, one fact each. Write fix steps as
    imperatives ("Add…", "Replace…", "Test:…").
  - Don't use metaphors, jokes, references to the talk, or dramatic framing
    ("Schrödinger's refund", "a ticking time bomb"). Avoid em dashes, rhetorical
    questions, and filler such as "it's worth noting", "crucially", "robust", or
    "comprehensive".
  - Use the codebase's own names, and numbers where you have them (3 retries,
    10-second timeout, 25 steps).
- **Keep secrets out.** Refer to secrets by location ("hard-coded key in
  `config.py:12`"), never by value.

## Severity: what to fix first

Set `severity` on every `missing` or `partial` check. It reflects how much harm the
gap allows **for this agent**, given its consequential actions. It sets the
"fix these first" order and doesn't change the score.

| Severity | Use when |
|---|---|
| `critical` | A consequential action can go wrong **today** because of this gap. Examples: a refund runs despite a denial or with an unchecked amount; anyone can approve; a retry can move money twice; an ambiguous target is silently guessed. |
| `high` | A missing core boundary that makes a critical failure likely or undetectable: no stop path, no intent before side effects, a shared static credential, a tool nobody has classified. |
| `medium` | A weakness that matters, but other gaps would have to fail first. This is the default for non-priority checks. |
| `low` | Hardening, or a drill/feedback loop that only makes sense once its prerequisites exist (e.g. integrity anchoring before there is any ledger). |

Don't mark a check `critical` just because the catalogue lists it as a priority.
Severity depends on what this agent can actually do.

## Coverage discipline

- Assess all 48 checks. `validate` rejects a report that skips any.
- Checks interlock. If Ledger has no action ID, `identity/record-verified-identity`
  and `permission/authorization-evidence` usually can't be `present` either.
  Make sure the statuses are consistent with each other.
- If you run out of time, mark the unassessed checks `unknown` with the question
  "Not assessed in this pass" rather than guessing. Say so in `notes`.
