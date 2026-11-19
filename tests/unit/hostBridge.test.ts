import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHostBridge, getHostBridge, readHostEnvironment, startHostBridge, type HostConnection, type HostEnvironment, type HostReceiver, type HostWindow } from "@/lib/host/hostBridge";
import { HOST_BOOTSTRAP_KEY, HOST_HANDLER_NAME, HOST_RECEIVER_KEY, type HostRequest } from "@/lib/host/hostProtocol";

const fixtureDir = path.resolve(__dirname, "../../apps/web/src/lib/host/fixtures/v1");
const fixture = (name: string) => JSON.parse(readFileSync(path.join(fixtureDir, name), "utf8")) as Record<string, unknown>;
const options = { editorVersion: "1.165.2", editorBuild: "abc123def" };

/** The host's normal answers, built on the request's id. */
function defaultReply(request: HostRequest): unknown {
  switch (request.type) {
    case "hello": return { ...fixture("hello.ok.response.json"), id: request.id };
    case "ready": return { ...fixture("ready.ok.response.json"), id: request.id };
    case "ping": return { id: request.id, ok: true, type: "ping.ok", payload: { echo: request.payload.sentAt } };
    case "pong": return { ...fixture("pong.ok.response.json"), id: request.id };
  }
}

function fakeEnv(overrides: { bootstrap?: unknown; reply?: (request: HostRequest) => unknown | Promise<unknown> } = {}) {
  const posts: HostRequest[] = [];
  const logs: string[] = [];
  let receiver: HostReceiver | null = null;
  let removals = 0;
  const env: HostEnvironment = {
    bootstrap: "bootstrap" in overrides ? overrides.bootstrap : fixture("bootstrap.json"),
    post: async (request) => {
      posts.push(request);
      return overrides.reply ? overrides.reply(request) : defaultReply(request);
    },
    installReceiver: (r) => {
      receiver = r;
      return () => {
        receiver = null;
        removals += 1;
      };
    },
    log: (level, message) => logs.push(`${level}: ${message}`),
  };
  return { env, posts, logs, receiver: () => receiver, removals: () => removals };
}

/** A page as a browser or the native host would present it. */
function hostPage(extra: Partial<HostWindow> = {}): HostWindow {
  return {
    location: { protocol: "layerling:" },
    webkit: { messageHandlers: { [HOST_HANDLER_NAME]: { postMessage: async (m: unknown) => defaultReply(m as HostRequest) } } },
    [HOST_BOOTSTRAP_KEY]: fixture("bootstrap.json"),
    ...extra,
  };
}

describe("an ordinary browser is never a host", () => {
  const nothing = (page: HostWindow | undefined) => expect(readHostEnvironment(page)).toBeNull();

  it("not on http, https or file, even with every host object spoofed", () => {
    for (const protocol of ["http:", "https:", "file:", "app:", "blob:", ""]) nothing(hostPage({ location: { protocol } }));
  });
  it("not without the custom scheme's handler, its postMessage, or the host's capability", () => {
    nothing(hostPage({ webkit: undefined }));
    nothing(hostPage({ webkit: { messageHandlers: {} } }));
    nothing(hostPage({ webkit: { messageHandlers: { [HOST_HANDLER_NAME]: {} } } }));
    nothing(hostPage({ webkit: { messageHandlers: { otherHandler: { postMessage: async () => ({}) } } } }));
    const noCapability = hostPage();
    delete noCapability[HOST_BOOTSTRAP_KEY];
    nothing(noCapability);
  });
  it("not from a URL parameter", () => {
    nothing({ location: { protocol: "https:", search: "?host=1&layerlingHost=1" } as HostWindow["location"] } as HostWindow);
    nothing(undefined);
  });
  it("starting the bridge in a browser does nothing: no post, no global, no bridge", () => {
    const page = { location: { protocol: "https:" } } as HostWindow;
    const before = Object.keys(page);
    const stop = startHostBridge(page);
    expect(getHostBridge()).toBeNull();
    expect(Object.keys(page)).toEqual(before);
    expect(HOST_RECEIVER_KEY in page).toBe(false);
    stop();
  });
  it("a bridge without a host environment stays inactive and posts nothing", async () => {
    const bridge = createHostBridge(null, options);
    expect(await bridge.connect()).toEqual({ state: "inactive" });
    expect(await bridge.markReady()).toEqual({ state: "inactive" });
    expect(await bridge.ping()).toMatchObject({ ok: false });
  });
});

describe("the native host page", () => {
  afterEach(() => vi.useRealTimers());

  it("is recognised, and the receiver is installed and removed on the page", () => {
    const page = hostPage();
    const env = readHostEnvironment(page);
    expect(env).not.toBeNull();
    expect(HOST_RECEIVER_KEY in page).toBe(false);
    const remove = env!.installReceiver(() => ({ ok: true }));
    expect(typeof (page[HOST_RECEIVER_KEY] as { receive: unknown }).receive).toBe("function");
    remove();
    expect(HOST_RECEIVER_KEY in page).toBe(false);
  });

  it("shakes hands and reports ready; requests match the shared fixtures", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1700000000000);
    const { env, posts, receiver } = fakeEnv();
    const bridge = createHostBridge(env, options);
    const seen: string[] = [];
    bridge.subscribe((c) => seen.push(c.state));

    expect(bridge.getConnection().state).toBe("inactive");
    expect(receiver()).toBeNull();
    const connected = await bridge.connect();
    expect(connected).toEqual({ state: "connected", protocol: 1, host: { name: "HundchenLayerling", version: "0.1.0" }, capabilities: [] });
    expect(receiver()).not.toBeNull(); // only after hello.ok

    const ready = await bridge.markReady();
    expect(ready.state).toBe("ready");
    const ping = await bridge.ping();
    expect(ping).toMatchObject({ ok: true });
    expect(receiver()!(fixture("host-ping.event.json"))).toEqual({ ok: true });
    await vi.waitFor(() => expect(posts).toHaveLength(4));

    expect(seen).toEqual(["connecting", "connected", "ready"]);
    expect(posts[0]).toEqual(fixture("hello.request.json"));
    expect(posts[1]).toEqual(fixture("ready.request.json"));
    expect(posts[2]).toEqual(fixture("ping.request.json"));
    expect(posts[3]).toEqual(fixture("pong.request.json"));
  });

  it("starts through startHostBridge and reaches ready on its own", async () => {
    const page = hostPage();
    const stop = startHostBridge(page);
    await vi.waitFor(() => expect(getHostBridge()?.getConnection().state).toBe("ready"));
    expect(typeof (page[HOST_RECEIVER_KEY] as { receive: unknown }).receive).toBe("function");
    stop();
    expect(getHostBridge()).toBeNull();
    expect(HOST_RECEIVER_KEY in page).toBe(false);
  });

  it("connects once, and dispose removes the receiver", async () => {
    const { env, posts, removals } = fakeEnv();
    const bridge = createHostBridge(env, options);
    await bridge.connect();
    await bridge.connect();
    expect(posts.filter((p) => p.type === "hello")).toHaveLength(1);
    bridge.dispose();
    expect(removals()).toBe(1);
  });

  it("does not report ready before hello, and sends nothing", async () => {
    const { env, posts } = fakeEnv();
    const bridge = createHostBridge(env, options);
    expect((await bridge.markReady()).state).toBe("inactive");
    expect(posts).toHaveLength(0);
  });
});

describe("failures are graceful: the editor stays a plain editor", () => {
  const failed = (c: HostConnection) => (c.state === "failed" ? c.failure : null);

  it("an unsupported protocol keeps the host's supported range and installs no receiver", async () => {
    const { env, receiver, logs } = fakeEnv({ reply: (r) => ({ ...fixture("hello.unsupported.response.json"), id: r.id }) });
    const bridge = createHostBridge(env, options);
    const connection = await bridge.connect();
    expect(failed(connection)).toEqual({ code: "unsupported-protocol", message: "This host speaks protocol 2-3 only.", supported: { min: 2, max: 3 } });
    expect(receiver()).toBeNull();
    expect((await bridge.markReady()).state).toBe("failed");
    expect(logs.some((l) => l.startsWith("warn: unsupported-protocol"))).toBe(true);
  });
  it("a host that chooses a protocol this editor does not speak", async () => {
    const reply = (r: HostRequest) => ({ id: r.id, ok: true, type: "hello.ok", payload: { protocol: 2, host: { name: "H", version: "1" }, capabilities: [] } });
    const { env, receiver } = fakeEnv({ reply });
    expect(failed(await createHostBridge(env, options).connect())?.code).toBe("protocol-out-of-range");
    expect(receiver()).toBeNull();
  });
  it("a malformed bootstrap capability posts nothing", async () => {
    const { env, posts } = fakeEnv({ bootstrap: { session: "x" } });
    expect(failed(await createHostBridge(env, options).connect())?.code).toBe("bad-bootstrap");
    expect(posts).toHaveLength(0);
  });
  it("malformed replies: not an object, wrong id, wrong type, incomplete payload", async () => {
    const replies: ((r: HostRequest) => unknown)[] = [
      () => "ok", () => null, (r) => ({ ...(defaultReply(r) as object), id: "other" }), (r) => ({ ...(defaultReply(r) as object), type: "ready.ok" }),
      (r) => ({ id: r.id, ok: true, type: "hello.ok", payload: { protocol: 1 } }),
    ];
    for (const reply of replies) expect(failed(await createHostBridge(fakeEnv({ reply }).env, options).connect())?.code).toBe("malformed-reply");
  });
  it("host error replies: bad-session, bad-request", async () => {
    for (const [file, code] of [["error.bad-session.response.json", "bad-session"], ["error.bad-request.response.json", "bad-request"]]) {
      const { env } = fakeEnv({ reply: (r) => ({ ...fixture(file), id: r.id }) });
      expect(failed(await createHostBridge(env, options).connect())?.code).toBe(code);
    }
  });
  it("a rejected post is a transport error", async () => {
    const { env } = fakeEnv({ reply: () => Promise.reject(new Error("handler gone")) });
    expect(failed(await createHostBridge(env, options).connect())).toEqual({ code: "transport-error", message: "handler gone" });
  });
  it("a host that never answers is a timeout, not a hang", async () => {
    vi.useFakeTimers();
    try {
      const { env } = fakeEnv({ reply: () => new Promise(() => undefined) });
      const pending = createHostBridge(env, { ...options, timeoutMs: 100 }).connect();
      await vi.advanceTimersByTimeAsync(150);
      expect(failed(await pending)?.code).toBe("timeout");
    } finally {
      vi.useRealTimers();
    }
  });
  it("a failure in ready is recorded and the receiver stays out of it", async () => {
    const { env } = fakeEnv({ reply: (r) => (r.type === "ready" ? { ...fixture("error.not-ready.response.json"), id: r.id } : defaultReply(r)) });
    const bridge = createHostBridge(env, options);
    await bridge.connect();
    expect(failed(await bridge.markReady())?.code).toBe("not-ready");
  });
});

describe("host events", () => {
  async function connected() {
    const harness = fakeEnv();
    const bridge = createHostBridge(harness.env, options);
    await bridge.connect();
    return { ...harness, bridge };
  }
  it("are refused before the handshake", () => {
    const { env, receiver } = fakeEnv();
    createHostBridge(env, options);
    expect(receiver()).toBeNull(); // nothing is installed to receive them
  });
  it("answer a ping with a pong request; wrong session, protocol or shape are refused without a reply", async () => {
    const { receiver, posts } = await connected();
    const good = fixture("host-ping.event.json");
    expect(receiver()!({ ...good, session: "99999999-0000-0000-0000-000000000000" })).toMatchObject({ ok: false, code: "bad-session" });
    expect(receiver()!({ ...good, protocol: 2 })).toMatchObject({ ok: false, code: "protocol-mismatch" });
    expect(receiver()!({ ...good, type: "reboot" })).toMatchObject({ ok: false, code: "bad-request" });
    expect(receiver()!(null)).toMatchObject({ ok: false, code: "bad-request" });
    expect(posts).toHaveLength(1); // only the hello
    expect(receiver()!(good)).toEqual({ ok: true });
    await vi.waitFor(() => expect(posts.at(-1)).toMatchObject({ type: "pong", payload: { inReplyTo: "h1" } }));
  });
  it("a failing pong is logged, never thrown into the host", async () => {
    const harness = fakeEnv({ reply: (r) => (r.type === "pong" ? Promise.reject(new Error("gone")) : defaultReply(r)) });
    const bridge = createHostBridge(harness.env, options);
    await bridge.connect();
    expect(harness.receiver()!(fixture("host-ping.event.json"))).toEqual({ ok: true });
    await vi.waitFor(() => expect(harness.logs.some((l) => l.startsWith("warn: pong for h1 failed"))).toBe(true));
  });
});
