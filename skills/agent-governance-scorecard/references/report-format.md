# Report format (`.governance-scorecard/report.json`)

`scorecard.mjs template` writes this skeleton. You fill it in, and
`scorecard.mjs validate` enforces the rules below. Markup: only `` `inline code` ``
is rendered. Everything else is escaped.

```jsonc
{
  "schemaVersion": 2,
  "catalogVersion": "…",                 // filled in by `template`
  "assessedAt": "2026-10-29T10:00:00Z",
  "assessor": "Claude Code (claude-opus-5-5)",   // whoever ran the assessment
  "project": {
    "name": "northstar-support-agent",   // required
    "summary": "Customer-support agent that answers order questions and issues refunds via Stripe.", // required
    "languages": ["Python"],
    "frameworks": ["LangGraph", "FastAPI"],
    "commit": "a1b2c3d"                  // optional; `git rev-parse --short HEAD`
  },
  "profile": {                              // required; decides which checks apply (run `scope` after filling it in)
    "traits": {
      "acts":                     { "value": true,  "reason": "Issues Stripe refunds.", "evidence": [{ "path": "app/tools/refunds.py", "line": 18 }] },
      "consequential":            { "value": true,  "reason": "Refunds move money.", "evidence": [{ "path": "app/tools/refunds.py", "line": 18 }] },
      "unreviewed_consequential": { "value": true,  "reason": "The refund executes inside the tool call.", "evidence": [{ "path": "app/tools/refunds.py", "line": 18 }] },
      "model_decides":            { "value": true,  "reason": "The model chooses the amount.", "evidence": [{ "path": "app/tools/refunds.py", "line": 12 }] },
      "ambiguous_targets":        { "value": false, "reason": "Orders are always passed by ID; no lookup by name anywhere in `app/`.", "evidence": [] }
    }
  },
  "agents": [
    { "name": "support-graph", "entrypoint": "app/agent/graph.py:41", "description": "LangGraph StateGraph with 6 tools" }
  ],
  "consequentialActions": [
    { "name": "issue_refund", "effect": "money", "location": "app/tools/refunds.py:18", "note": "Calls `stripe.Refund.create` directly." }
  ],
  "checks": [
    {
      "id": "permission/execution-boundary",     // required; exactly once per catalogue check
      "status": "missing",                       // present | partial | missing | not_applicable | unknown
      "severity": "critical",                    // critical | high | medium | low — for missing/partial; drives fix order
      "confidence": "high",                      // high | medium | low (optional)
      "finding": "`issue_refund` executes as soon as the model calls it; the only guard is a system-prompt sentence asking the model to confirm first.",
      "evidence": [
        { "path": "app/tools/refunds.py", "line": 18, "note": "raw Stripe call inside the tool" },
        { "path": "app/agent/prompts.py", "line": 7, "note": "prompt-only instruction" }
      ],
      "fix": {
        "summary": "Gate `issue_refund` with an approval check inside the tool so the Stripe call cannot run without a verified approval.",
        "steps": [
          "Add `require_approval(scope=\"refund\")` in `app/governance/approval.py` that verifies a signed, argument-bound, single-use token.",
          "Wrap `issue_refund` with it and keep the raw Stripe call private (`_issue_refund_raw`).",
          "Add a LangGraph `interrupt()` before the tool node for UX only.",
          "Test: calling the tool without a token must raise and must not call Stripe."
        ],
        "files": ["app/tools/refunds.py", "app/agent/graph.py"]
      }
    },
    { "id": "permission/review-load", "status": "unknown", "question": "Who reviews refund approvals, and what happens when that queue is overloaded?" },
    { "id": "uncertainty/calibration-and-load", "status": "not_applicable", "reason": "…" }
  ],
  "notes": ["The repo also contains `admin-bot/`; it was not assessed."]
}
```

Only checks that apply to the profile belong in `checks`. Every one of them must be
assessed, and entries for checks that don't apply are ignored with a warning.

## Required fields by status

| Status | finding | evidence | fix.summary | reason | question |
|---|---|---|---|---|---|
| `present` | ✓ | ≥ 1 | | | |
| `partial` | ✓ | ≥ 1 | ✓ (+ steps) | | |
| `missing` | ✓ | optional | ✓ (+ steps) | | |
| `not_applicable` | | | | ✓ | |
| `unknown` | optional | optional | | | ✓ |

Evidence `path`s are relative to the project root, and `line` is 1-based.
`validate` warns when a path doesn't exist.

## `scorecard.json` (written by `render`)

This is the report above plus:
- `scores.notRelevant[]` as `{ id, because }`: checks left out, and the false traits that ruled them out;
- `scores.overall.applicable`: how many checks were scored;
- `scores.overall` with `{ score, band, counts }`;
- `scores.rooms[]`;
- `scores.fixOrder` and `scores.questions`, both ordered lists of check IDs;
- `fixFirst[]` as `{ id, title, status }` in fix order.

Compare `scores.overall.score` across commits to track progress.
