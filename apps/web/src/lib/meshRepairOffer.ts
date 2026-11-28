/**
 * Build 0125: the quiet check for open meshes after a document was opened from a file, and the one-time offer to repair them.
 *
 * A small state machine per document load, pure (every effect is a port), so it is testable without the editor:
 *
 *   idle -> waiting -> scanning -> offered | silent        (aborted from anywhere)
 *
 *  - `start()` is called once, after the host was told the document is open. The first look happens after a short settle (`settleMs`).
 *  - A busy person is never interrupted: while `isBusy()` (a drag, a group session, the History view, ...), or when the scan reports busy, or when the scene changed
 *    while it was scanned, the check is DEFERRED (`retryMs` later, with a fresh scan), not abandoned. It ends only when the document goes away (`abort()`), the scan finds
 *    nothing or fails (`silent`: nothing is ever shown), or an offer was made (`offered`).
 *  - One offer per load: whatever the person answers, nothing more happens for this load (a decline is session memory only; nothing is persisted).
 *  - Only counts are kept; the repaired copies stay with the scan and are dropped at once. The repair itself starts from a fresh scan at confirmation.
 */
export type MeshOfferState = "idle" | "waiting" | "scanning" | "offered" | "silent" | "aborted";

/** What one scan reports. `scene` identifies the scene that was scanned (the 0124 identity check). */
export type MeshOfferScan =
  | { kind: "busy" }
  | { kind: "failed" }
  | { kind: "counts"; meshes: number; objects: number; scene: unknown; ms: number };

export type MeshOfferPorts = {
  /** The person is working (or the editor is not free): not now. */
  isBusy: () => boolean;
  /** A read-only scan of the whole document, in idle slices. */
  scan: () => Promise<MeshOfferScan>;
  /** Whether the scene is still the one that was scanned. */
  isCurrent: (scene: unknown) => boolean;
  /** Ask the host to offer the repair (false when there is no way to ask: nothing is shown then). */
  offer: (counts: { meshes: number; objects: number; scanMs: number }) => boolean;
  setTimer: (run: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
  /** One diagnostic line per scan (counts and time only, no document content). */
  log?: (line: string) => void;
};

export type MeshOfferOptions = { settleMs?: number; retryMs?: number };
export const MESH_OFFER_SETTLE_MS = 1000;
export const MESH_OFFER_RETRY_MS = 2000;

export type MeshOfferScheduler = { start: () => void; abort: () => void; state: () => MeshOfferState; scans: () => number };

export function createMeshOfferScheduler(ports: MeshOfferPorts, options: MeshOfferOptions = {}): MeshOfferScheduler {
  const settleMs = options.settleMs ?? MESH_OFFER_SETTLE_MS;
  const retryMs = options.retryMs ?? MESH_OFFER_RETRY_MS;
  let state: MeshOfferState = "idle";
  let timer: unknown = null;
  let scans = 0;

  const later = (ms: number) => {
    state = "waiting";
    timer = ports.setTimer(() => { timer = null; void attempt(); }, ms);
  };

  const attempt = async () => {
    if (state !== "waiting") return;
    if (ports.isBusy()) { later(retryMs); return; }
    state = "scanning";
    scans += 1;
    let result: MeshOfferScan;
    try { result = await ports.scan(); } catch { result = { kind: "failed" }; }
    if ((state as MeshOfferState) === "aborted") return;
    if (result.kind === "failed") { ports.log?.("mesh offer scan failed: nothing is shown"); state = "silent"; return; }
    if (result.kind === "busy") { later(retryMs); return; }
    ports.log?.(`mesh offer scan: ${result.meshes} repairable meshes, ${result.objects} objects, ${Math.round(result.ms)} ms`);
    if (result.meshes === 0) { state = "silent"; return; }
    // The person started working, or the scene changed while it was scanned: the result is not trusted; try again later with a fresh scan.
    if (ports.isBusy() || !ports.isCurrent(result.scene)) { later(retryMs); return; }
    state = ports.offer({ meshes: result.meshes, objects: result.objects, scanMs: result.ms }) ? "offered" : "silent";
  };

  return {
    start() {
      if (state !== "idle") return;   // one check per load
      later(settleMs);
    },
    abort() {
      if (timer !== null) ports.clearTimer(timer);
      timer = null;
      state = "aborted";
    },
    state: () => state,
    scans: () => scans,
  };
}
