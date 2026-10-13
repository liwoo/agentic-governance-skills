import { useEffect, useRef, useState } from "react";
import SafeguardConnections from "./SafeguardConnections.jsx";
import InfoTip from "./InfoTip.jsx";

export default function WallReader({ room, kind, completed, onToggle, onClose, onRoom }) {
  const heading = useRef();
  const scroll = useRef();
  const [showAll, setShowAll] = useState(false);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, []);
  const isRisk = kind === "risks";
  const checks = showAll ? room.checks : room.priorityChecks.map((id) => room.checks.find((item) => item.id === id));
  const verified = checks.filter((item) => completed.includes(item.id)).length;
  return <section className={`wall-reader wall-reader-${kind}`} aria-labelledby="wall-reader-title" onKeyDown={(event) => { if (event.key === "Escape") onClose(); }}>
    <div className="wall-reader-heading"><div><p>{room.short} / {isRisk ? "Risk whiteboard" : "Engineering checklist"}</p><div className="wall-title-row"><h2 ref={heading} tabIndex={-1} id="wall-reader-title">{isRisk ? "Risks & limits" : showAll ? "All eight actions" : "Three priorities"}</h2><InfoTip label={isRisk ? "About these risks" : "About this checklist"}>{isRisk ? <p>These cards show failures the safeguard addresses. The highlighted card shows a risk that remains even when it works.</p> : <><p>Start with these three high-impact actions. More opens all eight implementation tasks; these priorities alone are not the complete safeguard.</p><p>Use each info icon for implementation guidance and an acceptance test. Mark a task verified only after that test passes. Choose thresholds for your system’s risk and operating context.</p><p>Progress is saved in this browser. This is a self-verified implementation checklist, not a compliance score.</p></>}</InfoTip></div></div><button type="button" onClick={onClose} aria-label="Return to room">×</button></div>
    <div ref={scroll} className="wall-reader-scroll" tabIndex={0} aria-label={isRisk ? "Room risks" : "Room checklist"}>
      {isRisk ? <>
        <ol className="wall-risks">{room.risks.map((risk, index) => <li key={risk}><span>{String(index + 1).padStart(2, "0")}</span><p>{risk}</p></li>)}</ol>
        <SafeguardConnections room={room} onRoom={onRoom} />
      </> : <>
        <div className="wall-progress"><span aria-live="polite">{verified} of {checks.length} {showAll ? "actions" : "priorities"} verified</span><progress value={verified} max={checks.length} aria-label="Checklist completion" /></div>
        <div className="wall-checks" id="engineering-checklist">{checks.map((item, index) => {
          const checkId = `${room.id}-${item.id}`;
          return <article key={item.id} className={`engineering-check ${completed.includes(item.id) ? "is-done" : ""}`}>
            <label htmlFor={checkId}><input id={checkId} aria-label={item.title} type="checkbox" checked={completed.includes(item.id)} onChange={() => onToggle(item.id)} /><span><small>{String(index + 1).padStart(2, "0")}</small>{item.title}</span></label>
            <InfoTip label={item.title}><h4>Implement</h4><p>{item.action}</p><h4>Acceptance test</h4><p>{item.verify}</p></InfoTip>
          </article>;
        })}</div>
      </>}
    </div>
    <div className="wall-reader-footer">{isRisk ? <span /> : <button className="checklist-more" type="button" aria-expanded={showAll} aria-controls="engineering-checklist" onClick={() => { setShowAll(!showAll); scroll.current?.scrollTo(0, 0); }}>{showAll ? "Back to top 3" : "More · all 8 actions"}<span aria-hidden="true">{showAll ? " ↑" : " +"}</span></button>}<button type="button" onClick={onClose}>Back to the room <span aria-hidden="true">↗</span></button></div>
  </section>;
}
