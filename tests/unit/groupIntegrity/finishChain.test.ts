import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
const kernel = vi.hoisted(() => ({ runtime: null as Promise<unknown> | null }));
vi.mock("@/lib/editorMeshCore", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/editorMeshCore")>()), getManifoldRuntime: () => kernel.runtime }));
import { restoreGroupedChildren } from "@/lib/editorBooleans";
import { replaceAtFirst } from "@/lib/openGroupParts";
import { cloneWorkplaneShapeTreeWithFreshIds } from "@/lib/workplaneShapes";
import type { WorkplaneShape } from "@/types/layerling";
import { assertKernelLive, fixturePath, loadFixture, makeGroup, primitive, startKernel } from "./support";
import { finishChain, finishChainPerLevel, type ChainLevel } from "./finishChainProto";

beforeAll(async () => { kernel.runtime = Promise.resolve(await startKernel()); await assertKernelLive(); });

/*
 * Build 0132 STAGE 1: transactional completion of a chain of editing levels (whole-session Done; a breadcrumb click). FAILING FIRST: production has no such function. PROTOTYPE (test tree, production reconstruction):
 * equivalence with the per-level path on real SAUD/Foshay chains, and REFUSAL ATOMICITY (an outer refusal leaves nothing of the successfully computed inner levels). Real documents are deep-frozen: nothing may write to them.
 */
const root = path.resolve(__dirname, "../../../");
const editor = readFileSync(path.join(root, "apps/web/src/components/LayerlingEditor.tsx"), "utf8");
const hasGroup = (s: WorkplaneShape) => Boolean(s.groupedShapes?.length);
const deepFreeze = <T,>(v: T): T => { if (v && typeof v === "object" && !Object.isFrozen(v) && !ArrayBuffer.isView(v as object)) { Object.freeze(v); Object.values(v as Record<string, unknown>).forEach(deepFreeze); } return v; };
const json = (xs: readonly WorkplaneShape[]) => JSON.stringify(xs);
/** Equal documents without stringifying whole hierarchies: the same objects by reference, and a JSON comparison only of the few that were rebuilt. */
const norm = (x: WorkplaneShape) => JSON.stringify(x).replace(/"id":"[^"]*"/g, '"id":""');      // a rebuilt group's inner ids are generated; compare structure, geometry and properties
const sameDocs = (a: readonly WorkplaneShape[], b: readonly WorkplaneShape[]) => a.length === b.length && a.every((x, i) => x === b[i] || (x.id === b[i].id && norm(x) === norm(b[i])));
const sameRefs = (a: readonly WorkplaneShape[], b: readonly WorkplaneShape[]) => a.length === b.length && a.every((x, i) => x === b[i]);

function openChain(doc: readonly WorkplaneShape[], top: number, route: number[]) {
  let cur: WorkplaneShape[] = [...doc]; const levels: ChainLevel[] = []; let groupId = doc[top].id;
  for (let k = 0; k <= route.length; k += 1) {
    const g = cur.find((s) => s.id === groupId)!;
    const parts = restoreGroupedChildren(g, undefined, { keepPartVisibility: true });
    levels.push({ original: g, childIds: parts.map((p) => p.id), openedParts: parts });
    cur = replaceAtFirst(cur, [g.id], parts);
    if (k < route.length) groupId = parts[route[k]].id;
  }
  return { cur, levels };
}
const addMembers = (levels: ChainLevel[], k: number, ...added: WorkplaneShape[]) => levels.map((l, i) => (i === k ? { ...l, childIds: [...l.childIds, ...added.map((a) => a.id)] } : l));

describe("FAILING FIRST: production must provide the transactional completion", () => {
  it.fails("a production module (lib/groupFinishChain) computes all levels deepest-first without committing", async () => {
    const mod = await import("@/lib/groupFinishChain" as string);
    expect(typeof mod.finishChain).toBe("function");
  });
  it.fails("the editor has whole-session Done and Cancel and a go-to-level operation that use it (and commit once)", () => {
    expect(editor).toContain("finishAllOpenGroups");
    expect(editor).toContain("cancelWholeSession");
    expect(editor).toContain("finishToLevel");
  });
});

describe("PROTOTYPE: transactional completion on synthetic nested groups", () => {
  const build = async () => {
    const inner = await makeGroup([primitive("i1", "box", { width: 10, depth: 10, height: 10 }), primitive("i2", "box", { x: 12, width: 10, depth: 10, height: 10 })]);
    const outer = await makeGroup([{ ...inner, id: "innerG", name: "Inner" } as WorkplaneShape, primitive("o2", "box", { x: 40, width: 10, depth: 10, height: 10 })]);
    return { ...outer, id: "outerG", name: "Outer" } as WorkplaneShape;
  };
  const chain = async () => {
    const outer = await build();
    const doc: WorkplaneShape[] = [primitive("surround", "box", { x: 100 }), outer];
    return openChain(doc, 1, [0]);
  };
  it("completes both levels, commits ONCE (one result), keeps surroundings by reference; breadcrumb click keeps the outer level open", async () => {
    const { cur, levels } = await chain();
    const edited = cur.map((s) => (s.id === levels[1].childIds[0] ? { ...s, x: s.x + 2 } : s));
    const all = await finishChain(edited, levels, 0);
    expect(all.ok, all.ok ? "" : all.message).toBe(true);
    if (!all.ok) return;
    expect(all.open).toHaveLength(0);
    expect(all.shapes.map((s) => s.id)).toEqual(["surround", "outerG"]);
    expect(all.shapes[0]).toBe(cur[0]);                                                      // the surrounding is carried untouched
    const toOuter = await finishChain(edited, levels, 1);
    expect(toOuter.ok && toOuter.open.length).toBe(1);
    expect(toOuter.ok && toOuter.shapes.some((s) => s.id === levels[1].original.id)).toBe(true);        // the inner group is back as an object inside the still-open outer level
  });
  it("REFUSAL ATOMICITY: an outer refusal returns NO result and the input is untouched; today's per-level path has already committed the inner level when it stops", async () => {
    const { cur, levels } = await chain();
    // the outer level is edited into something the strict reconstruction refuses: an open mesh solid cut by a hole
    const openMesh = { ...primitive("open", "box", { x: 40, width: 10, depth: 10, height: 10 }), kind: "mesh", importedMesh: { positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], baseWidth: 10, baseDepth: 10, baseHeight: 10, triangleCount: 1, sourceFormat: "json" } } as unknown as WorkplaneShape;
    const hole = primitive("hole", "box", { x: 40, hole: true, width: 12, depth: 12, height: 12 });
    const edited = [...cur.map((s) => (s.id === levels[1].childIds[0] ? { ...s, x: s.x + 2 } : s)), openMesh, hole];
    const lv = addMembers(levels, 0, openMesh, hole);
    const before = json(edited); const frozen = deepFreeze([...edited]);
    const tx = await finishChain(frozen, lv, 0);
    expect(tx.ok).toBe(false);
    if (!tx.ok) { expect(tx.level).toBe(0); expect(tx.message).toMatch(/Cannot finish/); }
    expect(json(frozen)).toBe(before);                                                         // not a byte changed, nothing returned
    const today = await finishChainPerLevel(edited, lv, 0);
    expect(today.refused?.level).toBe(0);
    expect(json(today.shapes)).not.toBe(before);                                               // today: the inner level IS already committed when the outer one refuses (the partial state Bill excluded)
    expect(today.open).toHaveLength(1);
  });
});

for (const file of ["saud.lyl", "foshay.lyl"]) {
  describe.skipIf(!fixturePath(file))(`${file}: real hierarchies`, () => {
    it("transactional == per-level for whole-session Done and for every breadcrumb target; outer refusals are atomic", async () => {
      const project = await loadFixture(fixturePath(file)!);
      const doc = deepFreeze(project.shapes);
      const routes: { top: number; route: number[] }[] = [];
      doc.forEach((top, ti) => { const walk = (g: WorkplaneShape, route: number[]) => { if (g.groupedShapes!.length >= 2 && g.groupedShapes!.some(hasGroup) && !g.locked && !g.shapeLocked) routes.push({ top: ti, route }); g.groupedShapes!.forEach((c, ci) => { if (hasGroup(c) && route.length < 4) walk(c, [...route, ci]); }); }; if (hasGroup(top) && !top.locked && !top.shapeLocked) walk(top, []); });
      routes.sort((a, b) => b.route.length - a.route.length);
      const step = Math.max(1, Math.floor(routes.length / 40)); const sample = routes.filter((_, i) => i % step === 0).slice(0, 40);
      const donors = doc.filter((s) => hasGroup(s));
      const t = { cases: 0, equalAll: 0, equalPartial: 0, partialTried: 0, refusedBoth: 0, refusalAtomic: 0, refusalTried: 0, todayPartialLeak: 0, deepest: 0 };
      let n = 0;
      for (const { top, route } of sample) {
        n += 1; t.cases += 1; t.deepest = Math.max(t.deepest, route.length + 1);
        const { cur, levels } = openChain(doc, top, route);
        const inner = levels.at(-1)!;
        const donor = donors[(n * 7) % donors.length];
        const pasted = cloneWorkplaneShapeTreeWithFreshIds(donor.id === doc[top].id ? donors[(n * 7 + 1) % donors.length] : donor, "paste");
        const removed = inner.openedParts.find(hasGroup) ?? inner.openedParts[0];
        const edited = [...cur.filter((s) => s.id !== removed.id), pasted];
        const lv = addMembers(levels, levels.length - 1, pasted);
        const tx = await finishChain(edited, lv, 0);
        const seq = await finishChainPerLevel(edited, lv, 0);
        if (tx.ok) { if (seq.refused === null && sameDocs(tx.shapes, seq.shapes)) t.equalAll += 1; } else if (seq.refused) t.refusedBoth += 1;
        if (lv.length >= 3) {                                                                  // breadcrumb targets: every ancestor
          for (let keep = 1; keep < lv.length; keep += 1) {
            t.partialTried += 1;
            const a = await finishChain(edited, lv, keep), b = await finishChainPerLevel(edited, lv, keep);
            if (a.ok && b.refused === null && sameDocs(a.shapes, b.shapes) && a.open.length === keep) t.equalPartial += 1; else if (!a.ok && b.refused) t.equalPartial += 1;
          }
        }
        if (lv.length >= 2 && tx.ok) {                                                         // atomic refusal at the OUTER level while the inner levels succeed
          const o = { ...primitive(`open${n}`, "box", {}), kind: "mesh", importedMesh: { positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], baseWidth: 1, baseDepth: 1, baseHeight: 1, triangleCount: 1, sourceFormat: "json" } } as unknown as WorkplaneShape;
          const h = primitive(`hole${n}`, "box", { hole: true, width: 400, depth: 400, height: 400 });
          const outerBox = { ...o, x: lv[0].openedParts[0].x, z: lv[0].openedParts[0].z }; const hb = { ...h, x: outerBox.x, z: outerBox.z };
          const bad = [...edited, outerBox, hb]; const lvBad = addMembers(lv, 0, outerBox, hb);
          t.refusalTried += 1;
          const txBad = await finishChain(deepFreeze([...bad]), lvBad, 0);
          const today = await finishChainPerLevel(bad, lvBad, 0);
          if (!txBad.ok && txBad.level === 0) t.refusalAtomic += 1;      // the input is deep-frozen: a write would have thrown
          if (today.refused && today.open.length === 1 && !sameRefs(today.shapes, bad)) t.todayPartialLeak += 1;
        }
      }
      console.info(`[0132 ${file}] ${t.cases} chains (deepest ${t.deepest} levels): whole-session transactional == per-level ${t.equalAll} (refused by both ${t.refusedBoth}); breadcrumb targets equal ${t.equalPartial}/${t.partialTried}; outer refusal atomic ${t.refusalAtomic}/${t.refusalTried}; today's per-level path left inner levels committed in ${t.todayPartialLeak} of those`);
      expect(t.equalAll + t.refusedBoth).toBe(t.cases);
      expect(t.equalPartial).toBe(t.partialTried);
      expect(t.refusalAtomic).toBe(t.refusalTried);
    }, 1_800_000);
  });
}
