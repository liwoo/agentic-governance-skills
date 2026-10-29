import { createContext, useContext, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import { BEAT_SECONDS } from "../data/stories.js";

export const SceneOverlayContext = createContext(null);

const GREEN = "#80d6ad";
const RED = "#ee796b";
const GOLD = "#f3ce78";
const INK = "#344740";
const PAPER = "#fff1ce";
const BLUE = "#9ebfea";
const clamp = (n) => Math.max(0, Math.min(1, n));
const ease = (n) => { const v = clamp(n); return v * v * (3 - 2 * v); };
const ramp = (t, start, end) => ease((t - start) / (end - start));
function useStoryFrame(timeline, update) {
  useFrame(() => update(timeline.current.time / BEAT_SECONDS));
}
function Box({ at = [0, 0, 0], size = [1, 1, 1], color = INK, glow = false, ...props }) {
  return <mesh position={at} castShadow receiveShadow {...props}><boxGeometry args={size} /><meshStandardMaterial color={color} roughness={0.65} metalness={0.08} emissive={glow ? color : "#000"} emissiveIntensity={glow ? 0.35 : 0} /></mesh>;
}
function Cylinder({ at, radius = 0.15, height = 0.1, color = GOLD, ...props }) {
  return <mesh position={at} castShadow {...props}><cylinderGeometry args={[radius, radius, height, 24]} /><meshStandardMaterial color={color} metalness={0.25} roughness={0.5} /></mesh>;
}
function Label({ at, children, tone = "neutral", small = false }) {
  const portal = useContext(SceneOverlayContext);
  return <Html portal={portal} position={at} center zIndexRange={[6, 0]} style={{ pointerEvents: "none" }}><span className={`process-label process-${tone}${small ? " label-small" : ""}`}>{children}</span></Html>;
}
function Inspect({ at, label, onClick }) {
  const portal = useContext(SceneOverlayContext);
  return <Html portal={portal} position={at} center zIndexRange={[9, 0]} style={{ pointerEvents: "auto" }}><button type="button" className="scene-hotspot" aria-label={`Inspect ${label}`} onClick={(event) => { event.stopPropagation(); onClick(); }}>+</button></Html>;
}
function Rail({ from, to, color = "#6e8176", width = 0.08, y = 0.14 }) {
  const dx = to[0] - from[0];
  const dz = to[1] - from[1];
  return <Box at={[(from[0] + to[0]) / 2, y, (from[1] + to[1]) / 2]} size={[Math.hypot(dx, dz), 0.07, width]} rotation={[0, -Math.atan2(dz, dx), 0]} color={color} />;
}
function Parcel({ color = GOLD, children }) {
  return <><Box size={[0.65, 0.55, 0.58]} color={color} /><Box at={[0, 0.286, 0]} size={[0.14, 0.025, 0.59]} color={PAPER} />{children}</>;
}
function Barrier({ pivot, at = [1, 0, 0], open = false, height = 1 }) {
  return <group position={at}><Cylinder at={[0, height / 2, 0]} height={height} radius={0.09} color={INK} /><group ref={pivot} position={[0, height, 0]} rotation={[0, 0, open ? Math.PI / 2 : 0]}><Box at={[0.55, 0, 0]} size={[1.2, 0.16, 0.14]} color={RED} />{[0.2, 0.6, 1].map((x) => <Box key={x} at={[x, 0.005, 0.005]} size={[0.14, 0.17, 0.15]} color={PAPER} />)}</group></group>;
}
function Plinth({ at, size = [1.4, 0.65, 1.1], color = INK }) {
  return <><Box at={at} size={size} color={color} /><Box at={[at[0], at[1] + size[1] / 2 + 0.03, at[2]]} size={[size[0] + 0.1, 0.06, size[2] + 0.1]} color="#d9d0b9" /></>;
}

function Identity({ timeline, phase, onSelect }) {
  const parcel = useRef();
  const barrier = useRef();
  const stamps = useRef([]);
  const badges = useRef([]);
  useStoryFrame(timeline, (t) => {
    const x = t < 1 ? -1.25 + 1.85 * ramp(t, 0, 0.4) - 1.6 * ramp(t, 0.65, 1) : t < 3 ? -1 : -1 + 4.05 * ramp(t, 3.1, 3.8);
    parcel.current.position.set(x, 0.78, 0.6);
    barrier.current.rotation.z = Math.PI / 2 * ramp(t, 2.8, 3.1);
    stamps.current.forEach((stamp, i) => {
      const strike = clamp((t - 1 - i * 0.2) / 0.18);
      stamp.position.y = 1.75 - Math.sin(strike * Math.PI) * 0.65;
      badges.current[i].visible = t >= 1.1 + i * 0.2;
    });
  });
  return <>
    <Box at={[0, 0.3, 0.6]} size={[6.9, 0.26, 1.2]} color="#667970" />
    {[-2.8, -2, -1.2, -0.4, 0.4, 1.2, 2, 2.8].map((x) => <Box key={x} at={[x, 0.45, 0.6]} size={[0.06, 0.04, 1]} color="#bec8b5" />)}
    <group ref={parcel}><Parcel><group position={[0, 0.32, 0]}>{[RED, BLUE, GREEN, GOLD].map((color, i) => <group ref={(node) => { badges.current[i] = node; }} key={color}><Box at={[-0.23 + i * 0.15, 0, 0]} size={[0.11, 0.05, 0.35]} color={color} glow /></group>)}</group></Parcel></group>
    {[-1.6, -1.2, -0.8, -0.4].map((x, i) => <group key={x}><group ref={(node) => { stamps.current[i] = node; }} position={[x, 1.75, 0.6]}><Cylinder at={[0, 0.1, 0]} radius={0.08} height={0.4} color={INK} /><Box at={[0, -0.1, 0]} size={[0.32, 0.12, 0.4]} color={[RED, BLUE, GREEN, GOLD][i]} /></group></group>)}
    <Box at={[-1, 2.2, 0.6]} size={[2.15, 0.15, 0.25]} color={INK} />
    <Label at={[-1.3, 2.7, 0.6]}>OWNER · AGENT · INSTANCE · SESSION</Label>
    <Box at={[1, 1.4, -0.13]} size={[0.18, 2.1, 0.18]} color={INK} />
    <Box at={[1, 1.4, 1.32]} size={[0.18, 2.1, 0.18]} color={INK} />
    <Box at={[1, 2.45, 0.6]} size={[0.24, 0.2, 1.65]} color={phase >= 3 ? GREEN : RED} glow />
    <group rotation={[0, Math.PI / 2, 0]} position={[1, 0.4, 1.2]}><Barrier pivot={barrier} at={[0, 0, 0]} height={0.5} /></group>
    <Label at={[1.25, 2.95, 0.45]} tone={phase >= 3 ? "good" : phase === 0 ? "danger" : "neutral"}>{["✕ UNSIGNED", "GATE CLOSED", "CHECK SIGNATURE", "✓ VERIFIED", "✓ TRACEABLE"][phase]}</Label>
    {phase === 4 ? <Label at={[2.7, 1.5, 0.6]} tone="good">ACTION + SIGNED PASSPORT</Label> : null}
    <Inspect at={[-2.5, 1.25, 0.6]} label="identity stamping desk" onClick={() => onSelect("stampDesk")} />
    <Inspect at={[2, 2.1, 0.6]} label="verification gate" onClick={() => onSelect("gate")} />
    <Inspect at={phase >= 3 ? [3, 0.9, 1.3] : [-1, 0.9, 1.3]} label="attributed action parcel" onClick={() => onSelect("parcel")} />
  </>;
}

function Reliability({ timeline, phase, onSelect }) {
  const span = useRef();
  const traveller = useRef();
  const barrier = useRef();
  const probes = useRef([]);
  const joins = useRef([]);
  useStoryFrame(timeline, (t) => {
    const failed = ramp(t, 1, 1.35) * (1 - ramp(t, 2, 2.65));
    span.current.position.y = -failed * 0.85;
    span.current.rotation.z = -failed * 0.22;
    traveller.current.position.x = -3 + 0.6 * ramp(t, 0, 0.5) + 5.4 * ramp(t, 4, 4.85);
    barrier.current.rotation.z = -Math.PI / 2 * ramp(t, 3.8, 4);
    probes.current.forEach((node, i) => { node.position.y = 2.45 - 0.55 * Math.sin(clamp((t - i * 0.12) / 0.8) * Math.PI) - (i === 1 ? 0.55 * Math.sin(clamp((t - 2.55) / 0.4) * Math.PI) : 0); });
    joins.current.forEach((node) => { node.scale.y = 0.1 + ramp(t, 3.15, 3.7); });
  });
  return <>
    <Box at={[0, 0.08, 0.6]} size={[6.6, 0.1, 2]} color="#48656a" />
    {[-3.1, 3.1].map((x) => <Plinth key={x} at={[x, 0.55, 0.6]} size={[1, 1.1, 1.5]} color="#797969" />)}
    {[-1.65, 0, 1.65].map((x, i) => <group key={x}>
      <group ref={i === 1 ? span : undefined}>
        <Box at={[x, 1.05, 0.6]} size={[1.55, 0.24, 1.15]} color={i === 1 && phase === 1 ? RED : phase >= 3 || (phase >= 1 && i !== 1) ? GREEN : GOLD} />
        {[0.03, 1.17].map((z) => <Box key={z} at={[x, 1.35, z]} size={[1.55, 0.1, 0.09]} color={INK} />)}
      </group>
      <group ref={(node) => { probes.current[i] = node; }} position={[x, 2.45, 0.6]}><Cylinder at={[0, 0, 0]} height={0.5} radius={0.09} color={INK} /><Box at={[0, -0.3, 0]} size={[0.65, 0.1, 0.7]} color={i === 1 && phase === 1 ? RED : GREEN} /></group>
      <Label at={[x, 3, 0.6]} tone={i === 1 && phase === 1 ? "danger" : phase >= 3 || (phase >= 1 && i !== 1) ? "good" : "neutral"}>{["RETRIEVE", "TRANSFORM", "ACT"][i]} {i === 1 && phase === 1 ? "✕ FAIL" : phase >= 3 || (phase >= 1 && i !== 1) ? "✓ PASS" : "· TEST"}</Label>
    </group>)}
    {[-0.82, 0.82].map((x, i) => <group key={x} ref={(node) => { joins.current[i] = node; }} position={[x, 1.1, 0.6]}><Box size={[0.16, 0.3, 1.3]} color={GOLD} glow /></group>)}
    <group ref={traveller} position={[-3, 1.5, 0.6]}><Parcel color={BLUE} /></group>
    <group position={[-2.3, 0.25, 1.2]} rotation={[0, Math.PI / 2, 0]}><Barrier pivot={barrier} at={[0, 0, 0]} /></group>
    <Label at={[0, 0.25, 1.9]} tone={phase === 1 ? "danger" : phase >= 4 ? "good" : "neutral"}>{["SEPARATE TESTS · SEPARATE EVIDENCE", "GAP IN PROOF = NO CROSSING", "NEW CODE → NEW TEST", "CHECK INTERFACES + END TO END", "✓ WORKFLOW RELEASED"][phase]}</Label>
    <Inspect at={[-2.6, 2.55, 0.6]} label="test stations" onClick={() => onSelect("stations")} />
    <Inspect at={[0, 1.1, 1.7]} label="weak-link alarm" onClick={() => onSelect("weakLink")} />
    <Inspect at={[2.8, 2, 0.6]} label="composition gate" onClick={() => onSelect("output")} />
  </>;
}

function Permission({ timeline, phase, onSelect }) {
  const door = useRef();
  const key = useRef();
  const action = useRef();
  const routine = useRef();
  useStoryFrame(timeline, (t) => {
    door.current.position.y = 1.25 + 1.7 * ramp(t, 2.8, 3.1) * (1 - ramp(t, 3.75, 4.05));
    key.current.position.set(-2.4 + 3.25 * ramp(t, 2, 2.8), 1.55 + Math.sin(ramp(t, 2, 2.8) * Math.PI) * 0.45, 1.65 - 1.2 * ramp(t, 2, 2.8));
    key.current.scale.setScalar(Math.max(0.001, 1 - ramp(t, 3.2, 3.6)));
    key.current.visible = t >= 2 && t < 3.65;
    action.current.position.x = t < 1 ? -2.7 + 2.6 * ramp(t, 0.1, 0.8) : t < 2 ? -0.1 + 0.12 * Math.sin(clamp((t - 1) / 0.5) * Math.PI * 4) : t < 4 ? -0.1 + 2.7 * ramp(t, 3.1, 3.65) : -1.8 + 1.7 * ramp(t, 4.1, 4.6);
    routine.current.position.x = -2.8 + 5.7 * ramp(t, 0, 0.8);
  });
  return <>
    <Box at={[0, 0.08, -0.85]} size={[6.7, 0.08, 0.9]} color="#648e7e" />
    <Label at={[-1.5, 0.5, -1.5]} tone="good">READ / SEARCH · OPEN ACCESS</Label>
    <group ref={routine} position={[-2.8, 0.45, -0.85]}><Parcel color={GREEN} /></group>
    <Box at={[0, 0.08, 0.7]} size={[6.7, 0.08, 1]} color="#9e7664" />
    <group position={[1, 0, 0.7]}>
      {[-0.72, 0.72].map((z) => <Box key={z} at={[0, 1.2, z]} size={[0.6, 2.4, 0.2]} color={INK} />)}
      <Box at={[0, 2.45, 0]} size={[0.65, 0.22, 1.65]} color={INK} />
      <group ref={door} position={[0, 1.25, 0]}><Box size={[0.25, 2, 1.28]} color="#a65548" /><Cylinder at={[-0.18, 0, 0]} rotation={[0, 0, Math.PI / 2]} radius={0.22} height={0.12} color={GOLD} /></group>
    </group>
    <group ref={action} position={[-2.7, 0.43, 0.7]}><Parcel color={RED} /></group>
    <Plinth at={[-2.4, 0.5, 2]} size={[1.3, 1, 0.75]} />
    <Label at={[-2.35, 1.5, 2.2]}>HUMAN APPROVER</Label>
    <group ref={key} visible={false}><Cylinder at={[0, 0, 0]} radius={0.2} height={0.09} /><Box at={[0.3, 0, 0]} size={[0.5, 0.08, 0.09]} color={GOLD} /><Box at={[0.45, 0, 0.08]} size={[0.08, 0.08, 0.2]} color={GOLD} /></group>
    {phase === 2 ? <Label at={[-0.7, 2.2, 1.8]}>CHARGE $842 · 1 USE</Label> : null}
    <Label at={[1, 3.25, 0.7]} tone={phase === 3 ? "good" : "danger"}>{["CHARGE · LOCKED", "✕ NO APPROVAL", "EXACT REQUEST ONLY", "✓ APPROVED ONCE", "✕ USED KEY REJECTED"][phase]}</Label>
    {phase >= 3 ? <Label at={[-1.3, 0.6, 1.45]} tone={phase === 4 ? "danger" : "good"}>{phase === 3 ? "KEY CONSUMED" : "SECOND REQUEST · BLOCKED"}</Label> : null}
    <Inspect at={[-2.8, 0.6, -0.85]} label="open capability lockers" onClick={() => onSelect("greenLockers")} />
    <Inspect at={[1.7, 1.6, 1.3]} label="consequential-action vault" onClick={() => onSelect("redLocker")} />
    <Inspect at={[-3.2, 1.4, 2]} label="human approval console" onClick={() => onSelect("tokenDesk")} />
  </>;
}

function Uncertainty({ timeline, phase, onSelect }) {
  const train = useRef();
  const points = useRef();
  useStoryFrame(timeline, (t) => {
    const proceed = ramp(t, 4, 4.85);
    train.current.position.set(-2.8 + 2.15 * ramp(t, 0, 0.75) + 3.55 * proceed, 0.45, 0.55 - 1.8 * proceed);
    train.current.rotation.y = Math.atan2(1.8, 3.55) * ramp(t, 4, 4.2);
    points.current.rotation.y = -0.5 + ramp(t, 3, 3.7);
  });
  return <>
    {[0.3, 0.8].map((z) => <Rail key={z} from={[-3.3, z]} to={[-0.25, z]} />)}
    {[-1, 1].map((sign) => <group key={sign}>{[-0.22, 0.22].map((offset) => <Rail key={offset} from={[-0.25, 0.55 + offset]} to={[3, 0.55 + sign * 1.8 + offset]} color={sign === -1 && phase >= 3 ? GREEN : "#6e8176"} />)}</group>)}
    {[-3, -2.5, -2, -1.5, -1, -0.5].map((x) => <Box key={x} at={[x, 0.08, 0.55]} size={[0.14, 0.08, 1]} color="#92785b" />)}
    <group ref={points} position={[-0.2, 0.19, 0.55]}><Box at={[0.6, 0, 0]} size={[1.3, 0.06, 0.1]} color={GOLD} /></group>
    <group ref={train} position={[-2.8, 0.45, 0.55]}><Box size={[0.95, 0.4, 0.55]} color={BLUE} /><Box at={[-0.2, 0.35, 0]} size={[0.38, 0.4, 0.5]} color={BLUE} /><Box at={[0.03, 0.36, 0]} size={[0.02, 0.25, 0.35]} color={PAPER} />{[-0.3, 0.3].map((x) => <Cylinder key={x} at={[x, -0.18, 0]} radius={0.16} height={0.65} rotation={[Math.PI / 2, 0, 0]} color={INK} />)}</group>
    <Cylinder at={[-0.5, 0.9, -0.4]} height={1.8} radius={0.07} color={INK} />
    <Box at={[-0.5, 1.9, -0.4]} size={[0.4, 0.65, 0.3]} color={INK} />
    <mesh position={[-0.5, 1.95, -0.2]}><sphereGeometry args={[0.15, 20, 16]} /><meshStandardMaterial color={phase === 4 ? GREEN : RED} emissive={phase === 4 ? GREEN : RED} emissiveIntensity={1.2} /></mesh>
    <Plinth at={[2.85, 0.55, -1.7]} size={[1, 1.1, 0.6]} color={phase >= 3 ? "#5c9d80" : INK} />
    <Plinth at={[2.85, 0.55, 2.25]} size={[1, 1.1, 0.6]} />
    <Label at={[2.85, 1.6, -1.7]} tone={phase >= 3 ? "good" : "neutral"}>SJO · COSTA RICA {phase >= 3 ? "✓" : "?"}</Label>
    <Label at={[2.85, 1.6, 2.25]}>SJC · CALIFORNIA {phase >= 3 ? "✕" : "?"}</Label>
    <Label at={[-1.3, 2.7, 0.2]} tone={phase >= 3 ? "good" : phase === 1 ? "danger" : "neutral"}>{["TWO SAN JOSÉS. WHICH?", "HOLD · EVIDENCE MISSING", "ASK: SJO OR SJC?", "ANSWER: SJO · COSTA RICA", "✓ ROUTE CONFIRMED"][phase]}</Label>
    <Inspect at={[0.5, 0.55, 1.4]} label="ambiguous navigation table" onClick={() => onSelect("table")} />
    <Inspect at={[-1, 1.85, -0.4]} label="confidence instruments" onClick={() => onSelect("meters")} />
    <Inspect at={[-2.6, 2.1, 0.2]} label="clarification signal box" onClick={() => onSelect("lighthouse")} />
  </>;
}

function Ledger({ timeline, phase, onSelect }) {
  const intent = useRef();
  const outcome = useRef();
  const rotor = useRef();
  const seal = useRef();
  useStoryFrame(timeline, (t) => {
    const file = ramp(t, 0.15, 0.8);
    intent.current.position.set(-2.7 + 3.75 * file, 1.1 + Math.sin(file * Math.PI) * 0.65, 0.9 - 1.45 * file);
    intent.current.rotation.x = -Math.PI / 2 * file;
    const result = ramp(t, 2, 2.8);
    outcome.current.position.set(-0.7 + 3.1 * result, 1.3 + Math.sin(result * Math.PI) * 0.4, 0.75 - 1.3 * result);
    outcome.current.rotation.x = -Math.PI / 2 * result;
    outcome.current.visible = t >= 2;
    rotor.current.rotation.z = ramp(t, 1, 1.9) * Math.PI * 4;
    seal.current.scale.x = Math.max(0.001, ramp(t, 3, 3.6));
    seal.current.rotation.z = t >= 4 ? Math.sin(ramp(t, 4, 4.6) * Math.PI * 5) * 0.16 : 0;
  });
  return <>
    <Plinth at={[-2.7, 0.45, 0.9]} size={[1.1, 0.9, 1]} color="#718a80" />
    <Box at={[-2.7, 1.2, 0.55]} size={[0.95, 0.5, 0.28]} color={INK} />
    <Label at={[-2.7, 1.85, 0.6]}>INTENT PRESS</Label>
    <group ref={intent}><Box size={[0.78, 0.035, 0.7]} color={PAPER} /><Box at={[0, 0.022, 0]} size={[0.5, 0.015, 0.06]} color={INK} /></group>
    <Plinth at={[-0.65, 0.6, 0.85]} size={[1.25, 1.2, 1.1]} color={INK} />
    <mesh ref={rotor} position={[-0.65, 0.9, 1.44]}><torusGeometry args={[0.32, 0.08, 12, 24]} /><meshStandardMaterial color={phase === 0 ? RED : GREEN} /><Box size={[0.58, 0.07, 0.09]} color={GOLD} /></mesh>
    <Label at={[-0.65, 1.9, 0.85]} tone={phase === 0 ? "danger" : "good"}>{phase === 0 ? "ACTION LOCKED" : "ACTION RECORDED"}</Label>
    <Box at={[1.8, 0.65, -0.7]} size={[2.8, 1.3, 0.35]} color="#78674f" />
    <Box at={[1.8, 0.73, -0.35]} size={[2.9, 0.08, 0.5]} color={INK} />
    <group ref={outcome} visible={false}><Box size={[0.78, 0.035, 0.7]} color={GREEN} /><Box at={[0, 0.025, 0]} size={[0.5, 0.015, 0.06]} color={INK} /></group>
    <group ref={seal} position={[1.7, 0.65, -0.03]}>{[-1, 1].map((side) => <group key={side} position={[side * (phase === 4 ? 0.5 : 0.35), 0, 0]} rotation={[0, 0, phase === 4 ? side * 0.25 : 0]}><Box size={[0.65, 0.1, 0.1]} color={phase === 4 ? RED : GOLD} glow /></group>)}{phase < 4 ? <Cylinder at={[0, 0, 0]} radius={0.19} height={0.12} rotation={[Math.PI / 2, 0, 0]} color={GOLD} /> : null}</group>
    <Label at={[1.8, 2.2, -0.55]} tone={phase === 4 ? "danger" : "good"}>{phase === 4 ? "✕ ALTERATION DETECTED" : "APPEND-ONLY ARCHIVE"}</Label>
    {phase >= 2 ? <><Label at={[1.05, 1.7, -0.55]} small>01 INTENT</Label><Label at={[2.4, 1.7, -0.55]} small>02 OUTCOME</Label></> : null}
    {phase === 4 ? <><Box at={[1.05, 1.1, -0.5]} size={[0.8, 0.72, 0.05]} color={RED} /><Label at={[1.4, 0.15, 1.25]} tone="danger">CHANGED RECORD ≠ STORED HASH</Label></> : null}
    <Inspect at={[-3.25, 1.4, 0.9]} label="write-ahead intent printer" onClick={() => onSelect("printer")} />
    <Inspect at={[3.2, 1.8, -0.55]} label="append-only archive" onClick={() => onSelect("shelves")} />
    <Inspect at={[1.7, 0.65, 0.4]} label="tamper-evident chain" onClick={() => onSelect("chain")} />
  </>;
}

function Shutdown({ timeline, phase, onSelect }) {
  const rotor = useRef();
  const lever = useRef();
  const keys = useRef([]);
  const gauge = useRef();
  const packets = useRef([]);
  useStoryFrame(timeline, (t) => {
    rotor.current.rotation.z = Math.min(t, 2) * 9;
    lever.current.rotation.z = -0.65 + 1.3 * ramp(t, 1, 1.3);
    gauge.current.scale.x = 0.15 + 0.85 * ramp(t, 0, 0.95);
    keys.current.forEach((key, i) => { key.position.x = 2.2 + 0.65 * ramp(t, 2 + i * 0.15, 2.45 + i * 0.15); });
    packets.current.forEach((packet, i) => {
      packet.position.x = -0.8 + ((Math.min(t, 1) * 1.4 + i * 0.6) % 2.6);
      packet.scale.setScalar(Math.max(0.001, 1 - ramp(t, 1.7, 2.2)));
    });
  });
  return <>
    <Plinth at={[0, 0.85, 0.15]} size={[2.1, 1.7, 1.5]} color="#57706b" />
    <mesh ref={rotor} position={[0, 1.05, 0.94]}><torusGeometry args={[0.57, 0.09, 12, 32]} /><meshStandardMaterial color={phase >= 2 ? "#7f8981" : GOLD} />{[0, Math.PI / 3, 2 * Math.PI / 3].map((angle) => <Box key={angle} rotation={[0, 0, angle]} size={[1.1, 0.1, 0.1]} color={phase >= 2 ? "#7f8981" : GOLD} />)}</mesh>
    <Box at={[0, 2.02, 0.15]} size={[1.75, 0.24, 0.3]} color={INK} />
    <group position={[-0.78, 2.02, 0.33]}><group ref={gauge}><Box at={[0.78, 0, 0]} size={[1.55, 0.12, 0.04]} color={phase >= 1 ? RED : GOLD} glow /></group></group>
    <Label at={[0, 2.7, 0.15]} tone={phase >= 2 ? "good" : phase === 1 ? "danger" : "neutral"}>{["SPEND → LIMIT", "LIMIT REACHED", "ENGINE STOPPED", "CLEANUP BOUNDED", "STOPPED · NO AUTO-RESTART"][phase]}</Label>
    <Plinth at={[-2.6, 0.45, 1.1]} size={[0.85, 0.9, 0.8]} />
    <group ref={lever} position={[-2.6, 0.95, 1.1]}><Cylinder at={[0, 0.3, 0]} height={0.6} radius={0.07} color={PAPER} /><Box at={[0, 0.65, 0]} size={[0.45, 0.18, 0.2]} color={RED} /></group>
    <Label at={[-2.6, 2, 1.1]} tone="danger">INDEPENDENT STOP</Label>
    <Rail from={[-2.6, 1.1]} to={[0, 0.15]} color={phase >= 1 ? RED : GOLD} width={0.13} />
    <Rail from={[0, 0.15]} to={[2.2, 0.15]} color={phase >= 2 ? "#697469" : GOLD} width={0.13} />
    <Box at={[2.2, 1, 0.15]} size={[0.25, 2, 0.85]} color={INK} />
    {[0, 1, 2].map((i) => <group key={i} ref={(node) => { keys.current[i] = node; }} position={[2.2, 0.45 + i * 0.6, 0.15]}><Box size={[0.9, 0.3, 0.65]} color={phase >= 2 ? "#697469" : GREEN} /><Box at={[-0.55, 0, 0]} size={[0.25, 0.08, 0.1]} color={GOLD} /></group>)}
    <Label at={[2.6, 2.5, 0.15]} tone={phase >= 2 ? "danger" : "good"}>{phase >= 2 ? "✕ KEYS REVOKED" : "LIVE CREDENTIALS"}</Label>
    {[0, 1, 2].map((i) => <group ref={(node) => { packets.current[i] = node; }} key={i} position={[0, 0.3, 1.8]}><Box size={[0.25, 0.22, 0.25]} color={GOLD} /></group>)}
    {phase >= 3 ? <Label at={[0, 0.35, 2]} tone="good">✓ LEDGER SETTLED · OWNER NOTIFIED</Label> : <Label at={[0, 0.65, 2]} tone={phase >= 1 ? "danger" : "neutral"}>{phase >= 1 ? "NO NEW WORK · CANCEL PENDING" : "WORK IN FLIGHT"}</Label>}
    <Inspect at={[-1.25, 1.45, 0.9]} label="agent engine" onClick={() => onSelect("engine")} />
    <Inspect at={[-3.1, 1.35, 1.1]} label="emergency stop" onClick={() => onSelect("stopLever")} />
    <Inspect at={[3.4, 1.4, 0.15]} label="credential revocation rack" onClick={() => onSelect("battery")} />
  </>;
}
const SCENES = { identity: Identity, reliability: Reliability, permission: Permission, uncertainty: Uncertainty, ledger: Ledger, shutdown: Shutdown };
export default function GovernanceScenes({ room, timeline, phase, onSelect }) {
  const Scene = SCENES[room.id];
  return <Scene timeline={timeline} phase={phase} onSelect={onSelect} />;
}
