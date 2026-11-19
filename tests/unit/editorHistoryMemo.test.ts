import { describe, expect, it } from "vitest";
import { editorHistoryEntry, hydrateEditorHistoryState, type EditorHistoryEntry } from "@/lib/editorHistory";
import type { WorkplaneNote, WorkplaneShape } from "@/types/layerling";

function box(overrides: Partial<WorkplaneShape> = {}): WorkplaneShape {
  return { id: "box-1", name: "Box", kind: "box", color: "#d41721", x: 0, z: 0, elevation: 0, size: 20, width: 20, depth: 20, height: 20, rotation: 0, locked: false, hidden: false, ...overrides };
}
const face = { origin: { x: 0, y: 20, z: 0 }, normal: { x: 0, y: 1, z: 0 }, xAxis: { x: 1, y: 0, z: 0 }, zAxis: { x: 0, y: 0, z: 1 } };
const note = (text: string) => ({ id: "n1", text, x: 1, y: 2, z: 3 }) as unknown as WorkplaneNote;

/** What hydration gives when it has to rebuild: the same entries as fresh copies, which the memo does not know. */
const fresh = (entries: EditorHistoryEntry[]) => entries.map((entry) => ({ ...entry }));

describe("hydrating entries that editorHistoryEntry built", () => {
  it("returns an unchanged entry itself instead of rebuilding it", () => {
    const entries = [editorHistoryEntry([box()], []), editorHistoryEntry([box({ x: 5 })], ["box-1"])];
    const restored = hydrateEditorHistoryState([box({ x: 5 })], entries, 1);
    expect(restored.entries[0]).toBe(entries[0]);
    expect(restored.entries[1]).toBe(entries[1]);
  });

  it("gives the same entries as a rebuild would: fingerprints, selection, notes, workplane, time", () => {
    const entries = [
      editorHistoryEntry([box()], []),
      editorHistoryEntry([box({ x: 5 })], ["box-1", "missing"], [note("a")]),
      editorHistoryEntry([box({ x: 9 })], [], [], face, 1700000000000),
    ];
    const memoized = hydrateEditorHistoryState([box({ x: 9 })], entries, 2, "unlimited", [], face);
    const rebuilt = hydrateEditorHistoryState([box({ x: 9 })], fresh(entries), 2, "unlimited", [], face);
    expect(memoized.index).toBe(rebuilt.index);
    expect(memoized.entries.map((entry) => JSON.stringify(entry))).toEqual(rebuilt.entries.map((entry) => JSON.stringify(entry)));
  });

  it("is idempotent: hydrating the result again changes nothing", () => {
    const entries = [editorHistoryEntry([box()], []), editorHistoryEntry([box({ x: 5 })], [])];
    const once = hydrateEditorHistoryState([box({ x: 5 })], entries, 1);
    const twice = hydrateEditorHistoryState([box({ x: 5 })], once.entries, 1);
    expect(twice.entries).toEqual(once.entries);
    expect(twice.entries[1]).toBe(once.entries[1]);
  });

  it("still inherits the current workplane into an entry that has none (not memoized then)", () => {
    const entries = [editorHistoryEntry([box()], []), editorHistoryEntry([box({ x: 5 })], [])];
    const withFace = hydrateEditorHistoryState([box({ x: 5 })], entries, 1, "unlimited", [], face);
    const rebuilt = hydrateEditorHistoryState([box({ x: 5 })], fresh(entries), 1, "unlimited", [], face);
    expect(withFace.entries.map((entry) => JSON.stringify(entry))).toEqual(rebuilt.entries.map((entry) => JSON.stringify(entry)));
    expect(withFace.entries.every((entry) => entry.placementWorkplane !== undefined)).toBe(true);
  });

  it("memoizes an entry without a workplane when the current one is the base plate", () => {
    const entries = [editorHistoryEntry([box()], [])];
    const base = { origin: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 1, z: 0 }, xAxis: { x: 1, y: 0, z: 0 }, zAxis: { x: 0, y: 0, z: 1 } };
    expect(hydrateEditorHistoryState([box()], entries, 0, "unlimited", [], base).entries[0]).toBe(entries[0]);
  });

  it("does not trust an entry whose fields changed after it was built", () => {
    const entry = editorHistoryEntry([box()], []);
    const original = entry.shapes;
    entry.shapes = [box({ x: 77 })];
    const restored = hydrateEditorHistoryState([box({ x: 77 })], [entry], 0);
    expect(restored.entries[0]).not.toBe(entry);
    expect(restored.entries[0].shapes[0].x).toBe(77);
    expect(original[0].x).toBe(0);
  });

  it("does not memoize entries it did not build (stored or copied entries are still canonicalised)", () => {
    const built = editorHistoryEntry([box({ x: 5 })], []);
    const copy = { ...built, shapes: [box({ x: 5, color: "#D41721" })] } as EditorHistoryEntry;
    const restored = hydrateEditorHistoryState([box({ x: 5 })], [copy], 0);
    expect(restored.entries[0]).not.toBe(copy);
  });

  it("keeps rejecting a history whose last entry does not match the scene", () => {
    const entries = [editorHistoryEntry([box()], []), editorHistoryEntry([box({ x: 5 })], [])];
    const restored = hydrateEditorHistoryState([box({ x: 6 })], entries, 1);
    expect(restored.entries).toHaveLength(1);
    expect(restored.index).toBe(0);
  });
});
