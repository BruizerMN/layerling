import { beforeEach, describe, expect, it } from "vitest";
import { getSessionSectionOpen, resetSessionSections, setSessionSectionOpen } from "@/lib/inspectorCards";

describe("Inspector sections in the native app (session state)", () => {
  beforeEach(() => resetSessionSections());

  it("starts every section open", () => {
    expect(getSessionSectionOpen("object.general")).toBe(true);
    expect(getSessionSectionOpen("position")).toBe(true);
    expect(getSessionSectionOpen("anything")).toBe(true);
  });

  it("keeps the user's choice for the session, per section", () => {
    setSessionSectionOpen("position", false);
    expect(getSessionSectionOpen("position")).toBe(false);
    expect(getSessionSectionOpen("rotation")).toBe(true);
    setSessionSectionOpen("position", true);
    expect(getSessionSectionOpen("position")).toBe(true);
  });

  it("writes nothing to the browser storage", () => {
    const writes: string[] = [];
    const store = { setItem: (key: string) => writes.push(key), getItem: () => null, removeItem: () => undefined };
    Object.defineProperty(globalThis, "window", { value: { localStorage: store }, configurable: true });
    setSessionSectionOpen("properties", false);
    expect(writes).toEqual([]);
    Reflect.deleteProperty(globalThis, "window");
  });
});
