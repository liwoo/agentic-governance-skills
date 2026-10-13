import { useEffect, useRef } from "react";
import { rooms } from "../data/rooms.js";
import { usePlayback } from "../usePlayback.js";
import InfoTip from "./InfoTip.jsx";

const beats = ["Frontier models", "Everyday builders", "Governance by design"];
const agents = ["Support agent", "Finance agent", "Operations agent"];
const harms = [
  { title: "Private data exposed", trigger: "A message to the wrong person", detail: "A support agent can send confidential customer information to an unintended recipient. A valid model response does not establish that the recipient may receive that data." },
  { title: "People lose money", trigger: "A payment to the wrong account", detail: "A finance agent can act on mistaken or manipulated payment instructions. The person or organisation may suffer a financial loss before anyone notices or stops the workflow." },
  { title: "Services disrupted", trigger: "Critical records deleted", detail: "An operations agent can delete records that people rely on to access a service. Stopping the agent afterward does not automatically restore those records or remedy the disruption." },
];

function FlowLink({ branches = false }) {
  return <svg className="intro-flow-link" viewBox="0 0 60 240" preserveAspectRatio="none" aria-hidden="true">
    {(branches ? [48, 120, 192] : [120]).map((end, index) => <g key={end} style={{ "--link-delay": `${index * .3}s` }}><path className="flow-track" d={`M 0 120 C 30 120, 30 ${end}, 60 ${end}`} /><path className="flow-signal" d={`M 0 120 C 30 120, 30 ${end}, 60 ${end}`} pathLength="100" /></g>)}
  </svg>;
}

export default function IntroSlide({ onEnter, onRoom }) {
  const playback = usePlayback("introduction", beats.length);
  const heading = useRef();
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
    if (playback.reducedMotion) playback.seek(2);
  }, []);
  const phase = playback.phase;
  return <section className={`intro-slide intro-phase-${phase} ${playback.playing ? "is-playing" : "is-paused"}`} aria-labelledby="intro-title">
    <div className="intro-heading">
      <div><p className="intro-eyebrow">Agentic AI / shared responsibility</p><h1 id="intro-title" ref={heading} tabIndex={-1}>The next agent<br />could be <em>ours.</em></h1><p className="intro-subtitle">Governance must reach beyond frontier labs.</p></div>
      <InfoTip label="The case for governance in development"><p>Regulation needs to keep pace with agentic AI. Oversight of frontier models is one part of the task: developers also choose the tools, data, permissions, and workflows through which those models act.</p><p>As reusable models, APIs, and frameworks make agent building more accessible, harm can also arise from the systems built by teams like ours. This is the argument illustrated here, not a claim that most harm comes from any one group.</p><p>NIST places risk management across design, development, use, and evaluation. OECD’s work on agentic systems examines their adoption and governance within organisations. These six safeguards support that work; they do not replace wider governance or applicable regulation.</p><ul className="governance-sources"><li><a href="https://www.nist.gov/itl/ai-risk-management-framework" target="_blank" rel="noreferrer"><span>Voluntary framework</span>NIST · AI Risk Management Framework ↗</a></li><li><a href="https://www.oecd.org/en/publications/agentic-ai-in-organisations_1257a26f-en.html" target="_blank" rel="noreferrer"><span>Research · 2026</span>OECD · Agentic AI in organisations ↗</a></li></ul></InfoTip>
    </div>

    <div className="intro-illustration" role="group" aria-label="Frontier models power agents built by developers, whose tools can expose private data, lose people’s money, or disrupt services. Add safeguards before those actions.">
      <div className="intro-flow">
        <div className="intro-model intro-node">
          <p className="intro-node-kicker">The model layer</p>
          <div className="intro-model-chip" aria-hidden="true"><span /><span /><span /><span /><i>AI</i><span /><span /><span /><span /></div>
          <h2>Frontier models</h2><p>Available through an API</p>
        </div>
        <FlowLink branches />
        <div className="intro-builders">
          <p className="intro-node-kicker">The application layer</p><h2>Developers like us</h2><p className="intro-toolkit">Models + frameworks + tools</p>
          <div className="intro-agent-list">{agents.map((agent, index) => <div className="intro-agent" key={agent} style={{ "--agent-delay": `${index * .12}s` }}><span className="intro-code" aria-hidden="true">&lt;/&gt;</span><strong>{agent}</strong><span className="intro-agent-light" aria-hidden="true" /></div>)}</div>
        </div>
        <FlowLink />
        <div className="intro-gate" aria-label={phase === 2 ? "Safeguards built into the action path" : "Safeguards needed in the action path"}>
          <svg viewBox="0 0 40 48" aria-hidden="true"><path d="M20 3 36 9v15c0 9-7 16-16 21C11 40 4 33 4 24V9Z" /><path className="intro-shield-mark" d="m12 23 6 6 11-13" /></svg>
          <span>{phase === 2 ? "Controls" : "Control gap"}</span>
        </div>
        <FlowLink />
        <div className="intro-effects intro-node">
          <p className="intro-node-kicker">The human cost</p><h2>Harms we can cause</h2>
          <div className="intro-harm-list">{harms.map((harm, index) => <div className="intro-harm-card" key={harm.title} style={{ "--harm-delay": `${index * .16}s` }}><span className="intro-harm-mark" aria-hidden="true">!</span><div><strong>{harm.title}</strong><small>{harm.trigger}</small></div><InfoTip label={harm.title}><p>{harm.detail}</p><p>Illustrative failure scenario. The six safeguards help prevent, detect, and contain failures; none guarantees that harm cannot occur.</p></InfoTip></div>)}</div>
          <p className="intro-impact-note">{phase === 2 ? "Safeguards reduce risk. Harm remains possible." : "One tool call. A lasting consequence."}</p>
        </div>
      </div>
      <div className="intro-safeguards">
        <span>Build into the action path</span>
        <div>{rooms.map((room, index) => <button key={room.id} type="button" onClick={() => onRoom(index)} style={{ "--control-accent": room.accent }}><span>{room.number}</span>{room.short}<i aria-hidden="true">↗</i></button>)}</div>
      </div>
    </div>

    <div className="intro-bottom">
      <div className="intro-thesis"><p>Build governance into development.</p><span>Before a mistake becomes someone else’s harm.</span></div>
      <button className="intro-enter" type="button" onClick={onEnter}>Explore the six safeguards <span aria-hidden="true">→</span></button>
    </div>
    <div className="intro-playback" aria-label="Introduction playback">
      <button className="intro-play" type="button" onClick={playback.toggle} aria-label={playback.finished ? "Replay introduction" : playback.playing ? "Pause introduction" : "Play introduction"}>{playback.finished ? "↺" : playback.playing ? "Ⅱ" : "▶"}</button>
      <div>{beats.map((label, index) => <button type="button" key={label} onClick={() => playback.seek(index)} aria-label={`Introduction step ${index + 1}: ${label}`} aria-current={phase === index ? "step" : undefined}><span>{String(index + 1).padStart(2, "0")}</span>{label}</button>)}</div>
    </div>
  </section>;
}
