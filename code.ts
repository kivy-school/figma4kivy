// Figma plugin sandbox — runs in Figma's main thread.
// Serialises the current selection and sends it to the UI iframe.

figma.showUI(__html__, { width: 420, height: 540 });

// Track window size for resize messages
let winW = 420, winH = 540;

// Debounce helper — delays fn by ms, cancels previous pending call
function debounce<T extends (...args: any[]) => void>(fn: T, ms: number): T {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return ((...args: any[]) => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  }) as T;
}

// All scalar/array fields that can be copied directly from the Plugin API node.
const NODE_FIELDS = [
  // IsLayerTrait
  "visible", "locked", "rotation", "relativeTransform",
  // HasBlendModeAndOpacityTrait
  "blendMode", "opacity",
  // HasLayoutTrait
  "absoluteBoundingBox", "absoluteRenderBounds", "preserveRatio", "constraints",
  "layoutAlign", "layoutGrow", "layoutPositioning",
  "minWidth", "maxWidth", "minHeight", "maxHeight",
  "layoutSizingHorizontal", "layoutSizingVertical",
  // HasFramePropertiesTrait
  "clipsContent", "overflowDirection",
  "layoutMode", "layoutWrap",
  "primaryAxisSizingMode", "counterAxisSizingMode",
  "primaryAxisAlignItems", "counterAxisAlignItems", "counterAxisAlignContent",
  "paddingLeft", "paddingRight", "paddingTop", "paddingBottom",
  "itemSpacing", "counterAxisSpacing", "itemReverseZIndex", "strokesIncludedInLayout",
  "gridColumnCount", "gridRowCount", "gridColumnGap", "gridRowGap",
  // Fills / strokes
  "fills", "strokes",
  // HasGeometryTrait
  "vectorPaths",
  "strokeWeight", "strokeAlign", "strokeCap", "strokeJoin",
  "strokeDashes", "strokeMiterAngle", "individualStrokeWeights",
  // CornerTrait
  "cornerRadius", "rectangleCornerRadii", "cornerSmoothing",
  // Effects / exports / mask
  "effects", "exportSettings", "isMask", "maskType",
  // Transition
  "transitionNodeID", "transitionDuration", "transitionEasing",
  // TypePropertiesTrait (TEXT)
  "characters", "style", "characterStyleOverrides", "styleOverrideTable",
  "lineTypes", "lineIndentations",
  // TEXT font properties (direct TextNode properties)
  "fontSize", "fontName", "fontWeight", "textAlignHorizontal", "textAlignVertical",
  // InstanceNode
  "componentId", "isExposedInstance", "exposedInstances",
  "componentProperties", "overrides", "componentPropertyDefinitions",
  // Misc node types
  "booleanOperation", "backgroundColor", "flowStartingPoints",
  "arcData", "authorVisible", "shapeType", "sectionContentsHidden",
] as const;

// Helper: recursively serialise a SceneNode to a plain object.
function serialise(node: SceneNode): object {
  const n = node as any;
  const base: Record<string, unknown> = { id: node.id, type: node.type, name: node.name };

  for (const key of NODE_FIELDS) {
    if (n[key] !== undefined) base[key] = n[key];
  }

  // corner radius: if figma.mixed (a Symbol, dropped by JSON.stringify),
  // still ensure rectangleCornerRadii is a plain number array so Swift can
  // decode [Double] correctly. Symbol elements in arrays become null in JSON,
  // which would cause the entire [Double] decode to fail.
  if (n.rectangleCornerRadii !== undefined) {
    const r = n.rectangleCornerRadii as any;
    base["rectangleCornerRadii"] = [
      typeof r[0] === "number" ? r[0] : 0,
      typeof r[1] === "number" ? r[1] : 0,
      typeof r[2] === "number" ? r[2] : 0,
      typeof r[3] === "number" ? r[3] : 0,
    ];
  }

  if (n.layoutGrids?.length) {
    base.layoutGrids = n.layoutGrids.map((g: any) => ({
      pattern:     g.pattern,
      sectionSize: g.sectionSize ?? null,
      count:       g.count       ?? null,
    }));
  }

  if ("children" in node) {
    base.children = (node as ChildrenMixin).children.map(serialise);
  }

  return base;
}

// Recursively collect all unique IMAGE fill hashes from a node tree.
function collectImageHashes(node: SceneNode, out: Set<string>): void {
  const n = node as any;
  if (Array.isArray(n.fills)) {
    for (const fill of n.fills) {
      if (fill.type === "IMAGE" && typeof fill.imageHash === "string") {
        out.add(fill.imageHash);
      }
    }
  }
  if ("children" in node) {
    for (const child of (node as ChildrenMixin).children) {
      collectImageHashes(child as SceneNode, out);
    }
  }
}

async function sendSelection(msgType = "figmaNodes") {
  let nodes: SceneNode[];

  if (lockedNodeIds !== null) {
    if (lockedNodeIds.length === 0) {
      // Locked to the whole page
      nodes = figma.currentPage.children as SceneNode[];
    } else {
      // Locked to specific nodes
      nodes = lockedNodeIds
        .map((id) => figma.getNodeById(id))
        .filter((n): n is SceneNode => n !== null && n.type !== "DOCUMENT" && n.type !== "PAGE");
      if (nodes.length === 0) {
        figma.ui.postMessage({ type: "error", message: "Locked nodes no longer exist." });
        return;
      }
    }
  } else {
    const selection = figma.currentPage.selection;
    nodes = selection.length > 0
      ? (selection as SceneNode[])
      : (figma.currentPage.children as SceneNode[]);
  }

  if (nodes.length === 0) {
    figma.ui.postMessage({ type: "error", message: "Nothing selected." });
    return;
  }

  // Collect image hashes and upload bytes alongside the nodes.
  const hashSet = new Set<string>();
  for (const node of nodes) collectImageHashes(node, hashSet);

  const images: { hash: string; bytes: number[] }[] = [];
  for (const hash of hashSet) {
    try {
      const img = figma.getImageByHash(hash);
      if (img) {
        const bytes = await img.getBytesAsync();
        images.push({ hash, bytes: Array.from(bytes) });
      }
    } catch (_) {
      // If we can't fetch the image bytes, skip it — the server will 404 when requested.
    }
  }

  const serialised = nodes.map(serialise);
  figma.ui.postMessage({
    type: msgType,
    data: JSON.stringify(serialised),
    images,
  });
}

let liveHandler: (() => void) | null = null;
let changeHandler: ((e: DocumentChangeEvent) => void) | null = null;
// null  = not locked
// []    = locked to whole page (nothing was selected when lock was toggled)
// [...] = locked to specific node IDs
let lockedNodeIds: string[] | null = null;
// When true, suppress UI resize messages (device controls its own window size)
let deviceMode = false;

// Maps server-assigned tempIds → real Figma node ids for command-driven nodes.
const tempNodeMap = new Map<string, string>();

figma.ui.onmessage = (msg) => {
  if (msg.type === "uiReady") {
    figma.clientStorage.getAsync("uiState").then((saved: any) => {
      if (saved) {
        figma.ui.postMessage({ type: "restoreState", state: saved });
      }
    });
    return;
  }

  if (msg.type === "saveState") {
    if (msg.state) {
      figma.clientStorage.setAsync("uiState", msg.state);
    }
    return;
  }

  if (msg.type === "convert") {
    sendSelection();
    return;
  }

  if (msg.type === "getCanvasPyNodes") {
    sendSelection("canvasPyNodes");
    return;
  }

  if (msg.type === "resize") {
    if (deviceMode) return; // device controls its own window, don't resize plugin UI
    winW = msg.width; winH = msg.height;
    figma.ui.resize(winW, winH);
    return;
  }

  if (msg.type === "setLock") {
    if (msg.enabled) {
      const sel = figma.currentPage.selection;
      // Empty selection → lock to the whole page
      lockedNodeIds = sel.length > 0 ? sel.map((n) => n.id) : [];
      sendSelection();
    } else {
      lockedNodeIds = null;
    }
    return;
  }

  if (msg.type === "setLive") {
    if (msg.enabled) {
      if (!liveHandler) {
        liveHandler = debounce(() => sendSelection(), 500);
        figma.on("selectionchange", liveHandler);
      }
      if (!changeHandler) {
        const debouncedSend = debounce(() => sendSelection(), 500);
        changeHandler = (e: DocumentChangeEvent) => {
          // locked to specific nodes → watch those; locked to page or nothing selected → watch all
          const watchIds = lockedNodeIds !== null && lockedNodeIds.length > 0
            ? new Set(lockedNodeIds)
            : lockedNodeIds !== null
              ? null  // page-lock: any change triggers resend
              : new Set(figma.currentPage.selection.map((n) => n.id));
          // watchIds null means page-locked — always resend on any document change
          if (watchIds !== null && watchIds.size === 0) return;
          const affected = watchIds === null || e.documentChanges.some((c) => {
            if (!("id" in c)) return false;
            let node: BaseNode | null = figma.getNodeById((c as any).id);
            while (node) {
              if (watchIds!.has(node.id)) return true;
              node = node.parent;
            }
            return false;
          });
          if (affected) debouncedSend();
        };
        figma.on("documentchange", changeHandler);
      }
      // Send current selection immediately when live mode is turned on
      sendSelection();
    } else {
      if (liveHandler) {
        figma.off("selectionchange", liveHandler);
        liveHandler = null;
      }
      if (changeHandler) {
        figma.off("documentchange", changeHandler);
        changeHandler = null;
      }
    }
  }

  if (msg.type === "hideUI") {
    if (msg.state) {
      figma.clientStorage.setAsync("uiState", msg.state).then(() => figma.ui.hide());
    } else {
      figma.ui.hide();
    }
  }

  if (msg.type === "setDeviceMode") {
    deviceMode = !!msg.enabled;
    return;
  }

  if (msg.type === "figmaCmd") {
    const cmd = msg.cmd as { code?: string };
    if (cmd.code) {
      try {
        new Function("figma", "tempNodeMap", cmd.code)(figma, tempNodeMap);
      } catch (e) {
        figma.ui.postMessage({ type: "error", message: "figmaCmd: " + e });
      }
    }
  }
};