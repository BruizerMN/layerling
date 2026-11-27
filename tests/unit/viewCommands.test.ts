import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UI_COMMANDS } from "@/lib/host/hostProtocol";
import { getUiState, publishUiState, publishViewBarState, type NativeUiState } from "@/lib/host/nativeUi";
import { isMeasurePopoverOpen, setMeasurePopoverOpen } from "@/lib/measurePopover";
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
      ["measure.tape", "toggleTapeTools()"], ["measure.cornerRuler", "toggleCornerRulerTool()"], ["measure.protractor", "toggleProtractor()"],
    ]) expect(viewport.includes(`case "${command}": ${call}`), command).toBe(true);
    // Build 0103: in the Mac app the menu command opens the native Section View popover instead of the legacy panel.
    expect(viewport).toContain("case \"measure.section\": if (isNativeAppearance() && requestHostAction(\"showSectionView\")) break; toggleSectionView(); break;");
    expect(viewport).toContain("useSecondViewSupported() && !isNativeAppearance()");
    const sketch = readFileSync("apps/web/src/components/SketchWorkspace.tsx", "utf8");
    for (const [command, call] of [["camera.home", "resetView()"], ["camera.zoomOut", "zoomByButton(ZOOM_STEP_OUT)"], ["measure.tape", "onMeasureTool()"], ["sketch.measurements", "toggleMeasurements()"]]) {
      expect(sketch.includes(`case "${command}": ${call}`), command).toBe(true);
    }
    const toolbar = readFileSync("apps/web/src/components/workplane/SecondaryToolbar.tsx", "utf8");
    expect(toolbar).toContain("isViewCommand(command)) runViewCommand(command, value)");   // Build 0103: the typed value rides along
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

describe("Native Measure (Build 0099)", () => {
  it("the operational controls are known ui commands and the popover reports are page commands", () => {
    for (const command of ["measure.tape.add", "measure.tape.move", "measure.tape.delete", "measure.tape.wholeEdges", "measure.tape.visible", "measure.tape.clear",
      "measure.protractor.points", "measure.protractor.faces", "measure.protractor.clear", "measure.end", "measure.popoverOpened", "measure.popoverClosed"]) {
      expect(isViewCommand(command), command).toBe(true);
      expect((UI_COMMANDS as readonly string[]).includes(command), command).toBe(true);
    }
  });

  it("the page knows whether the host's Measure popover is open", () => {
    expect(isMeasurePopoverOpen()).toBe(false);
    setMeasurePopoverOpen(true);
    expect(isMeasurePopoverOpen()).toBe(true);
    setMeasurePopoverOpen(false);
    expect(isMeasurePopoverOpen()).toBe(false);
  });

  it("the controls call the legacy panels' own functions; the panels and the bar's buttons give way to the native popover in the Mac app only", () => {
    const viewport = readFileSync("apps/web/src/components/WorkplaneViewport.tsx", "utf8");
    for (const [command, call] of [
      ["measure.tape.add", "engageTape(); activateTapeAdd();"], ["measure.tape.move", "engageTape(); activateTapeMove();"], ["measure.tape.delete", "engageTape(); activateTapeDelete();"],
      ["measure.tape.wholeEdges", "toggleTapeWholeEdges();"], ["measure.tape.visible", "toggleTapeHidden();"], ["measure.tape.clearConfirmed", "confirmClearTape();"],
      ["measure.protractor.clear", "clearProtractor();"], ["measure.end", "endMeasuring();"],
    ]) expect(viewport.includes(`case "${command}": ${call}`) || viewport.includes(`case "${command}": ${call.replace(/;$/, "")}`), command).toBe(true);
    expect(viewport).toContain("chooseProtractorKind(\"points\")");
    expect(viewport).toContain("chooseProtractorKind(\"faces\")");
    expect(viewport).toContain("tapeToolsOpen && !isNativeAppearance()");
    expect(viewport).toContain("protractorOpen && !isNativeAppearance()");
    for (const action of ["showMeasureTape", "showMeasureCornerRuler", "showMeasureProtractor"]) expect(viewport).toContain(`requestHostAction("${action}")`);
    expect(viewport).toContain("isNativeAppearance() ? () => requestHostAction(\"showMeasureTape\") : toggleTapeTools");   // the browser edition keeps its own handler
  });

  it("Escape: with the popover open the editor leaves the key to the measuring tools and the host; Sketch leaves it unhandled when nothing is being measured", () => {
    const editor = readFileSync("apps/web/src/components/LayerlingEditor.tsx", "utf8");
    const escape = editor.indexOf("if (projectInteractionActiveRef.current || escapeWasHandled(event)) return;");
    const gate = editor.indexOf("if (isMeasurePopoverOpen()) return;", escape);
    const clear = editor.indexOf("clearSelection();", gate);
    expect(escape).toBeGreaterThan(0);
    expect(gate).toBeGreaterThan(escape);
    expect(clear).toBeGreaterThan(gate);   // before the selection is cleared
    expect(editor).toContain("leaveEscapeToHost: () => isMeasurePopoverOpen() && sketchTool !== \"measure\" && !noteMode");
    const keys = readFileSync("apps/web/src/lib/sketchEditorKeys.ts", "utf8");
    expect(keys).toContain("!actions.leaveEscapeToHost?.()");
    const toolbar = readFileSync("apps/web/src/components/workplane/SecondaryToolbar.tsx", "utf8");
    const closed = toolbar.indexOf('command === "measure.popoverClosed"');
    const gatePresentation = toolbar.indexOf("if (presentationActive && command !==", closed);
    expect(closed).toBeGreaterThan(0);
    expect(closed).toBeLessThan(gatePresentation);   // honoured even in Presentation Mode
  });
});

describe("Native Delete All Measurements confirmation (Build 0100)", () => {
  it("is a known command and host action; the page asks the host only in the Mac app and only when there are measurements, and only the confirmation deletes", () => {
    expect(isViewCommand("measure.tape.clearConfirmed")).toBe(true);
    expect((UI_COMMANDS as readonly string[]).includes("measure.tape.clearConfirmed")).toBe(true);
    const viewport = readFileSync("apps/web/src/components/WorkplaneViewport.tsx", "utf8");
    expect(viewport).toContain('case "measure.tape.clear": if (isNativeAppearance() && tapeModelRef.current.segments.length > 0) requestHostAction("confirmClearMeasurements"); else requestClearTape(); break;');
    // the engine's own deletion handler is what the confirmed command runs; the browser edition's panel button still goes through the web dialog
    expect(viewport).toContain('case "measure.tape.clearConfirmed": confirmClearTape(); break;');
    expect(viewport).toContain("onClick={requestClearTape}");
    const text = readFileSync("apps/web/src/lib/messages.en.ts", "utf8");
    expect(text).toContain('"confirm.clearTapeTitle": "Delete all measurements?"');
    expect(text).toContain('"confirm.clearTapeBody": "All tape measurements in this design will be deleted. This cannot be undone."');
  });
});

describe("Native Notes (Build 0101)", () => {
  it("the view bar state carries the note tool's state and the visibility switch, in 3D and in Sketch", () => {
    const viewport = readFileSync("apps/web/src/components/WorkplaneViewport.tsx", "utf8");
    expect(viewport).toContain('"measure.note": Boolean(onNoteTool && onToggleNotes), "view.notes": noteCount > 0,');
    expect(viewport).toContain('"measure.note": noteMode, "view.notes": notesVisible,');
    const sketch = readFileSync("apps/web/src/components/SketchWorkspace.tsx", "utf8");
    expect(sketch).toContain('"view.notes": noteCount > 0,');
    expect(sketch).toContain('checked: { "view.notes": notesVisible,');
    expect(sketch).toContain('case "measure.note": onNoteTool?.(); break;');
  });

  it("the commands the Notes popover sends are the existing ones: the note tool (shared with the bar and the menu) and the editor's own visibility toggle; one-shot placement and Escape are untouched", () => {
    expect(isViewCommand("measure.note")).toBe(true);
    expect((UI_COMMANDS as readonly string[]).includes("view.notes")).toBe(true);
    const toolbar = readFileSync("apps/web/src/components/workplane/SecondaryToolbar.tsx", "utf8");
    expect(toolbar).toContain('case "view.notes": onToggleNotes(); break;');
    const viewport = readFileSync("apps/web/src/components/WorkplaneViewport.tsx", "utf8");
    expect(viewport).toContain("onNoteModeChange?.(false);");   // one click places one note, then the tool is put down
    const editor = readFileSync("apps/web/src/components/LayerlingEditor.tsx", "utf8");
    expect(editor).toContain("if (noteMode) {\n          setNoteMode(false);");   // Escape puts the armed note tool down
  });
});


describe("Native Display popover (Build 0102)", () => {
  it("the dimensions toggle and the eight saved-view commands are known ui commands", () => {
    for (const command of ["camera.dimensions", "savedView.go.1", "savedView.go.4", "savedView.save.1", "savedView.save.4"]) {
      expect(isViewCommand(command)).toBe(true);
      expect((UI_COMMANDS as readonly string[]).includes(command)).toBe(true);
    }
    expect(isViewCommand("savedView.go.5")).toBe(false);
  });

  it("each command runs the function the key runs: Q's toggle with its notice, the saved-view functions of the keys, and a save refreshes the published slot flags", () => {
    const viewport = readFileSync("apps/web/src/components/WorkplaneViewport.tsx", "utf8");
    expect(viewport).toContain('case "camera.dimensions": { const visible = dimensionsHiddenRef.current; showDimensions(visible); onNotice?.(t(visible ? "camera.dimensionsShown" : "camera.dimensionsHidden")); break; }');
    expect(viewport).toContain("showSavedView(Number(command.slice(-1)) - 1)");
    expect(viewport).toContain("saveView(Number(command.slice(-1)) - 1)");
    // the keys call the same two functions
    expect(viewport).toContain("if (savedView.save) saveView(savedView.slot);");
    expect(viewport).toContain("else showSavedView(savedView.slot);");
    // the slot flags are re-read after every save (keys, MCP and commands all go through saveView), and the state carries the dimensions switch
    const views = readFileSync("apps/web/src/components/workplane/cameraViews.ts", "utf8");
    expect(views).toContain("optionsRef.current.onSavedViewsChanged?.();");
    expect(viewport).toContain('"camera.dimensions": !dimensionsHidden,');
    expect(viewport).toContain("...savedViewFlags,");
  });

  it("nothing here touches the document's history: the slots are saved by the existing writer and no undo entry is made", () => {
    const views = readFileSync("apps/web/src/components/workplane/cameraViews.ts", "utf8");
    const save = views.slice(views.indexOf("export function saveViewInSlot"), views.indexOf("export function showViewInSlot"));
    expect(save).toContain("writeSavedViews(projectId, views);");
    expect(save).not.toMatch(/undo|history|commit/i);
  });
});
