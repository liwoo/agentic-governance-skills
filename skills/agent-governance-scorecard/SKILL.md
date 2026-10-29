---
name: agent-governance-scorecard
description: >-
  Assess an AI agent codebase against the Governance House's six safeguards —
  Identity, Reliability, Permission, Uncertainty, Ledger, and Shutdown (48 checks) —
  and produce a scorecard (JSON + self-contained HTML) with evidence and concrete
  fixes that name real files. Framework-agnostic: it deduces whether each concept
  exists whatever library implements it (LangGraph, LlamaIndex, CrewAI, OpenAI
  Agents SDK, Pydantic AI, Agent Framework, Semantic Kernel, custom loops, any
  language). Use when someone asks to audit, review, score, or assess agent
  governance, safety, or production readiness; asks whether their agent has human
  approval, audit logging, a kill switch, agent identity, evals, or
  ask-don't-guess behaviour; or mentions the Governance House or a governance
  scorecard.
license: MIT
---

# Agent Governance Scorecard

The question this skill answers: *"Between the model suggesting an action and our
system actually doing it, which safeguards exist in this codebase, and what do we
fix first?"* It checks the codebase against the six rooms of the Governance House
(48 checks, each with a stable ID) and writes a scorecard the team can act on.

It is **read-only**. Don't run the agent, call external services, install
packages, or edit project code during an assessment. Never copy a secret value
into the report.

## Files in this skill

| Path | Use |
|---|---|
| `references/rooms/01-identity.md` … `06-shutdown.md` | The checks for each room: what good looks like, the verify test, the evidence to look for, what doesn't count, and the typical fix. **Read each room file before assessing that room.** |
| `references/assessment-method.md` | Status rules, evidence standards, and how to write fixes. **Read it once before you start.** |
| `references/report-format.md` | The report JSON you write, field by field. |
| `references/catalog.json` | Machine-readable catalogue used by the scripts. You don't need to read it. |
| `scripts/scorecard.mjs` | A zero-dependency Node ≥18 helper with the commands `discover`, `template`, `validate`, and `render`. |

Run the script from the project root with
`node <this-skill-dir>/scripts/scorecard.mjs …`. If the package is installed,
`npx agent-governance-scorecard …` also works. Outputs go to
`.governance-scorecard/` in the project.

## Workflow

### 1. Index the codebase

```bash
node <skill>/scripts/scorecard.mjs discover .
node <skill>/scripts/scorecard.mjs template .
```

`discover` prints a summary and writes `.governance-scorecard/discovery.json`,
which contains:
- the languages and frameworks detected, with manifests, tests, and CI files;
- the tool definitions it found;
- leads for consequential actions;
- each room's concept hits, ranked by file.

These are **leads to read, not verdicts**. Keyword matches miss renamed concepts
and find false positives. Use your own search tools as well.

`template` writes `.governance-scorecard/report.json`, with the profile questions
and all 48 checks waiting to be filled in.

If the project root holds several agents or services, ask which one to assess, or
assess the most consequential one and say so in `notes`.

### 2. Map the agent before judging it

Read enough code to write down:
- **What the agent does.** This goes in `project.summary`.
- **Agents and entry points.** Where the loop or graph starts and how it's deployed.
- **Tools.** Each one classified as read-only, internal write, or **consequential**:
  moves money, deletes or changes data, sends external communication, changes
  access, or runs code.
- **The path from model output to side effect.** Which functions actually perform
  the consequential action, and whether anything sits between the model's tool
  call and that function.

Record each consequential action in `consequentialActions`.

### 3. Decide what applies

Not every room applies to every agent. A bot that only answers questions has no
use for approval tokens or a kill switch, and it shouldn't lose points for lacking
them. Answer the 5 traits in `profile.traits` from the map:

| Trait | True when |
|---|---|
| `acts` | It writes, sends or changes anything outside its own run |
| `consequential` | An action is hard to undo or affects people outside the team |
| `unreviewed_consequential` | A consequential action takes effect before a person approves it |
| `model_decides` | Model output picks a target, amount, category, priority or route that is acted on or stored |
| `ambiguous_targets` | It works out who or what to act on from free text or fuzzy matching |

Each answer needs a `reason`. A `true` answer also needs evidence; a `false`
answer says what you searched for and didn't find. When unsure, answer `true`:
a wrong `false` hides real gaps. The full definitions are in
`references/assessment-method.md`. Then run:

```bash
node <skill>/scripts/scorecard.mjs scope .governance-scorecard/report.json
```

`scope` checks the answers are consistent, then trims `checks` to the ones that
apply and prints what it skipped and why. Assess only what's left. The report shows
the profile, so anyone can challenge an answer.

### 4. Assess each room

Go through the rooms in order: Identity, Reliability, Permission, Uncertainty,
Ledger, Shutdown. For each one:

1. Read `references/rooms/<nn>-<room>.md`.
2. For every check, look for the concept, not a particular library. The same
   control can be a LangGraph `interrupt()`, a decorator, a middleware, a DB
   constraint, or a check in the receiving API.
3. Set a status (`present`, `partial`, `missing`, `unknown`) following
   `references/assessment-method.md`. Use `not_applicable` only for a rare case the
   profile can't express, with a reason.
4. Fill in the remaining fields:
   - **evidence:** `path` + `line` + a short note for each piece;
   - **finding:** one or two sentences in this codebase's terms;
   - **fix** (for `missing` or `partial`): `summary`, concrete `steps`, and the
     `files` to change. Name the real functions and files, adapt the room file's
     typical fix to this stack, and keep it framework-native;
   - **severity** (for `missing` or `partial`): `critical`, `high`, `medium`, or
     `low`, for *this* agent. `critical` means a consequential action can go wrong
     today, for example a refund that runs even after a reviewer says no.

Fill in `report.json` room by room so progress survives an interruption.

### 5. Validate and render

```bash
node <skill>/scripts/scorecard.mjs validate .governance-scorecard/report.json
node <skill>/scripts/scorecard.mjs render   .governance-scorecard/report.json
```

`validate` names every missing field and every check that applies but hasn't been
assessed. Fix them and run
it again. `render` writes the following to `.governance-scorecard/`:
- `scorecard.html`: a self-contained report with a score per room, a "fix these
  first" list, questions for the team, evidence, and fixes;
- `scorecard.json`: the report plus scores and the fix order, for CI or tracking.

Useful options:
- `--link-base https://github.com/org/repo/blob/<sha>` turns evidence into links.
- `--fail-under 60` exits non-zero when the overall score is below 60, for CI.

### 6. Report back in chat

Keep the chat summary short and plain (the writing rules in
`references/assessment-method.md` apply here too), and send people to the HTML
file for detail. Include:
- the overall score and band, plus a one-line score for each room;
- the **top five fixes** from `fixFirst`, each with one line on why it matters for
  *this* agent (for example, "`issue_refund` can execute without any approval");
- the open questions for the team, if any;
- the paths to `scorecard.html` and `scorecard.json`.

Suggest adding `.governance-scorecard/discovery.json` and `report.json` to
`.gitignore`. Committing `scorecard.json` lets the team track the score over time.

## Scoring (computed by `render`)

- Only checks that apply to this agent are scored. `present` = 1 point,
  `partial` = ½, `missing` and `unknown` = 0.
- Each room's three **priority checks** (★) count double.
- Bands: ≥ 85 well governed · ≥ 60 partly governed · ≥ 30 thinly governed ·
  below 30 largely ungoverned.
- The fix order is: severity first, then priority checks, then `missing` before
  `partial`, then adoption order (Identity → Ledger → Shutdown → Permission →
  Uncertainty → Reliability). If you leave severity out, priority checks count as
  `high` and the rest as `medium`. Severity changes the order, not the score.

The scorecard is a static assessment of evidence in the code. It isn't a runtime
test or a compliance certification. Say so whenever the score might be read as a
guarantee.
