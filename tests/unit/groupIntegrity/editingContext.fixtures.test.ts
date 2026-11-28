import { beforeAll, describe, expect, it, vi } from "vitest";
const kernel = vi.hoisted(() => ({ runtime: null as Promise<unknown> | null }));
vi.mock("@/lib/editorMeshCore", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/editorMeshCore")>()), getManifoldRuntime: () => kernel.runtime }));
import { restoreGroupedChildren } from "@/lib/editorBooleans";
import { rebuildGroupFromParts } from "@/lib/groupReconstruction";
import { notesAfterShapeChange, notesPinnedTo, notesPutBack } from "@/lib/noteAnchoring";
import { replaceAtFirst } from "@/lib/openGroupParts";
import { createVisualGroup, EMPTY_VISUAL_GROUPS, liveObjectIds, membershipMap, moveObjectsToGroup } from "@/lib/visualGroups";
import { cloneWorkplaneShapeTreeWithFreshIds } from "@/lib/workplaneShapes";
import type { WorkplaneNote, WorkplaneShape } from "@/types/layerling";
import { applyMeshRepairs, scanForOpenMeshes } from "@/lib/meshRepair";
import { createKernelMeshCheck } from "@/lib/meshRepairKernel";
import { assertKernelLive, bodyStats, fixturePath, flatLeaves, loadFixture, startKernel, TRIANGLE_LIMIT } from "./support";
import { contextViolation, editableIds, trackMembership } from "./editingContextProto";

beforeAll(async () => { kernel.runtime = Promise.resolve(await startKernel()); await assertKernelLive(); });

/*
 * Build 0130 STEP 1, the SIGNATURE SCENARIO on the real documents (LAYERLING_INTEGRITY_FIXTURES, unrepaired originals). HEADLESS HARNESS, not the editor: it replays what the editor does with the pure functions the editor
 * uses (restoreGroupedChildren with keepPartVisibility and replaceAtFirst to open each level, the 0123 level tracking, notesAfterShapeChange, the PRODUCTION strict reconstruction to finish deepest first) plus the PROTOTYPE
 * membership rule and commit guard. For a sample of deeply nested groups: open the chain, delete an assembly, paste a copy of another assembly into the context, finish; then check that everything outside the chain is untouched
 * (identity, order, data), that Visual Groups membership and attached notes outside are untouched, and that the guard refuses illegitimate steps on the same state.
 */
type Level = { original: WorkplaneShape; childIds: string[]; openedParts: WorkplaneShape[] };
const hasGroup = (s: WorkplaneShape) => Boolean(s.groupedShapes?.length);

function routes(shapes: WorkplaneShape[]) {
  const out: { top: number; route: number[] }[] = [];
  shapes.forEach((top, ti) => {
    const walk = (g: WorkplaneShape, route: number[]) => {
      if (g.groupedShapes!.length >= 2 && g.groupedShapes!.some(hasGroup) && !g.locked && !g.shapeLocked) out.push({ top: ti, route });
      g.groupedShapes!.forEach((c, ci) => { if (hasGroup(c) && route.length < 4) walk(c, [...route, ci]); });
    };
    if (hasGroup(top) && !top.locked && !top.shapeLocked) walk(top, []);
  });
  return out;
}

for (const [file, repaired] of [["saud.lyl", false], ["saud.lyl", true], ["foshay.lyl", false]] as const) {
  describe.skipIf(!fixturePath(file))(`${file}${repaired ? " (after Repair Open Meshes)" : ""}: replace a nested assembly without disturbing anything outside`, () => {
    it("signature scenario over a sample of deeply nested groups", async () => {
      const project = await loadFixture(fixturePath(file)!);
      const doc = repaired ? applyMeshRepairs(project.shapes, (await scanForOpenMeshes(project.shapes, { kernelValid: await createKernelMeshCheck() })).repairs).shapes : project.shapes;
      const all = routes(doc).sort((a, b) => b.route.length - a.route.length);
      const step = Math.max(1, Math.floor(all.length / 80));
      const sample = all.filter((_, i) => i % step === 0).slice(0, 80);
      const donors = doc.map((s, i) => ({ s, i })).filter(({ s }) => hasGroup(s) && !s.locked);
      const tally = { cases: 0, finished: 0, refused: 0, unexpected: 0, outsideIntact: 0, orderIntact: 0, membership: 0, notesOutside: 0, notesFreed: 0, notesRepinned: 0, pastedJoined: 0, vgIntact: 0, guardLegalOk: 0, guardIllegalRefused: 0, guardIllegalTried: 0, depthMax: 0 };
      const diag = new Map<string, number>(); const refusals = new Map<string, number>(); const unexpected: string[] = [];
      let caseNo = -1;
      for (const { top, route } of sample) {
        caseNo += 1;
        tally.cases += 1; tally.depthMax = Math.max(tally.depthMax, route.length + 1);
        const root = doc[top];
        // --- open the chain, as the editor does (native: keepPartVisibility, parts stand where the group stood)
        let cur: WorkplaneShape[] = doc; const levels: Level[] = []; let groupId = root.id;
        for (let k = 0; k <= route.length; k += 1) {
          const g = cur.find((s) => s.id === groupId)!;
          const parts = restoreGroupedChildren(g, undefined, { keepPartVisibility: true });
          levels.push({ original: g, childIds: parts.map((p) => p.id), openedParts: parts });
          cur = replaceAtFirst(cur, [g.id], parts);
          if (k < route.length) groupId = parts[route[k]].id;
        }
        const inner = levels.at(-1)!;
        const parts0 = inner.openedParts;
        const A = parts0.find(hasGroup) ?? parts0[0];
        // a different donor assembly for each case (a top-level group elsewhere in the document, not the edited one)
        const eligible = donors.filter((d) => d.i !== top);
        const donor = eligible.length ? eligible[(caseNo * 7) % eligible.length].s : null;
        const outsideBefore = new Map(doc.filter((s) => s.id !== root.id).map((s) => [s.id, s]));
        const outsideIds = doc.filter((s) => s.id !== root.id).map((s) => s.id);
        // --- associated state: a Visual Group with two outside objects and the root group; notes on an outside object, on the assembly, on the root group
        let { registry, id: vg } = createVisualGroup(EMPTY_VISUAL_GROUPS, { name: "V" });
        registry = moveObjectsToGroup(registry, [outsideIds[0], root.id, outsideIds[outsideIds.length - 1]].filter(Boolean), vg);
        const vgBefore = JSON.stringify([...membershipMap(registry, liveObjectIds(doc))].sort());
        const note = (nid: string, shapeId: string): WorkplaneNote => ({ id: nid, text: nid, x: 1, y: 2, z: 3, anchor: { shapeId, normalized: [0.5, 0.5, 0.5] } } as WorkplaneNote);
        const heldIds = () => new Set(levels.map((l) => l.original.id));
        let notes: WorkplaneNote[] = [note("n-out", outsideIds[0]), note("n-asm", A.id), note("n-root", root.id)];
        // the editor's open step: notes pinned to the opened group are kept for Cancel and handed over (regrouping = true)
        notes = notesAfterShapeChange(notes, doc, cur, new Set(), true);
        const noteOutBefore = JSON.stringify(notes.find((n) => n.id === "n-out"));
        // --- guard on the OPEN state: legal and illegal steps
        const members0 = editableIds(levels.map((l) => l.childIds), new Set(cur.map((s) => s.id)))!;
        const legal = cur.map((s) => (s.id === parts0[0].id ? { ...s, x: s.x + 1 } : s));
        if (contextViolation(members0, cur, legal) === null) tally.guardLegalOk += 1;
        const o0 = cur.find((s) => outsideBefore.has(s.id))!;
        const illegals: WorkplaneShape[][] = [
          cur.map((s) => (s.id === o0.id ? { ...s, name: "renamed" } : s)),               // rename a surrounding
          cur.filter((s) => s.id !== o0.id),                                               // delete a surrounding
          cur.map((s) => (outsideBefore.has(s.id) ? { ...s, hidden: true } : s)),          // Hide Others / bulk hide
          cur.map((s) => (outsideBefore.has(s.id) ? { ...s, hidden: false } : s)).map((s) => (s.id === o0.id ? { ...s, locked: !s.locked } : s)),   // bulk lock/unlock
          (() => { const c = cur.slice(); const i = c.findIndex((s) => s.id === o0.id); const j = c.findIndex((s, k) => k > i && outsideBefore.has(s.id)); if (i >= 0 && j > i) [c[i], c[j]] = [c[j], c[i]]; return c; })(),   // reorder two surroundings
        ];
        for (const next of illegals) { tally.guardIllegalTried += 1; if (contextViolation(members0, cur, next) !== null) tally.guardIllegalRefused += 1; }
        // --- the scenario: delete the assembly, paste a copy of another assembly
        let ids = levels.map((l) => l.childIds as readonly string[]) as readonly (readonly string[])[];
        let prev = cur; cur = cur.filter((s) => s.id !== A.id);
        ids = trackMembership(ids, prev, cur); notes = notesAfterShapeChange(notes, prev, cur, heldIds());
        const afterDelete = { cur, ids };
        let pastedId = "";
        if (donor) {
          const placed = process.env.LAYERLING_PASTE_FAR ? donor : (() => {
            // the realistic paste: the copy is put where the assembly it replaces stood (centre of its box), then Done
            const a = bodyStats(A).bbox, d = bodyStats(donor).bbox;
            return { ...donor, x: donor.x + ((a[0] + a[3]) / 2 - (d[0] + d[3]) / 2), z: donor.z + ((a[2] + a[5]) / 2 - (d[2] + d[5]) / 2), elevation: (donor.elevation ?? 0) + (a[1] - d[1]) } as WorkplaneShape;
          })();
          const pasted = cloneWorkplaneShapeTreeWithFreshIds(placed, "paste"); pastedId = pasted.id;
          prev = cur; cur = [...cur, pasted];
          ids = trackMembership(ids, prev, cur); notes = notesAfterShapeChange(notes, prev, cur, heldIds());
          if (ids.at(-1)!.includes(pastedId)) tally.pastedJoined += 1;
        }
        if (contextViolation(editableIds(ids, new Set(cur.map((s) => s.id))), prev, cur) === null) tally.membership += 1;
        // --- finish deepest first with the PRODUCTION strict reconstruction (as finishOpenGroup)
        let failed: string | null = null; let failedLevel = -1; let failedParts: WorkplaneShape[] = [];
        for (let k = levels.length - 1; k >= 0; k -= 1) {
          const present = new Map(cur.map((s) => [s.id, s]));
          const parts = ids[k].flatMap((id) => (present.has(id) ? [{ ...present.get(id)!, locked: false }] : []));
          const r = await rebuildGroupFromParts(levels[k].original, parts, { triangleLimit: TRIANGLE_LIMIT, strict: true, opened: levels[k].openedParts });
          if (!r.group) { failedLevel = k; failedParts = parts; failed = ("removed" in r && r.removed) ? "removed (empty)" : r.failure; break; }
          const before = cur; cur = replaceAtFirst(cur, parts.map((p) => p.id), [r.group]);
          notes = notesAfterShapeChange(notes, before, cur, new Set(levels.slice(0, k).map((l) => l.original.id)), true);
        }
        if (failed) {
          // CONTROL: the same session with the paste left out (only the deletion). Refused too = not caused by the pasted object; accepted = the pasted object makes this group a mixed one.
          {
            const present = new Map(afterDelete.cur.map((x) => [x.id, x]));
            let controlOk = true;
            let ccur = afterDelete.cur;
            for (let k = levels.length - 1; k >= 0 && controlOk; k -= 1) {
              const pm = new Map(ccur.map((x) => [x.id, x]));
              const pp = afterDelete.ids[k].flatMap((id) => (pm.has(id) ? [{ ...pm.get(id)!, locked: false }] : []));
              const rr = await rebuildGroupFromParts(levels[k].original, pp, { triangleLimit: TRIANGLE_LIMIT, strict: true, opened: levels[k].openedParts });
              if (!rr.group) controlOk = false; else ccur = replaceAtFirst(ccur, pp.map((q) => q.id), [rr.group]);
            }
            void present;
            const innerAllHole = inner.openedParts.length > 0 && inner.openedParts.every((q) => q.hole);
            const donorHoleOnly = Boolean(donor && flatLeaves(donor).length && flatLeaves(donor).every((l) => l.shape.hole));
            const holes = failedParts.filter((q) => q.hole).length;
            const tag = `level ${failedLevel}/${levels.length - 1}, parts ${failedParts.length - holes} solid + ${holes} hole, donor.hole ${Boolean(donor?.hole)} donorParts ${donor?.groupedShapes?.length}; control(delete only) ${controlOk ? "ACCEPTED" : "refused too"}; innermost hole-only ${innerAllHole}; donor hole-only ${donorHoleOnly}`;
            diag.set(tag, (diag.get(tag) ?? 0) + 1);
          }
          const key = failed.split("\n")[0].replace(/“[^”]*”/g, "“…”").slice(0, 110);
          const expected = /Cannot finish/.test(failed);
          if (expected) { tally.refused += 1; refusals.set(key, (refusals.get(key) ?? 0) + 1); } else { tally.unexpected += 1; unexpected.push(`${root.name}: ${key}`); }
          continue;
        }
        tally.finished += 1;
        // --- everything outside the chain is as it was: identity, order, data, Visual Groups membership, notes
        const rootNow = cur.find((s) => s.id === root.id);
        const outsideNow = cur.filter((s) => s.id !== root.id);
        if (rootNow && outsideNow.length === outsideBefore.size && outsideNow.every((s) => outsideBefore.get(s.id) === s || JSON.stringify(outsideBefore.get(s.id)) === JSON.stringify(s))) tally.outsideIntact += 1;
        if (JSON.stringify(cur.map((s) => s.id)) === JSON.stringify(doc.map((s) => s.id))) tally.orderIntact += 1;
        if (JSON.stringify([...membershipMap(registry, liveObjectIds(cur))].sort()) === vgBefore) tally.vgIntact += 1;
        if (JSON.stringify(notes.find((n) => n.id === "n-out")) === noteOutBefore) tally.notesOutside += 1;
        if (!notes.find((n) => n.id === "n-asm")?.anchor) tally.notesFreed += 1;
        if (notes.find((n) => n.id === "n-root")?.anchor?.shapeId === root.id) tally.notesRepinned += 1;
        void notesPinnedTo; void notesPutBack; void flatLeaves;
      }
      console.info(`[0130 ${file}${repaired ? " repaired" : ""}] sampled ${tally.cases} nested groups (deepest chain ${tally.depthMax} levels): finished ${tally.finished}, expected refusals ${tally.refused} (${[...refusals].map(([k, v]) => `${v} x ${k}`).join("; ") || "none"}), UNEXPECTED ${tally.unexpected}${unexpected.slice(0, 5).map((u) => `\n   ${u}`).join("")}\n   pasted object joined the innermost level ${tally.pastedJoined}; guard allows the legitimate step ${tally.guardLegalOk}/${tally.cases}, refuses illegitimate steps ${tally.guardIllegalRefused}/${tally.guardIllegalTried}; membership+guard through the scenario ${tally.membership}/${tally.cases}\n   after Done: outside objects intact (identity, data) ${tally.outsideIntact}/${tally.finished}, top-level order intact ${tally.orderIntact}/${tally.finished}, Visual Groups membership intact ${tally.vgIntact}/${tally.finished}, outside note untouched ${tally.notesOutside}/${tally.finished}, note on the deleted assembly freed ${tally.notesFreed}/${tally.finished}, note on the edited group re-pinned ${tally.notesRepinned}/${tally.finished}\n   refusal diagnosis: ${[...diag].map(([k, v]) => `${v} x ${k}`).join(" | ") || "none"}`);
      expect(tally.unexpected).toBe(0);
      expect(tally.guardIllegalRefused).toBe(tally.guardIllegalTried);
      expect(tally.guardLegalOk).toBe(tally.cases);
      for (const key of ["outsideIntact", "orderIntact", "vgIntact", "notesOutside"] as const) expect(tally[key], key).toBe(tally.finished);
    }, 1_800_000);

    it.skipIf(repaired)("PERFORMANCE of the guard on this document (per commit, all top-level shapes)", async () => {
      const project = await loadFixture(fixturePath(file)!);
      const doc = project.shapes;
      const members = new Set(doc.slice(0, 3).map((s) => s.id));
      const time = (f: () => unknown, n = 20) => { const t0 = performance.now(); for (let i = 0; i < n; i += 1) f(); return (performance.now() - t0) / n; };
      const sharedRefs = doc.map((s) => s);                                           // a tool that keeps untouched objects by reference (the common case, before canonicalization)
      const modified = doc.map((s, i) => (i === 0 ? { ...s, x: s.x + 1 } : s));
      const allNew = doc.map((s) => ({ ...s }));                                      // worst case: every object recreated (e.g. Unhide All's map)
      const ref = time(() => contextViolation(members, doc, modified));
      const worst = time(() => contextViolation(members, doc, allNew), 5);
      console.info(`[0130 ${file} guard cost] ${doc.length} top-level shapes: reference path ${ref.toFixed(2)} ms per commit; every object recreated by spread (shared nested data) ${worst.toFixed(2)} ms; (sharedRefs ${sharedRefs.length})`);
      expect(ref).toBeLessThan(50);
    }, 600_000);
  });
}
