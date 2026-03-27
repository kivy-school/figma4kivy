"use strict";
// Figma plugin sandbox — runs in Figma's main thread.
// Serialises the current selection and sends it to the UI iframe.
figma.showUI(__html__, { width: 420, height: 540 });
// Track window size for resize messages
let winW = 420, winH = 540;
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
    // InstanceNode
    "componentId", "isExposedInstance", "exposedInstances",
    "componentProperties", "overrides", "componentPropertyDefinitions",
    // Misc node types
    "booleanOperation", "backgroundColor", "flowStartingPoints",
    "arcData", "authorVisible", "shapeType", "sectionContentsHidden",
];
// Helper: recursively serialise a SceneNode to a plain object.
function serialise(node) {
    var _a;
    const n = node;
    const base = { id: node.id, type: node.type, name: node.name };
    for (const key of NODE_FIELDS) {
        if (n[key] !== undefined)
            base[key] = n[key];
    }
    if ((_a = n.layoutGrids) === null || _a === void 0 ? void 0 : _a.length) {
        base.layoutGrids = n.layoutGrids.map((g) => {
            var _a, _b;
            return ({
                pattern: g.pattern,
                sectionSize: (_a = g.sectionSize) !== null && _a !== void 0 ? _a : null,
                count: (_b = g.count) !== null && _b !== void 0 ? _b : null,
            });
        });
    }
    if ("children" in node) {
        base.children = node.children.map(serialise);
    }
    return base;
}
function sendSelection() {
    const selection = figma.currentPage.selection;
    const nodes = selection.length > 0
        ? selection
        : figma.currentPage.children;
    if (nodes.length === 0) {
        figma.ui.postMessage({ type: "error", message: "Nothing selected." });
        return;
    }
    const serialised = nodes.map(serialise);
    figma.ui.postMessage({
        type: "figmaNodes",
        data: JSON.stringify(serialised),
    });
}
let liveHandler = null;
let changeHandler = null;
// Maps server-assigned tempIds → real Figma node ids for command-driven nodes.
const tempNodeMap = new Map();
figma.ui.onmessage = (msg) => {
    if (msg.type === "uiReady") {
        figma.clientStorage.getAsync("uiState").then((saved) => {
            if (saved) {
                figma.ui.postMessage({ type: "restoreState", state: saved });
                figma.clientStorage.deleteAsync("uiState");
            }
        });
        return;
    }
    if (msg.type === "convert") {
        sendSelection();
        return;
    }
    if (msg.type === "resize") {
        winW = msg.width;
        winH = msg.height;
        figma.ui.resize(winW, winH);
        return;
    }
    if (msg.type === "setLive") {
        if (msg.enabled) {
            if (!liveHandler) {
                liveHandler = () => sendSelection();
                figma.on("selectionchange", liveHandler);
            }
            if (!changeHandler) {
                changeHandler = (e) => {
                    // Only re-send if a changed node is part of (or ancestor of) the selection
                    const selectionIds = new Set(figma.currentPage.selection.map((n) => n.id));
                    if (selectionIds.size === 0)
                        return;
                    const affected = e.documentChanges.some((c) => {
                        if (!("id" in c))
                            return false;
                        // walk up from changed node to see if selection contains it or a parent
                        let node = figma.getNodeById(c.id);
                        while (node) {
                            if (selectionIds.has(node.id))
                                return true;
                            node = node.parent;
                        }
                        return false;
                    });
                    if (affected)
                        sendSelection();
                };
                figma.on("documentchange", changeHandler);
            }
            // Send current selection immediately when live mode is turned on
            sendSelection();
        }
        else {
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
        }
        else {
            figma.ui.hide();
        }
    }
    if (msg.type === "figmaCmd") {
        const cmd = msg.cmd;
        if (cmd.code) {
            try {
                new Function("figma", "tempNodeMap", cmd.code)(figma, tempNodeMap);
            }
            catch (e) {
                figma.ui.postMessage({ type: "error", message: "figmaCmd: " + e });
            }
        }
    }
};
