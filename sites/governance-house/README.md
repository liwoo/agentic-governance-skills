# The Governance House

An interactive React and Three.js field guide to six agent-governance practices. Each principle is represented as a navigable low-poly room with animated process props, a risk wall, and an implementation-checklist wall.

## Run locally

Requirements: Node.js 20 or newer and npm.

```bash
npm install
npm run dev
```

Vite prints the local URL. Drag inside a room to orbit, scroll or pinch to zoom, and select the wall controls or glowing markers to inspect the content.

The process scenes loop automatically: identity parcels cross a verification gate, test nodes move through a certification conveyor, approvals unlock the permission vault, ambiguity clears around a route, intent receipts enter the ledger, and the emergency sequence trips and revokes authority.

## Production build

```bash
npm run build
npm run preview
```

The deployable static output is written to `dist/`. The Vite base is relative, so the build can be hosted at a root domain or under a subdirectory.

## Deploy it yourself

For Vercel, Netlify, Cloudflare Pages, or another Git-based host, use:

- Build command: `npm run build`
- Output directory: `dist`
- Install command: `npm install`

For a plain static host, run `npm run build` and upload the contents of `dist/`.

## Structure

- `src/App.jsx` — application shell, room navigation, inspector, and persistent checklists
- `src/components/RoomCanvas.jsx` — orthographic Three.js room, camera navigation, walls, and low-poly props
- `src/data/rooms.js` — the six principles and their room content
- `src/styles.css` — full-screen interface and responsive presentation

Checklist progress is stored locally in the visitor's browser under a versioned key. No backend or environment variables are required.
