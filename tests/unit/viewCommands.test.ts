import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UI_COMMANDS } from "@/lib/host/hostProtocol";
import { getUiState, publishUiState, publishViewBarState, type NativeUiState } from "@/lib/host/nativeUi";
import { VIEW_COMMANDS, isViewCommand, registerViewCommands, runViewCommand, type ViewBarState } from "@/lib/viewCommands";

const base: NativeUiState = { mode: "geometry", sketchEnabled: true, focusMode: false, ribbonPinned: false };

afterEach(() => {
  registerViewCommands(null);
  publishViewBarState(null);
});

describe("View Bar commands (Build 0095)", () => {
  it("every command is a known ui command, once", () => {
    expect(new Set(VIEW_COMMANDS).size).toBe(VIEW_COMMANDS.length);
    for (const command of VIEW_COMMANDS) {
      expect((UI_COMMANDS as readonly string[]).includes(command), command).toBe(true);
      expect(isViewCommand(command)).toBe(true);
    }
    expect(isViewCommand("edit.undo")).toBe(false);
    expect(isViewCommand("camera.nope")).toBe(false);
  });

  it("a command reaches the mounted view and is ignored when none is mounted", () => {
    expect(runViewCommand("camera.home")).toBe(false);
    const run = vi.fn();
    registerViewCommands({ kind: "geometry", run });
    expect(runViewCommand("camera.zoomIn")).toBe(true);
    expect(run).toHaveBeenCalledWith("camera.zoomIn");
    registerViewCommands(null);   // the view unmounted (a switch to Sketch, a closed document)
    expect(runViewCommand("camera.zoomIn")).toBe(false);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("the latest mounted view takes the commands (3D replaced by Sketch)", () => {
    const three = vi.fn(), sketch = vi.fn();
    registerViewCommands({ kind: "geometry", run: three });
    registerViewCommands({ kind: "sketch", run: sketch });
    runViewCommand("camera.home");
    expect(sketch).toHaveBeenCalledOnce();
    expect(three).not.toHaveBeenCalled();
  });

  it("the view's command state travels inside ui.state, whichever side reports first", () => {
    const state: ViewBarState = { kind: "geometry", enabled: { "camera.home": true }, checked: { "camera.projection": true } };
    publishViewBarState(state);                      // the viewport can report before the toolbar has
    publishUiState(base);
    expect(getUiState()?.viewBar).toEqual(state);
    publishUiState({ ...base, focusMode: true });    // a toolbar report that knows nothing of it does not lose it
    expect(getUiState()?.viewBar).toEqual(state);
    expect(getUiState()?.focusMode).toBe(true);
    const sketch: ViewBarState = { kind: "sketch", enabled: { "measure.tape": true }, checked: {} };
    publishViewBarState(sketch);
    expect(getUiState()?.viewBar).toEqual(sketch);
    publishViewBarState(null);
    expect(getUiState()?.viewBar).toBeNull();
  });

  it("the commands run the functions the view bar's buttons run, and Second View is not offered in the native app", () => {
    const viewport = readFileSync("apps/web/src/components/WorkplaneViewport.tsx", "utf8");
    for (const [command, call] of [
      ["camera.home", "resetView()"], ["camera.zoomIn", "zoomCamera(ZOOM_STEP_IN)"], ["camera.projection", "toggleProjection()"],
      ["workplane.place", "togglePlacementWorkplane()"], ["workplane.lookOnto", "lookOntoWorkplane()"],
      ["measure.tape", "toggleTapeTools()"], ["measure.cornerRuler", "toggleCornerRulerTool()"], ["measure.protractor", "toggleProtractor()"], ["measure.section", "toggleSectionView()"],
    ]) expect(viewport.includes(`case "${command}": ${call}`), command).toBe(true);
    expect(viewport).toContain("useSecondViewSupported() && !isNativeAppearance()");
    const sketch = readFileSync("apps/web/src/components/SketchWorkspace.tsx", "utf8");
    for (const [command, call] of [["camera.home", "resetView()"], ["camera.zoomOut", "zoomByButton(ZOOM_STEP_OUT)"], ["measure.tape", "onMeasureTool()"], ["sketch.measurements", "toggleMeasurements()"]]) {
      expect(sketch.includes(`case "${command}": ${call}`), command).toBe(true);
    }
    const toolbar = readFileSync("apps/web/src/components/workplane/SecondaryToolbar.tsx", "utf8");
    expect(toolbar).toContain("isViewCommand(command)) runViewCommand(command)");
  });
});

describe("Camera navigation (Build 0096)", () => {
  it("the cube's rectangle travels with the view bar state and is null while the cube is hidden", () => {
    const shown: ViewBarState = { kind: "geometry", enabled: { "camera.home": true }, checked: {}, cube: { x: 10, y: 22, width: 82, height: 82 } };
    publishUiState(base);
    publishViewBarState(shown);
    expect(getUiState()?.viewBar?.cube).toEqual({ x: 10, y: 22, width: 82, height: 82 });
    publishViewBarState({ ...shown, cube: null });   // Presentation Mode hides the cube with CSS: the strip goes with it
    expect(getUiState()?.viewBar?.cube).toBeNull();
    publishViewBarState({ kind: "sketch", enabled: {}, checked: {} });   // a sketch has no cube
    expect(getUiState()?.viewBar?.cube).toBeUndefined();
  });

  it("the viewport measures the cube's own box, not its turning faces, and the footer's zoom works in Sketch", () => {
    const viewport = readFileSync("apps/web/src/components/WorkplaneViewport.tsx", "utf8");
    expect(viewport).toContain('closest<HTMLElement>(".view-cube")');
    expect(viewport).toContain("cube: cubeRect,");
    expect(viewport).toContain("focusSelection: () => { if (!focusSelection()) resetView(); },");
    const sketch = readFileSync("apps/web/src/components/SketchWorkspace.tsx", "utf8");
    expect(sketch).toContain("registerCameraController({");
    expect(sketch).toContain("publishCameraStatus({ distance: HOME_VIEW_DISTANCE / Math.max(view.zoom, 1e-6)");
    const footer = readFileSync("apps/web/src/components/NativeStatusBar.tsx", "utf8");
    const zoom = footer.slice(footer.indexOf('className="native-zoom"'));
    expect(zoom).not.toContain('mode !== "geometry"');
    expect(zoom).toContain("disabled={!camera}");
    expect(footer).toContain("Zoom to Selection");
  });
});

