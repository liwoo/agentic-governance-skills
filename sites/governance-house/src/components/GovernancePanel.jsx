import { CompanionCards } from "./SafeguardConnections.jsx";
import InfoTip from "./InfoTip.jsx";
import { governancePrinciples, governanceSources, roomGovernance, widerGovernance, GOVERNANCE_REVIEWED, GOVERNANCE_SCOPE } from "../data/governance.js";

export function PrincipleChips({ roomId, onOpen }) {
  return <div className="principle-chips" aria-label="Core governance principles supported">
    {roomGovernance[roomId].mappings.map(({ principle }) => <button key={principle} type="button" onClick={() => onOpen(principle)}>{governancePrinciples[principle].name}<span aria-hidden="true">↗</span></button>)}
  </div>;
}

function SourceLinks({ ids }) {
  return <ul className="governance-sources">{ids.map((id) => {
    const source = governanceSources[id];
    return <li key={id}><a href={source.url} target="_blank" rel="noreferrer" title={source.detail}><span>{source.type}</span>{source.title} <i aria-hidden="true">↗</i></a></li>;
  })}</ul>;
}

export default function GovernancePanel({ room, selectedPrinciple, onRoom }) {
  const mapping = roomGovernance[room.id];
  return <div className="inspector-content governance-panel">
    <h2 id="governance-panel-heading">Core principles</h2>
    <div className="governance-principles">{mapping.mappings.map((item) => {
      const principle = governancePrinciples[item.principle];
      return <article className={`governance-card ${selectedPrinciple === item.principle ? "is-selected" : ""}`} key={item.principle}>
        <h3>{principle.name}</h3>
        <InfoTip label={principle.name} initialOpen={selectedPrinciple === item.principle}><p>{principle.definition}</p><h4>This room’s contribution</h4><p>{item.contribution}</p><h4>Evidence to keep</h4><p>{item.evidence}</p><SourceLinks ids={item.sources} /></InfoTip>
      </article>;
    })}</div>
    <div className="governance-context">
      <div className="governance-info-row"><h3>Remaining work</h3><InfoTip label="Remaining work"><p>{mapping.remaining}</p></InfoTip></div>
      <div className="governance-info-row"><h3>Beyond these rooms</h3><InfoTip label="Beyond these rooms">{widerGovernance.map(({ principle: id, note }) => <div key={id}><h4>{governancePrinciples[id].name}</h4><p>{note}</p><SourceLinks ids={governancePrinciples[id].sources} /></div>)}<p>These mappings are a practical selection, not an exhaustive governance programme. Accessibility, wider human rights, and social and environmental impacts also matter.</p></InfoTip></div>
      <div className="governance-info-row"><h3>Sources & scope</h3><InfoTip label="Sources and mapping scope"><p>{GOVERNANCE_SCOPE}</p><p>EU links use the European Commission’s AI Act Explorer and its consolidated text dated 27 July 2026. Room-to-principle connections are our interpretation of the illustrated controls.</p><p>Sources reviewed {GOVERNANCE_REVIEWED}.</p><SourceLinks ids={["nist", "oecdRights", "oecdTransparency", "oecdSafety", "oecdAccountability"]} /></InfoTip></div>
    </div>
    <section className="governance-companions safeguard-connections" aria-label="Connected safeguards"><h4>Works with</h4><CompanionCards room={room} onRoom={onRoom} /></section>
  </div>;
}
