import { describe, expect, it } from "vitest";
import { DocumentRevisionTracker, PREFERENCE_WORKSPACE_KEYS, documentSettingsSignature, documentSignature, summarizeShapes, type RevisionState, type SignatureParts } from "@/lib/host/documentRevision";
import type { WorkplaneShape } from "@/types/layerling";

const parts = (over: Partial<SignatureParts> = {}): SignatureParts => ({
  entryFingerprint: "10:1:2", attachments: "", workspace: { width: 200, depth: 200, units: "mm", gridColor: "#ccc" }, snapGrid: "1.0 mm", placementElevation: 0,
  placementWorkplane: "base", savedViews: "{}", cornerRulers: "[]", tape: "null", ...over,
});

describe("document signature", () => {
  it("changes with every persistent part", () => {
    const base = documentSignature(parts());
    for (const change of [{ entryFingerprint: "10:1:3" }, { attachments: "a:b:c" }, { snapGrid: "0.5 mm" }, { placementElevation: 5 }, { placementWorkplane: "face" }, { savedViews: '{"7":{}}' }, { cornerRulers: "[1]" }, { tape: "[1]" }, { workspace: { width: 250, depth: 200, units: "mm", gridColor: "#ccc" } }, { workspace: { width: 200, depth: 200, units: "in", gridColor: "#ccc" } }]) {
      expect(documentSignature(parts(change)), JSON.stringify(change)).not.toBe(base);
    }
  });
  it("ignores preferences and appearance in the workspace, but not unknown keys", () => {
    const base = documentSignature(parts());
    expect(documentSignature(parts({ workspace: { width: 200, depth: 200, units: "mm", gridColor: "#000", showShadows: false, stlAsDownload: true, zoomSpeed: 9 } }))).toBe(base);
    expect(documentSignature(parts({ workspace: { width: 200, depth: 200, units: "mm", gridColor: "#ccc", someFutureSetting: 1 } }))).not.toBe(base);
  });
  it("does not depend on key order", () => {
    expect(documentSettingsSignature({ b: 1, a: 2 })).toBe(documentSettingsSignature({ a: 2, b: 1 }));
  });
  it("lists the documented preference keys", () => {
    for (const key of ["gridColor", "background", "stlAsDownload", "lylAsDownload", "showShadows", "zoomSpeed"]) expect(PREFERENCE_WORKSPACE_KEYS.has(key)).toBe(true);
    for (const key of ["width", "depth", "units", "printer", "plates", "gridBlockSize", "historyLimit", "shapeCustomizations"]) expect(PREFERENCE_WORKSPACE_KEYS.has(key)).toBe(false);
  });
});

describe("DocumentRevisionTracker", () => {
  function make() {
    const states: RevisionState[] = [];
    return { tracker: new DocumentRevisionTracker((state) => states.push(state)), states };
  }
  it("is clean after baseline and ignores changes before it", () => {
    const { tracker, states } = make();
    tracker.update("a");
    expect(states).toHaveLength(0);
    expect(tracker.dirty).toBe(false);
    tracker.baseline("a");
    expect(tracker.state()).toEqual({ revision: 0, dirty: false, signature: "a" });
  });
  it("an edit makes it dirty and raises the revision; the same content again does nothing", () => {
    const { tracker, states } = make();
    tracker.baseline("a");
    expect(tracker.update("b")).toBe(true);
    expect(tracker.update("b")).toBe(false);
    expect(tracker.state()).toEqual({ revision: 1, dirty: true, signature: "b" });
    expect(states.at(-1)).toEqual({ revision: 1, dirty: true, signature: "b" });
  });
  it("undo to the exact saved content is clean again; the revision keeps growing", () => {
    const { tracker } = make();
    tracker.baseline("a");
    tracker.update("b");
    tracker.update("a");
    expect(tracker.dirty).toBe(false);
    expect(tracker.revision).toBe(2);
    tracker.update("b");
    expect(tracker.dirty).toBe(true);
  });
  it("a save marks the snapshot's signature saved; a newer change stays dirty", () => {
    const { tracker } = make();
    tracker.baseline("a");
    tracker.update("b");
    const snapshot = { signature: tracker.signature, revision: tracker.revision };
    tracker.update("c"); // edit while the save runs
    tracker.markSaved(snapshot.signature);
    expect(tracker.dirty).toBe(true);
    expect(tracker.revision).toBe(2);
    tracker.update("b"); // undo back to what the file holds
    expect(tracker.dirty).toBe(false);
  });
  it("a save with no later change leaves the document clean", () => {
    const { tracker } = make();
    tracker.baseline("a");
    tracker.update("b");
    tracker.markSaved(tracker.signature);
    expect(tracker.dirty).toBe(false);
  });
});

describe("summarizeShapes", () => {
  it("counts top-level objects, all nodes and distinct meshes", () => {
    const mesh = { positions: [] } as never;
    const child = { id: "c", importedMesh: mesh } as unknown as WorkplaneShape;
    const shapes = [{ id: "a", importedMesh: mesh }, { id: "g", groupedShapes: [child, { id: "d" }] }, { id: "e", importedMesh: { positions: [] } }] as unknown as WorkplaneShape[];
    expect(summarizeShapes(shapes)).toEqual({ rootObjects: 3, nodes: 5, meshObjects: 2 });
  });
});
