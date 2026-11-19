import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createHostBridge, readHostEnvironment, type HostEnvironment, type HostReceiver, type HostWindow } from "@/lib/host/hostBridge";
import { DOCUMENT_URL_PATTERN, parseDocumentDescriptor } from "@/lib/host/hostDocument";
import { DOCUMENT_CAPABILITY, HOST_BOOTSTRAP_KEY, HOST_HANDLER_NAME, parseHostEvent, type HostRequest } from "@/lib/host/hostProtocol";

const v2Dir = path.resolve(__dirname, "../../apps/web/src/lib/host/fixtures/v2");
const fx = (name: string) => JSON.parse(readFileSync(path.join(v2Dir, name), "utf8")) as Record<string, unknown>;
const options = { editorVersion: "1.165.2", editorBuild: "abc123def", capabilities: [DOCUMENT_CAPABILITY] };

function harness(reply: (request: HostRequest) => unknown, bootstrap: unknown = fx("bootstrap.json")) {
  const posts: HostRequest[] = [];
  let receiver: HostReceiver | null = null;
  const env: HostEnvironment = {
    bootstrap,
    post: async (request) => {
      posts.push(request);
      return reply(request);
    },
    installReceiver: (r) => {
      receiver = r;
      return () => (receiver = null);
    },
    log: () => undefined,
  };
  return { env, posts, receiver: () => receiver };
}

/** A v2 host: grants documents and answers the document messages from the fixtures. */
const v2Reply = (request: HostRequest): unknown => {
  const byType: Record<string, string> = {
    hello: "hello.ok.response.json",
    "document.request": "document.request.file.ok.response.json",
    "document.progress": "document.progress.ok.response.json",
    "document.opened": "document.opened.ok.response.json",
    "document.failed": "document.failed.ok.response.json",
    ready: "../v1/ready.ok.response.json",
  };
  return { ...fx(byType[request.type]), id: request.id };
};

describe("protocol 2 handshake", () => {
  it("offers the document capability in hello, exactly as the fixture", async () => {
    const { env, posts } = harness(v2Reply);
    await createHostBridge(env, options).connect();
    expect(posts[0]).toEqual(fx("hello.request.json"));
  });
  it("negotiates 2 and reports documents supported once the host grants the capability", async () => {
    const { env } = harness(v2Reply);
    const bridge = createHostBridge(env, options);
    expect(bridge.supportsDocuments()).toBe(false);
    const connection = await bridge.connect();
    expect(connection).toMatchObject({ state: "connected", protocol: 2, capabilities: ["document.open"] });
    expect(bridge.supportsDocuments()).toBe(true);
  });
  it("falls back to v1 against a v1 host: no document support, nothing posted for documents", async () => {
    const { env, posts } = harness((r) => ({ ...fx("hello.v1-fallback.ok.response.json"), id: r.id }), { ...fx("bootstrap.json"), protocol: { min: 1, max: 1 } });
    const bridge = createHostBridge(env, options);
    expect(await bridge.connect()).toMatchObject({ state: "connected", protocol: 1, capabilities: [] });
    expect(bridge.supportsDocuments()).toBe(false);
    const result = await bridge.send("document.request", {});
    expect(result).toMatchObject({ ok: false, failure: { code: "unsupported-capability" } });
    expect(posts.map((p) => p.type)).toEqual(["hello"]);
  });
  it("does not support documents when the host chose 2 but did not grant the capability", async () => {
    const { env } = harness((r) => ({ id: r.id, ok: true, type: "hello.ok", payload: { protocol: 2, host: { name: "H", version: "1" }, capabilities: [] } }));
    const bridge = createHostBridge(env, options);
    await bridge.connect();
    expect(bridge.supportsDocuments()).toBe(false);
  });
  it("does not support documents before the handshake", async () => {
    const { env, posts } = harness(v2Reply);
    const bridge = createHostBridge(env, options);
    expect(await bridge.send("document.request", {})).toMatchObject({ ok: false });
    expect(posts).toHaveLength(0);
  });
});

describe("protocol 2 messages", () => {
  async function ready() {
    const h = harness(v2Reply);
    const bridge = createHostBridge(h.env, options);
    await bridge.connect();
    await bridge.markReady();
    h.posts.length = 0;
    return { ...h, bridge };
  }
  it("sends document.request and reads the descriptor of a file document", async () => {
    const { bridge, posts } = await ready();
    const result = await bridge.send("document.request", {});
    expect(result.ok).toBe(true);
    expect(posts[0]).toMatchObject({ type: "document.request", protocol: 2, payload: {}, session: fx("bootstrap.json").session });
    if (result.ok) expect(parseDocumentDescriptor(result.payload.document)).toMatchObject({ kind: "file", fileName: "Foshay.lyl", byteLength: 57814564 });
  });
  it("sends progress, opened and failed exactly as the fixtures", async () => {
    const { bridge, posts } = await ready();
    const progress = fx("document.progress.request.json").payload as Record<string, unknown>;
    const opened = fx("document.opened.request.json").payload as Record<string, unknown>;
    const failed = fx("document.failed.request.json").payload as Record<string, unknown>;
    await bridge.send("document.progress", progress);
    await bridge.send("document.opened", opened);
    await bridge.send("document.failed", failed);
    expect(posts.map((p) => [p.type, p.payload])).toEqual([["document.progress", progress], ["document.opened", opened], ["document.failed", failed]]);
    expect((fx("document.opened.request.json").payload as { repack: boolean }).repack).toBe(false);
  });
  it("returns the host's error for a document that is not there", async () => {
    const h = harness((r) => (r.type === "document.opened" ? { ...fx("error.no-such-document.response.json"), id: r.id } : v2Reply(r)));
    const bridge = createHostBridge(h.env, options);
    await bridge.connect();
    expect(await bridge.send("document.opened", {})).toMatchObject({ ok: false, failure: { code: "no-such-document" } });
  });
  it("delivers document.cancel to listeners, with the right session and protocol only", async () => {
    const { bridge, receiver } = await ready();
    const seen: string[] = [];
    bridge.onEvent((event) => seen.push(event.type));
    const event = fx("document.cancel.event.json");
    expect(receiver()!(event)).toEqual({ ok: true });
    expect(receiver()!({ ...event, session: "99999999-0000-0000-0000-000000000000" })).toMatchObject({ ok: false, code: "bad-session" });
    expect(receiver()!({ ...event, protocol: 1 })).toMatchObject({ ok: false, code: "protocol-mismatch" });
    expect(receiver()!({ ...event, payload: {} })).toMatchObject({ ok: false, code: "bad-request" });
    expect(seen).toEqual(["document.cancel"]);
  });
  it("refuses document events when documents were not negotiated", async () => {
    const h = harness((r) => ({ ...fx("hello.v1-fallback.ok.response.json"), id: r.id }), { ...fx("bootstrap.json"), protocol: { min: 1, max: 1 } });
    const bridge = createHostBridge(h.env, options);
    await bridge.connect();
    expect(h.receiver()!({ ...fx("document.cancel.event.json"), protocol: 1 })).toMatchObject({ ok: false, code: "bad-request" });
  });
  it("parses the cancel event fixture", () => {
    expect(parseHostEvent(fx("document.cancel.event.json"))).toMatchObject({ type: "document.cancel", payload: { documentId: "d0c00002-aaaa-4bbb-8ccc-000000000002" } });
  });
});

describe("document descriptors", () => {
  const file = (fx("document.request.file.ok.response.json").payload as { document: Record<string, unknown> }).document;
  const created = (fx("document.request.new.ok.response.json").payload as { document: Record<string, unknown> }).document;
  it("accepts the fixtures", () => {
    expect(parseDocumentDescriptor(file)).toMatchObject({ kind: "file" });
    expect(parseDocumentDescriptor(created)).toEqual({ kind: "new", documentId: created.documentId, displayName: "Untitled" });
  });
  it("only accepts the host's own document url shape", () => {
    expect(DOCUMENT_URL_PATTERN.test(file.url as string)).toBe(true);
    for (const url of ["https://example.com/x", "http://127.0.0.1/__host__/doc/AbCdEfGhIjKlMnOpQrStUv", "layerling://app/index.html", "layerling://app/__host__/doc/short", "layerling://app/__host__/doc/../../etc/passwd", "layerling://other/__host__/doc/AbCdEfGhIjKlMnOpQrStUvWxYz012345", "file:///etc/passwd", "layerling://app/__host__/doc/AbCdEfGhIjKlMnOpQrStUvWxYz012345/extra"]) {
      expect(parseDocumentDescriptor({ ...file, url }), url).toHaveProperty("invalid");
    }
  });
  it("refuses malformed descriptors", () => {
    const bad: unknown[] = [null, "x", [], {}, { ...file, kind: "other" }, { ...file, documentId: "" }, { ...file, documentId: "short" }, { ...file, fileName: "" }, { ...file, byteLength: 0 }, { ...file, byteLength: 1.5 }, { ...file, byteLength: 3 * 1024 ** 3 }, { ...file, modifiedAt: "now" }, { ...created, displayName: "" }];
    for (const value of bad) expect(parseDocumentDescriptor(value), JSON.stringify(value)).toHaveProperty("invalid");
  });
});

describe("a browser never reaches any of this", () => {
  it("is not a host window: no bridge, so no document request can be made", () => {
    const win: HostWindow = { location: { protocol: "https:" }, webkit: { messageHandlers: { [HOST_HANDLER_NAME]: { postMessage: async () => ({}) } } }, [HOST_BOOTSTRAP_KEY]: fx("bootstrap.json") };
    expect(readHostEnvironment(win)).toBeNull();
  });
});
