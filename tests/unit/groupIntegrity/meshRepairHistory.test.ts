import { describe, expect, it } from "vitest";
import { appendEditorHistorySnapshot, editorHistoryEntry, type EditorHistoryEntry } from "@/lib/editorHistory";
import { analyzeMesh, applyMeshRepairs, scanForOpenMeshes } from "@/lib/meshRepair";
import { canonicalizeShape } from "@/lib/workplaneShapes";
import type { WorkplaneShape } from "@/types/layerling";

/*
 * Build 0124: Undo restores the original (defective) topology, Redo the repaired one, and nothing the history holds is ever changed in place: the repair is one new history
 * entry made with the editor's own history functions, from scene copies exactly as the editor makes them.
 */
const T_JUNCTION_CUBE = (() => {
  const p = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]];
  const q = (a: number, b: number, c: number) => [p[a], p[b], p[c]];
  const tris = [q(0, 2, 1), q(0, 3, 2), q(4, 5, 6), q(4, 6, 7), q(0, 1, 5), q(0, 5, 4), q(1, 2, 6), q(1, 6, 5), q(2, 3, 7), q(2, 7, 6), q(3, 0, 4), q(3, 4, 7)];
  const m = [1, 0.5, 1];
  tris.splice(2, 1, [p[4], p[5], m], [p[4], m, p[6]]);
  return tris.flat().flat();
})();
const leaf = (id: string, positions: number[]) => ({ id, name: id, kind: "mesh", color: "#888", x: 0, z: 0, elevation: 0, width: 1, depth: 1, height: 1, rotation: 0, importedMesh: { positions, baseWidth: 1, baseDepth: 1, baseHeight: 1, triangleCount: positions.length / 9, sourceFormat: "json" } }) as unknown as WorkplaneShape;
const group = (id: string, children: WorkplaneShape[]) => ({ id, name: id, kind: "mesh", color: "#888", x: 0, z: 0, elevation: 0, width: 1, depth: 1, height: 1, rotation: 0, groupedShapes: children }) as unknown as WorkplaneShape;

describe("repair as one history step", () => {
  it("Undo brings back the defective topology, Redo the repaired one, and no earlier entry is changed in place", async () => {
    const shared = T_JUNCTION_CUBE;
    const scene = [leaf("a", shared), group("g", [leaf("b", shared)])];
    let entries: EditorHistoryEntry[] = [editorHistoryEntry(scene, [])];
    let index = 0;
    const original = JSON.stringify(entries[0].shapes);
    const scan = await scanForOpenMeshes(entries[0].shapes);
    expect(scan.repairs.size).toBe(1);
    const applied = applyMeshRepairs(entries[0].shapes, scan.repairs);
    const result = appendEditorHistorySnapshot(entries, index, editorHistoryEntry(applied.shapes, []), 100, 1);
    entries = result.entries; index = result.index;
    expect(result.changed).toBe(true);
    expect(entries).toHaveLength(2);
    // The new entry holds the repaired meshes (still one shared array), the old one is byte-for-byte what it was.
    expect(JSON.stringify(entries[0].shapes)).toBe(original);
    const after = entries[1].shapes.map(canonicalizeShape);
    expect(analyzeMesh(after[0].importedMesh!).state).toBe("closed");
    expect(after[1].groupedShapes![0].importedMesh!.positions).toEqual(after[0].importedMesh!.positions);
    // Undo: the entry before, as the editor restores it (a canonical copy): defective again.
    const undone = entries[0].shapes.map(canonicalizeShape);
    expect(analyzeMesh(undone[0].importedMesh!).state).toBe("repairable");
    expect(analyzeMesh(undone[1].groupedShapes![0].importedMesh!).state).toBe("repairable");
    // Redo: the repaired entry again.
    expect(analyzeMesh(entries[1].shapes.map(canonicalizeShape)[0].importedMesh!).state).toBe("closed");
    // A second repair finds nothing: the history does not grow.
    const again = await scanForOpenMeshes(entries[1].shapes);
    expect(again.repairs.size).toBe(0);
  });
  it("a repair that changes nothing adds no history entry", async () => {
    const scene = [leaf("a", T_JUNCTION_CUBE)];
    const entry = editorHistoryEntry(scene, []);
    const applied = applyMeshRepairs(entry.shapes, new Map());
    const result = appendEditorHistorySnapshot([entry], 0, editorHistoryEntry(applied.shapes, []), 100, 1);
    expect(result.changed).toBe(false);
  });
});
