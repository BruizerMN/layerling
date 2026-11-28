import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
const kernel = vi.hoisted(() => ({ runtime: null as Promise<unknown> | null }));
vi.mock("@/lib/editorMeshCore", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/editorMeshCore")>()), getManifoldRuntime: () => kernel.runtime }));
import { restoreGroupedChildren } from "@/lib/editorBooleans";
import { prepareContextCommit, trackContextMembership, editableIds } from "@/lib/editingContext";
import { rebuildGroupFromParts } from "@/lib/groupReconstruction";
import { notesAfterShapeChange } from "@/lib/noteAnchoring";
import { replaceAtFirst } from "@/lib/openGroupParts";
import { canonicalizeShape, cloneWorkplaneShapeTreeWithFreshIds } from "@/lib/workplaneShapes";
import type { WorkplaneShape } from "@/types/layerling";
import { assertKernelLive, fixturePath, loadFixture, makeGroup, primitive, startKernel, TRIANGLE_LIMIT } from "./support";

beforeAll(async () => { kernel.runtime = Promise.resolve(await startKernel()); await assertKernelLive(); });

/*
 * Build 0130, N7: reference equality is a reliable "unchanged" only if nothing mutates a shape (nested data included) in place. The editor's history keeps references to earlier shape arrays, so the codebase already depends on it;
 * this verifies it for the production paths the editing context runs: the data is DEEP-FROZEN (ES modules are strict: any in-place write throws) and the paths are run on it.
 */
function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value) && !ArrayBuffer.isView(value as object)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}
const root = path.resolve(__dirname, "../../../");
const editor = readFileSync(path.join(root, "apps/web/src/components/LayerlingEditor.tsx"), "utf8");

describe("immutability of shape data (the reference-equality assumption of the guard)", () => {
  it("S: the editor never mutates the shape array or its entries in place (no push/sort/splice/assignment on shapesRef.current or its elements)", () => {
    expect(editor).not.toMatch(/shapesRef\.current\.(push|pop|shift|unshift|splice|sort|reverse|fill)\(/);
    expect(editor).not.toMatch(/shapesRef\.current\[[^\]]+\]\s*=[^=]/);
    expect(editor).not.toMatch(/shapesRef\.current\.forEach\([^)]*=>\s*\{?[^}]*\.(x|z|elevation|hidden|locked|name)\s*=[^=]/);
  });
  it("P: the production pipeline runs on DEEP-FROZEN shapes without a write (open, edit, guard, track, finish, notes, clone, canonicalize)", async () => {
    const parts = deepFreeze([primitive("p1", "box", { width: 20, depth: 10, height: 12 }), primitive("p2", "cylinder", { x: 24, sides: 24, width: 10, depth: 10, height: 14 })]);
    const G = deepFreeze({ ...(await makeGroup(parts)), name: "G" } as WorkplaneShape);
    const out = deepFreeze(primitive("outside", "box", { x: 50, rotation: 0.004 }));
    const doc = deepFreeze([out, G]);
    const opened = deepFreeze(restoreGroupedChildren(G, undefined, { keepPartVisibility: true }));
    const live = deepFreeze(replaceAtFirst(doc, [G.id], opened));
    const levels = [opened.map((p) => p.id)];
    const members = editableIds(levels, new Set(live.map((s) => s.id)));
    const added = primitive("added", "box");
    const next = [...live, added];
    expect(prepareContextCommit(members, live, next, canonicalizeShape)).toMatchObject({ ok: true });
    expect(trackContextMembership(levels, live, next)[0]).toContain("added");
    notesAfterShapeChange([], live, next);
    cloneWorkplaneShapeTreeWithFreshIds(G, "paste");
    const done = await rebuildGroupFromParts(G, [...opened.map((p) => ({ ...p })), { ...added }], { triangleLimit: TRIANGLE_LIMIT, strict: true, opened });
    expect(done.group, "failure" in done ? done.failure : "").toBeTruthy();
    canonicalizeShape(out);
  });
  const fixture = (file: string) => describe.skipIf(!fixturePath(file))(`${file}: the real document, deep-frozen`, () => {
    it("restoreGroupedChildren, replaceAtFirst, the guard, membership and the strict reconstruction never write to it", async () => {
      const project = await loadFixture(fixturePath(file)!);
      const doc = deepFreeze(project.shapes);
      const groups = doc.filter((s) => s.groupedShapes && s.groupedShapes.length >= 2).slice(0, 12);
      for (const G of groups) {
        const opened = restoreGroupedChildren(G, undefined, { keepPartVisibility: true });
        const live = replaceAtFirst(doc, [G.id], opened);
        const members = editableIds([opened.map((p) => p.id)], new Set(live.map((s) => s.id)));
        const next = live.map((s) => (s.id === opened[0].id ? { ...s, x: s.x + 1 } : s));
        expect(prepareContextCommit(members, live, next, canonicalizeShape).ok).toBe(true);
        await rebuildGroupFromParts(G, next.filter((s) => members!.has(s.id)), { triangleLimit: TRIANGLE_LIMIT, strict: true, opened });
      }
      expect(groups.length).toBeGreaterThan(0);
    }, 600_000);
  });
  fixture("saud.lyl");
  fixture("foshay.lyl");
});
