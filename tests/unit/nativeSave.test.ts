import { describe, expect, it } from "vitest";
import { NativeSaveError, classifySaveError, performNativeSave, sha256Hex, uploadPackage, type NativeSaveApi, type SaveEventPayload } from "@/lib/host/nativeSave";
import type { HostBridge } from "@/lib/host/hostBridge";

const bytes = (n: number, fill = 3) => new Uint8Array(n).fill(fill);
type Call = { url: string; offset: number; length: number };

function host(options: { next?: (offset: number, length: number) => unknown; status?: number; failAt?: number } = {}) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const offset = Number(new URL(url, "layerling://app").searchParams.get("offset"));
    const length = (init.body as Uint8Array).byteLength;
    calls.push({ url, offset, length });
    if (options.failAt === offset) throw new TypeError("Load failed");
    return new Response(JSON.stringify(options.next ? options.next(offset, length) : { next: offset + length }), { status: options.status ?? 200 });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

describe("uploadPackage", () => {
  it("sends sequential acknowledged chunks to the token's endpoint", async () => {
    const h = host();
    const progress: number[] = [];
    await uploadPackage(bytes(25), { token: "tok", chunkBytes: 10, fetchImpl: h.fetchImpl, onProgress: (loaded) => progress.push(loaded) });
    expect(h.calls.map((c) => [c.offset, c.length])).toEqual([[0, 10], [10, 10], [20, 5]]);
    expect(h.calls[0].url).toBe("/__host__/save/tok?offset=0");
    expect(progress).toEqual([10, 20, 25]);
  });
  it("stops when the host does not acknowledge the right offset, refuses, or the transport fails", async () => {
    await expect(uploadPackage(bytes(25), { token: "t", chunkBytes: 10, fetchImpl: host({ next: () => ({ next: 7 }) }).fetchImpl })).rejects.toMatchObject({ code: "upload-failed" });
    await expect(uploadPackage(bytes(25), { token: "t", chunkBytes: 10, fetchImpl: host({ status: 409 }).fetchImpl })).rejects.toMatchObject({ code: "upload-failed" });
    await expect(uploadPackage(bytes(25), { token: "t", chunkBytes: 10, fetchImpl: host({ failAt: 10 }).fetchImpl })).rejects.toMatchObject({ code: "upload-failed" });
  });
  it("stops at once when cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    const h = host();
    await expect(uploadPackage(bytes(25), { token: "t", chunkBytes: 10, fetchImpl: h.fetchImpl, signal: controller.signal })).rejects.toMatchObject({ code: "cancelled" });
    expect(h.calls).toHaveLength(0);
  });
});

describe("sha256Hex", () => {
  it("matches the known digest", async () => {
    expect(await sha256Hex(new TextEncoder().encode("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

describe("classifySaveError", () => {
  it("maps what went wrong", () => {
    expect(classifySaveError(new NativeSaveError("interaction-timeout", "busy")).code).toBe("interaction-timeout");
    expect(classifySaveError(new Error("Project data exceeds the 256 MiB project file limit.")).code).toBe("too-large");
    expect(classifySaveError(new RangeError("Array buffer allocation failed")).code).toBe("out-of-memory");
    expect(classifySaveError(new DOMException("x", "AbortError")).code).toBe("cancelled");
    expect(classifySaveError(new Error("boom")).code).toBe("serialize-failed");
  });
});

describe("performNativeSave", () => {
  const event: SaveEventPayload = { documentId: "doc-12345678", saveId: "save-1", uploadToken: "tok", fileName: "Design", reason: "save" };
  function fakeBridge(commitReply: { ok: boolean } = { ok: true }) {
    const sent: { type: string; payload: Record<string, unknown> }[] = [];
    const bridge = {
      sendSave: async (type: string, payload: Record<string, unknown>) => {
        sent.push({ type, payload });
        return type === "document.save.commit" && !commitReply.ok ? { ok: false as const, failure: { code: "save-rejected" as const, message: "bad sha" } } : { ok: true as const, payload: {} };
      },
    } as unknown as HostBridge;
    return { bridge, sent };
  }
  const api = (pack: Partial<Awaited<ReturnType<NativeSaveApi["createPackage"]>>> = {}): NativeSaveApi => ({
    createPackage: async () => ({ bytes: bytes(20), revision: 4, signature: "sig", stats: { rootObjects: 2, nodes: 3, meshObjects: 1 }, thumbnail: true, waitMs: 1, snapshotMs: 2, serializeMs: 3, ...pack }),
    markSaved: () => undefined,
  });

  it("packages, uploads, then commits with length, hash, revision and signature", async () => {
    const { bridge, sent } = fakeBridge();
    const h = host();
    const result = await performNativeSave(bridge, event, api(), new AbortController(), { fetchImpl: h.fetchImpl });
    expect(result).toEqual({ ok: true });
    const commit = sent.find((m) => m.type === "document.save.commit")!;
    expect(commit.payload).toMatchObject({ documentId: event.documentId, saveId: "save-1", revision: 4, signature: "sig", byteLength: 20, sha256: await sha256Hex(bytes(20)), stats: { nodes: 3 }, thumbnail: true });
    expect(sent.map((m) => m.type)).toContain("document.save.progress");
    expect(sent.some((m) => m.type === "document.save.failed")).toBe(false);
  });
  it("reports a failed packaging to the host", async () => {
    const { bridge, sent } = fakeBridge();
    const failing: NativeSaveApi = { createPackage: async () => { throw new Error("Project data exceeds the 256 MiB project file limit."); }, markSaved: () => undefined };
    const result = await performNativeSave(bridge, event, failing, new AbortController(), { fetchImpl: host().fetchImpl });
    expect(result).toMatchObject({ ok: false, code: "too-large" });
    expect(sent.at(-1)).toMatchObject({ type: "document.save.failed", payload: { saveId: "save-1", code: "too-large" } });
    expect(sent.some((m) => m.type === "document.save.commit")).toBe(false);
  });
  it("reports a host that rejects the commit, and a cancelled save", async () => {
    const rejected = fakeBridge({ ok: false });
    expect(await performNativeSave(rejected.bridge, event, api(), new AbortController(), { fetchImpl: host().fetchImpl })).toMatchObject({ ok: false });
    expect(rejected.sent.at(-1)?.type).toBe("document.save.failed");
    const controller = new AbortController();
    const cancelled = fakeBridge();
    const slow: NativeSaveApi = { createPackage: async () => { controller.abort(); return api().createPackage({ fileName: null, signal: controller.signal, onPhase: () => undefined }); }, markSaved: () => undefined };
    expect(await performNativeSave(cancelled.bridge, event, slow, controller, { fetchImpl: host().fetchImpl })).toMatchObject({ ok: false, code: "cancelled" });
  });
});
