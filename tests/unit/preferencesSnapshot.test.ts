// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { preferencesSnapshot } from "@/lib/host/preferencesSnapshot";

describe("preferencesSnapshot (Build 0080)", () => {
  beforeEach(() => window.localStorage.clear());

  it("reports effective defaults for an empty store and writes nothing", () => {
    const snapshot = preferencesSnapshot();
    expect(snapshot["layerling.theme"]).toBe("system");
    expect(snapshot["layerling.toolbarSize"]).toBe("medium");
    expect(snapshot["layerling.editor.startInPerspective"]).toBe(true);
    expect(snapshot["layerling.editor.keepProportions"]).toBe(false);
    expect(snapshot["layerling.appPrefs.v1"]).toBeTypeOf("object");
    expect(window.localStorage.length).toBe(0);
  });

  it("reports stored choices", () => {
    window.localStorage.setItem("layerling.theme", "dark");
    window.localStorage.setItem("layerling.editor.startInPerspective", "false");
    window.localStorage.setItem("layerling.printInfill", "35");
    const snapshot = preferencesSnapshot();
    expect(snapshot["layerling.theme"]).toBe("dark");
    expect(snapshot["layerling.editor.startInPerspective"]).toBe(false);
    expect(snapshot["layerling.printInfill"]).toBe(35);
    expect(window.localStorage.length).toBe(3);
  });
});
