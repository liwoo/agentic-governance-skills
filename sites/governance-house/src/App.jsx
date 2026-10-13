import { Component, Suspense, lazy, startTransition, useEffect, useState } from "react";
import { usePlayback } from "./usePlayback.js";
import { rooms } from "./data/rooms.js";
import GovernancePanel, { PrincipleChips } from "./components/GovernancePanel.jsx";
import WallReader from "./components/WallReader.jsx";
import IntroSlide from "./components/IntroSlide.jsx";
import SafeguardConnections from "./components/SafeguardConnections.jsx";

const RoomCanvas = lazy(() => import("./components/RoomCanvas.jsx"));
// Stronger acceptance criteria start fresh; retain legacy v1 data without reusing its ticks.
const STORAGE_KEY = "governance-house-progress:v2";

function readProgress() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (value?.version !== 2 || !value.rooms || typeof value.rooms !== "object") return {};
    return Object.fromEntries(rooms.map((room) => {
      const saved = Array.isArray(value.rooms[room.id]) ? value.rooms[room.id] : [];
      return [room.id, room.checks.filter((check) => saved.includes(check.id)).map((check) => check.id)];
    }));
  } catch {
    return {};
  }
}

class SceneErrorBoundary extends Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return (
        <div className="scene-fallback scene-error" role="alert">
          <span>3D view unavailable</span>
          <p>Your browser needs WebGL enabled to enter the room.</p>
        </div>
      );
    }
    return this.props.children;
  }
}

function LoadingRoom() {
  return (
    <div className="scene-fallback" aria-live="polite">
      <span className="loading-cube" aria-hidden="true" />
      <p>Building the room…</p>
    </div>
  );
}

function App() {
  const [showIntro, setShowIntro] = useState(true);
  const [activeIndex, setActiveIndex] = useState(0);
  const [focus, setFocus] = useState("overview");
  const [selectedObject, setSelectedObject] = useState(null);
  const [inspectorView, setInspectorView] = useState("story");
  const [selectedPrinciple, setSelectedPrinciple] = useState(null);
  const [progress, setProgress] = useState(readProgress);
  const room = rooms[activeIndex];
  const playback = usePlayback(room.id, room.story.steps.length, !showIntro && focus === "overview");
  const beat = room.story.steps[playback.phase];
  const selectedDetail = selectedObject ? room.objects[selectedObject] : null;
  const completed = progress[room.id] || [];

  useEffect(() => {
    if (!showIntro) document.getElementById("room-title")?.focus({ preventScroll: true });
  }, [showIntro]);

  function openIntro() {
    setShowIntro(true);
    window.scrollTo(0, 0);
  }

  function chooseRoom(index, nextFocus = "overview") {
    if (nextFocus !== "overview" && playback.playing) playback.toggle();
    if (showIntro && nextFocus === "overview" && !playback.reducedMotion) playback.replay();
    startTransition(() => {
      setShowIntro(false);
      setActiveIndex((index + rooms.length) % rooms.length);
      setFocus(nextFocus);
      if (nextFocus !== "overview") setInspectorView("governance");
      setSelectedObject(null);
      setSelectedPrinciple(null);
    });
    if (showIntro) window.scrollTo(0, 0);
  }

  function openConnectedRoom(roomId) {
    const index = rooms.findIndex((item) => item.id === roomId);
    if (index < 0) return;
    chooseRoom(index, "risks");
    if (window.matchMedia("(max-width: 800px)").matches) {
      document.querySelector(".room-stage")?.scrollIntoView({ block: "start" });
    }
  }

  function chooseFocus(nextFocus) {
    if (nextFocus !== "overview" && playback.playing) playback.toggle();
    if (nextFocus !== "overview") setInspectorView("governance");
    setFocus(nextFocus);
    setSelectedObject(null);
  }

  function openPrinciple(principle = null) {
    if (playback.playing) playback.toggle();
    setSelectedObject(null);
    setSelectedPrinciple(principle);
    setInspectorView("governance");
    if (window.matchMedia("(max-width: 800px)").matches) {
      requestAnimationFrame(() => document.getElementById("governance-panel-heading")?.scrollIntoView({ block: "start" }));
    }
  }

  function toggleCheck(id) {
    setProgress((current) => {
      const existing = current[room.id] || [];
      const nextRoom = existing.includes(id)
        ? existing.filter((item) => item !== id)
        : [...existing, id];
      const next = { ...current, [room.id]: nextRoom };
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 2, rooms: next })); } catch { /* Keep progress in memory when storage is unavailable. */ }
      return next;
    });
  }

  return (
    <div className="app-shell" style={{ "--accent": showIntro ? "#d8b783" : room.accent, "--secondary": showIntro ? "#86b6a0" : room.secondary, "--room-progress": `${((activeIndex + 1) / rooms.length) * 100}%` }}>
      <header className="app-header">
        <div className="brand-lockup">
          <span className="brand-cube" aria-hidden="true"><i /><i /><i /></span>
          <span><strong>The Governance House</strong><small>Six safeguards. See why they work.</small></span>
        </div>
        <div className="header-status"><span className="status-dot" /> {showIntro ? "Introduction" : `Room ${room.number} of 06`}</div>
      </header>

      <main className={`room-viewer ${showIntro ? "is-intro" : ""}`}>
        <nav className="room-rail" aria-label="Choose a governance room">
          <p>Story path</p>
          <button type="button" className={showIntro ? "is-active" : ""} aria-current={showIntro ? "page" : undefined} onClick={openIntro}><span>00</span><strong>Introduction</strong></button>
          {rooms.map((item, index) => (
            <button
              key={item.id}
              className={!showIntro && index === activeIndex ? "is-active" : ""}
              type="button"
              onClick={() => chooseRoom(index)}
              aria-current={!showIntro && index === activeIndex ? "page" : undefined}
              title={item.title}
            >
              <span>{item.number}</span>
              <strong>{item.short}</strong>
            </button>
          ))}
        </nav>

        {showIntro ? <IntroSlide onEnter={() => { setInspectorView("story"); chooseRoom(0); }} onRoom={(index) => { setInspectorView("story"); chooseRoom(index); }} /> : <>
        <section className="room-stage" data-focus={focus} aria-labelledby="room-title">
          <div className="room-title-block">
            <p>{room.principle}</p>
            <h1 id="room-title" tabIndex={-1}>{room.title}</h1>
            <span>{room.question}</span>
          </div>

          <div className="camera-toolbar" aria-label="Room views">
            <span>View</span>
            {[
              ["overview", "Room"],
              ["risks", "Risk wall"],
              ["checklist", "Checklist wall"],
            ].map(([value, label]) => (
              <button key={value} type="button" className={focus === value ? "is-active" : ""} aria-pressed={focus === value} onClick={() => chooseFocus(value)}>{label}</button>
            ))}
          </div>

          <SceneErrorBoundary>
            <Suspense fallback={<LoadingRoom />}>
              <RoomCanvas
                room={room}
                timeline={playback.timeline}
                phase={playback.phase}
                completed={completed}
                focus={focus}
                onFocus={chooseFocus}
                onSelectObject={setSelectedObject}
              />
            </Suspense>
          </SceneErrorBoundary>

          {focus !== "overview" ? <WallReader key={`${room.id}-${focus}`} room={room} kind={focus} completed={completed} onToggle={toggleCheck} onClose={() => chooseFocus("overview")} onRoom={openConnectedRoom} /> : null}

          <div className="orbit-hint"><span aria-hidden="true">↻</span> Drag to explore · + to inspect</div>

          <section className={`story-player story-${beat.tone}`} aria-label="Illustration playback" hidden={focus !== "overview"}>
            <div className="story-caption" aria-live={playback.playing ? "off" : "polite"} aria-atomic="true">
              <div className="story-kicker"><span className="beat-indicator" />{playback.finished ? "Story complete" : playback.playing ? "Watch what happens" : "Paused · explore each step"}<span>{playback.phase + 1} / {room.story.steps.length}</span></div>
              <h2>{beat.title}</h2>
              <p>{beat.body}</p>
            </div>
            <div className="playback-controls">
              <button type="button" className="play-toggle" onClick={() => { chooseFocus("overview"); playback.toggle(); }} aria-label={playback.finished ? "Replay illustration" : playback.playing ? "Pause illustration" : "Play illustration"}>{playback.finished ? "↺" : playback.playing ? "Ⅱ" : "▶"}</button>
              <div className="beat-segments" aria-label="Jump to story step">{room.story.steps.map((step, index) => <button key={step.label} type="button" onClick={() => { chooseFocus("overview"); playback.seek(index); }} className={index === playback.phase ? "is-current" : index < playback.phase ? "is-past" : ""} aria-label={`Step ${index + 1}: ${step.label}`} aria-current={index === playback.phase ? "step" : undefined}><span /><small>{step.label}</small></button>)}</div>
              <button className="replay-button" type="button" onClick={() => { chooseFocus("overview"); playback.replay(); }} aria-label="Restart illustration" title="Restart illustration">↺</button>
            </div>
          </section>

          <div className="room-switcher">
            <button type="button" onClick={() => activeIndex === 0 ? openIntro() : chooseRoom(activeIndex - 1)} aria-label="Previous room">←</button>
            <div><span>{room.number}</span><i /></div>
            <button type="button" onClick={() => chooseRoom(activeIndex + 1)} aria-label="Next room">→</button>
          </div>
        </section>

        <aside className={`inspector inspector-${focus}`}>
          <div className="inspector-topline"><span>{selectedDetail ? "Object inspection" : inspectorView === "governance" ? "Governance connections" : "Room principle"}</span><b>{room.number}</b></div>

          <div className="inspector-tabs" aria-label="Inspector view">
            <button type="button" aria-pressed={inspectorView === "story" && !selectedDetail} onClick={() => { chooseFocus("overview"); setInspectorView("story"); }}>Story</button>
            <button type="button" aria-pressed={inspectorView === "governance" && !selectedDetail} onClick={() => openPrinciple()}>Governance</button>
          </div>

          {selectedDetail ? (
            <div className="object-detail">
              <button type="button" onClick={() => setSelectedObject(null)} aria-label="Close object detail">×</button>
              <div className="object-glyph" aria-hidden="true">◇</div>
              <h2>{selectedDetail.title}</h2>
              <p>{selectedDetail.body}</p>
            </div>
          ) : inspectorView === "governance" ? (
            <GovernancePanel key={`${room.id}-${selectedPrinciple || "default"}`} room={room} selectedPrinciple={selectedPrinciple} onRoom={openConnectedRoom} />
          ) : (
            <div className="inspector-content overview-copy">
              <p className="section-tag">What this room teaches</p>
              <h2>{room.question}</h2>
              <p className="room-takeaway">{room.story.takeaway}</p>
              <p>{room.story.analogy}</p>
              <div className="overview-principles"><p>Core principles supported</p><PrincipleChips roomId={room.id} onOpen={openPrinciple} /></div>
              <ol className="story-beats" aria-label="The illustrated safeguard">{room.story.steps.map((step, index) => <li key={step.label}><button type="button" onClick={() => { chooseFocus("overview"); playback.seek(index); }} className={index === playback.phase ? "is-current" : ""} aria-current={index === playback.phase ? "step" : undefined}><span>{String(index + 1).padStart(2, "0")}</span><strong>{step.label}</strong>{index === playback.phase ? <i aria-hidden="true">←</i> : null}</button></li>)}</ol>
              <SafeguardConnections room={room} onRoom={openConnectedRoom} />
              <details className="principle-detail"><summary>Technical safeguard</summary><p>{room.summary}</p></details>
              <p className="playback-note">{playback.reducedMotion ? "Reduced motion is on. Choose a step to explore a still scene, or press play." : "Choose any step to pause and inspect it. Each story plays once; replay whenever you like."}</p>
            </div>
          )}

          <div className="wall-shortcuts">
            <button type="button" onClick={() => chooseFocus("risks")}><span>!</span> Read risk wall</button>
            <button type="button" onClick={() => chooseFocus("checklist")}><span>✓</span> Open checklist</button>
          </div>
        </aside>
        </>}
      </main>
    </div>
  );
}

export default App;
