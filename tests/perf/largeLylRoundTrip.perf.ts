import { unzipSync } from "fflate";
import { expect, it } from "vitest";
import { editorHistoryEntry } from "@/lib/editorHistory";
import { exportLylProject, importLylProject, LYL_LIMITS } from "@/lib/lylProject";
import { DEFAULT_SNAP_GRID, DEFAULT_WORKPLANE_WORKSPACE } from "@/lib/workplaneSettings";
import type { WorkplaneShape } from "@/types/layerling";

const MiB = 1024 * 1024;
const partCount = 21_833;
const assemblyCount = 15;
const triangles = 189;

it("reopens a 21,833-part .lyl with distinct meshes and all 15 assembly states", async () => {
  const shapes: WorkplaneShape[] = Array.from({ length: partCount }, (_, index) => {
    const positions: number[] = [];
    for (let triangle = 0; triangle < triangles; triangle++) {
      const x = triangle / triangles;
      const y = (index + 1) / partCount;
      positions.push(x, 0, 0, x, y, 0, x, 0, 1);
    }
    return {
      id: `part-${String(index).padStart(5, "0")}`,
      name: `Pedestal test body ${index}`,
      kind: "mesh",
      color: "#12a4cc",
      x: index % 181,
      z: Math.floor(index / 181),
      elevation: index / 173,
      size: 1,
      width: 1,
      depth: 1,
      height: 1,
      rotation: index % 360,
      locked: index % 29 === 0,
      hidden: index % 41 === 0,
      importedMesh: { positions, baseWidth: 1, baseDepth: 1, baseHeight: 1, triangleCount: triangles, sourceFormat: "json" },
    };
  });
  const history = Array.from({ length: assemblyCount }, (_, index) =>
    editorHistoryEntry(shapes.slice(0, Math.floor(partCount * (index + 1) / assemblyCount)), []),
  );
  const input = {
    projectName: "Synthetic Foshay pedestal",
    shapes,
    history,
    historyIndex: history.length - 1,
    assets: [],
    workspace: DEFAULT_WORKPLANE_WORKSPACE,
    snapGrid: DEFAULT_SNAP_GRID,
    placementElevation: 0,
    compressionLevel: 1 as const,
  };
  const archive = await exportLylProject(input);
  const metadata = unzipSync(archive, { filter: (file) => file.name === "project.json" })["project.json"];
  expect(metadata.byteLength).toBeGreaterThan(64 * MiB);
  console.info({
    manifestMiB: metadata.byteLength / MiB,
    expandedMeshMiB: partCount * (16 + triangles * 9 * 8) / MiB,
    archiveMiB: archive.byteLength / MiB,
  });

  const restored = await importLylProject(archive);
  expect(restored.shapes).toHaveLength(partCount);
  expect(restored.historyIndex).toBe(assemblyCount - 1);
  expect(restored.history.map((entry) => entry.shapes.length)).toEqual(history.map((entry) => entry.shapes.length));
  for (const [index, actual] of restored.shapes.entries()) {
    const expected = shapes[index];
    if (actual.id !== expected.id || actual.x !== expected.x || actual.z !== expected.z
      || actual.elevation !== expected.elevation || actual.rotation !== expected.rotation
      || actual.locked !== expected.locked || actual.hidden !== expected.hidden) {
      throw new Error(`Changed identity, placement or editor flags at part ${index}`);
    }
    const actualPositions = actual.importedMesh?.positions;
    const expectedPositions = expected.importedMesh!.positions;
    if (actualPositions?.length !== expectedPositions.length
      || expectedPositions.some((value, coordinate) => !Object.is(value, actualPositions[coordinate]))) {
      throw new Error(`Changed mesh at part ${index}`);
    }
  }

  // A change after reopening can be saved and reopened again without the earlier undo states.
  const editedShapes = restored.shapes.map((shape, index) => index === 1 ? { ...shape, x: shape.x + 2 } : shape);
  const edited = await importLylProject(await exportLylProject({
    ...input,
    shapes: editedShapes,
    history: [editorHistoryEntry(editedShapes, [])],
    historyIndex: 0,
    assets: restored.assets,
  }), { currentStateOnly: true });
  expect(edited.shapes).toHaveLength(partCount);
  expect(edited.shapes[1].x).toBe(shapes[1].x + 2);
  expect(archive.byteLength).toBeLessThan(LYL_LIMITS.archiveBytes);
}, 240_000);
