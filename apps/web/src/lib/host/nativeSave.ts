import type { HostBridge } from "@/lib/host/hostBridge";
import type { SaveFailureCode, SavePhase } from "@/lib/host/hostProtocol";

/** What the editor hands over after packaging the document for a native Save. */
export interface NativePackage {
  bytes: Uint8Array;
  revision: number;
  signature: string;
  stats: { rootObjects: number; nodes: number; meshObjects: number };
  thumbnail: boolean;
  waitMs: number;
  snapshotMs: number;
  serializeMs: number;
}

export interface NativeSaveApi {
  /** Waits for a quiet moment, takes the snapshot, packages it (the same exportLylProject as the browser) and returns the .lyl bytes. */
  createPackage(options: { fileName: string | null; signal: AbortSignal; onPhase: (phase: SavePhase) => void; recovery?: boolean }): Promise<NativePackage>;
  /** The host committed the package: its signature is the saved one now. */
  markSaved(signature: string): void;
}

export class NativeSaveError extends Error {
  constructor(readonly code: SaveFailureCode, message: string) {
    super(message);
    this.name = "NativeSaveError";
  }
}

export const UPLOAD_CHUNK_BYTES = 8 * 1024 * 1024;

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export interface UploadOptions {
  token: string;
  signal?: AbortSignal;
  chunkBytes?: number;
  fetchImpl?: typeof fetch;
  onProgress?: (loaded: number, total: number) => void;
}

/**
 * Sends the package to the host's upload endpoint in sequential, acknowledged chunks (`/__host__/save/<token>?offset=N`). Each chunk is awaited
 * before the next (backpressure: one chunk in flight), the host must answer `{"next": offset + length}`; anything else stops the upload.
 */
export async function uploadPackage(bytes: Uint8Array, options: UploadOptions): Promise<void> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const chunk = options.chunkBytes ?? UPLOAD_CHUNK_BYTES;
  for (let offset = 0; offset < bytes.byteLength; offset += chunk) {
    if (options.signal?.aborted) throw new NativeSaveError("cancelled", "The save was cancelled.");
    const end = Math.min(offset + chunk, bytes.byteLength);
    let response: Response;
    try {
      response = await fetchImpl(`/__host__/save/${options.token}?offset=${offset}`, { method: "POST", body: bytes.subarray(offset, end) as unknown as BodyInit, cache: "no-store", signal: options.signal });
    } catch (error) {
      if (options.signal?.aborted) throw new NativeSaveError("cancelled", "The save was cancelled.");
      throw new NativeSaveError("upload-failed", `The package could not be sent to the app (${error instanceof Error ? error.message : String(error)})`);
    }
    if (!response.ok) throw new NativeSaveError("upload-failed", `The app refused part of the package (status ${response.status})`);
    const answer = (await response.json().catch(() => null)) as { next?: unknown } | null;
    if (!answer || answer.next !== end) throw new NativeSaveError("upload-failed", "The app did not acknowledge the package correctly.");
    options.onProgress?.(end, bytes.byteLength);
  }
}

export function classifySaveError(error: unknown): { code: SaveFailureCode; message: string } {
  if (error instanceof NativeSaveError) return { code: error.code, message: error.message };
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof DOMException && error.name === "AbortError") return { code: "cancelled", message: "The save was cancelled." };
  if (/256 MiB|exceeds the|too many|too large|limit/i.test(message)) return { code: "too-large", message };
  if (error instanceof RangeError || /out of memory|allocation/i.test(message)) return { code: "out-of-memory", message };
  return { code: "serialize-failed", message };
}

export interface SaveEventPayload {
  documentId: string;
  saveId: string;
  uploadToken: string;
  fileName: string | null;
  reason: string;
}

/**
 * One native Save, from the host's `document.save` event to the commit message. Reports failures to the host; resolves with the package
 * revision and signature after the host accepted it (verified and staged: the host still has to write the file).
 */
export async function performNativeSave(bridge: HostBridge, event: SaveEventPayload, api: NativeSaveApi, controller: AbortController, deps: { fetchImpl?: typeof fetch; now?: () => number } = {}): Promise<{ ok: true } | { ok: false; code: SaveFailureCode; message: string }> {
  const now = deps.now ?? (() => performance.now());
  const { documentId, saveId } = event;
  let lastProgress = 0;
  const progress = (phase: SavePhase, loaded?: number, total?: number) => {
    const t = now();
    if (phase === "upload" && loaded !== total && t - lastProgress < 250) return;
    lastProgress = t;
    void bridge.sendSave("document.save.progress", { documentId, saveId, phase, ...(loaded !== undefined ? { loaded } : {}), ...(total !== undefined ? { total } : {}) });
  };
  try {
    // reason "recovery": the host keeps this package as a crash-recovery snapshot, not as the document file (no preview picture needed).
    const pack = await api.createPackage({ fileName: event.fileName, signal: controller.signal, onPhase: (phase) => progress(phase), recovery: event.reason === "recovery" });
    if (controller.signal.aborted) throw new NativeSaveError("cancelled", "The save was cancelled.");
    const hashed = sha256Hex(pack.bytes);
    const t0 = now();
    await uploadPackage(pack.bytes, { token: event.uploadToken, signal: controller.signal, fetchImpl: deps.fetchImpl, onProgress: (loaded, total) => progress("upload", loaded, total) });
    const sha256 = await hashed;
    const uploadMs = Math.round(now() - t0);
    const reply = await bridge.sendSave("document.save.commit", {
      documentId,
      saveId,
      revision: pack.revision,
      signature: pack.signature,
      byteLength: pack.bytes.byteLength,
      sha256,
      stats: pack.stats,
      thumbnail: pack.thumbnail,
      timings: { waitMs: Math.round(pack.waitMs), snapshotMs: Math.round(pack.snapshotMs), serializeMs: Math.round(pack.serializeMs), uploadMs },
    });
    if (!reply.ok) throw new NativeSaveError("upload-failed", `${reply.failure.message} (${reply.failure.code})`);
    return { ok: true };
  } catch (error) {
    const failure = classifySaveError(error);
    await bridge.sendSave("document.save.failed", { documentId, saveId, code: failure.code, message: failure.message });
    return { ok: false, ...failure };
  }
}
