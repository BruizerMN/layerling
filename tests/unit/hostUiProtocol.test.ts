import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createHostBridge, type HostEnvironment, type HostReceiver } from "@/lib/host/hostBridge";
import { DOCUMENT_CAPABILITY, SAVE_CAPABILITY, UI_CAPABILITY, UI_MENU_CAPABILITY, parseHostEvent, type HostEvent, type HostRequest } from "@/lib/host/hostProtocol";

const uiDir = path.resolve(__dirname, "../../apps/web/src/lib/host/fixtures/ui");
const v3Dir = path.resolve(__dirname, "../../apps/web/src/lib/host/fixtures/v3");
const fx = (name: string, dir = uiDir) => JSON.parse(readFileSync(path.join(dir, name), "utf8")) as Record<string, unknown>;
const options = { editorVersion: "1.165.2", editorBuild: "abc123def", capabilities: [DOCUMENT_CAPABILITY, SAVE_CAPABILITY, UI_CAPABILITY, UI_MENU_CAPABILITY] };

function harness(helloFixture: string) {
  const posts: HostRequest[] = [];
  let receiver: HostReceiver | null = null;
  const reply = (request: HostRequest): unknown => {
    const byType: Record<string, [string, string]> = {
      hello: [helloFixture, helloFixture.startsWith("hello.ui") || helloFixture.startsWith("hello.menu") ? uiDir : v3Dir],
      "menu.show": ["menu.show.ok.response.json", uiDir],
      ready: ["../v1/ready.ok.response.json", v3Dir],
      "ui.state": ["ui.state.ok.response.json", uiDir],
      "ui.action": ["ui.action.ok.response.json", uiDir],
      "settings.state": ["settings.state.ok.response.json", uiDir],
    };
    const [name, dir] = byType[request.type];
    return { ...fx(name, dir), id: request.id };
  };
  const env: HostEnvironment = {
    bootstrap: fx("bootstrap.json", v3Dir),
    post: async (request) => (posts.push(request), reply(request)),
    installReceiver: (r) => ((receiver = r), () => (receiver = null)),
    log: () => undefined,
  };
  return { env, posts, receiver: () => receiver };
}

describe("ui.v1 (additive capability)", () => {
  it("is granted only when the host says so; the protocol stays 3", async () => {
    const h = harness("hello.ui.ok.response.json");
    const bridge = createHostBridge(h.env, options);
    expect(await bridge.connect()).toMatchObject({ state: "connected", protocol: 3, capabilities: ["document.open", "document.save", "ui.v1"] });
    expect(bridge.supportsUi()).toBe(true);
  });

  it("a host that does not grant it gets none of these messages, and nothing is posted", async () => {
    const h = harness("hello.ok.response.json");
    const bridge = createHostBridge(h.env, options);
    await bridge.connect();
    expect(bridge.supportsUi()).toBe(false);
    expect(await bridge.sendUi("ui.state", {})).toMatchObject({ ok: false, failure: { code: "unsupported-capability" } });
    expect(h.posts.map((p) => p.type)).toEqual(["hello"]);
    // ... and a ui event from such a host is refused.
    expect(h.receiver()!(fx("ui.command.event.json"))).toMatchObject({ ok: false, code: "bad-request" });
  });

  it("sends ui.state, ui.action and settings.state exactly as the fixtures", async () => {
    const h = harness("hello.ui.ok.response.json");
    const bridge = createHostBridge(h.env, options);
    await bridge.connect();
    await bridge.markReady();
    h.posts.length = 0;
    const docId = "d0c00002-aaaa-4bbb-8ccc-000000000002";
    expect(await bridge.sendUi("ui.state", { documentId: docId, state: { mode: "sketch", sketchEnabled: true, focusMode: false, ribbonPinned: true } })).toMatchObject({ ok: true });
    expect(await bridge.sendUi("ui.action", { documentId: docId, action: "openSettings" })).toMatchObject({ ok: true });
    expect(await bridge.sendUi("settings.state", { documentId: docId, workspace: { units: "Imperial", accuracy: 3 }, snap: "1/8 in", hasStartView: false })).toMatchObject({ ok: true });
    const stripId = (r: HostRequest) => ({ ...r, id: "-" });
    expect(h.posts.map(stripId)).toEqual([fx("ui.state.request.json"), fx("ui.action.request.json"), fx("settings.state.request.json")].map((f) => ({ ...f, id: "-" })));
  });

  it("delivers ui.command, settings.apply and settings.watch to listeners", async () => {
    const h = harness("hello.ui.ok.response.json");
    const bridge = createHostBridge(h.env, options);
    await bridge.connect();
    const seen: HostEvent[] = [];
    bridge.onEvent((e) => seen.push(e));
    for (const f of ["ui.command.event.json", "settings.apply.event.json", "settings.watch.event.json"]) expect(h.receiver()!(fx(f))).toEqual({ ok: true });
    expect(seen.map((e) => e.type)).toEqual(["ui.command", "settings.apply", "settings.watch"]);
  });

  it("parses the events and refuses unknown commands and malformed payloads", () => {
    expect(parseHostEvent(fx("ui.command.event.json"))).toMatchObject({ type: "ui.command", payload: { command: "mode.sketch" } });
    expect(parseHostEvent({ ...fx("ui.command.event.json"), payload: { documentId: "d", command: "format.disk" } })).toEqual({ invalid: expect.any(String) });
    expect(parseHostEvent({ ...fx("settings.apply.event.json"), payload: { documentId: "d" } })).toEqual({ invalid: expect.any(String) });
    expect(parseHostEvent({ ...fx("settings.watch.event.json"), payload: { documentId: "d", watching: "yes" } })).toEqual({ invalid: expect.any(String) });
  });
});


describe("ui.menu.v1 (native contextual menus)", () => {
  it("is granted only with ui.v1 and when the host says so", async () => {
    const h = harness("hello.menu.ok.response.json");
    const bridge = createHostBridge(h.env, options);
    expect(await bridge.connect()).toMatchObject({ state: "connected", capabilities: ["document.open", "document.save", "ui.v1", "ui.menu.v1"] });
    expect(bridge.supportsMenu()).toBe(true);
    const without = harness("hello.ui.ok.response.json");
    const b2 = createHostBridge(without.env, options);
    await b2.connect();
    expect(b2.supportsUi()).toBe(true);
    expect(b2.supportsMenu()).toBe(false);
    expect(await b2.sendUi("menu.show", {})).toMatchObject({ ok: false, failure: { code: "unsupported-capability" } });
    expect(without.posts.map((p) => p.type)).toEqual(["hello"]);
  });

  it("sends menu.show exactly as the fixture and delivers menu.result and menu.highlight", async () => {
    const h = harness("hello.menu.ok.response.json");
    const bridge = createHostBridge(h.env, options);
    await bridge.connect();
    await bridge.markReady();
    h.posts.length = 0;
    const request = fx("menu.show.request.json");
    const reply = await bridge.sendUi("menu.show", (request.payload as Record<string, unknown>));
    expect(reply).toMatchObject({ ok: true });
    expect({ ...h.posts[0], id: "-" }).toEqual({ ...request, id: "-" });
    const seen: HostEvent[] = [];
    bridge.onEvent((e) => seen.push(e));
    expect(h.receiver()!(fx("menu.result.event.json"))).toEqual({ ok: true });
    expect(h.receiver()!(fx("menu.highlight.event.json"))).toEqual({ ok: true });
    expect(seen.map((e) => e.type)).toEqual(["menu.result", "menu.highlight"]);
    expect(seen[0]).toMatchObject({ payload: { menuId: "m1", key: "duplicate", shift: true } });
  });

  it("refuses malformed menu events", () => {
    expect(parseHostEvent({ ...fx("menu.result.event.json"), payload: { documentId: "d", menuId: "m1", key: 5, shift: true } })).toEqual({ invalid: expect.any(String) });
    expect(parseHostEvent({ ...fx("menu.result.event.json"), payload: { documentId: "d", menuId: "m1", key: "x" } })).toEqual({ invalid: expect.any(String) });
    expect(parseHostEvent({ ...fx("menu.highlight.event.json"), payload: { documentId: "d", key: null } })).toEqual({ invalid: expect.any(String) });
    expect(parseHostEvent(fx("menu.highlight.event.json"))).toMatchObject({ type: "menu.highlight", payload: { key: null } });
  });
});
