import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(`apps/web/src/${path}`, "utf8");

// Build 0076: the native status bar no longer carries the Focus Mode icon or the "Keep every ribbon group open" pin. Both features and their View menu commands stay.
describe("footer cleanup (Build 0076)", () => {
  const bar = read("components/NativeStatusBar.tsx");

  it("the status bar has neither the Focus Mode icon nor the ribbon pin", () => {
    expect(bar).not.toContain('aria-label="Focus mode"');
    expect(bar).not.toContain('aria-label="Pin ribbon"');
    expect(bar).not.toContain("Keep every ribbon group open");
    expect(bar).not.toMatch(/focusMode\.toggle|ribbonPin\.toggle/);
    expect(bar).not.toMatch(/\bMaximize2\b|\bPinOff\b|\bPin\b/);
  });

  it("every other footer control from Build 0075 and before is still there", () => {
    for (const marker of [
      "data-presentation-enter", "data-presentation-exit", "data-presentation-standby", "data-presentation-grid",
      "data-workplane-toggle", 'aria-label="Inspector"', 'aria-label="Zoom out"', 'aria-label="Zoom in"', 'aria-label="Zoom"', "native-status-snap", "data-status=\"plate\"",
      "data-status=\"zoom\"", "data-status=\"selection\"", "data-status=\"objects\"", "data-status=\"units\"", "data-status=\"mode\"",
    ]) expect(bar, marker).toContain(marker);
    expect(bar).toContain('"Hide Workplane"');
    expect(bar).toContain('"Show Workplane"');
    expect(bar).toContain("toggleInspectorVisible");
  });

  it("the controls keep their order: workplane, Inspector, separator, snap, separator, zoom", () => {
    const order = ["data-workplane-toggle", 'aria-label="Inspector"', "native-status-snap", 'aria-label="Zoom out"'].map((m) => bar.indexOf(m));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("Focus Mode and the ribbon pin themselves are untouched: the commands the View menu runs are still handled by the page and known to the host protocol", () => {
    const toolbar = read("components/workplane/SecondaryToolbar.tsx");
    expect(toolbar).toContain("case \"focusMode.toggle\": onFocusModeChange?.(!focusMode); break;");
    expect(toolbar).toContain("case \"ribbonPin.toggle\": toggleRibbonPinned(); break;");
    const protocol = read("lib/host/hostProtocol.ts");
    expect(protocol).toContain("\"focusMode.toggle\"");
    expect(protocol).toContain("\"ribbonPin.toggle\"");
  });

  it("the browser edition's footer is a different component and was not touched", () => {
    const browser = read("components/AppFooter.tsx");
    expect(browser).not.toContain("native-status");
    expect(browser).not.toMatch(/Focus mode|Pin ribbon/);
  });
});
