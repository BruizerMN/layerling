import { beforeAll, describe, expect, it, vi } from "vitest";
const kernel = vi.hoisted(() => ({ runtime: null as Promise<unknown> | null }));
vi.mock("@/lib/editorMeshCore", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/editorMeshCore")>()), getManifoldRuntime: () => kernel.runtime }));
import { restoreGroupedChildren } from "@/lib/editorBooleans";
import { rebuildGroupFromParts } from "@/lib/groupReconstruction";
import { createVisualGroup, EMPTY_VISUAL_GROUPS, groupVisibilityState, moveObjectsToGroup, toggleGroupVisibility } from "@/lib/visualGroups";
import type { WorkplaneShape } from "@/types/layerling";
import { assertKernelLive, bodyStats, makeGroup, primitive, startKernel, TRIANGLE_LIMIT } from "./support";

beforeAll(async () => { kernel.runtime = Promise.resolve(await startKernel()); await assertKernelLive(); });

/*
 * Build 0130 STEP 1, Q8 (Bill's visibility distinction), headless, PRODUCTION code: what the native Group Editing does today with a hidden group and with hidden constituents, and how Visual Group visibility acts.
 * Result in short: the distinction Bill asks for ALREADY holds (Build 0126, `keepPartVisibility`); the open questions are marked AMBIGUITY.
 */
const strict = (G: WorkplaneShape, parts: WorkplaneShape[], opened: readonly WorkplaneShape[]) => rebuildGroupFromParts(G, parts, { triangleLimit: TRIANGLE_LIMIT, strict: true, opened });
const pair = async (patch: Partial<WorkplaneShape> = {}) => ({ ...(await makeGroup([primitive("p1", "box", { width: 20, depth: 10, height: 12 }), primitive("p2", "box", { x: 30, width: 10, depth: 10, height: 14 })])), ...patch } as WorkplaneShape);
const open = (G: WorkplaneShape) => restoreGroupedChildren(G, undefined, { keepPartVisibility: true }).map((p) => ({ ...p, locked: false }));

describe("hidden group and hidden constituents in native Group Editing (production)", () => {
  it("entering a HIDDEN group reveals its contents without a presentation override: the parts keep their OWN flags, the group's Hidden is not imposed on them", async () => {
    const G = await pair({ hidden: true });
    expect(open(G).map((p) => Boolean(p.hidden))).toEqual([false, false]);
  });
  it("a constituent's own Hidden is respected on entry", async () => {
    const G = await pair({ hidden: true });
    const stored = { ...G, groupedShapes: G.groupedShapes!.map((c, i) => (i === 1 ? { ...c, hidden: true } : c)) } as WorkplaneShape;
    expect(open(stored).map((p) => Boolean(p.hidden))).toEqual([false, true]);
  });
  it("Done preserves the group's original Hidden and the constituents' resulting flags (hide one, unhide another); one hidden constituent is still part of the group's data", async () => {
    const G = await pair({ hidden: true });
    const opened = open(G);
    const edited = [{ ...opened[0], hidden: true }, { ...opened[1], hidden: false }];     // hide p1 during editing, p2 stays visible
    const r = await strict(G, edited, opened);
    expect(r.group, "failure" in r ? r.failure : "").toBeTruthy();
    expect(r.group!.hidden).toBe(true);                                                    // the containing group's Hidden is untouched
    expect(r.group!.groupedShapes!.map((c) => Boolean(c.hidden))).toEqual([true, false]);  // the constituents' flags are what the person left
  });
  it("a group that is NOT hidden stays not hidden when its constituents are hidden/unhidden (the two levels are independent)", async () => {
    const G = await pair({ hidden: false });
    const opened = open(G);
    const r = await strict(G, [{ ...opened[0], hidden: true }, opened[1]], opened);
    expect(r.group!.hidden).toBeFalsy();
  });
  it("AMBIGUITY (characterization): does a hidden constituent contribute to the group's body (mesh) after Done?", async () => {
    const G = await pair({ hidden: false });
    const opened = open(G);
    const all = bodyStats(G).volume;
    const r = await strict(G, [{ ...opened[0], hidden: true }, opened[1]], opened);
    const after = bodyStats(r.group!).volume;
    console.info(`[0130 hidden constituent] body volume before ${all.toFixed(1)}, after Done with one constituent hidden ${after.toFixed(1)} (a plain group draws its constituents; whether hidden ones are drawn is the renderer's rule, not the reconstruction's)`);
    expect(after).toBeGreaterThan(0);
  });
});

describe("Visual Group visibility (production): it IS the per-object Hidden flag of its members; there is no separate group layer", () => {
  it("toggling a Visual Group's visibility sets `hidden` on its member OBJECTS (top-level ids), and nothing else", () => {
    const a = primitive("a", "box"), b = primitive("b", "box"), out = primitive("o", "box");
    const { registry, id } = createVisualGroup(EMPTY_VISUAL_GROUPS, { name: "V" });
    const reg = moveObjectsToGroup(registry, ["a", "b"], id);
    const change = toggleGroupVisibility(reg, id, [a, b, out]);
    expect(change).toBeTruthy();
    const next = change!.shapes!;
    expect(next.find((s) => s.id === "a")!.hidden).toBe(true);
    expect(next.find((s) => s.id === "o")!.hidden).toBeFalsy();
    expect(groupVisibilityState(reg, id, next)).toBe("hidden");
  });
  it("AMBIGUITY: a Visual Group member that is the group being edited is absent while it is open (lazy-valid), so a toggle then acts on the remaining present members only: with Q9 this mixed action is refused", () => {
    const a = primitive("a", "box"), out = primitive("o", "box");
    const { registry, id } = createVisualGroup(EMPTY_VISUAL_GROUPS, { name: "V" });
    const reg = moveObjectsToGroup(registry, ["a", "o"], id);                 // 'a' stands for the open group's id, which is not among the shapes while it is open
    const present = [out];
    const change = toggleGroupVisibility(reg, id, present);
    expect(change!.shapes!.find((s) => s.id === "o")!.hidden).toBe(true);     // today it would hide the outside member: outside the context, so refused under Q9
    void a;
  });
});
