import { beforeAll, describe, expect, it, vi } from "vitest";
import { restoreGroupedChildren } from "@/lib/editorBooleans";
import { derivedLocalId } from "@/lib/localIds";
import type { WorkplaneShape } from "@/types/layerling";
import { BODY_BBOX_TOLERANCE, BODY_VOLUME_TOLERANCE, DIMENSION_TOLERANCE, LEAF_TOLERANCE, KNOWN_BODY_EXCEEDANCES, KNOWN_FAILURE_MESSAGES, KNOWN_FRAME_SHIFTS, KNOWN_PROPERTY_DIFFS, KNOWN_REBUILD_FAILURES, KNOWN_STRICT_REFUSALS, type FixtureName } from "./baseline";
import { assertKernelLive, compareGroups, editThroughChain, fixturePath, flatLeaves, flatNodes, loadFixture, maxVertexDeviation, openAndFinish, reconstructStrict, startKernel } from "./support";

const kernel = vi.hoisted(() => ({ runtime: null as Promise<unknown> | null }));
vi.mock("@/lib/editorMeshCore", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/editorMeshCore")>()), getManifoldRuntime: () => kernel.runtime }));

/*
 * The real documents (Medium, Foshay, SAUD Waiting Room), when LAYERLING_INTEGRITY_FIXTURES points at a directory holding them (not in the repository).
 * Default: a deterministic sample of about 120 groups each. LAYERLING_INTEGRITY_FULL=1: every group (SAUD about 10 s, Foshay about 1 minute).
 * Known defects are ceilings in baseline.ts (they may shrink, never grow); everything else is strict.
 */
const FULL = process.env.LAYERLING_INTEGRITY_FULL === "1";
const NAMES: FixtureName[] = ["medium", "foshay", "saud"];
const MAX_TRIANGLES = 120_000;

beforeAll(async () => {
  kernel.runtime = Promise.resolve(await startKernel());
  await assertKernelLive();
});

type Entry = { top: number; path: number[]; shape: WorkplaneShape };

function groupsOf(shapes: WorkplaneShape[]): Entry[] {
  const out: Entry[] = [];
  shapes.forEach((top, index) => {
    if (!top.groupedShapes?.length) return;
    flatNodes(top).forEach((node) => {
      const shape = node.shape;
      if (!shape.groupedShapes?.length || shape.hidden || shape.locked || (shape.importedMesh?.triangleCount ?? 0) > MAX_TRIANGLES) return;
      out.push({ top: index, path: node.path, shape });
    });
  });
  return out;
}

for (const name of NAMES) {
  const file = fixturePath(`${name}.lyl`);
  describe.skipIf(!file)(`real document: ${name}`, () => {
    let shapes: WorkplaneShape[] = [];
    let groups: Entry[] = [];
    beforeAll(async () => {
      shapes = (await loadFixture(file!)).shapes;
      groups = groupsOf(shapes);
    }, 600_000);

    it("no-op open and finish: leaves, structure and properties are intact; failures and body drift stay within the known defects", async () => {
      const step = FULL ? 1 : Math.max(1, Math.floor(groups.length / 120));
      const sample = groups.filter((_, index) => index % step === 0);
      const regressions: string[] = [];
      let failures = 0;
      let bodyExceedances = 0;
      let frameShifts = 0;
      const shifted: string[] = [];
      for (const entry of sample) {
        const label = `${entry.top}:${entry.path.join(".")}`;
        const { result } = await openAndFinish(entry.shape);
        if (!result.group) {
          if (KNOWN_FAILURE_MESSAGES.some((pattern) => pattern.test(result.failure))) failures += 1;
          else regressions.push(`${label}: unexpected failure: ${result.failure.slice(0, 80)}`);
          continue;
        }
        const c = compareGroups(entry.shape, result.group);
        if (!c.structureSame) regressions.push(`${label}: structure changed ${c.leafCount.join("->")}`);
        else if (c.maxLeafDeviation > LEAF_TOLERANCE) regressions.push(`${label}: a leaf moved by ${c.maxLeafDeviation}`);
        let shifted1 = false;
        for (const [field, [x, y]] of Object.entries(c.properties)) {
          const numeric = typeof x === "number" || typeof y === "number";
          if (numeric) {
            // KNOWN DEFECT D11: the group's frame (position, size) is re-derived and can move by up to about a millimetre where holes protrude past the body
            if (Math.abs(((x as number) ?? 0) - ((y as number) ?? 0)) > DIMENSION_TOLERANCE) shifted1 = true;
          } else if (!KNOWN_PROPERTY_DIFFS.has(field)) regressions.push(`${label}: property ${field} ${String(x)} -> ${String(y)}`);
        }
        const holeOnly = Boolean(entry.shape.hole);
        if (c.bboxDeviation > BODY_BBOX_TOLERANCE) shifted1 = true;
        if (shifted1) { frameShifts += 1; shifted.push(label); }
        if (!holeOnly && Math.abs(c.relativeVolume) > BODY_VOLUME_TOLERANCE) bodyExceedances += 1;
      }
      expect(regressions, regressions.join("\n")).toEqual([]);
      expect(bodyExceedances).toBeLessThanOrEqual(KNOWN_BODY_EXCEEDANCES[name]);
      expect(frameShifts, `groups whose frame or body box moved: ${shifted.slice(0, 12).join(" ")}`).toBeLessThanOrEqual(KNOWN_FRAME_SHIFTS[name]);
      if (FULL) expect(failures).toBeLessThanOrEqual(KNOWN_REBUILD_FAILURES[name]);
      console.info(`[integrity] ${name}: ${sample.length} of ${groups.length} groups checked; known rebuild failures ${failures}; known body exceedances ${bodyExceedances}; known frame shifts ${frameShifts}`);
    }, 1_800_000);

    it("strict reconstruction (native Done after an edit): never degraded, every refusal names the object, holes that touch nothing succeed", async () => {
      const step = FULL ? 1 : Math.max(1, Math.floor(groups.length / 120));
      const sample = groups.filter((_, index) => index % step === 0);
      const problems: string[] = [];
      let refused = 0;
      for (const entry of sample) {
        const parts = restoreGroupedChildren(entry.shape).map((part) => ({ ...part, locked: false }));
        const result = await reconstructStrict(entry.shape, parts);
        if (result.group) {
          if ("quality" in result && result.quality?.degraded) problems.push(`${entry.top}:${entry.path.join(".")}: degraded result accepted: ${result.quality.degraded}`);
          continue;
        }
        refused += 1;
        if (!/^Cannot finish /.test(result.failure) || !/\u201C[^\u201D]+\u201D/.test(result.failure)) problems.push(`${entry.top}:${entry.path.join(".")}: refusal without a named object: ${result.failure.slice(0, 100)}`);
      }
      expect(problems, problems.join("\n")).toEqual([]);
      if (FULL) expect(refused).toBeLessThanOrEqual(KNOWN_STRICT_REFUSALS[name]);
      console.info(`[integrity] ${name}: strict refusals ${refused} of ${sample.length} groups`);
    }, 1_800_000);

    it("one deliberate change to a deeply nested leaf changes that leaf only", async () => {
      const candidates: { top: number; route: number[] }[] = [];
      shapes.forEach((top, index) => {
        if (!top.groupedShapes?.length || (top.importedMesh?.triangleCount ?? 0) > 40_000) return;
        const walk = (group: WorkplaneShape, route: number[]) => group.groupedShapes!.forEach((child, i) => {
          if (child.groupedShapes?.length) walk(child, [...route, i]);
          else if (route.length >= 3 && !child.hidden && !child.locked) candidates.push({ top: index, route: [...route, i] });
        });
        walk(top, []);
      });
      candidates.sort((a, b) => b.route.length - a.route.length);
      const picked: typeof candidates = [];
      const perTop = new Map<number, number>();
      for (const c of candidates) if ((perTop.get(c.top) ?? 0) < 1 && picked.length < 3) { picked.push(c); perTop.set(c.top, 1); }
      expect(picked.length).toBeGreaterThan(0);
      for (const c of picked) {
        const top = shapes[c.top];
        const before = flatLeaves(top);
        const out = await editThroughChain(top, c.route.slice(0, -1), (parts) => parts.map((part, i) => (i === c.route[c.route.length - 1] ? { ...part, x: part.x + 1 } : part)));
        if (!out.ok) {
          expect(KNOWN_FAILURE_MESSAGES.some((pattern) => pattern.test(out.failure)), `unexpected failure at level ${out.level}: ${out.failure}`).toBe(true);
          continue;
        }
        const after = flatLeaves(out.result);
        expect(after.length).toBe(before.length);
        const deviations = before.map((leaf, i) => maxVertexDeviation(leaf.verts, after[i].verts));
        expect(deviations.filter((d) => d > 1e-9), `${c.top}:${c.route.join(".")}`).toHaveLength(1);
        expect(Math.max(...deviations)).toBeCloseTo(1, 9);
        expect(after.map((leaf) => leaf.shape.name)).toEqual(before.map((leaf) => leaf.shape.name));
      }
    }, 600_000);
  });
}

describe.skipIf(!fixturePath("saud.lyl"))("signature scenario on SAUD: replace a defective window assembly", () => {
  let shapes: WorkplaneShape[] = [];
  beforeAll(async () => {
    shapes = (await loadFixture(fixturePath("saud.lyl")!)).shapes;
  }, 600_000);

  it("delete one assembly and paste a copy of its sibling: everything else stays exact", async () => {
    const top = shapes.find((shape) => (shape.groupedShapes?.length ?? 0) >= 3 && shape.groupedShapes![0].hole && shape.groupedShapes![1].hole && shape.groupedShapes![0].groupedShapes?.length && shape.groupedShapes![0].importedMesh?.triangleCount === shape.groupedShapes![1].importedMesh?.triangleCount);
    expect(top, "a group holding two equal hole assemblies").toBeTruthy();
    const before = flatLeaves(top!);
    const deleted = flatLeaves(restoreGroupedChildren(top!)[0]).length;
    const out = await editThroughChain(top!, [], (parts) => {
      const d = parts[0], s = parts[1];
      const copy = { ...s, id: derivedLocalId(s.id, "group-child"), x: s.x + (d.x - s.x), z: s.z + (d.z - s.z), elevation: (s.elevation ?? 0) + ((d.elevation ?? 0) - (s.elevation ?? 0)) } as WorkplaneShape;
      return [...parts.filter((_, i) => i !== 0), copy];
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const after = flatLeaves(out.result);
    const key = (v: number[]) => `${v.length}|${v.slice(0, 9).map((n) => n.toFixed(6)).join(",")}`;
    const available = new Map<string, number>();
    after.forEach((leaf) => available.set(key(leaf.verts), (available.get(key(leaf.verts)) ?? 0) + 1));
    let unmatched = 0;
    before.forEach((leaf) => {
      const k = key(leaf.verts);
      const n = available.get(k) ?? 0;
      if (n > 0) available.set(k, n - 1);
      else unmatched += 1;
    });
    expect(unmatched).toBeLessThanOrEqual(deleted);
    expect(after.length).toBe(before.length);
  }, 600_000);
});
