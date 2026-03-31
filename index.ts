
const serverUrlEl  = document.getElementById("serverUrl")    as HTMLInputElement;
const connectBtn   = document.getElementById("connectBtn")    as HTMLButtonElement;
const backgroundBtn = document.getElementById("backgroundBtn") as HTMLButtonElement;
const mainFrame    = document.getElementById("mainFrame")     as HTMLIFrameElement;
const tabBtns     = Array.from(document.querySelectorAll<HTMLButtonElement>(".tab"));

let connected = false;
let activeRoute = "/lab";

parent.postMessage({ pluginMessage: { type: "uiReady" } }, "*");

// ── Resize handles ────────────────────────────────────────────────────────────
const MIN_W = 280, MIN_H = 300;

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

// ── State persistence ─────────────────────────────────────────────────────────
function saveState() {
  parent.postMessage({
    pluginMessage: {
      type: "saveState",
      state: { serverUrl: serverUrlEl.value.trim(), activeRoute, connected },
    },
  }, "*");
}

// ── Tab switching ─────────────────────────────────────────────────────────────
function switchTab(route: string) {
  activeRoute = route;
  tabBtns.forEach((btn) => btn.classList.toggle("tab-active", btn.dataset.route === route));
  if (connected) mainFrame.src = serverUrlEl.value.trim() + route;
  saveState();
}

tabBtns.forEach((btn) => {
  btn.addEventListener("click", () => switchTab(btn.dataset.route!));
});

// ── Connect ───────────────────────────────────────────────────────────────────
function setConnected(value: boolean) {
  connected = value;
  connectBtn.classList.toggle("active", connected);
  connectBtn.textContent = connected ? "Connected" : "Connect";
  if (connected) {
    mainFrame.src = serverUrlEl.value.trim() + activeRoute;
    parent.postMessage({ pluginMessage: { type: "setLive", enabled: true } }, "*");
  } else {
    mainFrame.src = "";
    parent.postMessage({ pluginMessage: { type: "setLive", enabled: false } }, "*");
  }
  saveState();
}

connectBtn.addEventListener("click", () => setConnected(!connected));

backgroundBtn.addEventListener("click", () => {
  parent.postMessage({ pluginMessage: { type: "hideUI" } }, "*");
});

// ── Plugin messages ───────────────────────────────────────────────────────────
window.onmessage = (event: MessageEvent) => {
  // ── Relay from iframe → code.ts ───────────────────────────────────────────
  // Server pages post directly to window.parent (no pluginMessage wrapper).
  if (event.data && !event.data.pluginMessage) {
    const { type, ...rest } = event.data;
    if (type) {
      parent.postMessage({ pluginMessage: { type, ...rest } }, "*");
    }
    return;
  }

  const msg = event.data?.pluginMessage;
  if (!msg) return;

  if (msg.type === "restoreState") {
    const s = msg.state;
    if (s.serverUrl) serverUrlEl.value = s.serverUrl;
    if (s.activeRoute) {
      activeRoute = s.activeRoute;
      tabBtns.forEach((btn) => btn.classList.toggle("tab-active", btn.dataset.route === activeRoute));
    }
    if (s.connected) setConnected(true);
    return;
  }

  if (msg.type === "figmaNodes") {
    if (!connected) return;
    // Forward to the currently loaded page — it handles conversion itself.
    mainFrame.contentWindow?.postMessage({ type: "figmaNodes", data: msg.data }, "*");
    return;
  }
};

