import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  HOST_ERROR_CODES,
  HOST_PROTOCOL_MAX,
  HOST_PROTOCOL_MIN,
  negotiateProtocol,
  parseHelloOk,
  parseHostBootstrap,
  parseHostEvent,
  parseHostResponse,
  parseProtocolRange,
} from "@/lib/host/hostProtocol";

const fixtureDir = path.resolve(__dirname, "../../apps/web/src/lib/host/fixtures/v1");
const fixture = (name: string) => JSON.parse(readFileSync(path.join(fixtureDir, name), "utf8")) as Record<string, unknown>;

describe("host protocol constants", () => {
  it("speak versions 1 to 2, and the fixtures say the same", () => {
    expect([HOST_PROTOCOL_MIN, HOST_PROTOCOL_MAX]).toEqual([1, 2]);
    expect(fixture("manifest.json").protocol).toBe(1);
    expect(JSON.parse(readFileSync(path.join(fixtureDir, "../v2/manifest.json"), "utf8")).protocol).toBe(2);
  });
  it("list every error code the fixtures use", () => {
    for (const file of ["hello.unsupported", "error.bad-session", "error.protocol-mismatch", "error.bad-request", "error.not-ready"]) {
      const code = (fixture(`${file}.response.json`).error as { code: string }).code;
      expect(HOST_ERROR_CODES as readonly string[]).toContain(code);
    }
  });
});

describe("negotiateProtocol", () => {
  it("picks the highest version both sides speak", () => {
    expect(negotiateProtocol({ min: 1, max: 1 }, { min: 1, max: 1 })).toBe(1);
    expect(negotiateProtocol({ min: 1, max: 3 }, { min: 2, max: 5 })).toBe(3);
    expect(negotiateProtocol({ min: 2, max: 4 }, { min: 1, max: 2 })).toBe(2);
  });
  it("says null when the ranges do not meet", () => {
    expect(negotiateProtocol({ min: 1, max: 1 }, { min: 2, max: 3 })).toBeNull();
    expect(negotiateProtocol({ min: 4, max: 5 }, { min: 1, max: 3 })).toBeNull();
  });
});

describe("parseProtocolRange", () => {
  it("accepts a proper range and refuses everything else", () => {
    expect(parseProtocolRange({ min: 1, max: 2 })).toEqual({ min: 1, max: 2 });
    for (const bad of [null, undefined, 3, "1", [], {}, { min: 2, max: 1 }, { min: 0, max: 1 }, { min: 1.5, max: 2 }, { min: "1", max: 2 }]) {
      expect(parseProtocolRange(bad)).toBeNull();
    }
  });
});

describe("parseHostBootstrap", () => {
  it("reads the fixture", () => {
    expect(parseHostBootstrap(fixture("bootstrap.json"))).toEqual(fixture("bootstrap.json"));
  });
  it("refuses a malformed capability", () => {
    const good = fixture("bootstrap.json");
    const variants: unknown[] = [
      null, "x", [], {},
      { ...good, session: "" }, { ...good, session: "short" }, { ...good, session: 123 },
      { ...good, host: { name: "x" } }, { ...good, host: null },
      { ...good, protocol: { min: 3, max: 1 } }, { ...good, protocol: undefined },
    ];
    for (const bad of variants) expect(parseHostBootstrap(bad)).toBeNull();
  });
});

describe("parseHostResponse", () => {
  it("reads every success fixture for its request", () => {
    const pairs: [string, string, string][] = [
      ["hello.ok.response.json", "e1", "hello.ok"],
      ["ready.ok.response.json", "e2", "ready.ok"],
      ["ping.ok.response.json", "e3", "ping.ok"],
      ["pong.ok.response.json", "e4", "pong.ok"],
    ];
    for (const [file, id, type] of pairs) expect(parseHostResponse(fixture(file), id, type), file).toMatchObject({ kind: "ok", type });
  });
  it("reads the hello.ok payload", () => {
    const parsed = parseHostResponse(fixture("hello.ok.response.json"), "e1", "hello.ok");
    expect(parsed.kind).toBe("ok");
    if (parsed.kind === "ok") expect(parseHelloOk(parsed.payload)).toEqual({ protocol: 1, host: { name: "HundchenLayerling", version: "0.1.0" }, capabilities: [] });
  });
  it("reads error replies, with the supported range of an unsupported protocol", () => {
    expect(parseHostResponse(fixture("hello.unsupported.response.json"), "e1", "hello.ok")).toEqual({
      kind: "error",
      error: { code: "unsupported-protocol", message: "This host speaks protocol 2-3 only.", supported: { min: 2, max: 3 } },
    });
    for (const [file, id, code] of [
      ["error.bad-session.response.json", "e2", "bad-session"],
      ["error.protocol-mismatch.response.json", "e2", "protocol-mismatch"],
      ["error.bad-request.response.json", "e1", "bad-request"],
      ["error.not-ready.response.json", "e2", "not-ready"],
    ]) {
      expect(parseHostResponse(fixture(file), id, "x")).toMatchObject({ kind: "error", error: { code } });
    }
  });
  it("reads an unknown error code from a newer host as internal and keeps the original in the message", () => {
    const parsed = parseHostResponse({ id: "e1", ok: false, error: { code: "quota-exceeded", message: "no room" } }, "e1", "hello.ok");
    expect(parsed).toEqual({ kind: "error", error: { code: "internal", message: 'no room (host code "quota-exceeded")' } });
  });
  it("refuses replies that are not what was asked", () => {
    const ok = fixture("hello.ok.response.json");
    const cases: [unknown, string, string][] = [
      [null, "e1", "hello.ok"], ["x", "e1", "hello.ok"], [[], "e1", "hello.ok"],
      [ok, "e9", "hello.ok"],                                  // another request's reply
      [ok, "e1", "ready.ok"],                                  // wrong type
      [{ ...ok, ok: "yes" }, "e1", "hello.ok"],                 // ok is not a boolean
      [{ ...ok, payload: undefined }, "e1", "hello.ok"],        // no payload
      [{ id: "e1", ok: false }, "e1", "hello.ok"],              // error without error
      [{ id: "e1", ok: false, error: { code: "bad-session" } }, "e1", "hello.ok"], // error without message
    ];
    for (const [value, id, type] of cases) expect(parseHostResponse(value, id, type).kind, JSON.stringify(value)).toBe("invalid");
  });
  it("refuses an incomplete hello.ok payload", () => {
    expect(parseHelloOk({ protocol: 1, host: { name: "x", version: "1" } })).toBeNull();
    expect(parseHelloOk({ protocol: 0, host: { name: "x", version: "1" }, capabilities: [] })).toBeNull();
    expect(parseHelloOk({ protocol: 1, host: { name: "x" }, capabilities: [] })).toBeNull();
    expect(parseHelloOk({ protocol: 1, host: { name: "x", version: "1" }, capabilities: [1] })).toBeNull();
  });
});

describe("parseHostEvent", () => {
  it("reads the host ping fixture", () => {
    expect(parseHostEvent(fixture("host-ping.event.json"))).toEqual({ session: "11111111-2222-3333-4444-555555555555", protocol: 1, id: "h1", type: "ping", payload: {} });
  });
  it("refuses malformed events and unknown types", () => {
    const good = fixture("host-ping.event.json");
    for (const bad of [null, "x", [], { ...good, session: "" }, { ...good, id: "" }, { ...good, protocol: 0 }, { ...good, type: "reboot" }, { ...good, payload: null }]) {
      expect(parseHostEvent(bad)).toHaveProperty("invalid");
    }
  });
});
