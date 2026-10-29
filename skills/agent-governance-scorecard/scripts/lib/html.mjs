// Render a scored report as one self-contained HTML file (no external assets, no scripts).
// Laid out like a building survey: one column of findings, condition in the margin.
// Colour only ever encodes a check's condition.

import { checkIndex, loadCatalog } from "./catalog.mjs";
import { severityOf } from "./report.mjs";

const STATUS_WORD = {
  missing: "Missing",
  partial: "Partial",
  present: "Present",
  unknown: "Unknown",
  not_applicable: "Not relevant",
  not_relevant: "Not relevant",
};
// Checks ruled out by the profile and checks the assessor marked not applicable read the same way.
const STATUS_ORDER = ["missing", "partial", "present", "unknown", "not_applicable"];
const cellClass = (status) => (status === "not_relevant" ? "not_applicable" : status);
const FIX_LIMIT = 10;
const GROUPS = [
  { severity: "critical", title: "Fix now", note: "These gaps let a consequential action go wrong today." },
  { severity: "high", title: "Fix next", note: "Missing boundaries that make those failures likely, or impossible to detect." },
  { severity: "medium", title: "Then", note: "" },
  { severity: "low", title: "Later", note: "Hardening and drills that need the fixes above first." },
];

const esc = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
// Escaped text with `inline code` support, the only markup assessors may use.
const rich = (value) => esc(value).replace(/`([^`]+)`/g, "<code>$1</code>");
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function location(item, linkBase) {
  const label = `${item.path}${item.line ? `:${item.line}` : ""}`;
  if (!linkBase) return `<code>${esc(label)}</code>`;
  const href = `${linkBase.replace(/\/$/, "")}/${item.path.split("/").map(encodeURIComponent).join("/")}${item.line ? `#L${item.line}` : ""}`;
  return `<a href="${esc(href)}"><code>${esc(label)}</code></a>`;
}

function evidenceList(evidence = [], linkBase) {
  if (!evidence.length) return "";
  return `<ul class="evidence">${evidence
    .map((e) => `<li>${location(e, linkBase)}${e.note ? `<span>${rich(e.note)}</span>` : ""}</li>`)
    .join("")}</ul>`;
}

function fixBlock(fix) {
  if (!fix?.summary) return "";
  const steps = fix.steps?.length ? `<ol>${fix.steps.map((s) => `<li>${rich(s)}</li>`).join("")}</ol>` : "";
  const files = fix.files?.length ? `<p class="files">Files: ${fix.files.map((f) => `<code>${esc(f)}</code>`).join(", ")}</p>` : "";
  return `<div class="fix"><p><b>Fix.</b> ${rich(fix.summary)}</p>${steps}${files}</div>`;
}

// The first sentence of a finding. Findings are written consequence-first, so this is the harm.
function firstSentence(text) {
  const match = String(text ?? "").match(/^.*?[.!?](?=\s+[A-Z`"(]|$)/s);
  return (match ? match[0] : String(text ?? "")).trim();
}

function verdict(report, scored, index) {
  const byId = new Map(report.checks.map((c) => [c.id, c]));
  const severities = scored.fixOrder.map((id) => severityOf(byId.get(id), index.get(id).check));
  const critical = severities.filter((s) => s === "critical").length;
  const high = severities.filter((s) => s === "high").length;
  const first = scored.fixOrder.length ? rich(firstSentence(byId.get(scored.fixOrder[0]).finding)) : "";
  if (critical) return `${plural(critical, "critical gap")}. The first to fix: ${first}`;
  if (high) return `No critical gaps, ${plural(high, "high-severity gap")}. The first to fix: ${first}`;
  if (scored.fixOrder.length) return `No critical or high-severity gaps. ${plural(scored.fixOrder.length, "smaller fix", "smaller fixes")} remain.`;
  return "Every applicable check has evidence in the code.";
}

function tally(counts) {
  const merged = { ...counts, not_applicable: (counts.not_applicable ?? 0) + (counts.not_relevant ?? 0) };
  return STATUS_ORDER.filter((s) => merged[s])
    .map((s) => `${merged[s]} ${STATUS_WORD[s].toLowerCase()}`)
    .join(", ");
}

// "it only returns text…" for the traits that ruled something out.
function whyNot(because, catalog) {
  return because.map((id) => catalog.traits.find((t) => t.id === id).whenFalse).join(", and ");
}

function profileBlock(report, catalog, linkBase) {
  const traits = report.profile?.traits ?? {};
  const rows = catalog.traits
    .map((t) => {
      const a = traits[t.id] ?? {};
      const where = a.evidence?.[0] ? ` ${location(a.evidence[0], linkBase)}` : "";
      return `<tr><th scope="row">${esc(t.label)}</th><td class="answer ${a.value ? "yes" : "no"}">${a.value ? "Yes" : "No"}</td><td>${rich(a.reason)}${where}</td></tr>`;
    })
    .join("");
  return `<table class="profile"><tbody>${rows}</tbody></table>`;
}

export function renderHtml(report, scored, { linkBase } = {}) {
  const catalog = loadCatalog();
  const index = checkIndex(catalog);
  const notRelevant = new Map(scored.notRelevant.map((x) => [x.id, x.because]));
  const byId = new Map(report.checks.filter((c) => !notRelevant.has(c.id)).map((c) => [c.id, c]));
  const statusOf = (id) => (notRelevant.has(id) ? "not_relevant" : byId.get(id).status);
  const roomScore = new Map(scored.rooms.map((r) => [r.id, r]));
  const roomById = new Map(catalog.rooms.map((r) => [r.id, r]));
  const project = report.project;
  const assessed = report.assessedAt ? new Date(report.assessedAt) : new Date();
  const date = assessed.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  const skipped = scored.notRelevant.length + (scored.overall.counts.not_applicable ?? 0);

  const meta = [date, project.commit ? `commit <code>${esc(String(project.commit).slice(0, 12))}</code>` : "", report.assessor ? esc(report.assessor) : ""]
    .filter(Boolean)
    .join(" · ");

  // The house at a glance: one square per check, rooms in story order, checks in catalogue order.
  const grid = catalog.rooms
    .map((room) => {
      const s = roomScore.get(room.id);
      const cells = room.checks
        .map((check) => {
          const status = statusOf(check.id);
          const label = `${check.title}: ${STATUS_WORD[status].toLowerCase()}`;
          return `<a class="cell c-${cellClass(status)}" href="#${esc(check.id)}" title="${esc(label)}"><span class="sr">${esc(label)}</span></a>`;
        })
        .join("");
      return `<div class="grid-row">
        <a class="grid-room" href="#${room.id}"><b>${esc(room.short)}</b><span>${esc(room.title)}</span></a>
        <div class="cells">${cells}</div>
        <span class="grid-score">${s.score ?? "–"}</span>
        <span class="grid-tally">${s.applies ? tally(s.counts) : "Not relevant to this agent"}</span>
      </div>`;
    })
    .join("");

  const legend = STATUS_ORDER.map((s) => `<span><i class="cell c-${s}" aria-hidden="true"></i>${STATUS_WORD[s]}</span>`).join("");

  const actionRows = (report.consequentialActions ?? [])
    .map(
      (a) => `<tr><th scope="row"><code>${esc(a.name)}</code></th><td class="effect">${esc(a.effect ?? "")}</td><td>${a.location ? `<code>${esc(a.location)}</code>` : ""}</td><td>${rich(a.note ?? "")}</td></tr>`,
    )
    .join("");
  const actions = `<section class="block">
      <h2>What the agent can do</h2>
      <p class="note">These answers decide which checks apply. A check this agent has no use for is left out of the score.</p>
      ${profileBlock(report, catalog, linkBase)}
      ${actionRows ? `<h3 class="sub">Actions with real-world effects</h3><table class="actions"><tbody>${actionRows}</tbody></table>` : ""}
    </section>`;

  // Fix list: the first FIX_LIMIT gaps in fix order, grouped by severity.
  const shown = scored.fixOrder.slice(0, FIX_LIMIT);
  const fixNumber = new Map();
  let n = 0;
  const fixGroups = GROUPS.map((group) => {
    const ids = shown.filter((id) => severityOf(byId.get(id), index.get(id).check) === group.severity);
    if (!ids.length) return "";
    const items = ids
      .map((id) => {
        n += 1;
        fixNumber.set(id, n);
        const entry = byId.get(id);
        const { check, room } = index.get(id);
        return `<li class="fix-item" id="fix-${n}">
          <span class="n">${n}</span>
          <div>
            <p class="lead">${rich(entry.finding)}</p>
            <p class="ref"><a href="#${esc(id)}">${esc(room.short)} · ${esc(check.title)}</a> <span class="status-word t-${entry.status}">${STATUS_WORD[entry.status]}</span></p>
            ${evidenceList(entry.evidence, linkBase)}
            ${fixBlock(entry.fix)}
          </div>
        </li>`;
      })
      .join("");
    return `<div class="fix-group"><h3>${group.title}</h3>${group.note ? `<p class="note">${group.note}</p>` : ""}<ol class="fixes">${items}</ol></div>`;
  }).join("");
  const remaining = scored.fixOrder.length - shown.length;

  const questions = scored.questions.length
    ? `<section class="block">
        <h2>Questions for the team</h2>
        <p class="note">The code can't answer these. Each answer either earns credit or becomes a fix.</p>
        <ul class="questions">${scored.questions
          .map((id) => {
            const { check, room } = index.get(id);
            return `<li><p>${rich(byId.get(id).question)}</p><p class="ref"><a href="#${esc(id)}">${esc(room.short)} · ${esc(check.title)}</a></p></li>`;
          })
          .join("")}</ul>
      </section>`
    : "";

  const rooms = catalog.rooms
    .map((room) => {
      const s = roomScore.get(room.id);
      const head = `<header class="room-head">
          <h2>${esc(room.short)}</h2>
          <p class="room-sub">${esc(room.title)}. ${esc(room.question)}</p>
          <p class="room-score">${s.applies ? `<b>${s.score ?? "–"}</b> / 100` : "<b>–</b>"}</p>
        </header>`;
      if (!s.applies) {
        return `<section class="room is-skipped" id="${room.id}">${head}
          <p class="skip-note"><b>Not relevant to this agent:</b> ${esc(whyNot(s.because, catalog))}. If that changes, these ${room.checks.length} checks start to apply.</p>
        </section>`;
      }
      // Checks the profile rules out, grouped by the reason.
      const ruledOut = new Map();
      for (const check of room.checks) {
        if (!notRelevant.has(check.id)) continue;
        const why = whyNot(notRelevant.get(check.id), catalog);
        ruledOut.set(why, [...(ruledOut.get(why) ?? []), check]);
      }
      const skipNotes = [...ruledOut]
        .map(([why, checks]) => `<p class="skip-note"><b>Not relevant here</b> because ${esc(why)}: ${checks.map((c) => `<span id="${esc(c.id)}">${esc(c.title)}</span>`).join(", ")}.</p>`)
        .join("");
      const rows = room.checks
        .filter((check) => !notRelevant.has(check.id))
        .map((check) => {
          const entry = byId.get(check.id);
          const severity = ["missing", "partial"].includes(entry.status) ? severityOf(entry, check) : null;
          const body = [];
          if (entry.status === "not_applicable") body.push(`<p class="finding">${rich(entry.reason)}</p>`);
          else if (entry.finding) body.push(`<p class="finding">${rich(entry.finding)}</p>`);
          if (entry.status === "unknown") body.push(`<p class="ask"><b>Question.</b> ${rich(entry.question)}</p>`);
          if (fixNumber.has(check.id)) {
            const k = fixNumber.get(check.id);
            body.push(`<p class="fix-ref">Evidence and fix: <a href="#fix-${k}">item ${k} in What to fix first</a>.</p>`);
          } else {
            body.push(evidenceList(entry.evidence, linkBase));
            body.push(fixBlock(entry.fix));
          }
          return `<article class="check" id="${esc(check.id)}">
            <div class="stamp t-${entry.status}"><b>${STATUS_WORD[entry.status]}</b>${severity && severity !== "medium" ? `<span>${severity}</span>` : ""}</div>
            <div class="check-body">
              <h4>${esc(check.title)} <code class="id">${esc(check.id)}${check.priority ? " ×2" : ""}</code>${entry.confidence === "low" ? ' <span class="unsure">low confidence</span>' : ""}</h4>
              ${body.join("")}
              <details><summary>What passing looks like</summary><p>${esc(check.action)}</p><p><b>Test:</b> ${esc(check.verify)}</p></details>
            </div>
          </article>`;
        })
        .join("");
      const companions = room.limitation.companions.map((c) => roomById.get(c.roomId).short).join(", ");
      return `<section class="room" id="${room.id}">
        ${head}
        ${rows}
        ${skipNotes}
        <p class="limit"><b>Even when every check passes:</b> ${esc(room.limitation.title.replace(/\.$/, ""))}. Pair it with ${esc(companions)}.</p>
      </section>`;
    })
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="agent-governance-scorecard · catalogue ${esc(scored.catalogVersion)}">
<title>${esc(project.name)}: governance scorecard</title>
<style>${CSS}</style>
</head>
<body>
<main>
  <header class="cover">
    <p class="masthead"><span>Governance scorecard</span><span>${meta}</span></p>
    <h1>${esc(project.name)}</h1>
    <p class="summary">${rich(project.summary)}</p>
    ${project.frameworks?.length ? `<p class="stack">${project.frameworks.map(esc).join(" · ")}</p>` : ""}
  </header>

  <section class="verdict">
    <p class="headline">${verdict(report, scored, index)}</p>
    <p class="subline">Score ${scored.overall.score ?? "–"} out of 100 (${esc(scored.overall.band.label.toLowerCase())}) across the ${scored.overall.applicable} checks that apply to this agent: ${tally({ ...scored.overall.counts, not_applicable: 0, not_relevant: 0 })}.${skipped ? ` ${plural(skipped, "check doesn’t", "checks don’t")} apply and ${skipped === 1 ? "isn’t" : "aren’t"} scored.` : ""}</p>
  </section>

  <section class="block house" aria-label="Condition of each room">
    <div class="grid">${grid}</div>
    <p class="legend">${legend}</p>
  </section>

  ${actions}

  <section class="block">
    <h2>What to fix first</h2>
    ${fixGroups || '<p class="note">Nothing is missing or partial. Run each room’s tests in staging to keep it that way.</p>'}
    ${remaining > 0 ? `<p class="note">${plural(remaining, "more fix", "more fixes")} in the room-by-room list below.</p>` : ""}
  </section>

  ${questions}

  ${rooms}

  <footer>
    ${(report.notes ?? []).length ? `<h3>Assessor’s notes</h3><ul>${report.notes.map((x) => `<li>${rich(x)}</li>`).join("")}</ul>` : ""}
    <h3>How this was scored</h3>
    <p>The assessor read the code, tests and config and recorded what they could find. Nothing was run. The profile at the top decides which checks apply; the rest are left out of the score. Present scores 1, partial ½, missing and unknown 0. Checks marked ×2 count double. Severity sets the fix order and doesn’t change the score.</p>
    <p>${esc(catalog.scope)}</p>
    <p class="colophon">agent-governance-scorecard · catalogue ${esc(scored.catalogVersion)}</p>
  </footer>
</main>
</body>
</html>
`;
}

const CSS = `
:root{
  --paper:#ffffff; --ink:#1e2328; --graphite:#5c636b; --rule:#d9dcd8; --wash:#f4f5f3;
  --missing:#b4372b; --missing-t:#f7e1dd;
  --partial:#a2670f; --partial-t:#f5e9d2;
  --present:#2f7550; --present-t:#dcede2;
  --unknown:#4d5e8c; --unknown-t:#e2e6f1;
  --na:#7d848b; --na-t:#eceeee;
  --label:"DIN Alternate","DIN Next","Bahnschrift","Barlow","Arial Narrow",sans-serif;
  --display:"DIN Condensed","Bahnschrift Condensed","Bahnschrift","Arial Narrow",sans-serif;
  --text:Charter,"Bitstream Charter","Iowan Old Style","Sitka Text",Cambria,Georgia,serif;
  --mono:ui-monospace,"SF Mono",Menlo,Consolas,monospace;
  color-scheme:light;
}
*{box-sizing:border-box}
html{background:var(--paper)}
body{margin:0;color:var(--ink);font:17px/1.55 var(--text);-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
main{max-width:940px;margin:0 auto;padding:56px 32px 96px}
a{color:inherit;text-decoration-color:var(--rule);text-underline-offset:3px}
a:hover{text-decoration-color:currentColor}
a:focus-visible,summary:focus-visible{outline:2px solid var(--ink);outline-offset:2px}
code{font:.82em/1.4 var(--mono);color:var(--ink)}
h1,h2,h3,h4{margin:0;font-weight:400}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}

.masthead{display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;margin:0 0 28px;padding-bottom:10px;border-bottom:2px solid var(--ink);font:14px/1.3 var(--label);color:var(--graphite)}
.masthead span:first-child{color:var(--ink)}
.masthead code{font-size:13px;color:var(--graphite)}
h1{font:clamp(44px,7vw,72px)/.95 var(--display);letter-spacing:-.01em}
.summary{max-width:62ch;margin:14px 0 0;color:var(--graphite)}
.summary code{color:var(--graphite)}
.stack{margin:10px 0 0;font:14px var(--label);color:var(--graphite)}

.verdict{margin:48px 0 0}
.headline{max-width:34ch;margin:0;font:clamp(26px,3.6vw,36px)/1.2 var(--text);letter-spacing:-.01em}
.headline code{font-size:.78em}
.subline{margin:12px 0 0;color:var(--graphite)}

.block{margin-top:56px}
.block>h2,.room-head h2{font:30px/1 var(--display);letter-spacing:.01em}
.block>h2{margin-bottom:18px}
.note{margin:4px 0 16px;color:var(--graphite);font-size:15px}

.grid{display:grid;gap:6px;margin-top:28px}
.grid-row{display:grid;grid-template-columns:210px auto 44px 1fr;align-items:center;gap:16px}
.grid-room{display:flex;flex-direction:column;text-decoration:none;line-height:1.15}
.grid-room b{font:19px var(--label);font-weight:400}
.grid-room span{font-size:13px;color:var(--graphite)}
.cells{display:grid;grid-template-columns:repeat(8,30px);gap:4px}
.cell{display:block;width:30px;height:30px;border-radius:2px;border:1px solid transparent}
a.cell:hover{outline:2px solid var(--ink);outline-offset:1px}
.c-missing{background:var(--paper);border:2px solid var(--missing)}
.c-partial{background:repeating-linear-gradient(135deg,var(--partial) 0 4px,var(--partial-t) 4px 8px);border-color:var(--partial)}
.c-present{background:var(--present)}
.c-unknown{background:var(--unknown-t);border:1px dashed var(--unknown)}
.c-not_applicable{background:var(--na-t)}
.grid-score{font:24px var(--display);text-align:right}
.grid-tally{font-size:13px;color:var(--graphite)}
.legend{display:flex;flex-wrap:wrap;gap:6px 18px;margin:18px 0 0;font:13px var(--label);color:var(--graphite)}
.legend span{display:inline-flex;align-items:center;gap:7px}
.legend .cell{width:14px;height:14px}

.actions{width:100%;border-collapse:collapse;font-size:15px}
.actions th,.actions td{padding:10px 14px 10px 0;border-top:1px solid var(--rule);text-align:left;vertical-align:baseline}
.actions tr:last-child th,.actions tr:last-child td{border-bottom:1px solid var(--rule)}
.actions th{font-weight:400;white-space:nowrap}
.actions .effect{font:14px var(--label);color:var(--graphite)}
.profile{width:100%;border-collapse:collapse;font-size:15px;margin-bottom:8px}
.profile th,.profile td{padding:9px 14px 9px 0;border-top:1px solid var(--rule);text-align:left;vertical-align:baseline}
.profile tr:last-child th,.profile tr:last-child td{border-bottom:1px solid var(--rule)}
.profile th{font:15px var(--label);font-weight:400;white-space:nowrap;width:1%}
.profile .answer{font:15px var(--label);width:1%;white-space:nowrap}
.profile .yes{color:var(--ink)}.profile .no{color:var(--graphite)}
.profile code{color:var(--graphite)}
.sub{font:18px var(--label);margin:28px 0 8px}
.skip-note{margin:14px 0 0;font-size:15px;color:var(--graphite)}
.room.is-skipped .room-head{border-bottom-color:var(--rule)}
.room.is-skipped .room-head h2,.room.is-skipped .room-score b{color:var(--graphite)}

.fix-group{margin-top:28px}
.fix-group h3{font:20px var(--label);padding-bottom:6px;border-bottom:1px solid var(--ink)}
.fix-group .note{margin-top:8px}
.fixes{list-style:none;margin:0;padding:0}
.fix-item{display:grid;grid-template-columns:44px 1fr;gap:0 8px;padding:18px 0;border-bottom:1px solid var(--rule)}
.n{font:28px/1 var(--display);color:var(--graphite)}
.lead{margin:0;font-size:18px}
.ref{margin:6px 0 0;font:14px var(--label);color:var(--graphite)}
.ref a{text-decoration:none}.ref a:hover{text-decoration:underline}
.status-word{margin-left:8px}
.t-missing{color:var(--missing)}.t-partial{color:var(--partial)}.t-present{color:var(--present)}.t-unknown{color:var(--unknown)}.t-not_applicable{color:var(--na)}

.evidence{list-style:none;margin:10px 0 0;padding:0;font-size:15px}
.evidence li{display:flex;flex-wrap:wrap;gap:2px 12px;padding:2px 0}
.evidence code{color:var(--ink)}
.evidence span{color:var(--graphite)}
.fix{margin-top:12px;padding:12px 16px;background:var(--wash);font-size:15.5px}
.fix p{margin:0}
.fix ol{margin:8px 0 0;padding-left:22px}
.fix li{margin:3px 0}
.fix .files{margin-top:8px;color:var(--graphite);font-size:14px}

.questions{list-style:none;margin:0;padding:0}
.questions li{padding:14px 0;border-top:1px solid var(--rule)}
.questions li:last-child{border-bottom:1px solid var(--rule)}
.questions p{margin:0}

.room{margin-top:72px}
.room-head{display:grid;grid-template-columns:1fr auto;align-items:end;gap:4px 24px;padding-bottom:10px;border-bottom:2px solid var(--ink)}
.room-sub{grid-column:1;margin:0;color:var(--graphite);font-size:15px}
.room-score{grid-column:2;grid-row:1/3;margin:0;font:15px var(--label);color:var(--graphite)}
.room-score b{font:40px/1 var(--display);color:var(--ink);font-weight:400}

.check{display:grid;grid-template-columns:96px 1fr;gap:0 20px;padding:18px 0;border-bottom:1px solid var(--rule)}
.stamp{align-self:start;display:flex;flex-direction:column;gap:2px;padding:5px 8px;border:1.5px solid currentColor;font:14px/1.1 var(--label);text-transform:uppercase;letter-spacing:.04em}
.stamp b{font-weight:400}
.stamp span{font-size:11.5px;letter-spacing:.06em;opacity:.85}
.stamp.t-missing{background:var(--missing-t)}.stamp.t-partial{background:var(--partial-t)}.stamp.t-present{background:var(--present-t)}.stamp.t-unknown{background:var(--unknown-t);border-style:dashed}.stamp.t-not_applicable{background:var(--na-t)}
.check h4{font-size:18px;line-height:1.35}
.check .id{margin-left:6px;font-size:12px;color:var(--graphite);white-space:nowrap}
.unsure{font:13px var(--label);color:var(--partial)}
.finding{margin:6px 0 0}
.ask{margin:8px 0 0;color:var(--unknown)}
details{margin-top:10px;font-size:14.5px;color:var(--graphite)}
summary{cursor:pointer;font:14px var(--label);width:max-content}
details p{margin:6px 0 0;max-width:70ch}
.fix-ref{margin:8px 0 0;font:14px var(--label);color:var(--graphite)}
.limit{margin:16px 0 0;font-size:15px;color:var(--graphite)}

footer{margin-top:88px;padding-top:14px;border-top:2px solid var(--ink);font-size:14.5px;color:var(--graphite)}
footer h3{margin:18px 0 6px;font:16px var(--label);color:var(--ink)}
footer p,footer ul{max-width:72ch;margin:0 0 10px}
footer ul{padding-left:20px}
.colophon{font:13px var(--label)}

@media (max-width:760px){
  main{padding:32px 18px 64px}
  .grid-row{grid-template-columns:1fr auto;gap:6px 12px;padding:8px 0;border-top:1px solid var(--rule)}
  .cells{grid-column:1/-1;grid-row:2;grid-template-columns:repeat(8,1fr)}
  .cell{width:auto;aspect-ratio:1}
  .legend .cell{width:14px}
  .grid-tally{grid-column:1/-1}
  .check{grid-template-columns:1fr}
  .stamp{flex-direction:row;gap:10px;width:max-content;margin-bottom:8px}
  .actions,.actions tbody,.actions tr,.actions th,.actions td{display:block}
  .actions tr{padding:10px 0;border-top:1px solid var(--rule)}
  .actions th,.actions td{padding:2px 0;border:0}
  .actions tr:last-child th,.actions tr:last-child td{border:0}
  .actions tr:last-child{border-bottom:1px solid var(--rule)}
  .masthead span:last-child{font-size:13px}
  code{overflow-wrap:anywhere}
}
@media print{
  body{font-size:11pt}
  main{max-width:none;padding:0}
  .check,.fix-item,.grid-row{break-inside:avoid}
  .room{break-before:page}
  a{text-decoration:none}
}
`;
