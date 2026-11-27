/*
 * Model-integrity verification support (Build 0121): the comparison tooling and fixtures helpers for tests/unit/groupIntegrity.
 *
 * Every test file there must mock the geometry runtime loader (see the header of kernelLive.test.ts): without it the engine's async booleans
 * silently return null in Node, which once produced false failures. `assertKernelLive` is the positive check that the kernel is really in use.
 */
import manifoldModule from "manifold-3d";
import { expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { buildGroupedShapeFromSelection, disposeManifold, manifoldFromMeshData, restoreGroupedChildren } from "@/lib/editorBooleans";
import { meshForShape } from "@/lib/editorMeshCore";
import { loadedManifoldRuntime, rememberManifoldRuntime } from "@/lib/manifoldHandle";
import { rebuildGroupFromParts } from "@/lib/groupReconstruction";
import { importLylProject } from "@/lib/lylProject";
import type { WorkplaneShape } from "@/types/layerling";

export const TRIANGLE_LIMIT = 250_000;

/** Loads the kernel the way the engine's own tests do; returns the runtime for `kernel.runtime = Promise.resolve(...)` in the file's mock. */
export async function startKernel() {
  const runtime = await manifoldModule();
  runtime.setup();
  rememberManifoldRuntime(runtime);
  return runtime;
}

/**
 * Positive proof that the geometry kernel is in use: a box cut by a round hole can only be made by the kernel (the clean-box shortcut handles
 * axis-aligned box cutters only). The result must say so (`grouped-manifold-cut`) and have the volume of a box with a bore through it.
 */
export async function assertKernelLive() {
  expect(loadedManifoldRuntime(), "the geometry kernel must be loaded").toBeTruthy();
  const block = primitive("block", "box", { width: 10, depth: 10, height: 10 });
  const bore = primitive("bore", "cylinder", { hole: true, sides: 64, width: 6, depth: 6, height: 14, elevation: -2 });
  const built = await buildGroupedShapeFromSelection([block, bore], TRIANGLE_LIMIT);
  expect(built.group, `the kernel must cut the block: ${built.failureNotice ?? ""}`).toBeTruthy();
  expect(built.group!.id.startsWith("grouped-manifold-cut"), `built by ${built.group!.id}`).toBe(true);
  const solid = manifoldFromMeshData(loadedManifoldRuntime()!, meshForShape(built.group!));
  try {
    expect(solid.status()).toBe("NoError");
    // a round bore of radius 3 through a 10 mm cube: 1000 - 10 * pi * 9 = 717.2 for a true circle; the 64-sided bore measures 717.5
    expect(Math.abs(solid.volume() - 717.5)).toBeLessThan(0.5);
  } finally {
    disposeManifold(solid);
  }
}

/** Production reconstruction (Done on an opened group) of exactly these parts. */
export function reconstruct(original: WorkplaneShape, parts: WorkplaneShape[]) {
  return rebuildGroupFromParts(original, parts, { triangleLimit: TRIANGLE_LIMIT });
}

/** What the editor does when a group is opened and finished with nothing changed. */
export async function openAndFinish(group: WorkplaneShape) {
  const parts = restoreGroupedChildren(group).map((part) => ({ ...part, locked: false }));
  const result = await reconstruct(group, parts);
  return { parts, result };
}

// ---------------------------------------------------------------- comparison tooling

export type Flat = { path: number[]; shape: WorkplaneShape; verts: number[] };

/** Every leaf under a shape in the world, in tree order, with its world vertices. */
export function flatLeaves(shape: WorkplaneShape, route: number[] = []): Flat[] {
  if (shape.groupedShapes?.length) return restoreGroupedChildren(shape).flatMap((child, index) => flatLeaves(child, [...route, index]));
  const mesh = meshForShape(shape);
  const verts: number[] = [];
  for (const vertex of mesh.vertices) verts.push(vertex[0], vertex[1], vertex[2]);
  return [{ path: route, shape, verts }];
}

/** Every node, groups included, in tree order, in the world frame (as the editor presents them while their ancestors are open). */
export function flatNodes(shape: WorkplaneShape, route: number[] = []): { path: number[]; shape: WorkplaneShape }[] {
  const here = [{ path: route, shape }];
  if (!shape.groupedShapes?.length) return here;
  return here.concat(restoreGroupedChildren(shape).flatMap((child, index) => flatNodes(child, [...route, index])));
}

export function maxVertexDeviation(a: readonly number[], b: readonly number[]) {
  if (a.length !== b.length) return Number.POSITIVE_INFINITY;
  let worst = 0;
  for (let index = 0; index < a.length; index += 1) worst = Math.max(worst, Math.abs(a[index] - b[index]));
  return worst;
}

export type BodyStats = { triangles: number; volume: number; area: number; bbox: number[] };
export function bodyStats(shape: WorkplaneShape): BodyStats {
  const mesh = meshForShape(shape);
  const bbox = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (const v of mesh.vertices) for (let axis = 0; axis < 3; axis += 1) { bbox[axis] = Math.min(bbox[axis], v[axis]); bbox[axis + 3] = Math.max(bbox[axis + 3], v[axis]); }
  let volume = 0;
  let area = 0;
  for (const [ia, ib, ic] of mesh.faces) {
    const A = mesh.vertices[ia], B = mesh.vertices[ib], C = mesh.vertices[ic];
    area += Math.hypot((B[1] - A[1]) * (C[2] - A[2]) - (B[2] - A[2]) * (C[1] - A[1]), (B[2] - A[2]) * (C[0] - A[0]) - (B[0] - A[0]) * (C[2] - A[2]), (B[0] - A[0]) * (C[1] - A[1]) - (B[1] - A[1]) * (C[0] - A[0])) / 2;
    volume += (A[0] * (B[1] * C[2] - B[2] * C[1]) - A[1] * (B[0] * C[2] - B[2] * C[0]) + A[2] * (B[0] * C[1] - B[1] * C[0])) / 6;
  }
  return { triangles: mesh.faces.length, volume, area, bbox };
}

/** Volume (mm^3) of the symmetric difference of two shapes' world bodies, computed with the kernel; null when either is not a valid solid. */
export function symmetricDifferenceVolume(a: WorkplaneShape, b: WorkplaneShape): number | null {
  const kernel = loadedManifoldRuntime();
  if (!kernel) throw new Error("the geometry kernel is not loaded");
  const made: unknown[] = [];
  try {
    const A = manifoldFromMeshData(kernel, meshForShape(a)); made.push(A);
    const B = manifoldFromMeshData(kernel, meshForShape(b)); made.push(B);
    if (A.status() !== "NoError" || B.status() !== "NoError") return null;
    const d1 = A.subtract(B); made.push(d1);
    const d2 = B.subtract(A); made.push(d2);
    return d1.volume() + d2.volume();
  } catch {
    return null;
  } finally {
    made.forEach(disposeManifold);
  }
}

const NUMERIC_FIELDS = ["x", "z", "elevation", "width", "depth", "height", "rotation", "rotationX", "rotationZ", "groupedBaseWidth", "groupedBaseDepth", "groupedBaseHeight"] as const;
const BOOLEAN_FIELDS = ["mirrorX", "mirrorY", "mirrorZ", "hole", "hidden", "locked", "shapeLocked", "transparent", "multicolor"] as const;
const TEXT_FIELDS = ["name", "color", "kind", "groupOperation"] as const;

/** Property differences between two shapes. Booleans are compared strictly (`undefined` is false, never "equal to anything"). */
export function propertyDiffs(a: WorkplaneShape, b: WorkplaneShape, numericTolerance = 1e-9) {
  const out: Record<string, [unknown, unknown]> = {};
  for (const field of NUMERIC_FIELDS) {
    const x = (a as unknown as Record<string, unknown>)[field] as number | undefined, y = (b as unknown as Record<string, unknown>)[field] as number | undefined;
    if (Math.abs((x ?? 0) - (y ?? 0)) > numericTolerance) out[field] = [x, y];
  }
  for (const field of BOOLEAN_FIELDS) {
    const x = (a as unknown as Record<string, unknown>)[field], y = (b as unknown as Record<string, unknown>)[field];
    if (Boolean(x) !== Boolean(y)) out[field] = [x, y];
  }
  for (const field of TEXT_FIELDS) {
    // `groupOperation` undefined and "group" both mean a plain merged group
    const fallback = field === "groupOperation" ? "group" : "";
    const x = (a as unknown as Record<string, unknown>)[field], y = (b as unknown as Record<string, unknown>)[field];
    if ((x ?? fallback) !== (y ?? fallback)) out[field] = [x, y];
  }
  return out;
}

export type GroupComparison = {
  leafCount: [number, number];
  structureSame: boolean;
  maxLeafDeviation: number;
  properties: Record<string, [unknown, unknown]>;
  before: BodyStats;
  after: BodyStats;
  bboxDeviation: number;
  relativeVolume: number;
};

/** Compares a group before and after reconstruction: leaves (world vertices, names, order, hole and colour), properties and the derived body. */
export function compareGroups(before: WorkplaneShape, after: WorkplaneShape): GroupComparison {
  const a = flatLeaves(before), b = flatLeaves(after);
  const sameCount = a.length === b.length;
  let structure = sameCount;
  let deviation = sameCount ? 0 : Number.POSITIVE_INFINITY;
  if (sameCount) a.forEach((leaf, index) => {
    const other = b[index];
    if (leaf.shape.name !== other.shape.name || Boolean(leaf.shape.hole) !== Boolean(other.shape.hole) || leaf.shape.color !== other.shape.color) structure = false;
    deviation = Math.max(deviation, maxVertexDeviation(leaf.verts, other.verts));
  });
  const sa = bodyStats(before), sb = bodyStats(after);
  return {
    leafCount: [a.length, b.length], structureSame: structure, maxLeafDeviation: deviation, properties: propertyDiffs(before, after), before: sa, after: sb,
    bboxDeviation: Math.max(...sa.bbox.map((value, index) => Math.abs(value - sb.bbox[index]))),
    relativeVolume: sa.volume ? (sb.volume - sa.volume) / sa.volume : 0,
  };
}

// ---------------------------------------------------------------- fixtures

/** Directory with the large real documents (`medium.lyl`, `foshay.lyl`, `saud.lyl`); they are not in the repository. Set LAYERLING_INTEGRITY_FIXTURES. */
export function fixturePath(name: string): string | null {
  const dir = process.env.LAYERLING_INTEGRITY_FIXTURES;
  if (!dir) return null;
  const file = path.join(dir, name);
  return existsSync(file) ? file : null;
}

export async function loadFixture(file: string) {
  const bytes = readFileSync(file);
  return importLylProject(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
}

/** A plain primitive for synthetic documents. */
export function primitive(id: string, kind: WorkplaneShape["kind"], extra: Partial<WorkplaneShape> = {}): WorkplaneShape {
  return { id, name: id, kind, color: "#888888", x: 0, z: 0, elevation: 0, size: 10, width: 10, depth: 10, height: 10, rotation: 0, ...extra } as WorkplaneShape;
}

/** A group built the way the editor builds one (production builder). */
export async function makeGroup(parts: WorkplaneShape[]) {
  const built = await buildGroupedShapeFromSelection(parts, TRIANGLE_LIMIT);
  if (!built.group) throw new Error(`could not group: ${built.failureNotice ?? "unknown"}`);
  return built.group;
}

/**
 * The editor's nested edit, step by step with the production reconstruction: open each ancestor along `route` (indices), let `mutate` change
 * the deepest level's parts, finish each level back out. Returns the rebuilt top group, or why a level could not be rebuilt.
 */
export async function editThroughChain(top: WorkplaneShape, route: number[], mutate: (parts: WorkplaneShape[]) => WorkplaneShape[]) {
  const groups: WorkplaneShape[] = [top];
  const parts: WorkplaneShape[][] = [];
  for (let level = 0; level <= route.length; level += 1) {
    parts.push(restoreGroupedChildren(groups[level]).map((part) => ({ ...part, locked: false })));
    if (level < route.length) groups.push(parts[level][route[level]]);
  }
  parts[route.length] = mutate(parts[route.length]);
  for (let level = route.length; level >= 0; level -= 1) {
    const rebuilt = await reconstruct(groups[level], parts[level]);
    if (!rebuilt.group) return { ok: false as const, level, failure: rebuilt.failure };
    if (level === 0) return { ok: true as const, result: rebuilt.group };
    parts[level - 1][route[level - 1]] = rebuilt.group;
  }
  throw new Error("unreachable");
}
