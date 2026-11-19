import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createHostBridge, type HostEnvironment, type HostReceiver } from "@/lib/host/hostBridge";
import { DOCUMENT_CAPABILITY, SAVE_CAPABILITY, parseHostEvent, type HostEvent, type HostRequest } from "@/lib/host/hostProtocol";

const v3Dir = path.resolve(__dirname, "../../apps/web/src/lib/host/fixtures/v3");
const fx = (name: string) => JSON.parse(readFileSync(path.join(v3Dir, name), "utf8")) as Record<string, unknown>;
const options = { editorVersion: "1.165.2", editorBuild: "abc123def", capabilities: [DOCUMENT_CAPABILITY, SAVE_CAPABILITY] };

function harness(reply: (request: HostRequest) => unknown, bootstrap: unknown = fx("bootstrap.json")) {
  const posts: HostRequest[] = [];
  let receiver: HostReceiver | null = null;
  const env: HostEnvironment = {
    bootstrap,
    post: async (request) => (posts.push(request), reply(request)),
    installReceiver: (r) => ((receiver = r), () => (receiver = null)),
    log: () => undefined,
  };
  return { env, posts, receiver: () => receiver };
}
const v3Reply = (request: HostRequest): unknown => {
  const byType: Record<string, string> = {
    hello: "hello.ok.response.json",
    ready: "../v1/ready.ok.response.json",
    "document.changed": "document.changed.ok.response.json",
    "document.save.progress": "save.progress.ok.response.json",
    "document.save.commit": "save.commit.ok.response.json",
    "document.save.failed": "save.failed.ok.response.json",
  };
  return { ...fx(byType[request.type]), id: request.id };
};

describe("protocol 3 handshake", () => {
  it("offers both capabilities in hello, exactly as the fixture, and negotiates 3", async () => {
    const h = harness(v3Reply);
    const bridge = createHostBridge(h.env, options);
    const connection = await bridge.connect();
    expect(h.posts[0]).toEqual(fx("hello.request.json"));
    expect(connection).toMatchObject({ state: "connected", protocol: 3, capabilities: ["document.open", "document.save"] });
    expect(bridge.supportsSave()).toBe(true);
    expect(bridge.supportsDocuments()).toBe(true);
  });
  it("against a v2 host there is no save, and nothing save-related is posted", async () => {
    const h = harness((r) => ({ ...fx("hello.v2-fallback.ok.response.json"), id: r.id }), { ...fx("bootstrap.json"), protocol: { min: 1, max: 2 } });
    const bridge = createHostBridge(h.env, options);
    expect(await bridge.connect()).toMatchObject({ protocol: 2, capabilities: ["document.open"] });
    expect(bridge.supportsSave()).toBe(false);
    expect(await bridge.sendSave("document.changed", {})).toMatchObject({ ok: false, failure: { code: "unsupported-capability" } });
    expect(h.posts.map((p) => p.type)).toEqual(["hello"]);
  });
  it("a host that chose 3 without granting document.save gives no save", async () => {
    const h = harness((r) => ({ id: r.id, ok: true, type: "hello.ok", payload: { protocol: 3, host: { name: "H", version: "1" }, capabilities: ["document.open"] } }));
    const bridge = createHostBridge(h.env, options);
    await bridge.connect();
    expect(bridge.supportsSave()).toBe(false);
  });
});

describe("protocol 3 messages", () => {
  async function ready() {
    const h = harness(v3Reply);
    const bridge = createHostBridge(h.env, options);
    await bridge.connect();
    await bridge.markReady();
    h.posts.length = 0;
    return { ...h, bridge };
  }
  it("sends changed, progress, commit and failed exactly as the fixtures", async () => {
    const { bridge, posts } = await ready();
    const names = ["document.changed.request", "save.progress.request", "save.commit.request", "save.failed.request"];
    const types = ["document.changed", "document.save.progress", "document.save.commit", "document.save.failed"] as const;
    for (let i = 0; i < 4; i += 1) expect((await bridge.sendSave(types[i], fx(`${names[i]}.json`).payload as Record<string, unknown>)).ok).toBe(true);
    expect(posts.map((p) => [p.type, p.payload])).toEqual(types.map((t, i) => [t, fx(`${names[i]}.json`).payload]));
  });
  it("returns the host's save-rejected error", async () => {
    const h = harness((r) => (r.type === "document.save.commit" ? { ...fx("error.save-rejected.response.json"), id: r.id } : v3Reply(r)));
    const bridge = createHostBridge(h.env, options);
    await bridge.connect();
    expect(await bridge.sendSave("document.save.commit", {})).toMatchObject({ ok: false, failure: { code: "save-rejected" } });
  });
  it("delivers every v3 event to listeners, with the right session and protocol only", async () => {
    const { bridge, receiver } = await ready();
    const seen: string[] = [];
    bridge.onEvent((event: HostEvent) => seen.push(event.type));
    for (const name of ["save.event", "save.cancel.event", "saved.event", "renamed.event", "externalChange.event"]) expect(receiver()!(fx(`${name}.json`))).toEqual({ ok: true });
    expect(seen).toEqual(["document.save", "document.save.cancel", "document.saved", "document.renamed", "document.externalChange"]);
    const event = fx("save.event.json");
    expect(receiver()!({ ...event, session: "99999999-0000-0000-0000-000000000000" })).toMatchObject({ ok: false, code: "bad-session" });
    expect(receiver()!({ ...event, protocol: 2 })).toMatchObject({ ok: false, code: "protocol-mismatch" });
    expect(receiver()!({ ...event, payload: { documentId: "x" } })).toMatchObject({ ok: false, code: "bad-request" });
  });
  it("refuses save events when saving was not negotiated", async () => {
    const h = harness((r) => ({ ...fx("hello.v2-fallback.ok.response.json"), id: r.id }), { ...fx("bootstrap.json"), protocol: { min: 1, max: 2 } });
    const bridge = createHostBridge(h.env, options);
    await bridge.connect();
    expect(h.receiver()!({ ...fx("save.event.json"), protocol: 2 })).toMatchObject({ ok: false, code: "bad-request" });
  });
  it("parses and rejects event payloads", () => {
    expect(parseHostEvent(fx("saved.event.json"))).toMatchObject({ type: "document.saved", payload: { revision: 7, fileName: "Foshay" } });
    expect(parseHostEvent({ ...fx("saved.event.json"), payload: { documentId: "d", saveId: "s", revision: "7", signature: "x" } })).toHaveProperty("invalid");
    expect(parseHostEvent({ ...fx("renamed.event.json"), payload: { documentId: "d" } })).toHaveProperty("invalid");
    expect(parseHostEvent({ ...fx("save.event.json"), payload: { documentId: "d", saveId: "s" } })).toHaveProperty("invalid");
    expect(parseHostEvent({ ...fx("save.event.json"), type: "document.explode" })).toHaveProperty("invalid");
  });
});
