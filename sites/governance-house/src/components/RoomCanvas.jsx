import { memo, useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { ContactShadows, OrbitControls, RoundedBox } from "@react-three/drei";
import { CanvasTexture, Color, SRGBColorSpace, Vector3 } from "three";
import GovernanceScenes, { SceneOverlayContext } from "./GovernanceScenes.jsx";

const VIEWS = {
  overview: { position: [-8.6, 7.8, 10], target: [0, 1.15, -0.1], zoom: 68 },
  risks: { position: [-1.65, 2.35, 7], target: [-1.65, 2.35, -2.91], zoom: 104 },
  checklist: { position: [-6, 2.25, -0.7], target: [3.91, 2.25, -0.7], zoom: 102 },
};

function CameraRig({ focus, controlsRef, roomId }) {
  const { camera, size } = useThree();
  const moving = useRef(true);
  const reducedMotion = useRef(false);
  const goal = useRef(new Vector3(...VIEWS.overview.position));
  const target = useRef(new Vector3(...VIEWS.overview.target));
  const zoom = useRef(VIEWS.overview.zoom);

  useEffect(() => {
    reducedMotion.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const view = VIEWS[focus] || VIEWS.overview;
    goal.current.set(...view.position);
    target.current.set(...view.target);
    zoom.current = focus === "overview" ? Math.min(size.width / 11.5, size.height / 8.6) : Math.min(size.width / 5, size.height / 4.5);
    moving.current = true;
  }, [focus, roomId, size.width, size.height]);

  useFrame((_, delta) => {
    if (!moving.current || !controlsRef.current) return;
    const speed = reducedMotion.current ? 1 : 1 - Math.exp(-delta * 5.5);
    camera.position.lerp(goal.current, speed);
    controlsRef.current.target.lerp(target.current, speed);
    camera.zoom += (zoom.current - camera.zoom) * speed;
    camera.updateProjectionMatrix();
    controlsRef.current.update();
    if (camera.position.distanceTo(goal.current) < 0.025 && Math.abs(camera.zoom - zoom.current) < 0.08) moving.current = false;
  });

  return <OrbitControls ref={controlsRef} makeDefault enabled={focus === "overview"} enableDamping dampingFactor={0.08} minZoom={20} maxZoom={145} minPolarAngle={focus === "overview" ? 0.7 : 0} maxPolarAngle={focus === "overview" ? 1.38 : Math.PI} minAzimuthAngle={focus === "overview" ? -1.5 : -Math.PI} maxAzimuthAngle={focus === "overview" ? 0.3 : Math.PI} onStart={() => { moving.current = false; }} />;
}

function Block({ args, position, color, radius = 0.08, rotation, emissive, children, ...props }) {
  return (
    <RoundedBox args={args} position={position} rotation={rotation} radius={Math.min(radius, ...args.map((value) => value / 2 - 0.001))} smoothness={2} castShadow receiveShadow {...props}>
      <meshStandardMaterial color={color} roughness={0.78} metalness={0.03} emissive={emissive || "#000000"} emissiveIntensity={emissive ? 0.35 : 0} />
      {children}
    </RoundedBox>
  );
}

function WallBoard({ room, completed, kind, position, rotation = [0, 0, 0], accent, onClick }) {
  const isRisk = kind === "risks";
  const completionKey = completed.join(",");
  const texture = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 1024;
    canvas.height = 512;
    const context = canvas.getContext("2d");
    context.fillStyle = isRisk ? "#334843" : "#e8e3d9";
    context.fillRect(0, 0, 1024, 512);
    context.fillStyle = isRisk ? "#d9ba89" : "#8c6551";
    context.font = "bold 34px sans-serif";
    context.fillText(`${room.short.toUpperCase()} / ${isRisk ? "RISKS" : "CHECKLIST"}`, 54, 65);
    context.fillStyle = isRisk ? "#f0ede5" : "#2e3532";
    context.font = "25px sans-serif";
    const done = new Set(completionKey.split(",").filter(Boolean));
    const items = isRisk ? [...room.risks, `HOWEVER: ${room.limitation.title}`] : room.priorityChecks.map((id) => room.checks.find((item) => item.id === id));
    items.forEach((item, index) => {
      const y = 122 + index * 81;
      context.fillStyle = isRisk ? "#e4c69b" : "#45664d";
      context.fillText(isRisk ? String(index + 1).padStart(2, "0") : done.has(item.id) ? "✓" : "□", 54, y);
      context.fillStyle = isRisk ? "#f0ede5" : "#2e3532";
      let line = "";
      let row = 0;
      for (const word of (isRisk ? item : item.title).split(" ")) {
        const next = line ? `${line} ${word}` : word;
        if (context.measureText(next).width > 850 && line) {
          context.fillText(line, 108, y + row * 29);
          row += 1;
          line = word;
        } else line = next;
      }
      context.fillText(line, 108, y + row * 29);
    });
    context.font = "bold 22px sans-serif";
    context.fillStyle = isRisk ? "#e4c69b" : "#45664d";
    context.fillText(isRisk ? "OPEN RISK WALL →" : `TOP 3 · ${items.filter((item) => done.has(item.id)).length}/3 VERIFIED · OPEN →`, 54, 477);
    const result = new CanvasTexture(canvas);
    result.colorSpace = SRGBColorSpace;
    return result;
  }, [isRisk, room, completionKey]);
  // Dispose only after a texture is replaced or the room shell is unmounted.
  useEffect(() => () => texture.dispose(), [texture]);
  return (
    <group position={position} rotation={rotation}>
      <Block args={[2.7, 1.45, 0.12]} position={[0, 0, 0]} color={isRisk ? "#334843" : "#e8e3d9"} radius={0.05} />
      <mesh position={[0, 0, 0.07]} onClick={(event) => { event.stopPropagation(); onClick(); }}>
        <planeGeometry args={[2.58, 1.32]} />
        <meshBasicMaterial map={texture} toneMapped={false} />
      </mesh>
      <Block args={[0.55, 0.08, 0.18]} position={[0, 0.84, 0]} color={accent} />
    </group>
  );
}

function RoomShell({ room, onFocus, completed }) {
  return (
    <>
      <Block args={[8.4, 0.22, 6.4]} position={[0, -0.12, 0]} color={room.floor} radius={0.04} />
      <Block args={[8.4, 3.6, 0.22]} position={[0, 1.68, -3.08]} color={room.wall} radius={0.04} />
      <Block args={[0.22, 3.6, 6.4]} position={[4.08, 1.68, 0]} color={new Color(room.wall).offsetHSL(0, -0.03, -0.05)} radius={0.04} />
      <Block args={[5.4, 0.035, 3.7]} position={[-0.4, 0.03, 0.2]} color="#c5bba8" radius={0.18} />
      <WallBoard room={room} completed={completed} kind="risks" position={[-1.65, 2.35, -2.91]} accent={room.accent} onClick={() => onFocus("risks")} />
      <WallBoard room={room} completed={completed} kind="checklist" position={[3.91, 2.25, -0.7]} rotation={[0, -Math.PI / 2, 0]} accent={room.secondary} onClick={() => onFocus("checklist")} />
    </>
  );
}

function Scene({ room, focus, onFocus, onSelectObject, timeline, phase, overlayRef, completed }) {
  const controlsRef = useRef();
  return (
    <>
      <color attach="background" args={["#303331"]} />
      <fog attach="fog" args={["#303331", 15, 26]} />
      <ambientLight intensity={1.35} />
      <directionalLight position={[-5, 9, 7]} intensity={2.4} castShadow shadow-mapSize={[2048, 2048]} shadow-camera-left={-7} shadow-camera-right={7} shadow-camera-top={7} shadow-camera-bottom={-7} />
      <pointLight position={[3, 3.2, 1]} color={room.secondary} intensity={9} distance={7} decay={2} />
      <RoomShell room={room} onFocus={onFocus} completed={completed} />
      <SceneOverlayContext.Provider value={overlayRef}><group visible={focus === "overview"}><GovernanceScenes room={room} timeline={timeline} phase={phase} onSelect={onSelectObject} /></group></SceneOverlayContext.Provider>
      <ContactShadows key={room.id} frames={1} position={[0, -0.24, 0]} scale={11} opacity={0.45} blur={2.8} far={5} color="#161917" />
      <CameraRig focus={focus} controlsRef={controlsRef} roomId={room.id} />
    </>
  );
}

function RoomCanvas({ room, focus, onFocus, onSelectObject, timeline, phase, completed }) {
  // Drei labels must keep one DOM target as the canvas event system initializes.
  const overlayRef = useRef();
  return (
    <div className="canvas-wrap" role="group" aria-label={`Interactive illustration: ${room.title}`}>
      <Canvas orthographic shadows dpr={[1, 1.75]} camera={{ position: VIEWS.overview.position, zoom: VIEWS.overview.zoom, near: 0.1, far: 100 }} gl={{ antialias: true, alpha: false }} onPointerMissed={() => onSelectObject(null)}>
        <Scene room={room} focus={focus} onFocus={onFocus} onSelectObject={onSelectObject} timeline={timeline} phase={phase} overlayRef={overlayRef} completed={completed} />
      </Canvas>
      <div className="scene-overlays" ref={overlayRef} />
    </div>
  );
}

export default memo(RoomCanvas);
