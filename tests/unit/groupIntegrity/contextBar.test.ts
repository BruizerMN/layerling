import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { updateCameraViewport } from "@/components/workplane/cameraRig";
import { GroupEditingContextBar } from "@/components/workplane/GroupEditingContextBar";
import { visualGroupsPaletteState } from "@/lib/visualGroupsSnapshot";
import { createVisualGroup, EMPTY_VISUAL_GROUPS, moveObjectsToGroup } from "@/lib/visualGroups";
import { primitive } from "./support";

/*
 * Build 0132: the permanent Workspace Context Bar, the page-side availability of the whole-design commands, the breadcrumb/ops plumbing, and the camera across the bar's appearance. P = production code (React server render, the real
 * camera function), S = source/CSS census; the look itself (accent, Dark Mode, proportions, truncation) is for interactive acceptance.
 */
const root = path.resolve(__dirname, "../../../");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");
const editor = read("apps/web/src/components/LayerlingEditor.tsx");
const css = read("apps/web/src/app/groupEditingBar.css");

describe("Context Bar markup (P)", () => {
  const html = renderToString(createElement(GroupEditingContextBar, { name: "Window wall", state: { opacity: 0.4, references: true }, busy: false, onOpacity: () => undefined, onReferences: () => undefined, onDone: () => undefined, onCancel: () => undefined }));
  it("single row, left to right: Surroundings slider, percentage, references; centred 'Editing Group {name}'; Cancel then Done", () => {
    const at = (needle: string) => html.indexOf(needle);
    expect(at("Surroundings")).toBeGreaterThan(-1);
    expect(at("Surroundings")).toBeLessThan(at("40"));
    expect(at("40")).toBeLessThan(at("Use as references"));
    expect(at("Use as references")).toBeLessThan(at("Editing Group"));
    expect(html).toMatch(/Editing Group (<!-- -->)?Window wall/);
    expect(at("Editing Group")).toBeLessThan(at(">Cancel<"));
    expect(at(">Cancel<")).toBeLessThan(at(">Done<"));                                   // Done is the rightmost control
  });
  it("the tooltips say 'entire editing session' (Bill's wording); Done is the visually primary action", () => {
    expect(html).toContain('title="Cancel the entire editing session"');
    expect(html).toContain('title="Finish the entire editing session"');
    expect(html).toMatch(/class="context-bar-button primary"[^>]*>Done</);
  });
  it("buttons are disabled while a completion is running (no double completion)", () => {
    const busy = renderToString(createElement(GroupEditingContextBar, { name: "x", state: { opacity: 0, references: true }, busy: true, onOpacity: () => undefined, onReferences: () => undefined, onDone: () => undefined, onCancel: () => undefined }));
    expect(busy.match(/<button[^>]*disabled/g)?.length).toBe(2);
  });
});

describe("Context Bar layout and appearance (S, CSS)", () => {
  it("spans exactly the Workspace column: from the toolbar's edge, ending before the Inspector when shown; the stage gives it room (no overlay)", () => {
    expect(css).toMatch(/\.group-editing-context-bar \{[^}]*position: fixed;[^}]*top: var\(--editor-toolbar-height\);[^}]*left: 0;[^}]*right: 0;/);
    expect(css).toContain('html[data-inspector="on"]:not([data-focus-mode="on"]) .group-editing-context-bar { right: 296px; }');
    expect(css).toMatch(/html\[data-context-bar="on"\] \.workplane-stage \{[^}]*margin-top: var\(--context-bar-height\);[^}]*height: calc\(100vh - var\(--editor-toolbar-height\) - var\(--editor-footer-height\) - var\(--context-bar-height\)\)/);
    expect(read("apps/web/src/app/nativeInspector.css")).toContain("margin-right: 296px");       // the Inspector width the bar stops before
  });
  it("uses the host's live accent and contrasting foreground (Light, Dark and accent changes come for free); about 32 pt", () => {
    expect(css).toContain("var(--accent-live, #0a84ff)");
    expect(css).toContain("var(--accent-live-fg, #ffffff)");
    expect(css).toContain("--context-bar-height: 32px");
    expect(read("apps/web/src/app/nativeAppearance.css")).toContain("--accent-live-fg: var(--system-accent-fg, #ffffff);");
  });
  it("a three-column grid: equal outer columns centre the title on the Workspace; the title truncates before any control is hidden", () => {
    expect(css).toContain("grid-template-columns: minmax(0, 1fr) minmax(0, auto) minmax(0, 1fr);");
    expect(css).toMatch(/\.context-bar-title \{[^}]*overflow: hidden;[^}]*text-overflow: ellipsis;/);
  });
  it("hidden in Presentation Mode (and the stage's room returns); visible in Focus Mode", () => {
    expect(css).toContain('html[data-presentation="on"] .group-editing-context-bar { display: none; }');
    expect(css).not.toMatch(/data-focus-mode="on"\][^{]*\.group-editing-context-bar \{[^}]*display: none/);
    expect(editor).toContain("const contextBarShown = Boolean(nativeDocument) && openGroups.length > 0 && !presentationMode;");
  });
  it("the editing session and the Surroundings settings survive a visit to Presentation Mode: the state is reset only when a NEW session begins", () => {
    expect((editor.match(/setSurroundings\(beginSurroundingsSession\(\)\)/g) ?? []).length).toBe(1);
    expect(editor.slice(editor.indexOf("const beginGroupSession = useCallback"), editor.indexOf("const endGroupSession"))).toContain("setSurroundings(beginSurroundingsSession());");
  });
});

describe("the bar's actions (S)", () => {
  it("Done and Cancel are the WHOLE-session operations; the superseded overlay is gone", () => {
    expect(editor).toContain("onDone={() => void finishAllOpenGroups()}");
    expect(editor).toContain("onCancel={requestCancelWholeSession}");
    expect(existsSync(path.join(root, "apps/web/src/components/workplane/SurroundingsOverlay.tsx"))).toBe(false);
    expect(editor).not.toContain("SurroundingsOverlay");
  });
  it("whole-session Cancel asks the native confirmation only if the session changed something, and a confirmation answers the right question", () => {
    const req = editor.slice(editor.indexOf("const requestCancelWholeSession = useCallback"), editor.indexOf("/** Why a part cannot go into or out of a group"));
    expect(req).toContain("sessionEditedRef.current");
    expect(req).toContain("wholeCancelPendingRef.current = true;");
    expect(editor).toContain("if (wholeCancelPendingRef.current) { wholeCancelPendingRef.current = false; cancelWholeSession(); } else cancelOpenGroup();");
    expect(editor).toContain("wholeCancelPendingRef.current = false;\n");
  });
  it("no new keyboard shortcut and no repurposed Return/Escape (Bill, Q7)", () => {
    const bar = read("apps/web/src/components/workplane/GroupEditingContextBar.tsx");
    expect(bar).not.toMatch(/onKeyDown|keydown|Escape|"Enter"/);
  });
});

describe("camera across the bar's appearance (P)", () => {
  it("resizing the viewport for the bar keeps the camera pose, zoom and vertical field (perspective and orthographic)", () => {
    const persp = new THREE.PerspectiveCamera(45, 1.6, 0.1, 5000); persp.position.set(120, 90, 160); persp.lookAt(10, 5, 0); persp.updateMatrixWorld();
    const before = { pos: persp.position.clone(), quat: persp.quaternion.clone(), fov: persp.fov, zoom: persp.zoom };
    updateCameraViewport(persp, 1200, 800 - 32); updateCameraViewport(persp, 1200, 800);
    expect(persp.position.equals(before.pos)).toBe(true); expect(persp.quaternion.equals(before.quat)).toBe(true); expect(persp.fov).toBe(before.fov); expect(persp.zoom).toBe(before.zoom);
    const ortho = new THREE.OrthographicCamera(-100, 100, 60, -60, 0.1, 5000); ortho.zoom = 1.7; ortho.position.set(80, 80, 80); ortho.lookAt(0, 0, 0);
    const o = { top: ortho.top, bottom: ortho.bottom, zoom: ortho.zoom, pos: ortho.position.clone(), quat: ortho.quaternion.clone() };
    updateCameraViewport(ortho, 1200, 800 - 32);
    expect(ortho.top).toBe(o.top); expect(ortho.bottom).toBe(o.bottom); expect(ortho.zoom).toBe(o.zoom);                // the vertical extent and zoom are kept; only the width follows the aspect
    expect(ortho.position.equals(o.pos)).toBe(true); expect(ortho.quaternion.equals(o.quat)).toBe(true);
    updateCameraViewport(ortho, 1200, 800);
    expect(ortho.right / ortho.top).toBeCloseTo(1200 / 800, 6);
  });
  it("the orbit target belongs to the controls and the resize function never touches it (S)", () => {
    const scene = read("apps/web/src/components/workplane/viewportScene.ts");
    const resize = scene.slice(scene.indexOf("const resize = () => {"), scene.indexOf("const state: ThreeState"));
    expect(resize).not.toMatch(/controls\.target|camera\.position|camera\.zoom/);
  });
});

describe("page-side availability of the whole-design commands (S, P)", () => {
  it("context menus show Unhide All and Hide Others as UNAVAILABLE (web and native menus read the same item flag)", () => {
    expect(editor).toContain('key: "showHidden", label: t("contextMenu.showHidden"), shortcut: "Ctrl+Shift+H", disabled: Boolean(contextSelectableIds)');
    expect(editor).toContain('key: "hideOthers", label: t("contextMenu.hideOthers"), disabled: Boolean(contextSelectableIds)');
    expect(editor).toContain("...(item.disabled ? { enabled: false } : {})");
    expect(read("apps/web/src/components/workplane/ShapeContextMenu.tsx")).toContain("disabled={item.disabled}");
  });
  it("the ribbon/palette commands, the view-bar buttons, the plate bar and the native menus' ui.state all follow the one predicate", () => {
    const bar = read("apps/web/src/components/workplane/SecondaryToolbar.tsx");
    expect(bar).toContain("hiddenShapeCount > 0 && !groupEditing,");
    expect(bar).toContain("hasSelection && !groupEditing, onHideOthers");
    expect(bar).toContain("view: sketching ? null : { groupEditing, hiddenCount: hiddenShapeCount,");
    expect(editor).toContain("groupEditing={Boolean(contextSelectableIds)}");
    expect(editor).toContain("disabled={Boolean(historyViewState) || Boolean(contextSelectableIds)}");
  });
  it("the Visual Groups palette publishes `locked` while a group is open (browsing stays: it is only a flag)", () => {
    const { registry, id } = createVisualGroup(EMPTY_VISUAL_GROUPS, { name: "V" });
    const reg = moveObjectsToGroup(registry, ["a"], id);
    const open = primitive("g", "box");
    expect(visualGroupsPaletteState(reg, [primitive("a", "box")], [], (s) => s.id, false, [open]).locked).toBe(true);
    expect(visualGroupsPaletteState(reg, [primitive("a", "box")], [], (s) => s.id, false, []).locked).toBeUndefined();
    expect(visualGroupsPaletteState(EMPTY_VISUAL_GROUPS, [], [], (s) => s.id, false, [open]).locked).toBe(true);
  });
  it("finishToLevel is an additive op end to end (page allow-list, parser) and the page handler calls the transactional completion", () => {
    expect(read("apps/web/src/lib/host/hostProtocol.ts")).toContain('"finishToLevel"');
    expect(read("apps/web/src/lib/host/nativeObjects.ts")).toContain('case "finishToLevel":');
    expect(editor).toContain('} else if (command.op === "finishToLevel") {\n        void finishToLevel(command.groupId);');
  });
});
