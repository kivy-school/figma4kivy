# figma4kivy

Figma plugin that serialises your design tree and sends it to a local [FigmaVaporServer](../FigmaVaporServer) for conversion to Kivy `.kv` layout files.

## How it works

```
Figma plugin  →  HTTP POST /kv  →  FigmaVaporServer  →  Figma2Kv (Swift)  →  .kv output
                 HTTP POST /json-dump  (raw node dump, always sent)
                 WebSocket /ws         (bidirectional — server can drive Figma API)
```

The plugin UI runs inside Figma's iframe sandbox.  The sandbox code (`code.ts`) serialises selected nodes and posts them to the UI.  The UI (`index.ts`) forwards the payload to the server over plain HTTP and/or a persistent WebSocket.

---

## Prerequisites

- **Node.js** ≥ 18 and **npm**
- **Figma desktop app** (browser Figma does not support local plugins)
- **FigmaVaporServer** running on `http://localhost:8765` (see [server setup](#server-setup))

---

## Build

```bash
cd figma4kivy
npm install
npm run build
```

Output is written to `dist/`:

| File | Purpose |
|---|---|
| `dist/index.html` | Plugin UI (all JS inlined, no external requests) |
| `dist/code.js` | Plugin sandbox code (runs in Figma main thread) |

---

## Install in Figma

1. Open the Figma desktop app.
2. Go to **Plugins → Development → Import plugin from manifest…**
3. Select `figma4kivy/manifest.json`.
4. The plugin now appears under **Plugins → Development → figma4kivy**.

> The plugin reads `dist/` at runtime, so a rebuild is all that's needed to pick up changes — no reinstall required.

---

## Server setup

The server is a Swift Vapor app in `FigmaVaporServer/`.

```bash
cd FigmaVaporServer
swift run
```

It listens on `http://localhost:8765`.  It resolves Swift package dependencies on first run (takes ~30 s).

### Endpoints

| Method | Path | Body | Purpose |
|---|---|---|---|
| `POST` | `/json-dump` | JSON array of Figma nodes | Pretty-prints the raw node tree to the server console |
| `POST` | `/kv` | JSON array of Figma nodes | Returns generated `.kv` text |
| `WS` | `/ws` | — | Persistent connection; server can push JS commands that run in the Figma Plugin API |

---

## Using the plugin

Run the plugin from **Plugins → Development → figma4kivy**.

### UI buttons

| Button | What it does |
|---|---|
| **Convert selection** | Serialise the current Figma selection (or the whole page if nothing is selected) and send it to the server once. |
| **⦿ Live** | Toggle live mode — automatically re-sends whenever the selection or document changes. |
| **KV** | Toggle KV output visibility.  When off, the `/kv` request is skipped and only `/json-dump` is sent — useful when you only need the raw JSON.  Automatically disabled when you send the plugin to the background. |
| **Copy KV** | Copy the last KV output to the clipboard. |
| **Server URL** | The base URL of the running server.  Defaults to `http://localhost:8765`. |
| **Connect** | Arm the HTTP connection.  When active, every conversion result is posted to the server.  When inactive the plugin only shows output locally (if KV is on). |
| **⇄ WS** | Open a WebSocket to `/ws`.  Auto-reconnects every 2 s if the connection drops.  The server can push arbitrary Figma Plugin API JS through this channel. |
| **⬇ Background** | Hide the plugin UI (sends it to background).  KV is automatically disabled to avoid unnecessary processing while the panel is hidden. |

### Typical workflow

1. Start the server: `swift run` inside `FigmaVaporServer/`.
2. Select one or more frames in Figma.
3. Run the plugin.
4. Click **Connect** so the server URL is active.
5. Click **Convert selection** — the `.kv` output appears in the panel and is printed to the server console.
6. Enable **⦿ Live** to keep the output in sync as you edit.
7. Click **Copy KV** to copy the result to your clipboard.

---

## Development

```bash
npm run dev   # Vite dev server (UI hot-reload only — code.ts still needs a full build)
npm run build # Production build → dist/
```

`scripts/inline.mjs` post-processes the Vite output to inline all assets into a single `dist/index.html` so Figma's sandboxed iframe can load it without a web server.
