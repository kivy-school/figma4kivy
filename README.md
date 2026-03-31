# figma4kivy

Figma plugin that serialises your design tree and streams it to a local [FigmaVaporServer](../FigmaVaporServer) for live conversion to Kivy canvas code and `.kv` layout files.

## How it works

```
Figma plugin  →  POST /canvas-py        →  FigmaVaporServer  →  Python canvas code (SSE stream)
              →  POST /canvas-py/json-dump                    →  pretty-printed raw JSON
              →  POST /kv                                     →  .kv layout output
              →  WebSocket /ws                                →  bidirectional (server → Figma API)
```

The plugin shell (`index.ts`) hosts an iframe that loads server-rendered pages. When connected, `code.ts` tracks selection/document changes and pushes serialised node trees to the server. The active server page receives pushes over SSE and renders output in real time.

---

## Prerequisites

- **Node.js** ≥ 18 and **npm**
- **Figma desktop app** (browser Figma does not support local plugins)
- **FigmaVaporServer** running on `http://localhost:8765`

---

## Build

```bash
cd figma4kivy
npm install
npm run build
```

Output written to `dist/`:

| File | Purpose |
|---|---|
| `dist/index.html` | Plugin UI (all JS inlined) |
| `dist/code.js` | Plugin sandbox code (runs in Figma main thread) |

---

## Install in Figma

1. Open the Figma desktop app.
2. **Plugins → Development → Import plugin from manifest…**
3. Select `figma4kivy/manifest.json`.

Rebuilding is all that's needed to pick up changes — no reinstall required.

---

## Server setup

```bash
cd FigmaVaporServer
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer swift run
```

Listens on `http://localhost:8765`.

---

## Plugin UI

### URL bar

| Control | What it does |
|---|---|
| **Server URL** | Base URL of the running server. Defaults to `http://localhost:8765`. |
| **Connect** | Connects to the server — loads the active tab into the iframe and starts streaming node data on every selection/document change. Click again to disconnect. |
| **Background** | Hides the plugin panel (`figma.ui.hide()`). The live stream keeps running — the server continues to receive updates while the panel is invisible. |

### Tabs

Each tab loads a different server-rendered page into the iframe. The server page subscribes to the SSE stream and renders output in place.

| Tab | Route | Purpose |
|---|---|---|
| **Lab** | `/lab` | Experimental / utility actions |
| **KV** | `/kv` | `.kv` layout output from the current selection |
| **Canvas** | `/canvas-py` | Python Kivy canvas code — live preview, kivy mode, debug JSON |

### Canvas tab features

- **Kivy Mode** — starts the Docker container running a live Kivy/VNC preview that reloads on every push. Stops the container when toggled off.
- **Debug JSON** — shows the raw Figma node JSON sent with the last push in a second editor pane.
- **Lock** — pins the push to the current selection so document-wide changes don't trigger spurious reloads.
- **Scalable** — generates percentage-based positions instead of fixed pixel values.

### Resize handles

Drag the bottom-right dot to resize both width and height. Drag the bottom-left dot to resize height only.

---

## Development

```bash
npm run dev   # Vite dev server (UI hot-reload only — code.ts still needs a full build)
npm run build # Production build → dist/
```

`scripts/inline.mjs` post-processes the Vite output to inline all assets into a single `dist/index.html` so Figma's sandboxed iframe can load it without a web server.
