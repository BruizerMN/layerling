import { beforeAll, describe, expect, it, vi } from "vitest";
const kernel = vi.hoisted(() => ({ runtime: null as Promise<unknown> | null }));
vi.mock("@/lib/editorMeshCore", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/editorMeshCore")>()), getManifoldRuntime: () => kernel.runtime }));
import { restoreGroupedChildren } from "@/lib/editorBooleans";
import { meshForShape } from "@/lib/editorMeshCore";
import { planPoseRebuild, POSE_DISPLACEMENT_TOLERANCE, groupHasPose, unposePart } from "@/lib/groupPose";
import type { WorkplaneShape } from "@/types/layerling";
import { assertKernelLive, flatLeaves, maxVertexDeviation, reconstruct, startKernel } from "./support";
import { openParts, poseFieldsDiff, posedGroup, primitive, produce, relSym, type Pose } from "./poseLab";

beforeAll(async () => { kernel.runtime = Promise.resolve(await startKernel()); await assertKernelLive(); });

/*
 * Build 0127, the PRODUCTION reconstruction (planPoseRebuild + rebuildGroupFromParts, strict, with the session's opened parts): refusals and their wording (Bill's revised messages 1, 4 and 5,
 * the approved 2, 3 and 6), the group-level feature gate (paint, multicolor, marks), SAUD-scale stretch on architectural-size parts, the world-space accounting of the rotation check, verbatim ids,
 * exact restoration, no-pose groups, nested sessions.
 */
const local = (): WorkplaneShape[] => [primitive("A", "box", { x: 0, width: 40, depth: 20, height: 30 }), primitive("H", "cylinder", { x: 0, hole: true, sides: 32, width: 8, depth: 8, height: 40, elevation: -5 }), primitive("B", "box", { x: 34, z: 2, elevation: 3, width: 18, depth: 12, height: 14 })];
const movePart = (parts: WorkplaneShape[], name: string, patch: Partial<WorkplaneShape> | ((p: WorkplaneShape) => Partial<WorkplaneShape>)) => parts.map((p) => (p.name === name ? { ...p, ...(typeof patch === "function" ? patch(p) : patch) } : p));
const refusal = async (G: WorkplaneShape, edit: (parts: WorkplaneShape[]) => WorkplaneShape[]) => { const opened = openParts(G); const r = await produce(G, edit(opened), opened); expect(r.group, "a refusal was expected").toBeNull(); return r.failure; };
const STAYS = "Your changes are still in place and Group Editing remains open.";
// Bill, 2026-11-27: one remedy wording in messages 1 to 6
const CANCEL = "Cancel Group Editing to restore the original group and discard the changes made during this session.";
const orCancel = `or c${CANCEL.slice(1)}`;

describe("refusal messages (revised wording)", () => {
  it("1. skew: a part turned at an angle in a group resized unevenly", async () => {
    const G = await posedGroup(local(), { stretch: [2, 1.3, 0.6], rotation: 33 });
    const text = await refusal(G, (p) => movePart(p, "B", (b) => ({ rotation: (b.rotation ?? 0) + 25 })));
    expect(text).toBe(`Cannot finish “Posed”: “B” is turned at an angle inside a group that has been resized unevenly. Its shape would change when the group is rebuilt.\nTry aligning the part with the group's sides, ${orCancel}\n${STAYS}`);
    expect(text).not.toMatch(/90|quarter|180|270/);   // no prescribed angles
  });
  it("2. twist: a twisted part in a group resized unevenly (approved wording)", async () => {
    const parts = local(); parts[2] = { ...parts[2], extrudeTwist: 40 };
    const G = await posedGroup(parts, { stretch: [2, 1, 1] });
    const text = await refusal(G, (p) => movePart(p, "B", { x: 40 }));
    expect(text).toBe(`Cannot finish “Posed”: “B” is twisted and the group has been resized unevenly, which would change its shape. Remove the twist from “B”, ${orCancel}\n${STAYS}`);
  });
  it("3. a kind that cannot yet be kept exact in a resized group (a star)", async () => {
    const parts = local(); parts[2] = primitive("B", "star", { x: 34, width: 18, depth: 18, height: 10 });
    const G = await posedGroup(parts, { stretch: [1.7, 1.7, 1.7] });
    const text = await refusal(G, (p) => movePart(p, "B", { x: 40 }));
    expect(text).toBe(`Cannot finish “Posed”: Group Editing cannot yet keep a star (“B”) exact in a group that has been resized. ${CANCEL}\n${STAYS}`);
  });
  it("4. rotation that cannot be preserved accurately (revised: the displacement, no 0.5 degree advice)", async () => {
    const parts = local(); parts[2] = { ...parts[2], rotation: 0 };
    const G = await posedGroup(parts, { rotation: 33 });                      // no resize: only the storage of the turn matters
    const text = await refusal(G, (p) => movePart(p, "B", (b) => ({ rotation: (b.rotation ?? 0) + 0.2 })));   // 0.2 degrees relative to the group: snapped to 0 by the engine
    expect(text).toMatch(/^Cannot finish “Posed”: the current rotation of “B” cannot be preserved accurately when the group is rebuilt\. Its geometry would shift by up to 0\.\d+ mm\.\nAdjust the part's rotation, align it with the group, or cancel Group Editing to restore the original group and discard the changes made during this session\.\n/);
    expect(text).toContain(STAYS);
    expect(text).not.toContain("0.5");
  });
  it("5. a group type or feature that cannot yet be preserved (revised wording, the type is named)", async () => {
    const G = await posedGroup(local(), { mirrorX: true }, { groupOperation: "loft" });
    const text = await refusal(G, (p) => movePart(p, "B", { x: 40 }));
    expect(text).toBe(`Cannot finish “Posed”: Group Editing does not yet support preserving this type of group (loft) when it has been rotated, mirrored or resized.\n${CANCEL}\n${STAYS}`);
    expect(text).not.toMatch(/works while|not rotated/);   // no promise that an unposed group reconstructs
  });
  it("6. a changed part that uses a feature that cannot yet be kept (approved wording)", async () => {
    const G = await posedGroup(local(), { mirrorX: true });
    const text = await refusal(G, (p) => movePart(p, "B", { edgeTreatments: [{ kind: "fillet", amount: 1, edgeCount: 4 }] } as Partial<WorkplaneShape>));
    expect(text).toBe(`Cannot finish “Posed”: “B” uses edge treatments, which Group Editing cannot yet keep exact while the group is rotated, mirrored or resized. Change “B” back, ${orCancel}\n${STAYS}`);
  });
});

describe("the group-level feature gate includes paint, multicolor information and marks", () => {
  const cases: [string, Partial<WorkplaneShape>, string][] = [
    ["paint", { paint: [{ id: "s" }] } as unknown as Partial<WorkplaneShape>, "painted group"],
    ["multicolor information", { multicolor: true }, "multicolor group"],
    ["a QR code mark", { qrCode: { text: "x" } } as unknown as Partial<WorkplaneShape>, "QR code"],
    ["a name tag mark", { groupOperation: "bundle", layeredText: true }, "name tag"],
    ["edge treatments on the group", { edgeTreatments: [{ kind: "fillet", amount: 1, edgeCount: 4 }] } as Partial<WorkplaneShape>, "group with edge treatments"],
  ];
  for (const [name, patch, type] of cases) {
    it(`${name} is refused for a posed group, naming it`, async () => {
      const G = await posedGroup(local(), { mirrorX: true }, patch);
      const text = await refusal(G, (p) => movePart(p, "B", { x: 40 }));
      expect(text).toContain(`(${type})`);
    });
  }
  it("the same groups WITHOUT a pose are not touched by the gate (the Build 0126 path)", async () => {
    const G = await posedGroup(local(), {}, { paint: [{ id: "s" }] } as unknown as Partial<WorkplaneShape>);
    expect(groupHasPose(G)).toBe(false);
    expect(planPoseRebuild(G, openParts(G), openParts(G)).kind).toBe("unposed");
  });
  it("an untouched part of an unsupported kind never causes a refusal; the group builder is what has to be verified", async () => {
    const parts = local(); parts[2] = primitive("B", "star", { x: 34, width: 18, depth: 18, height: 10 });
    const G = await posedGroup(parts, { stretch: [1.7, 1.7, 1.7] });
    const opened = openParts(G);
    const r = await produce(G, movePart(opened, "A", { x: 3 }), opened);   // only A moves; the star is retained verbatim
    expect(r.group, r.failure).toBeTruthy();
    expect(r.group!.groupedShapes!.find((p) => p.name === "B")!.kind).toBe("star");
  });
});

describe("SAUD-scale stretch on architectural-size parts", () => {
  // a SAUD wall group: 2.3 mm wide, 485 mm deep, 99 mm high, stretched x39.7 along X (parts stored 0.058 mm thick)
  const wall = (): WorkplaneShape[] => [primitive("Slab", "box", { x: 0, width: 0.06, depth: 485, height: 99 }), primitive("Opening", "box", { hole: true, x: 0, z: 100, elevation: 20, width: 0.2, depth: 60, height: 50 }), primitive("Post", "box", { x: 0.0, z: -200, width: 0.06, depth: 20, height: 99 })];
  it("edits that keep parts aligned with the group succeed, keep the pose and leave untouched parts exact", async () => {
    const G = await posedGroup(wall(), { stretch: [39.7, 1, 1], x: 4000, z: 1500 });
    expect(G.width).toBeCloseTo(0.06 * 39.7, 2);
    const opened = openParts(G);
    const edited = [...movePart(opened, "Post", { z: opened[2].z + 15 }), primitive("Extra", "box", { x: G.x, z: G.z + 150, elevation: G.elevation ?? 0, width: 2.3, depth: 30, height: 40 })];
    const r = await produce(G, edited, opened);
    expect(r.group, r.failure).toBeTruthy();
    expect(poseFieldsDiff(r.group!, G)).toBeLessThan(1e-9);
    const after = restoreGroupedChildren(r.group!);
    const dev = (a: WorkplaneShape, b: WorkplaneShape) => { const va: number[] = [], vb: number[] = []; flatLeaves(a).forEach((l) => va.push(...l.verts)); flatLeaves(b).forEach((l) => vb.push(...l.verts)); return maxVertexDeviation(va, vb); };
    expect(dev(after[0], opened[0])).toBeLessThan(1e-9);          // Slab untouched: world mesh equal
    expect(r.group!.groupedShapes![0].id).toBe(G.groupedShapes![0].id);
  });
  it("a part turned at an angle in such a group is refused as skewed (the stretch makes it large)", async () => {
    const G = await posedGroup(wall(), { stretch: [39.7, 1, 1] });
    const text = await refusal(G, (p) => movePart(p, "Post", (b) => ({ rotation: (b.rotation ?? 0) + 7 })));
    expect(text).toContain("resized unevenly");
  });
  it("the rotation check is made in the WORLD: the group's stretch amplifies a local displacement (unit level)", async () => {
    const parts = [primitive("Slab", "box", { x: 0, width: 4, depth: 485, height: 99 }), primitive("Post", "box", { x: 0, z: -200, width: 4, depth: 20, height: 99 })];
    const flat = await posedGroup(parts, {});
    const stretched = await posedGroup(parts, { stretch: [39.7, 1, 1] });
    const turn = (G: WorkplaneShape) => { const w = restoreGroupedChildren(G)[1]; return unposePart(G, { ...w, rotation: (w.rotation ?? 0) + 0.2 }); };   // 0.2 degrees about Y: snapped to 0 by the engine
    const a = turn(flat), b = turn(stretched);
    expect(a.displacementMm).toBeGreaterThan(0);
    expect(b.displacementMm).toBeGreaterThan(10 * a.displacementMm);                       // amplified by the stretch along X (about 39.7)
    expect(a.displacementShare).toBeGreaterThan(POSE_DISPLACEMENT_TOLERANCE);              // a 0.2 degree snap is refused even unstretched
  });
  it("a 485 mm part: ordinary 0.01 degree rounding is accepted, a snapped small turn is refused with its size in millimetres", async () => {
    const parts = [primitive("Slab", "box", { x: 0, width: 4, depth: 485, height: 99 }), primitive("Post", "box", { x: 0, z: -200, width: 4, depth: 485, height: 99 })];
    const G = await posedGroup(parts, { rotation: 33 });
    const opened = openParts(G);
    const ok = await produce(G, movePart(opened, "Post", (b) => ({ rotation: (b.rotation ?? 0) + 12.345678 })), opened);
    expect(ok.group, ok.failure).toBeTruthy();
    const bad = await refusal(G, (p) => movePart(p, "Post", (b) => ({ rotation: (b.rotation ?? 0) + 0.2 })));
    expect(bad).toMatch(/shift by up to 0\.\d+ mm|shift by up to \d+\.\d+ mm/);
  });
});

describe("cones keep their radii through a posed rebuild (the engine rescales cone radii on open; the inverse must undo it)", () => {
  it("an edited cone in a uniformly resized, turned and mirrored group: body agrees with the pose-baking rebuild of the same edit", async () => {
    const parts = [primitive("K", "cone", { x: 0, width: 20, depth: 20, height: 24 }), primitive("Block", "box", { x: 26, width: 14, depth: 14, height: 14 }), primitive("Hole", "cylinder", { hole: true, x: 26, sides: 24, width: 5, depth: 5, height: 30, elevation: -5 })];
    for (const pose of [{ stretch: [1.7, 1.7, 1.7] }, { rotation: 20, rotationX: 35, rotationZ: 50, mirrorX: true, stretch: [1.3, 1.3, 1.3] }] as Pose[]) {
      const G = await posedGroup(parts, pose);
      const opened = openParts(G);
      const edited = movePart(opened, "K", { x: opened[0].x + 2 });
      const produced = await produce(G, edited, opened);
      const baked = await reconstruct(G, edited.map((p) => ({ ...p, locked: false })));
      expect(produced.group, produced.failure).toBeTruthy();
      expect(relSym(produced.group!, baked.group!), JSON.stringify(pose)).toBeLessThan(2e-3);
    }
  });
});

describe("cone radii in a UNION-ONLY group (the path that honours an explicit radius; the kernel cut path ignores a lone baseRadius, which is why a body-level check on cut groups cannot see the inverse)", () => {
  it("an edited cone keeps its size: the restored cone's mesh equals the cone the person placed", async () => {
    const parts = [primitive("K", "cone", { x: 0, width: 20, depth: 20, height: 24 }), primitive("Block", "box", { x: 26, width: 14, depth: 14, height: 14 })];
    for (const pose of [{ stretch: [1.7, 1.7, 1.7] }, { rotation: 20, rotationX: 35, rotationZ: 50, mirrorX: true, stretch: [1.3, 1.3, 1.3] }] as Pose[]) {
      const G = await posedGroup(parts, pose);
      const opened = openParts(G);
      const edited = movePart(opened, "K", { x: opened[0].x + 2 });
      const r = await produce(G, edited, opened);
      expect(r.group, r.failure).toBeTruthy();
      const meshOf = (s: WorkplaneShape) => { const o: number[] = []; meshForShape(s).vertices.forEach((v) => o.push(...v)); return o; };
      const cone = restoreGroupedChildren(r.group!).find((p) => p.name === "K")!;
      expect(maxVertexDeviation(meshOf(cone), meshOf(edited[0])), JSON.stringify(pose)).toBeLessThan(1e-2);   // the 0.01 degree storage floor on a 20 mm cone, not a radius error of millimetres
    }
  });
});

describe("identity, exact restoration, no pose, nested sessions", () => {
  it("untouched parts keep their ids and every field (position aside); hidden, colour, shape lock and transparency are carried", async () => {
    const G = await posedGroup(local(), { mirrorX: true, rotation: 25 }, { hidden: true, transparent: true, shapeLocked: true, color: "#12ab34" });
    const opened = openParts(G);
    const r = await produce(G, movePart(opened, "B", { x: 40 }), opened);
    expect(r.group, r.failure).toBeTruthy();
    expect(r.group!.hidden).toBe(true); expect(r.group!.transparent).toBe(true); expect(r.group!.shapeLocked).toBe(true);
    expect(r.group!.groupedShapes![0].id).toBe(G.groupedShapes![0].id);
    expect(r.group!.groupedShapes![1].id).toBe(G.groupedShapes![1].id);
    const strip = (s: WorkplaneShape) => { const { x, z, elevation, id, ...rest } = JSON.parse(JSON.stringify(s)) as Record<string, unknown>; void x; void z; void elevation; void id; return JSON.stringify({ ...rest, hole: Boolean(rest.hole) }); };
    expect(strip(r.group!.groupedShapes![0])).toBe(strip(G.groupedShapes![0]));
  });
  it("when nothing in the parts changed the ORIGINAL group comes back (the same object)", async () => {
    const G = await posedGroup(local(), { mirrorX: true });
    const opened = openParts(G);
    const r = await produce(G, opened.map((p) => ({ ...p, locked: false })), opened);
    expect(r.group).toBe(G);
  });
  it("a group without a pose takes the unchanged path (no plan, no opened parts needed)", async () => {
    const G = await posedGroup(local(), {});
    expect(planPoseRebuild(G, openParts(G), undefined).kind).toBe("unposed");
    const r = await produce(G, movePart(openParts(G), "B", { x: 40 }), openParts(G));
    expect(r.group, r.failure).toBeTruthy();
    expect(groupHasPose(r.group!)).toBe(false);
  });
  const nested = async (l1Pose: Parameters<typeof posedGroup>[1]) => {
    const l3 = await posedGroup([primitive("p1", "box", { width: 12, depth: 12, height: 12 }), primitive("p2", "cylinder", { x: 11, sides: 24, width: 8, depth: 8, height: 16 }), primitive("p3", "box", { x: -11, z: 2, width: 6, depth: 6, height: 8 })], { mirrorX: true }, { id: "L3", name: "L3" });
    const l2 = await posedGroup([{ ...l3, x: 18, z: 4 }, primitive("q1", "box", { x: -22, width: 14, depth: 10, height: 12 })], { rotation: 40, stretch: [1.4, 1.4, 1.4] }, { id: "L2", name: "L2" });
    return posedGroup([{ ...l2, x: -25 }, primitive("r1", "box", { x: 40, z: 10, width: 20, depth: 12, height: 14 })], l1Pose, { id: "L1", name: "L1" });
  };
  const finishDeepestFirst = async (l1: WorkplaneShape) => {
    const groups: WorkplaneShape[] = [l1]; const opened: WorkplaneShape[][] = []; const parts: WorkplaneShape[][] = [];
    for (let level = 0; level <= 2; level += 1) { const p = restoreGroupedChildren(groups[level]).map((x) => ({ ...x, locked: false })); opened.push(p); parts.push([...p]); if (level < 2) groups.push(p[0]); }
    parts[2] = parts[2].map((p, i) => (i === 0 ? { ...p, x: p.x + 1.5, z: p.z - 0.5 } : p));
    for (let level = 2; level >= 0; level -= 1) {     // deepest first
      const r = await produce(groups[level], parts[level], opened[level]);
      if (!r.group) return { level, failure: r.failure, result: null };
      if (level === 0) return { level, failure: "", result: r.group };
      parts[level - 1][0] = r.group;
    }
    throw new Error("unreachable");
  };
  it("three nested levels, a different pose on each, finished DEEPEST FIRST: only the edited part moves, every level keeps its pose", async () => {
    const l1 = await nested({ stretch: [1.5, 1.5, 1.5], mirrorZ: true, x: 30 });   // a uniform resize at the top: nothing can skew
    const original = flatLeaves(l1);
    const done = await finishDeepestFirst(l1);
    expect(done.result, done.failure).toBeTruthy();
    const after = flatLeaves(done.result!);
    const moved = after.map((leaf, i) => (maxVertexDeviation(leaf.verts, original[i].verts) > 1e-9 ? i : -1)).filter((i) => i >= 0);
    expect(moved.length).toBe(1);
    expect(poseFieldsDiff(done.result!, l1)).toBeLessThan(1e-9);
    expect(relSym(done.result!, l1)).toBeLessThan(0.1);
  });
  it("at the OUTER level the rebuilt inner group is a changed part: turned 40 degrees inside a group resized unevenly it is refused there, naming it", async () => {
    const l1 = await nested({ stretch: [2, 1, 1], mirrorZ: true, x: 30 });
    const done = await finishDeepestFirst(l1);
    expect(done.result).toBeNull();
    expect(done.level).toBe(0);                      // the deeper levels finished; the outer one refused
    expect(done.failure).toContain("“L1”: “L2” is turned at an angle inside a group that has been resized unevenly");
    expect(done.failure).toContain("Group Editing remains open");
  });
});
