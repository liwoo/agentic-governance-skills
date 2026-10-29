# The Governance House

An interactive React and Three.js field guide to six agent-governance practices, introduced by an animated opening slide about developers’ responsibility for the systems they build. Each room tells a five-beat visual story: encounter a problem, enforce the safeguard, and show the consequence.

| Principle | Room | What the audience sees |
| --- | --- | --- |
| Identity | The Passport Checkpoint | An unsigned parcel is held, receives four identity stamps, and crosses only after signature verification. |
| Reliability | The Proof Bridge | One failed span blocks the workflow. Repair, fresh tests, and interface checks make the crossing possible. |
| Permission | The Single-Use Vault | Reads use an open lane. An exact human approval unlocks one deletion, is consumed, and cannot be reused. |
| Uncertainty | The Clarification Junction | A train waits at a red signal between two Alexes. A targeted question resolves the destination before departure. |
| Ledger | The Evidence Press | Intent enters the archive before execution; outcome follows. Altering an old receipt visibly breaks the hash seal. |
| Shutdown | The Emergency Power Room | An independent breaker stops work, disconnects credentials, then settles records and notifications. It stays stopped. |

## Run locally

Requirements: Node.js 20.19+ or 22.12+, and npm.

```bash
npm install
npm run dev
```

The app opens with **You are the Governance Layer**, a cover with a hand-drawn cutaway of the house: six numbered rooms in their safeguard colours, and the flight-booking agent handing its ticket to a person at the front door. The presenter’s details sit in the footer. **Begin the talk** (or Enter, Space, or Right Arrow while the title is focused) opens **Because you are the risk** The introduction’s **← Cover** button returns to the title. The introduction traces frontier models through developer-built agents to exposed private data, financial loss, and service disruption, then adds safeguards into that action path. The harms remain visible after the controls appear, with illustrative failure scenarios behind their info icons. It plays once over three beats and holds the final state; pause, replay, or select any beat. Reduced-motion visitors start with the complete, still diagram. **Explore the six safeguards** enters Identity; individual safeguard links jump to their rooms. Use **Introduction** in the rail, or Previous from Identity, to return. After Shutdown, Next opens a matching **Thank you** cover, where the agent and the person wave goodbye, with a locally generated QR code for **https://chienda.com/speaking**. The **Thank you** rail button also opens it directly, including on mobile. **Back to the talk** returns to Shutdown. The introduction renders without WebGL and defers the 3D bundle until a room opens.

Each room story plays once, then holds its final state. Captions, highlighted steps, and props share one timeline. Pause or replay with the controls below the room; selecting any step freezes a representative state for inspection. Drag to orbit and scroll or pinch to zoom. Glowing `+` markers explain the props. Wall controls open the risks and implementation checklist, pausing playback while you read.

Visitors who prefer reduced motion start with a still scene and can select steps without animation. Playback is available by explicit choice. Pausing freezes the process, and returning from a background tab does not jump past the story.

## Production build

```bash
npm run build
npm run preview
```

Static output is written to `dist/`. The Vite base is relative, supporting root domains or subdirectories. For a Git-based host, use `npm install`, build with `npm run build`, and publish `dist`.

## Structure

- `src/App.jsx` — navigation, synchronized narration, playback controls, inspector, and persistent checklists
- `src/components/CoverSlide.jsx` — title cover, presenter footer, and entry into the introduction
- `src/components/CoverArt.jsx` — inline SVG cover illustration, with a waving variant for the closing cover
- `src/components/IntroSlide.jsx` — opening argument, animated model-to-action diagram, research context, and entry controls
- `src/usePlayback.js` — shared playback clock, pause, replay, seeking, and reduced-motion preference
- `src/components/RoomCanvas.jsx` — room shell, responsive camera, lighting, and wall boards
- `src/components/GovernanceScenes.jsx` — six deterministic, time-driven illustrations
- `src/data/stories.js` — the five beats, plain-language analogies, and takeaways
- `src/data/rooms.js` — room assembly, preventable failures, and prop meanings
- `src/data/engineering.js` — residual risks, companion safeguards, implementation tasks, and acceptance tests
- `src/styles.css` — desktop and mobile presentation

Scene transforms read the clock directly each frame; React updates at story boundaries. Seeking computes a scene from its time rather than relying on earlier animation having run. Keep the narration and scene timing aligned when changing a beat. Each beat lasts four seconds.

Checklists persist locally under a versioned key, with an in-memory fallback if browser storage is unavailable. No backend or environment variables are required.

## Reviewing an illustration

For each room, check the blocked state, the control being applied, and the resulting permitted or stopped state. Step backward as well as forward, and verify that replay resets the scene. Review at desktop and mobile widths, with reduced motion on and off. The analogy must preserve the limits of the control: identity is not permission, component tests do not replace interface tests, clarification is not approval, hash links detect tampering, and stopping computation alone does not revoke authority.

## Governance principles and sources

Each room now shows the core governance principles its control supports. Open **Governance** to see compact principle cards. Their info icons reveal the definition, the room’s contribution, evidence to retain, and official references; the supporting info rows cover remaining work and scope. Story-view principle chips open the matching explanation. The mappings draw on the OECD AI Principles, NIST AI RMF 1.0, and the EU AI Act, with law distinguished from voluntary guidance. Privacy and fairness are identified as areas requiring additional controls.

The mappings are an educational interpretation, not a compliance assessment. Legal applicability depends on the system, use, role, jurisdiction, and dates. Source links and review metadata live in `src/data/governance.js`; the source review is documented in `GOVERNANCE-SOURCES.md`.

Risk and checklist walls open as readable text boards over the room, independent of 3D text resolution. Checkboxes update both the reading board and the 3D preview and persist locally. Press Escape or use Back to the room to return to the illustration.

## Engineering and residual risk

Each risk wall separates failures addressed by the control from risks that remain even when it works. “Works with” links to companion rooms and explains the role of each layer. The same connections appear in the Story and Governance views. These are complementary controls, not a claim that six controls eliminate all risk.

The checklist initially shows three curated high-impact actions for each room. **More · all 8 actions** opens the complete task list; **Back to top 3** returns to the concise view. Each task’s info icon contains its implementation instruction and acceptance test. The full list includes an operational or cross-control failure scenario. Mark a task verified only after its acceptance test passes for the intended system; the visible progress count matches the currently shown tasks. Thresholds and deadlines must be chosen for that system’s context.

Risk, checklist, and Governance views show titles and compact cards by default. Supporting explanations live behind info icons that open on hover, keyboard focus, or tap. The floating panels support source links, stay inside the viewport, and close with Escape, the close button, or an outside click. Escape dismisses an open info panel before it closes a wall.

Acceptance-test progress uses stable task IDs under `governance-house-progress:v2`. The previous broad checklist’s v1 data is left intact but is not treated as evidence that the stronger tasks have been verified. Malformed, duplicate, or unknown saved task IDs are ignored. When materially changing an acceptance criterion, assign a new task ID.
