import { memo, useEffect, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { ContactShadows, Html, OrbitControls, RoundedBox } from "@react-three/drei";
import { Color, Vector3 } from "three";

const VIEWS = {
  overview: { position: [8.6, 7.1, 9.2], target: [0, 1.15, -0.1], zoom: 68 },
  risks: { position: [0, 2.7, 8.4], target: [-1.45, 2.15, -3], zoom: 104 },
  checklist: { position: [9.2, 3.1, 0.2], target: [3.92, 2.05, -0.8], zoom: 102 },
};

function CameraRig({ focus, controlsRef }) {
  const { camera } = useThree();
  const moving = useRef(true);
  const goal = useRef(new Vector3(...VIEWS.overview.position));
  const target = useRef(new Vector3(...VIEWS.overview.target));
  const zoom = useRef(VIEWS.overview.zoom);

  useEffect(() => {
    const view = VIEWS[focus] || VIEWS.overview;
    goal.current.set(...view.position);
    target.current.set(...view.target);
    zoom.current = view.zoom;
    moving.current = true;
  }, [focus]);

  useFrame((_, delta) => {
    if (!moving.current || !controlsRef.current) return;
    const speed = 1 - Math.exp(-delta * 5.5);
    camera.position.lerp(goal.current, speed);
    controlsRef.current.target.lerp(target.current, speed);
    camera.zoom += (zoom.current - camera.zoom) * speed;
    camera.updateProjectionMatrix();
    controlsRef.current.update();
    if (camera.position.distanceTo(goal.current) < 0.025 && Math.abs(camera.zoom - zoom.current) < 0.08) moving.current = false;
  });

  return <OrbitControls ref={controlsRef} makeDefault enableDamping dampingFactor={0.08} minZoom={46} maxZoom={145} minPolarAngle={0.7} maxPolarAngle={1.38} minAzimuthAngle={-1.5} maxAzimuthAngle={1.55} onStart={() => { moving.current = false; }} />;
}

function Block({ args, position, color, radius = 0.08, rotation, emissive, children, ...props }) {
  return (
    <RoundedBox args={args} position={position} rotation={rotation} radius={radius} smoothness={2} castShadow receiveShadow {...props}>
      <meshStandardMaterial color={color} roughness={0.78} metalness={0.03} emissive={emissive || "#000000"} emissiveIntensity={emissive ? 0.35 : 0} />
      {children}
    </RoundedBox>
  );
}

function Hotspot({ position, label, onClick }) {
  return (
    <Html position={position} center zIndexRange={[20, 0]}>
      <button className="scene-hotspot" type="button" onClick={(event) => { event.stopPropagation(); onClick(); }} aria-label={`Inspect ${label}`} title={`Inspect ${label}`}>
        <span>+</span>
      </button>
    </Html>
  );
}

function WallBoard({ kind, position, rotation = [0, 0, 0], accent, onClick }) {
  const isRisk = kind === "risks";
  return (
    <group position={position} rotation={rotation}>
      <Block args={[2.7, 1.45, 0.12]} position={[0, 0, 0]} color={isRisk ? "#334843" : "#e8e3d9"} radius={0.05} onClick={onClick}>
        <Html transform position={[0, 0, 0.075]} distanceFactor={1.55} zIndexRange={[10, 0]}>
          <button className={`board-face ${isRisk ? "board-risk" : "board-check"}`} type="button" onClick={(event) => { event.stopPropagation(); onClick(); }}>
            <small>{isRisk ? "RISK WHITEBOARD" : "IMPLEMENTATION LIST"}</small>
            <strong>{isRisk ? "What could go wrong?" : "How to address it"}</strong>
            <span>{isRisk ? "Tap to inspect the risks →" : "Tap to open the checklist →"}</span>
          </button>
        </Html>
      </Block>
      <mesh position={[0, 0.84, 0]} castShadow>
        <boxGeometry args={[0.55, 0.08, 0.18]} />
        <meshStandardMaterial color={accent} />
      </mesh>
    </group>
  );
}

function RoomShell({ room, onFocus }) {
  return (
    <>
      <Block args={[8.4, 0.22, 6.4]} position={[0, -0.12, 0]} color={room.floor} radius={0.04} />
      <Block args={[8.4, 4.8, 0.22]} position={[0, 2.28, -3.08]} color={room.wall} radius={0.04} />
      <Block args={[0.22, 4.8, 6.4]} position={[4.08, 2.28, 0]} color={new Color(room.wall).offsetHSL(0, -0.03, -0.05)} radius={0.04} />
      <Block args={[5.4, 0.035, 3.7]} position={[-0.4, 0.03, 0.2]} color="#c5bba8" radius={0.18} />
      <WallBoard kind="risks" position={[-1.65, 2.35, -2.91]} accent={room.accent} onClick={() => onFocus("risks")} />
      <WallBoard kind="checklist" position={[3.91, 2.25, -0.7]} rotation={[0, -Math.PI / 2, 0]} accent={room.secondary} onClick={() => onFocus("checklist")} />
      <mesh position={[-3.8, 0.35, 2.95]} rotation={[0, 0.2, 0]} castShadow>
        <boxGeometry args={[0.65, 0.65, 0.65]} />
        <meshStandardMaterial color="#a6835e" roughness={0.95} />
      </mesh>
    </>
  );
}

function loop(time, duration, offset = 0) {
  return ((time - offset) % duration + duration) % duration;
}

function between(value, start, end) {
  return Math.max(0, Math.min(1, (value - start) / (end - start)));
}

function ProcessLabel({ position, children, tone = "neutral" }) {
  return (
    <Html position={position} center zIndexRange={[8, 0]}>
      <span className={`process-label process-${tone}`}>{children}</span>
    </Html>
  );
}

function ApprovalAnimation() {
  const token = useRef();
  const door = useRef();
  useFrame(({ clock }) => {
    const t = loop(clock.elapsedTime, 8);
    if (token.current) {
      const travel = t < 3 ? between(t, 0.4, 2.8) : t > 6.6 ? 0 : 1;
      token.current.position.set(2.25 + (-1.25 * travel), 1.15 + 0.45 * Math.sin(travel * Math.PI), 0.85 + (-2.85 * travel));
      token.current.scale.setScalar(t > 6.6 ? Math.max(0.01, 1 - between(t, 6.6, 7.3)) : 1);
    }
    if (door.current) {
      const open = t < 3.1 ? 0 : t < 4.2 ? between(t, 3.1, 4.2) : t < 6.2 ? 1 : 1 - between(t, 6.2, 7.2);
      door.current.rotation.y = -open * 1.28;
    }
  });
  return (
    <>
      <group ref={token}>
        <Block args={[0.54, 0.08, 0.34]} position={[0, 0, 0]} color="#f3cf5e" emissive="#d9a918" radius={0.04} />
        <ProcessLabel position={[0, 0.26, 0]}>SIGNED APPROVAL</ProcessLabel>
      </group>
      <group ref={door} position={[0.31, 1.22, -2.01]}>
        <Block args={[0.68, 2.35, 0.08]} position={[0.34, 0, 0]} color="#913f3b" radius={0.04} />
      </group>
      <ProcessLabel position={[0.65, 2.86, -2.04]} tone="danger">LOCKED → VERIFIED → OPEN</ProcessLabel>
    </>
  );
}

const NODE_COLORS = ["#71a2d4", "#d98c68", "#8fbd8b", "#b38ac7"];
const TEST_KEYFRAMES = [[0, -3], [0.8, -1.65], [1.7, -1.65], [2.4, -0.45], [3.3, -0.45], [4, 0.75], [4.9, 0.75], [5.6, 1.95], [6.5, 1.95], [7.3, 3.05], [8.4, 3.05]];

function testNodeX(time) {
  for (let index = 1; index < TEST_KEYFRAMES.length; index += 1) {
    const [endTime, endX] = TEST_KEYFRAMES[index];
    const [startTime, startX] = TEST_KEYFRAMES[index - 1];
    if (time <= endTime) return startX + (endX - startX) * between(time, startTime, endTime);
  }
  return 3.05;
}

function ConveyorNode({ index }) {
  const group = useRef();
  const material = useRef();
  useFrame(({ clock }) => {
    const t = loop(clock.elapsedTime, 10.2, index * 2.15);
    if (!group.current || !material.current) return;
    group.current.position.x = testNodeX(t);
    group.current.position.y = 0.8 + Math.sin(t * 7) * 0.015;
    const resetting = t > 8.4;
    const size = resetting ? Math.max(0.01, 1 - between(t, 8.4, 9)) : Math.min(1, between(t, 0, 0.35));
    group.current.scale.setScalar(size);
    const paused = TEST_KEYFRAMES.some(([stamp]) => Math.abs(t - stamp) < 0.42);
    material.current.emissiveIntensity = paused ? 0.8 + Math.sin(t * 14) * 0.25 : 0.12;
  });
  return (
    <group ref={group} position={[-3, 0.8, -0.45]}>
      <RoundedBox args={[0.48, 0.48, 0.48]} radius={0.07} smoothness={2} castShadow>
        <meshStandardMaterial ref={material} color={NODE_COLORS[index]} emissive={NODE_COLORS[index]} emissiveIntensity={0.12} roughness={0.62} />
      </RoundedBox>
      <ProcessLabel position={[0, 0.42, 0]}>NODE {index + 1}</ProcessLabel>
    </group>
  );
}

function BeltMarkers() {
  const group = useRef();
  useFrame(({ clock }) => {
    if (group.current) group.current.position.x = (clock.elapsedTime * 0.55) % 0.55;
  });
  return (
    <group ref={group}>
      {Array.from({ length: 12 }, (_, index) => <mesh key={index} position={[-3.15 + index * 0.55, 0.645, -0.45]}><boxGeometry args={[0.26, 0.02, 0.58]} /><meshStandardMaterial color="#8b9690" /></mesh>)}
    </group>
  );
}

function LedgerAnimation() {
  const receipt = useRef();
  const chainMaterial = useRef();
  useFrame(({ clock }) => {
    const t = loop(clock.elapsedTime, 7.5);
    if (receipt.current) {
      const travel = t < 1.3 ? 0 : t < 4.6 ? between(t, 1.3, 4.6) : 1;
      receipt.current.position.set(-2.35 + 2.85 * travel, 1.12 + 0.45 * Math.sin(travel * Math.PI), 0.6 - 2.38 * travel);
      receipt.current.rotation.y = travel * 0.3;
      receipt.current.scale.setScalar(t > 5.4 ? Math.max(0.01, 1 - between(t, 5.4, 6.3)) : 1);
    }
    if (chainMaterial.current) chainMaterial.current.emissiveIntensity = t > 4.4 && t < 6.7 ? 1.4 : 0.35;
  });
  return (
    <>
      <group ref={receipt} position={[-2.35, 1.12, 0.6]}>
        <Block args={[0.64, 0.05, 0.46]} position={[0, 0, 0]} color="#fff3d7" radius={0.02} />
        <ProcessLabel position={[0, 0.23, 0]}>INTENT FIRST</ProcessLabel>
      </group>
      <mesh position={[0.4, 1.4, -1.82]}><boxGeometry args={[4.1, 0.055, 0.055]} /><meshStandardMaterial ref={chainMaterial} color="#f0cb58" emissive="#f0cb58" emissiveIntensity={0.35} /></mesh>
      <ProcessLabel position={[0.4, 1.72, -1.82]}>APPEND → HASH → VERIFY</ProcessLabel>
    </>
  );
}

function ShutdownAnimation() {
  const engine = useRef();
  const power = useRef();
  const signal = useRef();
  useFrame(({ clock }, delta) => {
    const t = loop(clock.elapsedTime, 9);
    if (engine.current) engine.current.rotation.z += t < 4.2 ? delta * 2.1 : 0;
    if (power.current) {
      const shuttingDown = between(t, 4.2, 6.1);
      power.current.intensity = 6 * (1 - shuttingDown);
    }
    if (signal.current) {
      signal.current.position.x = -1.7 + between(t, 3.8, 5.2) * 3.8;
      signal.current.scale.setScalar(t > 3.6 && t < 5.5 ? 1 : 0.01);
    }
  });
  return (
    <>
      <mesh ref={engine} position={[0.25, 1.1, 0.14]}><torusGeometry args={[0.58, 0.1, 12, 36]} /><meshStandardMaterial color="#d9b95f" emissive="#d9b95f" emissiveIntensity={0.45} /></mesh>
      <pointLight ref={power} position={[0.3, 1.4, 0.4]} color="#e9b95b" intensity={6} distance={3.5} />
      <group ref={signal} position={[-1.7, 1.8, 0.4]}><Block args={[0.32, 0.12, 0.12]} position={[0, 0, 0]} color="#ef5b4e" emissive="#ef5b4e" radius={0.04} /></group>
      <ProcessLabel position={[0.2, 2.65, -0.1]} tone="danger">RUN → TRIP → REVOKE → SAFE</ProcessLabel>
    </>
  );
}

function PassportAnimation() {
  const parcel = useRef();
  const gateLight = useRef();
  useFrame(({ clock }) => {
    const t = loop(clock.elapsedTime, 8.5);
    if (parcel.current) {
      const first = Math.min(1, between(t, 0.3, 2.2));
      const second = Math.min(1, between(t, 2.7, 5.2));
      parcel.current.position.set(-2.9 + 2.1 * first + 3.25 * second, 0.56 + Math.sin(Math.min(1, first + second) * Math.PI) * 0.12, 0.65 - 1.2 * second);
      parcel.current.scale.setScalar(t > 6.2 ? Math.max(0.01, 1 - between(t, 6.2, 7)) : 1);
    }
    if (gateLight.current) gateLight.current.intensity = t > 4.4 && t < 6.3 ? 8 : 0.4;
  });
  return (
    <>
      <group ref={parcel} position={[-2.9, 0.56, 0.65]}>
        <Block args={[0.7, 0.56, 0.7]} position={[0, 0, 0]} color="#d6a66b" radius={0.05} />
        <ProcessLabel position={[0, 0.46, 0]}>ACTION</ProcessLabel>
      </group>
      <pointLight ref={gateLight} position={[1.75, 2, -0.4]} color="#6ee7ae" intensity={0.4} distance={3} />
      <ProcessLabel position={[-1.45, 1.72, 0.65]}>OWNER → AGENT → INSTANCE → SESSION</ProcessLabel>
    </>
  );
}

function UncertaintyAnimation() {
  const route = useRef();
  const beam = useRef();
  const fogRefs = useRef([]);
  useFrame(({ clock }) => {
    const t = loop(clock.elapsedTime, 9);
    const clarified = between(t, 4.2, 6.2);
    if (route.current) {
      route.current.position.x = -1.25 + between(t, 0.6, 3.5) * 1.8 + between(t, 6.2, 8) * 1.4;
      route.current.position.z = 0.2 - between(t, 6.2, 8) * 0.9;
      route.current.scale.setScalar(t > 8.3 ? 0.01 : 1);
    }
    if (beam.current) {
      beam.current.rotation.y = -0.25 + Math.sin(t * 0.7) * 0.18;
      beam.current.visible = t > 4;
    }
    fogRefs.current.forEach((mesh, index) => {
      if (mesh) mesh.material.opacity = 0.18 * (1 - clarified * 0.78) + Math.sin(t * 0.9 + index) * 0.025;
    });
  });
  return (
    <>
      {[[-1.2, 1.25, 0.2], [1.15, 1.2, 0.25], [0.1, 1.25, -1.1]].map((position, index) => <mesh ref={(node) => { fogRefs.current[index] = node; }} key={index} position={position}><sphereGeometry args={[0.55 + index * 0.12, 14, 10]} /><meshStandardMaterial color="#ffffff" transparent opacity={0.18} depthWrite={false} /></mesh>)}
      <mesh ref={beam} position={[-1.5, 1.5, -0.75]} rotation={[0, -0.25, -0.12]} visible={false}><coneGeometry args={[0.7, 3.2, 4, 1, true]} /><meshStandardMaterial color="#f7dc71" transparent opacity={0.13} depthWrite={false} side={2} /></mesh>
      <group ref={route} position={[-1.25, 1.05, 0.2]}><mesh><sphereGeometry args={[0.16, 16, 12]} /><meshStandardMaterial color="#f1d260" emissive="#f1d260" emissiveIntensity={1} /></mesh></group>
      <ProcessLabel position={[0, 1.66, 0.15]}>AMBIGUOUS → ASK → ONE CLEAR ROUTE</ProcessLabel>
    </>
  );
}

function LockerRoom({ room, onSelect }) {
  const colors = [room.secondary, room.secondary, "#d5a24d", "#a8524b"];
  return (
    <>
      <group position={[-0.6, 0, -2.35]}>
        {colors.map((color, index) => (
          <group key={color + index} position={[(index - 1.5) * 0.82, 0, 0]}>
            <Block args={[0.7, index === 3 ? 2.45 : 2.1, 0.62]} position={[0, index === 3 ? 1.22 : 1.05, 0]} color={color} radius={0.05} />
            <mesh position={[0.21, 1.07, 0.34]} castShadow><sphereGeometry args={[0.055, 12, 12]} /><meshStandardMaterial color="#f1d17a" metalness={0.4} /></mesh>
          </group>
        ))}
      </group>
      <Block args={[1.55, 0.85, 0.95]} position={[2.25, 0.45, 0.85]} color="#65564b" />
      <Block args={[0.75, 0.08, 0.46]} position={[2.25, 0.91, 0.85]} color="#f2d46e" emissive="#d4a82f" />
      <ApprovalAnimation />
      <Hotspot position={[-1.2, 2.45, -2.05]} label="open capability lockers" onClick={() => onSelect("greenLockers")} />
      <Hotspot position={[0.65, 2.72, -2.05]} label="consequential-action vault" onClick={() => onSelect("redLocker")} />
      <Hotspot position={[2.25, 1.25, 0.85]} label="human approval console" onClick={() => onSelect("tokenDesk")} />
    </>
  );
}

function ReliabilityRoom({ room, onSelect }) {
  const stations = [
    { x: -1.65, label: "SCHEMA", color: "#71a2d4" },
    { x: -0.45, label: "ISOLATE", color: room.secondary },
    { x: 0.75, label: "EVALUATE", color: room.accent },
    { x: 1.95, label: "CERTIFY", color: "#8fbd8b" },
  ];
  return (
    <>
      <Block args={[6.5, 0.28, 0.95]} position={[0, 0.48, -0.45]} color="#4d5753" />
      <BeltMarkers />
      {stations.map((station) => (
        <group key={station.label} position={[station.x, 0, -0.45]}>
          <Block args={[0.14, 1.62, 0.94]} position={[-0.44, 1.34, 0]} color={station.color} radius={0.035} />
          <Block args={[0.14, 1.62, 0.94]} position={[0.44, 1.34, 0]} color={station.color} radius={0.035} />
          <Block args={[1.02, 0.16, 0.94]} position={[0, 2.12, 0]} color={station.color} radius={0.035} />
          <mesh position={[0, 1.58, 0.5]}>
            <circleGeometry args={[0.13, 20]} />
            <meshStandardMaterial color="#d8ffe7" emissive={station.color} emissiveIntensity={1.1} />
          </mesh>
          <ProcessLabel position={[0, 2.45, 0]} tone={station.label === "CERTIFY" ? "good" : "neutral"}>{station.label}</ProcessLabel>
        </group>
      ))}
      {[0, 1, 2, 3].map((index) => <ConveyorNode key={index} index={index} />)}
      <Block args={[0.92, 1.35, 1.08]} position={[3.05, 0.68, -0.45]} color="#75624f" />
      <ProcessLabel position={[3.05, 1.62, -0.45]} tone="good">COMPOSITION GATE</ProcessLabel>
      <Hotspot position={[-1.45, 2.15, -0.45]} label="test stations" onClick={() => onSelect("stations")} />
      <Hotspot position={[0.8, 2.2, -0.45]} label="weak-link alarm" onClick={() => onSelect("weakLink")} />
      <Hotspot position={[3.05, 1.95, -0.45]} label="composition gate" onClick={() => onSelect("output")} />
    </>
  );
}

function LedgerRoom({ room, onSelect }) {
  const books = ["#c6695a", "#d6a951", "#6c9588", "#6e82a2", "#ae7894", "#d48657"];
  return (
    <>
      <Block args={[4.9, 2.55, 0.55]} position={[0.5, 1.3, -2.45]} color="#654d3b" />
      {[0, 1].map((row) => <group key={row}>{books.map((color, index) => <Block key={color + row} args={[0.55, 0.82, 0.35]} position={[-1.4 + index * 0.65, 0.73 + row * 1.05, -2.1]} color={color} radius={0.035} />)}</group>)}
      <Block args={[1.25, 0.9, 1]} position={[-2.35, 0.48, 0.6]} color="#76847f" />
      <Block args={[0.8, 0.05, 0.55]} position={[-2.35, 1.06, 0.6]} color="#f3eada" />
      <LedgerAnimation />
      <Hotspot position={[1.7, 2.9, -2.05]} label="append-only archive" onClick={() => onSelect("shelves")} />
      <Hotspot position={[0.5, 1.75, -1.7]} label="tamper-evident chain" onClick={() => onSelect("chain")} />
      <Hotspot position={[-2.35, 1.4, 0.6]} label="write-ahead intent printer" onClick={() => onSelect("printer")} />
    </>
  );
}

function ShutdownRoom({ room, onSelect }) {
  return (
    <>
      <Block args={[3.1, 2.2, 1.6]} position={[0.25, 1.1, -0.7]} color="#5c6d6e" radius={0.2} />
      {[-0.7, 0.25, 1.2].map((x, index) => <mesh key={x} position={[x, 1.62, 0.12]} rotation={[0, 0, 0]}><circleGeometry args={[0.25, 24]} /><meshStandardMaterial color={index === 2 ? "#e76958" : "#dfc978"} emissive={index === 2 ? "#d43b2c" : "#000"} emissiveIntensity={0.6} /></mesh>)}
      <Block args={[0.82, 1.35, 0.82]} position={[-2.3, 0.7, 0.95]} color="#d6c9ad" />
      <mesh position={[-2.3, 1.18, 1.38]}><cylinderGeometry args={[0.28, 0.28, 0.18, 24]} /><meshStandardMaterial color="#d94d43" emissive="#b72f29" emissiveIntensity={0.3} /></mesh>
      <group position={[2.75, 0.2, 0.9]}>{[0, 1, 2].map((index) => <Block key={index} args={[0.55, 0.65, 0.8]} position={[0, 0.33 + index * 0.69, 0]} color={index === 0 ? "#c35a4e" : room.secondary} />)}</group>
      <ShutdownAnimation />
      <Hotspot position={[0.25, 2.55, -0.15]} label="agent engine" onClick={() => onSelect("engine")} />
      <Hotspot position={[-2.3, 1.65, 1.35]} label="emergency stop" onClick={() => onSelect("stopLever")} />
      <Hotspot position={[2.75, 2.65, 0.9]} label="credential revocation rack" onClick={() => onSelect("battery")} />
    </>
  );
}

function IdentityRoom({ room, onSelect }) {
  return (
    <>
      <Block args={[3.5, 0.8, 1.2]} position={[-1.45, 0.42, 0.65]} color="#9b6d4c" />
      {["#c45f54", "#657ca8", "#5f8d80", "#bb8748"].map((color, index) => <Block key={color} args={[0.5, 0.62, 0.5]} position={[-2.55 + index * 0.72, 1.08, 0.65]} color={color} />)}
      <group position={[1.75, 0, -0.55]}><Block args={[0.35, 3.15, 0.5]} position={[-0.95, 1.58, 0]} color="#45635f" /><Block args={[0.35, 3.15, 0.5]} position={[0.95, 1.58, 0]} color="#45635f" /><Block args={[2.2, 0.35, 0.5]} position={[0, 3.05, 0]} color="#45635f" /></group>
      <PassportAnimation />
      <Hotspot position={[-1.45, 1.65, 0.65]} label="identity stamping desk" onClick={() => onSelect("stampDesk")} />
      <Hotspot position={[1.75, 3.35, -0.55]} label="verification gate" onClick={() => onSelect("gate")} />
      <Hotspot position={[-0.8, 0.95, -1.1]} label="attributed action parcel" onClick={() => onSelect("parcel")} />
    </>
  );
}

function UncertaintyRoom({ room, onSelect }) {
  return (
    <>
      <mesh position={[0, 0.8, 0.15]} castShadow receiveShadow><cylinderGeometry args={[1.75, 1.5, 0.25, 36]} /><meshStandardMaterial color="#c6ae77" roughness={0.9} /></mesh>
      <mesh position={[0, 0.95, 0.15]} rotation={[-Math.PI / 2, 0, 0]}><torusGeometry args={[0.95, 0.035, 10, 48]} /><meshStandardMaterial color={room.accent} /></mesh>
      <group position={[-2.6, 0, -1]}><mesh position={[0, 0.9, 0]} castShadow><cylinderGeometry args={[0.36, 0.55, 1.8, 12]} /><meshStandardMaterial color="#e9e5db" /></mesh><mesh position={[0, 1.6, 0]} castShadow><cylinderGeometry args={[0.42, 0.42, 0.55, 12]} /><meshStandardMaterial color="#d96759" emissive="#f2d66f" emissiveIntensity={0.35} /></mesh></group>
      <group position={[2.4, 0, -1.3]}>{[[0, 0], [0.7, 0], [0, 0.75], [0.7, 0.75]].map(([x, y], index) => <Block key={index} args={[0.58, 0.58, 0.3]} position={[x, 1.2 + y, 0]} color={index === 3 ? room.accent : room.secondary} />)}</group>
      <UncertaintyAnimation />
      <Hotspot position={[0, 1.45, 0.15]} label="ambiguous navigation table" onClick={() => onSelect("table")} />
      <Hotspot position={[2.75, 2.45, -1.25]} label="confidence instruments" onClick={() => onSelect("meters")} />
      <Hotspot position={[-2.6, 2, -1]} label="clarification lighthouse" onClick={() => onSelect("lighthouse")} />
    </>
  );
}

const FURNITURE = { permission: LockerRoom, reliability: ReliabilityRoom, ledger: LedgerRoom, shutdown: ShutdownRoom, identity: IdentityRoom, uncertainty: UncertaintyRoom };

function Scene({ room, focus, onFocus, onSelectObject }) {
  const controlsRef = useRef();
  const Furniture = FURNITURE[room.id];
  return (
    <>
      <color attach="background" args={["#303331"]} />
      <fog attach="fog" args={["#303331", 15, 26]} />
      <ambientLight intensity={1.35} />
      <directionalLight position={[-5, 9, 7]} intensity={2.4} castShadow shadow-mapSize={[2048, 2048]} shadow-camera-left={-7} shadow-camera-right={7} shadow-camera-top={7} shadow-camera-bottom={-7} />
      <pointLight position={[3, 3.2, 1]} color={room.secondary} intensity={9} distance={7} decay={2} />
      <RoomShell room={room} onFocus={onFocus} />
      <Furniture room={room} onSelect={onSelectObject} />
      <ContactShadows position={[0, 0.04, 0]} scale={11} opacity={0.45} blur={2.8} far={5} color="#161917" />
      <CameraRig focus={focus} controlsRef={controlsRef} />
    </>
  );
}

function RoomCanvas({ room, focus, onFocus, onSelectObject }) {
  return (
    <div className="canvas-wrap" role="img" aria-label={`Navigable 2.5D model of the ${room.title}`}>
      <Canvas orthographic shadows dpr={[1, 1.75]} camera={{ position: VIEWS.overview.position, zoom: VIEWS.overview.zoom, near: 0.1, far: 100 }} gl={{ antialias: true, alpha: false }} onPointerMissed={() => onSelectObject(null)}>
        <Scene room={room} focus={focus} onFocus={onFocus} onSelectObject={onSelectObject} />
      </Canvas>
    </div>
  );
}

export default memo(RoomCanvas);
