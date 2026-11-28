import type { WorkplaneShape } from "@/types/layerling";

/**
 * Build 0124: Repair Open Meshes. A pure engine (no editor, no kernel): finds imported meshes whose open edges are only T-junctions (a vertex that lies on the
 * edge of the face next to it, so the surface is geometrically closed but topologically open: the Boolean kernel rejects it as "not manifold"), and repairs them by
 * splitting the face that uses the whole edge at every such vertex. The repair creates no coordinate, moves none, and keeps the surface exactly (tests prove it on the
 * real documents). It never touches healthy meshes, baked group bodies, or meshes with other defects.
 *
 * Appearance: a mesh without its own normals is shaded flat from its triangles (the sub-triangles of a split are coplanar with the face they came from, so they shade
 * exactly as it did). A mesh WITH per-corner normals keeps every normal: a sub-triangle's corners take the normals of the face's corners, and the inserted vertex takes the
 * normal interpolated along the edge, which is the shading the surface already had there.
 */
export type ImportedMesh = NonNullable<WorkplaneShape["importedMesh"]>;

export type RepairedMesh = { positions: number[]; normals?: number[]; triangleCount: number; splits: number; maxOffEdge: number };
export type MeshState = "closed" | "repairable" | "notRepairable";
export type MeshAnalysis = { state: MeshState; openEdges: number; repaired?: RepairedMesh };

/** The vertices must lie this close to the edge (as a fraction of the mesh's diagonal) to count as a T-junction. */
export const T_JUNCTION_TOLERANCE = 1e-6;
const MAX_PASSES = 64;
/** A mesh with more open edges than this is not a T-junction defect and is not worked on at all. */
const MAX_OPEN_EDGES = 4000;

type Tri = { v: [number, number, number]; n?: [number[], number[], number[]] };

type Welded = { ids: Int32Array; coords: number[][]; tris: Tri[] };

function weld(positions: ArrayLike<number>, normals: ArrayLike<number> | undefined): Welded {
  const corners = Math.floor(positions.length / 3);
  const ids = new Int32Array(corners);
  const coords: number[][] = [];
  const map = new Map<string, number>();
  for (let corner = 0; corner < corners; corner += 1) {
    const x = positions[corner * 3];
    const y = positions[corner * 3 + 1];
    const z = positions[corner * 3 + 2];
    const key = `${x},${y},${z}`;
    let id = map.get(key);
    if (id === undefined) {
      id = coords.length;
      map.set(key, id);
      coords.push([x, y, z]);
    }
    ids[corner] = id;
  }
  const tris: Tri[] = [];
  for (let t = 0; t < corners / 3; t += 1) {
    const tri: Tri = { v: [ids[t * 3], ids[t * 3 + 1], ids[t * 3 + 2]] };
    if (normals) tri.n = [0, 1, 2].map((c) => [normals[(t * 3 + c) * 3], normals[(t * 3 + c) * 3 + 1], normals[(t * 3 + c) * 3 + 2]]) as [number[], number[], number[]];
    tris.push(tri);
  }
  return { ids, coords, tris };
}

/** The directed edges used by more triangles than their reverse: the boundary of the surface, as [from, to] pairs in a fixed order. */
function boundaryEdges(tris: readonly Tri[]): [number, number][] {
  const count = new Map<number, number>();
  const stride = 1 << 26;
  const key = (a: number, b: number) => a * stride + b;
  for (const { v } of tris) {
    for (let k = 0; k < 3; k += 1) {
      const id = key(v[k], v[(k + 1) % 3]);
      count.set(id, (count.get(id) ?? 0) + 1);
    }
  }
  const out: [number, number][] = [];
  count.forEach((n, id) => {
    const a = Math.floor(id / stride);
    const b = id - a * stride;
    if (n > (count.get(key(b, a)) ?? 0)) out.push([a, b]);
  });
  out.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  return out;
}

function diagonalOf(coords: number[][]) {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (const c of coords) for (let k = 0; k < 3; k += 1) { if (c[k] < lo[k]) lo[k] = c[k]; if (c[k] > hi[k]) hi[k] = c[k]; }
  return Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
}

/**
 * The normal at a vertex inserted on an edge: the straight mean of the edge's end normals at that point, which is exactly what the graphics pipeline interpolates across the
 * original face there (it interpolates linearly and normalises per pixel), so the shading does not change. Kept as it is unless it is too short to count as a direction (the
 * renderer then would not use it), in which case its direction is used.
 */
function lerpNormal(a: number[], b: number[], t: number): number[] {
  const x = a[0] + (b[0] - a[0]) * t;
  const y = a[1] + (b[1] - a[1]) * t;
  const z = a[2] + (b[2] - a[2]) * t;
  const lengthSq = x * x + y * y + z * z;
  if (lengthSq > 0.25) return [x, y, z];
  return lengthSq > 1e-24 ? [x / Math.sqrt(lengthSq), y / Math.sqrt(lengthSq), z / Math.sqrt(lengthSq)] : a;
}

/**
 * Splits every face that uses a whole edge where vertices lie on that edge. Returns null when the mesh is not a T-junction-only defect (open edges remain, or too
 * many to try). Deterministic: the boundary edges are taken in vertex order, at most one split per triangle in a pass.
 */
export function repairTJunctions(positions: ArrayLike<number>, normals?: ArrayLike<number>): RepairedMesh | null {
  if (positions.length < 9 || positions.length % 9 !== 0) return null;
  const hasNormals = Boolean(normals && normals.length === positions.length);
  const { coords, tris } = weld(positions, hasNormals ? normals : undefined);
  const tolerance = diagonalOf(coords) * T_JUNCTION_TOLERANCE;
  let splits = 0;
  let maxOffEdge = 0;
  for (let pass = 0; pass < MAX_PASSES; pass += 1) {
    const open = boundaryEdges(tris);
    if (open.length === 0) break;
    if (open.length > MAX_OPEN_EDGES) return null;
    const candidates = new Set<number>();
    open.forEach(([a, b]) => { candidates.add(a); candidates.add(b); });
    // The triangle that uses each boundary edge (directed).
    const owner = new Map<string, number>();
    tris.forEach((tri, index) => { for (let k = 0; k < 3; k += 1) owner.set(`${tri.v[k]}>${tri.v[(k + 1) % 3]}`, index); });
    const replaced = new Map<number, Tri[]>();
    for (const [a, b] of open) {
      const index = owner.get(`${a}>${b}`);
      if (index === undefined || replaced.has(index)) continue;
      const A = coords[a];
      const B = coords[b];
      const d = [B[0] - A[0], B[1] - A[1], B[2] - A[2]];
      const length2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
      if (length2 === 0) continue;
      const inside: { p: number; t: number; off: number }[] = [];
      for (const p of candidates) {
        if (p === a || p === b) continue;
        const P = coords[p];
        const t = ((P[0] - A[0]) * d[0] + (P[1] - A[1]) * d[1] + (P[2] - A[2]) * d[2]) / length2;
        if (t <= 1e-9 || t >= 1 - 1e-9) continue;
        const off = Math.hypot(P[0] - (A[0] + t * d[0]), P[1] - (A[1] + t * d[1]), P[2] - (A[2] + t * d[2]));
        if (off <= tolerance) inside.push({ p, t, off });
      }
      if (!inside.length) continue;
      inside.sort((u, w) => u.t - w.t);
      const tri = tris[index];
      const k = [0, 1, 2].find((c) => tri.v[c] === a && tri.v[(c + 1) % 3] === b);
      if (k === undefined) continue;
      const third = tri.v[(k + 2) % 3];
      const chain = [a, ...inside.map((i) => i.p), b];
      const ts = [0, ...inside.map((i) => i.t), 1];
      const na = tri.n?.[k];
      const nb = tri.n?.[(k + 1) % 3];
      const nc = tri.n?.[(k + 2) % 3];
      const pieces: Tri[] = [];
      for (let i = 0; i < chain.length - 1; i += 1) {
        const piece: Tri = { v: [chain[i], chain[i + 1], third] };
        if (na && nb && nc) {
          const at = (j: number) => (j === 0 ? na : j === chain.length - 1 ? nb : lerpNormal(na, nb, ts[j]));
          piece.n = [at(i), at(i + 1), nc];
        }
        pieces.push(piece);
      }
      replaced.set(index, pieces);
      splits += pieces.length - 1;
      for (const i of inside) if (i.off > maxOffEdge) maxOffEdge = i.off;
    }
    if (replaced.size === 0) break;
    const next: Tri[] = [];
    tris.forEach((tri, index) => { const pieces = replaced.get(index); if (pieces) next.push(...pieces); else next.push(tri); });
    tris.length = 0;
    tris.push(...next);
  }
  if (boundaryEdges(tris).length > 0) return null;
  const out: number[] = [];
  const outNormals: number[] = [];
  for (const tri of tris) {
    for (let c = 0; c < 3; c += 1) {
      const P = coords[tri.v[c]];
      out.push(P[0], P[1], P[2]);
      if (hasNormals) {
        const n = tri.n![c];
        outNormals.push(n[0], n[1], n[2]);
      }
    }
  }
  return { positions: out, ...(hasNormals ? { normals: outNormals } : {}), triangleCount: tris.length, splits, maxOffEdge };
}

/** What state a mesh is in, and its repair when it has one. Healthy meshes cost one weld and one edge count. */
export function analyzeMesh(mesh: Pick<ImportedMesh, "positions" | "normals">): MeshAnalysis {
  const { positions, normals } = mesh;
  if (positions.length < 9 || positions.length % 9 !== 0) return { state: "notRepairable", openEdges: 0 };
  const { tris } = weld(positions, undefined);
  const open = boundaryEdges(tris);
  if (open.length === 0) return { state: "closed", openEdges: 0 };
  const repaired = repairTJunctions(positions, normals);
  return repaired ? { state: "repairable", openEdges: open.length, repaired } : { state: "notRepairable", openEdges: open.length };
}

// ---- post-conditions -----------------------------------------------------------------------------------------------------------------------------------------------

function measure(positions: ArrayLike<number>) {
  let volume = 0;
  let volumeTerms = 0;
  let area = 0;
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let o = 0; o < positions.length; o += 9) {
    const a = [positions[o], positions[o + 1], positions[o + 2]];
    const b = [positions[o + 3], positions[o + 4], positions[o + 5]];
    const c = [positions[o + 6], positions[o + 7], positions[o + 8]];
    const term = (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
    volume += term;
    volumeTerms += Math.abs(term);
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    area += 0.5 * Math.hypot(u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]);
    for (const p of [a, b, c]) for (let k = 0; k < 3; k += 1) { if (p[k] < lo[k]) lo[k] = p[k]; if (p[k] > hi[k]) hi[k] = p[k]; }
  }
  return { volume, volumeTerms, area, lo, hi, diagonal: Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) };
}

/**
 * The checks every repair must pass before it is used: the mesh is closed now; no coordinate was created (every vertex is one the mesh already had); the bounding box,
 * the enclosed volume and the surface area are the same; and normals, if there were any, are still one per corner and finite. Returns the reasons it fails, empty when it holds.
 */
export function repairProblems(before: Pick<ImportedMesh, "positions" | "normals">, after: RepairedMesh): string[] {
  const problems: string[] = [];
  const old = new Set<string>();
  for (let i = 0; i < before.positions.length; i += 3) old.add(`${before.positions[i]},${before.positions[i + 1]},${before.positions[i + 2]}`);
  for (let i = 0; i < after.positions.length; i += 3) {
    if (!old.has(`${after.positions[i]},${after.positions[i + 1]},${after.positions[i + 2]}`)) { problems.push("a vertex was created"); break; }
  }
  if (boundaryEdges(weld(after.positions, undefined).tris).length > 0) problems.push("not closed");
  const a = measure(before.positions);
  const b = measure(after.positions);
  if (a.lo.some((v, k) => v !== b.lo[k]) || a.hi.some((v, k) => v !== b.hi[k])) problems.push("bounding box changed");
  const scale = a.diagonal || 1;
  // The signed volume of an open mesh is a sum of terms that cancel: its rounding error scales with the terms, not with the (possibly tiny) total.
  if (Math.abs(a.volume - b.volume) > 1e-9 * Math.abs(a.volume) + 1e-12 * a.volumeTerms + 1e-12 * scale ** 3) problems.push("volume changed");
  if (Math.abs(a.area - b.area) > 1e-9 * a.area + 1e-12 * scale ** 2) problems.push("surface area changed");
  if (after.triangleCount * 9 !== after.positions.length) problems.push("triangle count");
  if (before.normals && before.normals.length === before.positions.length) {
    if (!after.normals || after.normals.length !== after.positions.length || after.normals.some((v) => !Number.isFinite(v))) problems.push("normals");
  } else if (after.normals) {
    problems.push("normals were added");
  }
  return problems;
}

// ---- the scene ------------------------------------------------------------------------------------------------------------------------------------------------------

/** Whether a mesh can be looked at: a leaf (never a baked group body, never a preview or a STEP body whose exact B-Rep is kept). */
function eligibleLeafMesh(shape: WorkplaneShape): ImportedMesh | null {
  if (shape.groupedShapes?.length || shape.previewOnly) return null;
  const mesh = shape.importedMesh;
  if (!mesh || mesh.brepStep || mesh.positions.length < 9 || mesh.positions.length % 9 !== 0) return null;
  return mesh;
}

/** Every eligible leaf mesh in the scene (groups opened recursively), each with its distinct position array and how many objects use it. */
export function collectLeafMeshes(shapes: readonly WorkplaneShape[]): { mesh: ImportedMesh; objects: number }[] {
  const byArray = new Map<unknown, { mesh: ImportedMesh; objects: number }>();
  const walk = (shape: WorkplaneShape) => {
    if (shape.groupedShapes?.length) { shape.groupedShapes.forEach(walk); return; }
    const mesh = eligibleLeafMesh(shape);
    if (!mesh) return;
    const entry = byArray.get(mesh.positions);
    if (entry) entry.objects += 1;
    else byArray.set(mesh.positions, { mesh, objects: 1 });
  };
  shapes.forEach(walk);
  return [...byArray.values()];
}

export type MeshRepairScan = {
  /** Distinct meshes looked at (shared assets counted once). */
  meshes: number;
  /** Distinct meshes with a repair, keyed by their original position array. */
  repairs: Map<number[], RepairedMesh>;
  /** Objects that use a repairable mesh. */
  objects: number;
  /** Distinct meshes with open edges that this repair does not fix (reported, never changed). */
  notRepairable: number;
  /** Distinct meshes the repair was found for but whose checks failed (kept as they are). */
  failedChecks: number;
};

export type KernelCheck = (positions: number[]) => Promise<boolean>;
export type ScanOptions = { kernelValid?: KernelCheck; signal?: AbortSignal; yieldNow?: () => Promise<void>; sliceMs?: number };

/**
 * Looks at every distinct leaf mesh of the scene and works out the repair of each one that needs it. Read-only: nothing is changed. A repair counts only when it passes
 * `repairProblems` and, when a kernel check is given, the repaired mesh is accepted by the kernel. Yields between slices so a large document keeps the page alive.
 */
export async function scanForOpenMeshes(shapes: readonly WorkplaneShape[], options: ScanOptions = {}): Promise<MeshRepairScan> {
  const leaves = collectLeafMeshes(shapes);
  const scan: MeshRepairScan = { meshes: leaves.length, repairs: new Map(), objects: 0, notRepairable: 0, failedChecks: 0 };
  const sliceMs = options.sliceMs ?? 12;
  const yieldNow = options.yieldNow ?? (() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
  let sliceStart = performance.now();
  for (const { mesh, objects } of leaves) {
    if (options.signal?.aborted) throw new DOMException("aborted", "AbortError");
    const analysis = analyzeMesh(mesh);
    if (analysis.state === "notRepairable") scan.notRepairable += 1;
    else if (analysis.state === "repairable" && analysis.repaired) {
      const ok = repairProblems(mesh, analysis.repaired).length === 0 && (!options.kernelValid || (await options.kernelValid(analysis.repaired.positions)));
      if (ok) { scan.repairs.set(mesh.positions, analysis.repaired); scan.objects += objects; } else scan.failedChecks += 1;
    }
    if (performance.now() - sliceStart > sliceMs) { await yieldNow(); sliceStart = performance.now(); }
  }
  return scan;
}

/**
 * The scene with each repaired mesh in place of the one it replaces, in every object that uses it (nested groups included). Only the objects on the way down to a changed
 * leaf are copied; everything else is the same object. Baked group bodies are never touched. Nothing is mutated: the old arrays stay as they were for the history.
 */
export function applyMeshRepairs(shapes: readonly WorkplaneShape[], repairs: ReadonlyMap<number[], RepairedMesh>): { shapes: WorkplaneShape[]; objects: number } {
  let objects = 0;
  const walk = (shape: WorkplaneShape): WorkplaneShape => {
    if (shape.groupedShapes?.length) {
      let changed = false;
      const children = shape.groupedShapes.map((child) => { const next = walk(child); if (next !== child) changed = true; return next; });
      return changed ? { ...shape, groupedShapes: children } : shape;
    }
    const mesh = eligibleLeafMesh(shape);
    const repaired = mesh ? repairs.get(mesh.positions) : undefined;
    if (!mesh || !repaired) return shape;
    objects += 1;
    const next: ImportedMesh = { ...mesh, positions: repaired.positions, triangleCount: repaired.triangleCount };
    if (repaired.normals) next.normals = repaired.normals;
    return { ...shape, importedMesh: next };
  };
  return { shapes: shapes.map(walk), objects };
}

/** The words the command and the confirmation use: counts of what a repair would change. */
export function describeMeshRepair(scan: Pick<MeshRepairScan, "repairs" | "objects" | "notRepairable">) {
  return { meshes: scan.repairs.size, objects: scan.objects, notRepairable: scan.notRepairable };
}

/** An indexed copy of a triangle list for the kernel (vertices welded by position, in order of first use). */
export function meshDataFromPositions(positions: ArrayLike<number>, name = "mesh") {
  const ids = new Map<string, number>();
  const vertices: [number, number, number][] = [];
  const faces: [number, number, number][] = [];
  for (let o = 0; o + 8 < positions.length; o += 9) {
    const face = [0, 3, 6].map((k) => {
      const key = `${positions[o + k]},${positions[o + k + 1]},${positions[o + k + 2]}`;
      let id = ids.get(key);
      if (id === undefined) { id = vertices.length; ids.set(key, id); vertices.push([positions[o + k], positions[o + k + 1], positions[o + k + 2]]); }
      return id;
    });
    faces.push([face[0], face[1], face[2]]);
  }
  return { name, vertices, faces };
}
