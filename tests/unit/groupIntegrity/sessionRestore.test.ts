import { beforeAll, describe, expect, it, vi } from "vitest";
import { restoreGroupedChildren } from "@/lib/editorBooleans";
import { editorHistoryEntry, projectShapesFingerprint } from "@/lib/editorHistory";
import { documentSignature } from "@/lib/host/documentRevision";
import { replaceAtFirst } from "@/lib/openGroupParts";
import { canonicalizeShape } from "@/lib/workplaneShapes";
import { DEFAULT_SNAP_GRID, DEFAULT_WORKPLANE_WORKSPACE } from "@/lib/workplaneSettings";
import type { WorkplaneShape } from "@/types/layerling";
import { assertKernelLive, fixturePath, flatNodes, loadFixture, makeGroup, primitive, startKernel } from "./support";

const kernel = vi.hoisted(() => ({ runtime: null as Promise<unknown> | null }));
vi.mock("@/lib/editorMeshCore", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/editorMeshCore")>()), getManifoldRuntime: () => kernel.runtime }));
beforeAll(async () => {
  kernel.runtime = Promise.resolve(await startKernel());
  await assertKernelLive();
});

/*
 * Build 0122: an unchanged editing session restores the original group EXACTLY (the editor does not rebuild; `restoreOriginalSession`). These tests perform the
 * same list operations the editor performs (parts replace the group in its place; the original replaces its parts) and check the document-level consequences:
 * identical objects, order, scene fingerprint and therefore the same "modified" state. They are what replaces the known defect D2e ("unchanged Done is not an identity").
 */
const signatureOf = (shapes: WorkplaneShape[]) => documentSignature({
  entryFingerprint: editorHistoryEntry(shapes, []).fingerprint, attachments: "", workspace: {}, snapGrid: DEFAULT_SNAP_GRID, placementElevation: 0, placementWorkplane: "", savedViews: "", cornerRulers: "", tape: "",
});

function openAndRestore(shapes: WorkplaneShape[], groupId: string) {
  const group = shapes.find((shape) => shape.id === groupId)!;
  const parts = restoreGroupedChildren(group).map(canonicalizeShape);
  const opened = replaceAtFirst(shapes, [group.id], parts);
  const atOpen = projectShapesFingerprint(opened);
  const restored = replaceAtFirst(opened, parts.map((part) => part.id), [group]);
  return { opened, atOpen, restored, parts };
}

describe("unchanged session restores the exact scene", () => {
  it("the restored list is the original list: same objects, same order, same fingerprint, same document signature", async () => {
    const group = { ...(await makeGroup([primitive("a", "box", { x: -20, width: 20, depth: 10, height: 15 }), primitive("b", "cylinder", { x: 8, z: 3, elevation: 4, width: 12, depth: 12, height: 9, sides: 48 })])), id: "g", name: "Fence" } as WorkplaneShape;
    const shapes = [primitive("first", "box", { x: 100 }), group, primitive("last", "box", { x: -100 })].map(canonicalizeShape);
    const { restored, opened, atOpen } = openAndRestore(shapes, "g");
    expect(restored).toEqual(shapes);
    expect(restored.map((shape) => shape.id)).toEqual(["first", "g", "last"]);
    expect(projectShapesFingerprint(restored)).toBe(projectShapesFingerprint(shapes));
    expect(signatureOf(restored)).toBe(signatureOf(shapes));
    // and the opened state is a different scene, which is what "changed or not" is measured against
    expect(atOpen).not.toBe(projectShapesFingerprint(shapes));
    expect(projectShapesFingerprint(opened)).toBe(atOpen);
  });

  it("a rotated, mirrored, stretched group comes back with its own pose untouched (the case the rebuild bakes)", async () => {
    const base = await makeGroup([primitive("a", "box", { x: -20, width: 20, depth: 10, height: 15 }), primitive("b", "cylinder", { x: 8, z: 3, elevation: 4, width: 12, depth: 12, height: 9, sides: 48 })]);
    const group = { ...base, id: "g", x: 100, z: 50, rotation: 30, mirrorX: true, width: base.width * 1.5, shapeLocked: true, hidden: false } as WorkplaneShape;
    const { restored } = openAndRestore([canonicalizeShape(group)], "g");
    expect(restored[0].rotation).toBe(30);
    expect(restored[0].mirrorX).toBe(true);
    expect(restored[0].shapeLocked).toBe(true);
    expect(restored[0]).toEqual(canonicalizeShape(group));
  });

  it("a hole-only group keeps its own colour (the rebuild turns it grey)", async () => {
    const cutter = async (id: string, x: number) => ({
      ...(await makeGroup([primitive(`${id}b`, "box", { x, color: "#f5831f" }), primitive(`${id}c`, "cylinder", { x, hole: true, sides: 32, width: 4, depth: 4, height: 14, elevation: -2 })])),
      id, hole: true, color: "#f5831f",
    } as WorkplaneShape);
    const group = { ...(await makeGroup([await cutter("c1", 0), await cutter("c2", 20)])), id: "g", color: "#f5831f" } as WorkplaneShape;
    const { restored } = openAndRestore([canonicalizeShape(group)], "g");
    expect(restored[0].color).toBe("#f5831f");
    expect(restored[0]).toEqual(canonicalizeShape(group));
  });

  it("a hidden group stays hidden, and its parts were not marked hidden for good", async () => {
    const group = { ...(await makeGroup([primitive("a", "box", {}), primitive("b", "box", { x: 20 })])), id: "g", hidden: true } as WorkplaneShape;
    const { restored } = openAndRestore([canonicalizeShape(group)], "g");
    expect(restored[0].hidden).toBe(true);
    expect(restored[0].groupedShapes!.every((part) => !part.hidden)).toBe(true);
  });
});

for (const name of ["medium", "foshay", "saud"] as const) {
  const file = fixturePath(`${name}.lyl`);
  describe.skipIf(!file)(`real document ${name}: every group, opened and restored unchanged`, () => {
    it("is value-identical to the original, part ids included", async () => {
      const shapes = (await loadFixture(file!)).shapes.map(canonicalizeShape);
      const tops = shapes.filter((shape) => shape.groupedShapes?.length);
      const sample = process.env.LAYERLING_INTEGRITY_FULL === "1" ? tops : tops.filter((_, index) => index % 4 === 0);
      let checked = 0;
      for (const top of sample) {
        const { restored } = openAndRestore(shapes, top.id);
        expect(restored[shapes.indexOf(top)], top.name).toEqual(top);
        checked += 1;
        for (const node of flatNodes(top).filter((n) => n.path.length > 0 && n.shape.groupedShapes?.length && !n.shape.hidden && !n.shape.locked).slice(0, 4)) {
          const nested = canonicalizeShape(node.shape);
          expect(openAndRestore([nested], nested.id).restored[0]).toEqual(nested);
        }
      }
      expect(checked).toBeGreaterThan(0);
      expect(projectShapesFingerprint(shapes)).toBe(projectShapesFingerprint(shapes.map((s) => canonicalizeShape(s))));
    }, 1_800_000);
  });
}

void DEFAULT_WORKPLANE_WORKSPACE;
