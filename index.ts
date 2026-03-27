
const convertBtn    = document.getElementById("convertBtn")    as HTMLButtonElement;
const liveBtn       = document.getElementById("liveBtn")        as HTMLButtonElement;
const kvBtn         = document.getElementById("kvBtn")          as HTMLButtonElement;
const copyBtn       = document.getElementById("copyBtn")        as HTMLButtonElement;
const connectBtn    = document.getElementById("connectBtn")     as HTMLButtonElement;
const wsBtn         = document.getElementById("wsBtn")          as HTMLButtonElement;
const bgBtn         = document.getElementById("bgBtn")          as HTMLButtonElement;
const serverUrl     = document.getElementById("serverUrl")      as HTMLInputElement;
const output        = document.getElementById("output")         as HTMLDivElement;
const status        = document.getElementById("status")         as HTMLDivElement;

let connected   = false;
let liveMode    = false;
let kvEnabled   = true;
let wsActive    = false;
let ws: WebSocket | null = null;
let wsReconnectTimer: ReturnType<typeof setTimeout> | null = null;

function wsUrl(): string {
  return serverUrl.value.trim().replace(/^http/, "ws") + "/ws";
}

function connectWs() {
  if (ws && ws.readyState <= WebSocket.OPEN) return;
  status.textContent = "WS connecting…";
  ws = new WebSocket(wsUrl());

  ws.onopen = () => {
    wsBtn.classList.add("active");
    wsBtn.textContent = "⇄ WS (on)";
    status.textContent = "WS connected.";
    if (wsReconnectTimer) { clearTimeout(wsReconnectTimer); wsReconnectTimer = null; }
  };

  ws.onmessage = (e) => {
    try {
      const cmd = JSON.parse(e.data as string);
      parent.postMessage({ pluginMessage: { type: "figmaCmd", cmd } }, "*");
    } catch { /* ignore malformed */ }
  };

  ws.onclose = () => {
    wsBtn.classList.remove("active");
    wsBtn.textContent = "⇄ WS";
    if (!wsActive) return;
    status.textContent = "WS closed — retrying in 2s…";
    wsReconnectTimer = setTimeout(connectWs, 2000);
  };

  ws.onerror = () => {
    status.textContent = "⚠ WS error — server running?";
    ws?.close();
  };
}

function disconnectWs() {
  wsActive = false;
  if (wsReconnectTimer) { clearTimeout(wsReconnectTimer); wsReconnectTimer = null; }
  ws?.close();
  ws = null;
}

// ── Resize handles ───────────────────────────────────────────────────────────
const MIN_W = 280, MIN_H = 320;

function attachResize(el: HTMLElement, resizeW: boolean) {
  let resizing = false, startX = 0, startY = 0, startW = 0, startH = 0;
  el.addEventListener("pointerdown", (e) => {
    resizing = true;
    startX = e.clientX; startY = e.clientY;
    startW = window.innerWidth; startH = window.innerHeight;
    el.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  el.addEventListener("pointermove", (e) => {
    if (!resizing) return;
    const w = resizeW ? Math.max(MIN_W, startW + (e.clientX - startX)) : startW;
    const h = Math.max(MIN_H, startH + (e.clientY - startY));
    parent.postMessage({ pluginMessage: { type: "resize", width: Math.round(w), height: Math.round(h) } }, "*");
  });
  el.addEventListener("pointerup", () => { resizing = false; });
}

attachResize(document.getElementById("resizeHandleRight") as HTMLElement, true);
attachResize(document.getElementById("resizeHandleLeft")  as HTMLElement, false);

status.textContent = "Ready.";

convertBtn.addEventListener("click", () => {
  status.textContent = "Converting…";
  copyBtn.style.display = "none";
  parent.postMessage({ pluginMessage: { type: "convert" } }, "*");
});

liveBtn.addEventListener("click", () => {
  liveMode = !liveMode;
  liveBtn.classList.toggle("active", liveMode);
  liveBtn.textContent = liveMode ? "⦿ Live (on)" : "⦿ Live";
  status.textContent = liveMode ? "Live mode on — watching selection…" : "Live mode off.";
  parent.postMessage({ pluginMessage: { type: "setLive", enabled: liveMode } }, "*");
});

kvBtn.addEventListener("click", () => {
  kvEnabled = !kvEnabled;
  kvBtn.classList.toggle("active", kvEnabled);
  if (!kvEnabled) {
    output.style.display = "none";
    copyBtn.style.display = "none";
    output.textContent = "";
    parent.postMessage({ pluginMessage: { type: "resize", width: window.innerWidth, height: 160 } }, "*");
  } else {
    output.style.display = "";
    parent.postMessage({ pluginMessage: { type: "resize", width: window.innerWidth, height: 540 } }, "*");
  }
});


copyBtn.addEventListener("click", () => {
  navigator.clipboard.writeText(output.textContent ?? "");
  copyBtn.textContent = "Copied!";
  setTimeout(() => (copyBtn.textContent = "Copy KV"), 1500);
});

connectBtn.addEventListener("click", () => {
  connected = !connected;
  connectBtn.classList.toggle("active", connected);
  connectBtn.textContent = connected ? "Connected" : "Connect";
  status.textContent = connected
    ? "Connected — will send in live mode."
    : "Disconnected.";
});

wsBtn.addEventListener("click", () => {
  wsActive = !wsActive;
  if (wsActive) {
    connectWs();
  } else {
    disconnectWs();
    wsBtn.textContent = "⇄ WS";
  }
});

bgBtn.addEventListener("click", () => {
  parent.postMessage({ pluginMessage: { type: "hideUI" } }, "*");
});

window.onmessage = (event: MessageEvent) => {
  const msg = event.data?.pluginMessage;
  if (!msg) return;

  if (msg.type === "error") {
    output.textContent = "";
    status.textContent = "⚠ " + msg.message;
    return;
  }

  if (msg.type === "figmaNodes") {
    if (connected) {
      const base = serverUrl.value.trim();
      // Always dump raw JSON to server (fire and forget)
      fetch(base + "/json-dump", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: msg.data as string,
      }).catch((e) => { status.textContent = "⚠ json-dump failed: " + e.message; });

      if (kvEnabled) {
        fetch(base + "/kv", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: msg.data as string,
        }).then(async (res) => {
          const kv = await res.text();
          if (res.ok && kv) {
            output.textContent = kv;
            copyBtn.style.display = "inline-block";
            status.textContent = liveMode ? "Live — server updated." : "Server done.";
          } else {
            status.textContent = "⚠ Server error: " + kv;
          }
        }).catch((e) => { status.textContent = "⚠ /kv failed: " + e.message; });
      } else {
        status.textContent = liveMode ? "Live — dumped." : "Dumped.";
      }
    } else {
      status.textContent = liveMode ? "Live — updated." : "Done.";
    }
  }
};
