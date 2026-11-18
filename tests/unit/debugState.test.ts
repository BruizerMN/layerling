import { describe, expect, it } from "vitest";
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
