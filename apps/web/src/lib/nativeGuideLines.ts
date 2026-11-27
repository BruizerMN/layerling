import type { MessageKey } from "@/lib/messages.en";

/**
 * Build 0107: the Mac app (Hundchen Layers) has no view bar: its functions are in the toolbar items (Workplane, Measure, Section, Notes, Display), the camera strip under the view cube, the
 * footer and the menus. The short guide lines that describe the bar's buttons therefore read differently there. English only (the Mac app's own wording); in every other language, and in the
 * browser edition, the guide is unchanged. `null` leaves a line out (it is about a touch screen's switch in the bar). A targeted correction, not a rewrite of the guide.
 */
export const NATIVE_GUIDE_LINES: Partial<Record<MessageKey, string | null>> = {
  "guide.view.touch": null,
  "guide.view.projection": "The Projection button in the strip under the view cube switches between the normal view and a flat, orthographic one; Home and Zoom to Selection sit beside it. The eye over a grid in the footer hides the plate, so you can see the underside from below. Red, green and blue arrows at the plate's front left corner show X, Y and Z the way the numbers count (switch them off in the settings).",
  "guide.view.section": "The Section item in the toolbar (Modeling) opens the section controls and cuts the view open along a plane, to see walls and cavities. It is only a view: the design and its exports stay whole. \"Export SVG…\" saves the outlines on the plane at 1:1, for a laser for instance. \"Measure on Cut\" measures right on the cut: two clicks on the blue outline, and a click anywhere on the opposite wall gives the wall thickness square to it. Drag the panel away from the toolbar item to keep it open as a floating palette.",
  "guide.workplane.place": "The W key or Place Workplane in the Workplane item's panel places a temporary workplane onto any clicked face, near a corner exactly on the corner, near an edge on the edge, on the empty plate where you click. New shapes align with it.",
  "guide.workplane.reset": "Clicking into empty space (or Esc) returns the workplane to the ground, and so does Reset Workplane to Base Plate in the Workplane item's panel. Shift+W places it directly onto the selection. Alt+W puts it back on the ground at any time, with or without a selection.",
  "guide.workplane.hide": "Show Face Workplane in the Workplane item's panel hides or shows a workplane set on a face without dropping it: new shapes still land on it.",
  "guide.measure.protractor": "Protractor in the Measure item's panel measures angles: click the corner and a point on each side, or two flat faces. It snaps to corners and edges like the tape measure, follows the bodies it measures and is not saved.",
};
