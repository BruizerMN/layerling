import { describe, expect, it } from "vitest";
import { DocumentTransferError, fetchDocumentBytes } from "@/lib/host/documentTransfer";
import type { FileDocumentDescriptor } from "@/lib/host/hostDocument";

const descriptor = (byteLength: number): FileDocumentDescriptor => ({ kind: "file", documentId: "d0c00002-aaaa", fileName: "x.lyl", byteLength, modifiedAt: 1, url: "layerling://app/__host__/doc/AbCdEfGhIjKlMnOpQrStUvWxYz012345" });

function response(chunks: Uint8Array[], init: { status?: number; contentLength?: string | null; failAfter?: number } = {}): Response {
  let index = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (init.failAfter !== undefined && index >= init.failAfter) return controller.error(new Error("connection lost"));
      if (index < chunks.length) controller.enqueue(chunks[index++]);
      else controller.close();
    },
  });
  const total = chunks.reduce((n, c) => n + c.byteLength, 0);
  const headers = new Headers();
  if (init.contentLength !== null) headers.set("content-length", init.contentLength ?? String(total));
  return new Response(body, { status: init.status ?? 200, headers });
}
const bytes = (n: number, fill = 7) => new Uint8Array(n).fill(fill);

describe("fetchDocumentBytes", () => {
  it("assembles chunks into one array of exactly the announced size and reports progress", async () => {
    const progress: number[] = [];
    const result = await fetchDocumentBytes(descriptor(10), { fetchImpl: async () => response([bytes(4, 1), bytes(4, 2), bytes(2, 3)]), onProgress: (loaded) => progress.push(loaded) });
    expect([...result]).toEqual([1, 1, 1, 1, 2, 2, 2, 2, 3, 3]);
    expect(progress).toEqual([4, 8, 10]);
  });
  it("asks for the document's own url, GET, uncached", async () => {
    let seen: [unknown, RequestInit | undefined] | null = null;
    await fetchDocumentBytes(descriptor(2), { fetchImpl: async (url, init) => ((seen = [url, init]), response([bytes(2)])) });
    expect(seen![0]).toBe(descriptor(2).url);
    expect(seen![1]).toMatchObject({ method: "GET", cache: "no-store" });
  });
  it("refuses a Content-Length that differs from the descriptor: the file changed", async () => {
    await expect(fetchDocumentBytes(descriptor(10), { fetchImpl: async () => response([bytes(12)]) })).rejects.toThrow(/changed while it was being opened/);
    await expect(fetchDocumentBytes(descriptor(10), { fetchImpl: async () => response([bytes(10)], { contentLength: null }) })).rejects.toThrow(DocumentTransferError);
  });
  it("refuses a body longer or shorter than announced", async () => {
    await expect(fetchDocumentBytes(descriptor(10), { fetchImpl: async () => response([bytes(6), bytes(6)], { contentLength: "10" }) })).rejects.toThrow(/larger than the host announced/);
    await expect(fetchDocumentBytes(descriptor(10), { fetchImpl: async () => response([bytes(6)], { contentLength: "10" }) })).rejects.toThrow(/shorter than the host announced/);
  });
  it("turns a refused status, a failed fetch and a broken stream into transfer errors", async () => {
    await expect(fetchDocumentBytes(descriptor(4), { fetchImpl: async () => response([bytes(4)], { status: 404 }) })).rejects.toThrow(/status 404/);
    await expect(fetchDocumentBytes(descriptor(4), { fetchImpl: async () => Promise.reject(new TypeError("Load failed")) })).rejects.toThrow(DocumentTransferError);
    await expect(fetchDocumentBytes(descriptor(8), { fetchImpl: async () => response([bytes(4), bytes(4)], { contentLength: "8", failAfter: 1 }) })).rejects.toThrow(/broke off/);
  });
  it("passes an abort through as the abort, not as a transfer error", async () => {
    const controller = new AbortController();
    const failure = fetchDocumentBytes(descriptor(4), { signal: controller.signal, fetchImpl: async (_url, init) => new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))) });
    controller.abort();
    await expect(failure).rejects.toMatchObject({ name: "AbortError" });
  });
});
