/**
 * Build 0095: the native "View Bar" menu's commands. The view bar's buttons keep working exactly as they did; this gives the same functions a second entry, the host's menus.
 *
 * The commands are not new implementations: the 3D viewport and the sketch workspace each REGISTER a controller whose `run` calls the very functions their view bar buttons call
 * (`resetView`, `zoomCamera`, `toggleTapeTools`...). A command from the host (`ui.command`, routed by the toolbar's native command switch) reaches the controller of the view that
 * is mounted; the viewport also PUBLISHES which commands are available and which are on (`ViewBarState`), carried to the host inside `ui.state` so its menu items can be enabled
 * and checked from the owning document's own state. One page runs one document, so each tab or window has its own registry and state.
 *
 * Nothing here is saved in the document, marks it edited or makes an undo step: view and tool state only, as the buttons always were. Browser edition: nothing registers a
 * controller's state anywhere that matters (no host grants `ui.v1`); the buttons are unchanged.
 */
export const VIEW_COMMANDS = [
  // Camera (3D and Sketch)
  "camera.home", "camera.focusSelection", "camera.zoomIn", "camera.zoomOut",
  // Display (3D)
  "camera.projection", "camera.scrollbars", "workplane.visible",
  // Workplane (3D)
  "workplane.place", "workplane.lookOnto", "workplane.faceVisible", "workplane.reset",
  // Measure and annotate (3D and Sketch: "measure.tape" is the Measure tool in a sketch)
  "measure.tape", "measure.cornerRuler", "measure.protractor", "measure.section", "measure.note",
  // Sketch only
  "sketch.measurements", "sketch.partEdges",
  // Build 0099: the native Measure popover's operational controls (3D: Tape Measure, Corner Ruler via "measure.cornerRuler", Protractor), the end of every measuring operation, and the popover's
  // own open and closed reports. They call the same functions the legacy panels' buttons called.
  "measure.tape.add", "measure.tape.move", "measure.tape.delete", "measure.tape.wholeEdges", "measure.tape.visible", "measure.tape.clear", "measure.tape.clearConfirmed",
  "measure.protractor.points", "measure.protractor.faces", "measure.protractor.clear",
  "measure.end", "measure.popoverOpened", "measure.popoverClosed",
  // Build 0102: the native Display popover. "camera.dimensions" is the Q key's toggle (Dimensions and Distances); "savedView.go.N" is the key 7, 8, 9 or 0, "savedView.save.N" Shift+key
  // (N = 1...4, the slot's position). Saving here overwrites like the key does: the HOST asks for confirmation before it sends a save for a slot that is filled (the enabled flag of
  // "savedView.go.N" says the slot is filled).
  "camera.dimensions",
  "savedView.go.1", "savedView.go.2", "savedView.go.3", "savedView.go.4",
  "savedView.save.1", "savedView.save.2", "savedView.save.3", "savedView.save.4",
] as const;
export type ViewCommand = (typeof VIEW_COMMANDS)[number];

export function isViewCommand(command: string): command is ViewCommand {
  return (VIEW_COMMANDS as readonly string[]).includes(command);
}

/**
 * Build 0101: the keys of `ViewBarState.enabled` and `.checked`: every View Bar command, plus `view.notes` (the existing visibility toggle, "Show Notes and Points": its availability and its
 * state are reported here so the native Notes popover can show them; the command itself is the editor's existing `view.notes`).
 */
export type ViewBarKey = ViewCommand | "view.notes";

/** What the menus need: for the view that is mounted, which commands can run now and which are on (checkmarks). A command not listed is not available. */
export interface ViewBarState {
  kind: "geometry" | "sketch";
  enabled: Partial<Record<ViewBarKey, boolean>>;
  checked: Partial<Record<ViewBarKey, boolean>>;
  /**
   * Build 0096: where the view cube is in the page, in CSS points from the page's top-left corner (which is the web view's own), or null while it is not shown (Presentation Mode, Sketch).
   * The host pins its camera strip under it. It changes only when the layout does, never while the camera turns (the rectangle is the cube's box, not its rotating faces).
   */
  cube?: { x: number; y: number; width: number; height: number } | null;
}

export interface ViewCommandController {
  kind: "geometry" | "sketch";
  run: (command: ViewCommand) => void;
}

let controller: ViewCommandController | null = null;

/** The mounted view (3D viewport or sketch workspace) registers itself; null when it goes away. */
export function registerViewCommands(next: ViewCommandController | null) {
  controller = next;
}

/** Runs a command in the mounted view. False when no view is mounted that can take it (the command is then ignored). */
export function runViewCommand(command: ViewCommand): boolean {
  if (!controller) return false;
  controller.run(command);
  return true;
}
