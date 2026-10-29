# Governance skills — plan for teams

Turn the Governance House talk into something a team can install with one command
and run against its own agent codebase to answer: *"Which of the six safeguards do
we actually have, and what do we fix first?"*

## Decisions (2026-10-29)

| Question | Decision |
|---|---|
| Audience | **Public.** Most teams build in *some* Python agent framework, so the skill must stay framework-agnostic: it scans the codebase and deduces whether each *concept* from the talk is present, whatever library implements it. |
| Naming | **Room names** are the vocabulary everywhere: Identity (Passport Checkpoint), Reliability (Proof Bridge), Permission (Single-Use Vault), Uncertainty (Clarification Junction), Ledger (Evidence Press), Shutdown (Emergency Power Room). Guides 07 (data minimization) and 08 (drift) fold into Ledger, Permission, Reliability and Shutdown. |
| Distribution | **Public GitHub repo, installable like any skills.sh skill:** `npx skills add liwoo/agentic-governance-skills`. The repo also ships an npm `bin` so the bundled scripts work as `npx agent-governance-scorecard …`. |
| First skill | **`agent-governance-scorecard`**: a tech-agnostic assessment that checks a codebase against the Governance House's 48 checks and writes a **JSON + HTML scorecard** with concrete fixes that name real files. |

## Product: `agent-governance-scorecard`

```
npx skills add liwoo/agentic-governance-skills          # install into Claude Code / Cursor / Codex / …
> "Run a governance scorecard on this repo"              # the coding agent follows SKILL.md
→ governance-scorecard.json   machine-readable, for CI and tracking over time
→ governance-scorecard.html   self-contained report: score per room, "fix first" list, evidence, fixes
```

### How it works

1. **Discover (deterministic, zero dependencies).** `scorecard.mjs discover` walks
   the repo and builds an index of candidate evidence:
   - languages, agent frameworks, dependency manifests, tests and CI files;
   - tool definitions and consequential-action keywords (refund, delete, send…);
   - keyword hits for each room's concepts, with snippets redacted for secrets.

   This only gives the agent somewhere to start reading. It is never the verdict.
2. **Map the agent.** The coding agent finds the entry points, the tools, the
   consequential actions, the external calls, and how the agent is deployed.
3. **Assess.** The agent works through each room's checks. The checks are
   generated from the site's `engineering.js`, plus a hand-written overlay
   (`tools/catalog/signals.mjs`) describing:
   - what evidence looks like in *any* framework;
   - what doesn't count, such as prompt instructions, TODOs, or docs on their own;
   - the general shape of the fix.

   Each check gets a status, evidence (`file:line`), a finding, and a fix written
   in the codebase's own terms. Statuses:

   | Status | Meaning |
   |---|---|
   | `present` | Implemented and backed by evidence |
   | `partial` | Some of it exists |
   | `missing` | Not found |
   | `not_applicable` | Doesn't apply here; a reason is required |
   | `unknown` | Can't be decided from the code |
4. **Validate + render.** `scorecard.mjs validate` checks that all 48 IDs are
   present and that the evidence and fixes are filled in. `scorecard.mjs render`
   then:
   - merges in the catalogue: titles, the room's limitation and companion rooms,
     and the principle mappings (with the "not a certification" caveat);
   - computes the scores, giving each room's three priority checks double weight;
   - orders the "fix first" list by the **severity** the assessor gives each gap
     for *this* agent (`critical` means a consequential action can go wrong today),
     then priority checks, then `missing` before `partial`, then adoption order
     (Identity → Ledger → Shutdown → Permission → Uncertainty → Reliability);
   - writes the HTML and a scored JSON file.

### Single source of truth

`sites/governance-house/src/data/*.js` (what the talk shows)
→ `tools/catalog/build.mjs` (+ `signals.mjs` overlay)
→ `skills/agent-governance-scorecard/references/catalog.json` + `references/rooms/*.md`.

The build fails if any check lacks signals or a signal names an unknown check, so
the site and the skill can't drift apart. Run it with
`npm run build:catalog` after editing the site's data.

### Rules the skill enforces on the assessor

- **No evidence, no credit.** A comment, a TODO, a README promise or a system
  prompt ("be careful with refunds") is at most `partial`, and usually `missing`.
- **Enforcement location matters.** A framework pause/approval hook only counts as
  `present` if the side effect can't happen without it. Otherwise it's `partial`.
- **Checks that need a staging drill or a team process** (`*-drill`, `review-load`,
  …) can't be fully proven statically. They're `present` only if a test or runbook
  in the repo actually exercises them, and `unknown` with a question for the team
  otherwise.
- **Read-only.** The skill doesn't run the agent, make network calls, change
  code, or copy secret values into the report.

## Roadmap

| Phase | Deliverable | Status |
|---|---|---|
| 0 | Catalogue build from the site data + signals overlay | v0 in this branch |
| 1 | `agent-governance-scorecard` skill: discover / validate / render, JSON + HTML | v0 in this branch |
| 2 | Evaluation fixtures. The half-governed `examples/northstar-refunds` agent and its sample scorecard are done. Still to add: a fully governed variant, an expected-results file to diff assessor output against, and skill-creator triggering evals | started |
| 3 | `--fail-under` CI mode + a GitHub Action that posts the scorecard to PRs and tracks scores over time | |
| 4 | Fix skills named after the rooms (`agent-permission`, `agent-ledger`, …) that take a scorecard row and implement the fix. Build them from the 01–08 guides and the Action-Space Constraint skill (Python first) | |
| 5 | Optional deep-dive annexes: data minimization, drift sidecar | |

## Open questions

- Should the HTML report link evidence as `vscode://file/…` URLs, or keep plain
  `path:line` so it reads the same in CI artefacts?
- Should a repo containing several agents get one report per agent (via a
  `--agent` flag) or one combined report?
