import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEBUG_STATE_STORAGE_KEY, debugStateRequested } from "@/lib/debugState";

const storageWith = (value: string | null) => ({ getItem: (key: string) => (key === DEBUG_STATE_STORAGE_KEY ? value : null) });
const throwingStorage = { getItem: () => { throw new Error("blocked"); } };

describe("debugStateRequested (scene mirror in hidden DOM elements)", () => {
  it("is off by default", () => {
    expect(debugStateRequested("", null)).toBe(false);
    expect(debugStateRequested("", storageWith(null))).toBe(false);
    expect(debugStateRequested("?editor=1&project=project-1", storageWith(null))).toBe(false);
  });

  it("is on with ?debugState=1, also next to other parameters", () => {
    expect(debugStateRequested("?debugState=1", null)).toBe(true);
    expect(debugStateRequested("?editor=1&debugState=1&project=x", storageWith(null))).toBe(true);
  });

  it("is on when the stored switch is 1", () => {
    expect(debugStateRequested("", storageWith("1"))).toBe(true);
  });

  it("ignores every other value", () => {
    for (const value of ["0", "true", "yes", "", "2"]) {
      expect(debugStateRequested(`?debugState=${value}`, storageWith(value))).toBe(false);
    }
  });

  it("treats blocked or failing storage as off", () => {
    expect(debugStateRequested("", throwingStorage)).toBe(false);
    expect(debugStateRequested("?debugState=1", throwingStorage)).toBe(true);
  });
});

describe("the hidden scene mirrors stay gated in the sources", () => {
  const read = (file: string) => readFileSync(path.resolve(__dirname, "../../apps/web/src", file), "utf8");

  const elementsWithGuard = (source: string, guard: RegExp) => {
    const found = [...source.matchAll(/<pre data-codex-[a-z]+ hidden>/g)];
    expect(found.length).toBeGreaterThan(0);
    return found.every((match) => guard.test(source.slice(Math.max(0, (match.index ?? 0) - 160), match.index)));
  };

  it("renders data-codex-state and data-codex-summary only when requested", () => {
    expect(elementsWithGuard(read("components/LayerlingEditor.tsx"), /debugStateEnabled \? \(/)).toBe(true);
  });

  it("renders data-codex-projects only when requested", () => {
    expect(elementsWithGuard(read("app/page.tsx"), /projectDebugSummary \? \(/)).toBe(true);
  });

  it("builds the large state string only when requested", () => {
    const editor = read("components/LayerlingEditor.tsx");
    expect(editor).toMatch(/debugStateEnabled\s*\n?\s*\? JSON\.stringify/);
    expect(editor).toMatch(/debugStateEnabled \? `notice=/);
  });
});

describe("readDebugStateRequested keeps a request made in the first URL", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("still answers yes after the address bar was rewritten for an open design", async () => {
    const location = { search: "?debugState=1" };
    vi.stubGlobal("window", { location, localStorage: { getItem: () => null } });
    vi.resetModules();
    const fresh = await import("@/lib/debugState");
    expect(fresh.readDebugStateRequested()).toBe(true);
    location.search = "?editor=1&project=project-1";
    expect(fresh.readDebugStateRequested()).toBe(true);
  });

  it("answers no when neither the first URL nor storage asked", async () => {
    vi.stubGlobal("window", { location: { search: "?editor=1" }, localStorage: { getItem: () => null } });
    vi.resetModules();
    const fresh = await import("@/lib/debugState");
    expect(fresh.readDebugStateRequested()).toBe(false);
  });
});
