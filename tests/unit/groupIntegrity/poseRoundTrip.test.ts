import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
const kernel = vi.hoisted(() => ({ runtime: null as Promise<unknown> | null }));
vi.mock("@/lib/editorMeshCore", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/editorMeshCore")>()), getManifoldRuntime: () => kernel.runtime }));
import { restoreGroupedChildren } from "@/lib/editorBooleans";
import { meshForShape } from "@/lib/editorMeshCore";
import { unposePart } from "@/lib/groupPose";
import type { WorkplaneShape } from "@/types/layerling";
import { assertKernelLive, maxVertexDeviation, primitive, startKernel } from "./support";
import { openParts, posedGroup, type Pose } from "./poseLab";

beforeAll(async () => { kernel.runtime = Promise.resolve(await startKernel()); await assertKernelLive(); });

const verts = (s: WorkplaneShape) => { const o: number[] = []; meshForShape(s).vertices.forEach((v) => o.push(...v)); return o; };

describe("Build 0127: un-posing is the inverse of opening (production unposePart, seeded random poses and parts)", () => {
  it("restore then un-pose then restore reproduces every opened part's world mesh, for boxes, cylinders, spheres, cones, tapered and leaning boxes", async () => {
    let seed = 20261127;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 0x100000000; };
    const pick = <T,>(items: readonly T[]) => items[Math.floor(rnd() * items.length)];
    const quarter = () => pick([0, 90, 180, 270]);
    let worst = 0, cases = 0; const offenders: string[] = [];
    for (let n = 0; n < 60; n += 1) {
      const uneven = rnd() < 0.5;
      const pose: Pose = {
        rotation: rnd() < 0.5 ? 10 + rnd() * 340 : 0, rotationX: rnd() < 0.4 ? 10 + rnd() * 340 : undefined, rotationZ: rnd() < 0.4 ? 10 + rnd() * 340 : undefined,
        mirrorX: rnd() < 0.4, mirrorY: rnd() < 0.2, mirrorZ: rnd() < 0.4,
        stretch: uneven ? [0.5 + rnd() * 3, 0.5 + rnd() * 3, 0.5 + rnd() * 3] : (() => { const s = 0.5 + rnd() * 2; return [s, s, s] as [number, number, number]; })(),
        x: rnd() * 400 - 200, z: rnd() * 400 - 200, elevation: rnd() * 50,
      };
      // parts turned only in ways that cannot skew under an uneven stretch (quarter turns about the group axes), so the representation is exact; arbitrary turns only under a uniform stretch
      const turn = () => (uneven ? { rotation: quarter(), rotationX: quarter(), rotationZ: quarter() } : { rotation: rnd() * 360, rotationX: rnd() * 360 > 180 ? rnd() * 360 : 0, rotationZ: 0 });
      const parts: WorkplaneShape[] = [
        primitive("a", "box", { width: 20 + rnd() * 30, depth: 10 + rnd() * 20, height: 10 + rnd() * 30, ...(rnd() < 0.5 ? { taperTopWidth: 8, taperTopDepth: 9 } : {}) }),
        primitive("b", pick(["cylinder", "sphere", "cone"] as const), { x: 30 + rnd() * 10, z: rnd() * 10, sides: 32, width: 14, depth: 14, height: 14 + rnd() * 10, ...turn() }),
        primitive("c", "box", { x: -30, width: 12, depth: 12, height: 14, ...(rnd() < 0.5 ? { extrudeTopOffsetX: 2, extrudeTopOffsetZ: 1 } : {}) }),
      ];
      const G = await posedGroup(parts, pose);
      const opened = openParts(G);
      opened.forEach((world, i) => {
        const un = unposePart(G, world);
        const again = restoreGroupedChildren({ ...G, groupedShapes: [un.part] })[0];
        const d = maxVertexDeviation(verts(again), verts(world)); worst = Math.max(worst, d); cases += 1;
        if (d > 1e-2) offenders.push(`${world.name}(${world.kind} -> ${un.part.kind}) dev ${d.toFixed(3)} uneven ${uneven} rot ${[pose.rotation, pose.rotationX, pose.rotationZ].map((v) => (v ?? 0).toFixed(1)).join('/')} mirror ${[pose.mirrorX, pose.mirrorY, pose.mirrorZ].map(Boolean).join('/')} stretch ${(pose.stretch ?? []).map((v) => v.toFixed(2)).join('/')} taper ${Boolean(world.taperTopWidth)} lean ${Boolean(world.extrudeTopOffsetX)}`);
      });
    }
    console.info(`[0127 offenders] ${offenders.length}\n${offenders.slice(0, 12).join('\n')}`);
    console.info(`[0127 round trip] ${cases} parts in 60 random posed groups: worst world-mesh deviation ${worst.toExponential(2)} mm`);
    // the engine's own 0.01 degree rotation storage is the floor for a part whose relative turn has to be re-derived: at most 3e-4 of its reach (the production displacement tolerance), here parts of about 30 mm
    expect(worst).toBeLessThan(1e-2);
  });
});

describe("Build 0127 wiring (source checks)", () => {
  const root = path.resolve(__dirname, "../../../");
  const editor = readFileSync(path.join(root, "apps/web/src/components/LayerlingEditor.tsx"), "utf8");
  const reconstruction = readFileSync(path.join(root, "apps/web/src/lib/groupReconstruction.ts"), "utf8");
  it("the session level remembers the opened parts in the native app only, and Done hands them to the strict reconstruction", () => {
    expect(editor).toContain("...(nativeDocument ? { openedParts: parts } : {})");
    expect(editor).toContain("rebuildGroupFromParts(original, parts, Boolean(nativeDocument), session.openedParts)");
  });
  it("only strict (native) reconstruction plans a pose-preserving rebuild; the browser's path is untouched", () => {
    expect(reconstruction).toContain("const plan = context.strict ? planPoseRebuild(original, parts, context.opened) : null;");
    expect(reconstruction).toContain('if (plan?.kind === "refuse") return { group: null, failure: plan.message };');
  });
  it("a refusal goes through the existing refusal path (session stays open) and an unchanged session is still restored before any reconstruction", () => {
    const finish = editor.slice(editor.indexOf("const finishOpenGroup = useCallback"), editor.indexOf("const groupPartsStepRefused"));
    expect(finish).toContain("if (!result.group) return refuseOpenGroupStep(result.failure);");
    expect(finish.indexOf("restoreOriginalSession(")).toBeLessThan(finish.indexOf("rebuildGroupFromParts(original, parts"));
  });
  it("nested levels finish deepest first: Done always acts on the innermost open level", () => {
    const finish = editor.slice(editor.indexOf("const finishOpenGroup = useCallback"), editor.indexOf("const groupPartsStepRefused"));
    expect(finish).toContain("const session = levels.at(-1);");
  });
});
