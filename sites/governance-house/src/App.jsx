import { Component, Suspense, lazy, startTransition, useState } from "react";
import { rooms } from "./data/rooms.js";

const RoomCanvas = lazy(() => import("./components/RoomCanvas.jsx"));
const STORAGE_KEY = "governance-house-progress:v1";

function readProgress() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    return value?.version === 1 && value.rooms ? value.rooms : {};
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
  const [activeIndex, setActiveIndex] = useState(0);
  const [focus, setFocus] = useState("overview");
  const [selectedObject, setSelectedObject] = useState(null);
  const [progress, setProgress] = useState(readProgress);
  const room = rooms[activeIndex];
  const selectedDetail = selectedObject ? room.objects[selectedObject] : null;
  const completed = progress[room.id] || [];

  function chooseRoom(index) {
    startTransition(() => {
      setActiveIndex((index + rooms.length) % rooms.length);
      setFocus("overview");
      setSelectedObject(null);
    });
  }

  function chooseFocus(nextFocus) {
    setFocus(nextFocus);
    setSelectedObject(null);
  }

  function toggleCheck(index) {
    setProgress((current) => {
      const existing = current[room.id] || [];
      const nextRoom = existing.includes(index)
        ? existing.filter((item) => item !== index)
        : [...existing, index];
      const next = { ...current, [room.id]: nextRoom };
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, rooms: next }));
      return next;
    });
  }

  return (
    <div className="app-shell" style={{ "--accent": room.accent, "--secondary": room.secondary, "--room-progress": `${((activeIndex + 1) / rooms.length) * 100}%` }}>
      <header className="app-header">
        <div className="brand-lockup">
          <span className="brand-cube" aria-hidden="true"><i /><i /><i /></span>
          <span><strong>The Governance House</strong><small>Interactive 2.5D field guide</small></span>
        </div>
        <div className="header-status"><span className="status-dot" /> Room {room.number} of 06</div>
      </header>

      <main className="room-viewer">
        <nav className="room-rail" aria-label="Choose a governance room">
          <p>Story path</p>
          {rooms.map((item, index) => (
            <button
              key={item.id}
              className={index === activeIndex ? "is-active" : ""}
              type="button"
              onClick={() => chooseRoom(index)}
              aria-current={index === activeIndex ? "page" : undefined}
              title={item.title}
            >
              <span>{item.number}</span>
              <strong>{item.short}</strong>
            </button>
          ))}
        </nav>

        <section className="room-stage" aria-labelledby="room-title">
          <div className="room-title-block">
            <p>{room.principle}</p>
            <h1 id="room-title">{room.title}</h1>
            <span>{room.question}</span>
          </div>

          <div className="camera-toolbar" aria-label="Camera positions">
            <span>View</span>
            {[
              ["overview", "Room"],
              ["risks", "Risk wall"],
              ["checklist", "Checklist wall"],
            ].map(([value, label]) => (
              <button key={value} type="button" className={focus === value ? "is-active" : ""} onClick={() => chooseFocus(value)}>{label}</button>
            ))}
          </div>

          <SceneErrorBoundary key={room.id}>
            <Suspense fallback={<LoadingRoom />}>
              <RoomCanvas
                room={room}
                focus={focus}
                onFocus={chooseFocus}
                onSelectObject={setSelectedObject}
              />
            </Suspense>
          </SceneErrorBoundary>

          <div className="orbit-hint"><span aria-hidden="true">↻</span> Process loops automatically · Drag to orbit · Click props to inspect</div>

          <div className="room-switcher">
            <button type="button" onClick={() => chooseRoom(activeIndex - 1)} aria-label="Previous room">←</button>
            <div><span>{room.number}</span><i /></div>
            <button type="button" onClick={() => chooseRoom(activeIndex + 1)} aria-label="Next room">→</button>
          </div>
        </section>

        <aside className={`inspector inspector-${focus}`} aria-live="polite">
          <div className="inspector-topline"><span>{selectedDetail ? "Object inspection" : focus === "risks" ? "Risk whiteboard" : focus === "checklist" ? "Implementation checklist" : "Room principle"}</span><b>{room.number}</b></div>

          {selectedDetail ? (
            <div className="object-detail">
              <button type="button" onClick={() => setSelectedObject(null)} aria-label="Close object detail">×</button>
              <div className="object-glyph" aria-hidden="true">◇</div>
              <h2>{selectedDetail.title}</h2>
              <p>{selectedDetail.body}</p>
            </div>
          ) : focus === "risks" ? (
            <div className="inspector-content">
              <p className="section-tag">If this room is missing</p>
              <h2>Risks if ignored</h2>
              <ul className="risk-list">{room.risks.map((risk, index) => <li key={risk}><span>0{index + 1}</span>{risk}</li>)}</ul>
            </div>
          ) : focus === "checklist" ? (
            <div className="inspector-content">
              <p className="section-tag">{completed.length}/{room.checks.length} complete</p>
              <h2>How to address it</h2>
              <div className="check-list">
                {room.checks.map((item, index) => {
                  const isDone = completed.includes(index);
                  return <button key={item} type="button" className={isDone ? "is-done" : ""} onClick={() => toggleCheck(index)} aria-pressed={isDone}><span>{isDone ? "✓" : ""}</span>{item}</button>;
                })}
              </div>
            </div>
          ) : (
            <div className="inspector-content overview-copy">
              <p className="section-tag">What this room teaches</p>
              <h2>{room.question}</h2>
              <p>{room.summary}</p>
              <div className="process-flow" aria-label={`Animated process: ${room.process.join(", then ")}`}>
                <small>Animated process</small>
                <div>{room.process.map((step, index) => <span key={step}>{step}{index < room.process.length - 1 ? <i aria-hidden="true">→</i> : null}</span>)}</div>
              </div>
              <div className="inspect-prompt"><i>+</i><span>Choose a glowing marker inside the room to inspect its meaning.</span></div>
            </div>
          )}

          <div className="wall-shortcuts">
            <button type="button" onClick={() => chooseFocus("risks")}><span>!</span> Read risk wall</button>
            <button type="button" onClick={() => chooseFocus("checklist")}><span>✓</span> Open checklist</button>
          </div>
        </aside>
      </main>
    </div>
  );
}

export default App;
