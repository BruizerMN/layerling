import { describe, expect, it } from "vitest";
import { performNativeSave, type NativeSaveApi, type SaveEventPayload } from "@/lib/host/nativeSave";
import type { HostBridge } from "@/lib/host/hostBridge";

// A "recovery" save is the same pipeline as a Save; the editor only needs to know so that it can skip the preview picture.
function fixture() {
  const options: Array<{ recovery?: boolean }> = [];
  const api: NativeSaveApi = {
    createPackage: async (o) => {
      options.push({ recovery: o.recovery });
      return { bytes: new Uint8Array([1, 2, 3]), revision: 4, signature: "sig", stats: { rootObjects: 0, nodes: 0, meshObjects: 0 }, thumbnail: false, waitMs: 0, snapshotMs: 0, serializeMs: 0 };
    },
    markSaved: () => undefined,
  };
  const sent: string[] = [];
  const bridge = { sendSave: async (type: string) => { sent.push(type); return { ok: true }; } } as unknown as HostBridge;
  const fetchImpl = (async (_url: string, init: RequestInit) => new Response(JSON.stringify({ next: (init.body as Uint8Array).byteLength }), { status: 200 })) as unknown as typeof fetch;
  return { api, bridge, fetchImpl, options, sent };
}
const event = (reason: string): SaveEventPayload => ({ documentId: "doc-12345678", saveId: "s1", uploadToken: "tok", fileName: null, reason });

describe("recovery snapshots use the save pipeline", () => {
  it("tells the editor when the package is a recovery snapshot", async () => {
    const f = fixture();
    const result = await performNativeSave(f.bridge, event("recovery"), f.api, new AbortController(), { fetchImpl: f.fetchImpl });
    expect(result.ok).toBe(true);
    expect(f.options).toEqual([{ recovery: true }]);
    expect(f.sent).toContain("document.save.commit");
  });

  it("an ordinary save is not a recovery snapshot", async () => {
    const f = fixture();
    await performNativeSave(f.bridge, event("save"), f.api, new AbortController(), { fetchImpl: f.fetchImpl });
    expect(f.options).toEqual([{ recovery: false }]);
  });
});
