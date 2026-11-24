import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import { WorkplaneGridIcon } from "@/components/WorkplaneGridIcon";
import { getWorkplaneVisible, publishWorkplaneVisible, subscribeWorkplaneVisible } from "@/lib/workplaneDisplay";

const read = (path: string) => readFileSync(`apps/web/src/${path}`, "utf8");

describe("workplane display state (Build 0075)", () => {
  beforeEach(() => publishWorkplaneVisible(true));

  it("a page starts with the workplane shown", () => {
    expect(getWorkplaneVisible()).toBe(true);
  });
  it("publishes changes to the footer and only real changes", () => {
    let calls = 0;
    const stop = subscribeWorkplaneVisible(() => { calls += 1; });
    publishWorkplaneVisible(false);
    expect(getWorkplaneVisible()).toBe(false);
    publishWorkplaneVisible(false);
    expect(calls).toBe(1);
    publishWorkplaneVisible(true);
    expect(calls).toBe(2);
    stop();
    publishWorkplaneVisible(false);
    expect(calls).toBe(2);
  });
});

describe("the workplane icon shows its state without colour", () => {
  const shown = renderToStaticMarkup(createElement(WorkplaneGridIcon, { size: 15 }));
  const hidden = renderToStaticMarkup(createElement(WorkplaneGridIcon, { size: 15, slashed: true }));
  it("visible: the plain grid, no slash", () => {
    expect(shown).toContain("M12 4 22 12 12 20 2 12Z");
    expect(shown).not.toContain("M3 3 21 21");
    expect(shown).not.toContain("<mask");
  });
  it("hidden: the same grid with a diagonal slash and a gap cut around it", () => {
    expect(hidden).toContain("M12 4 22 12 12 20 2 12Z");
    expect(hidden).toContain("M3 3 21 21");
    expect(hidden).toContain("<mask");
    expect(hidden).toContain('data-slashed="true"');
  });
  it("the two states differ in shape, not only in a style", () => {
    expect(hidden).not.toBe(shown);
    expect(hidden.length).toBeGreaterThan(shown.length);
  });
});

describe("the footer's workplane button", () => {
  const bar = read("components/NativeStatusBar.tsx");
  const at = bar.indexOf("data-workplane-toggle");
  const button = bar.slice(bar.lastIndexOf("{!presentation", at), bar.indexOf("</button>", at) + 9);

  it("is the viewport's own switch, with the requested labels and tooltips", () => {
    expect(at).toBeGreaterThan(0);
    expect(button).toContain('"Hide Workplane"');
    expect(button).toContain('"Show Workplane"');
    expect(button).toContain("aria-label=");
    expect(button).toContain("title=");
    expect(button).toContain("window.layerlingWorkplaneDisplay?.(!gridVisible)");
  });
  it("is icon-only and a view setting only: no text, no document command, no undo", () => {
    expect(button).not.toMatch(/runUiCommand|requestHostAction|commit|undo|setNotice/i);
    expect(button).not.toMatch(/aria-pressed=/);       // the label says what it will do; the icon says what is
    expect(button).toContain("<WorkplaneGridIcon");
  });
  it("is shown in the 3D editor outside Presentation Mode (which has its own grid button on the same state)", () => {
    expect(button).toContain('!presentation && mode === "geometry"');
    expect(bar).toContain("useSyncExternalStore(subscribeWorkplaneVisible, getWorkplaneVisible");
    expect(bar).toContain("data-presentation-grid");
  });
  it("Presentation Mode still remembers the user's state on entering and restores it on leaving", () => {
    const editor = read("components/LayerlingEditor.tsx");
    expect(editor).toContain("gridBeforePresentationRef.current = window.layerlingWorkplaneDisplay?.().visible ?? null;");
    expect(editor).toContain("window.layerlingWorkplaneDisplay?.(gridBeforePresentationRef.current)");
  });
});

describe("the viewport side stays a view setting", () => {
  const viewport = read("components/WorkplaneViewport.tsx");
  it("starts from, and publishes to, the display state, and touches nothing of the document", () => {
    expect(viewport).toContain("useState(() => !getWorkplaneVisible())");
    const publish = viewport.slice(viewport.indexOf("publishWorkplaneVisible(!workplaneLayerHidden)") - 120, viewport.indexOf("publishWorkplaneVisible(!workplaneLayerHidden)") + 120);
    expect(publish).not.toMatch(/commitShapes|onShapesChange|markDirty|undo/);
    const api = viewport.slice(viewport.indexOf("window.layerlingWorkplaneDisplay = (visible) =>"), viewport.indexOf("delete window.layerlingWorkplaneDisplay"));
    expect(api).toContain("setWorkplaneLayerHidden(!visible)");
    expect(api).not.toMatch(/commitShapes|onShapesChange|markDirty|undo/);
  });
});

describe("one look for the footer's bordered controls", () => {
  const css = read("app/nativeStatusBar.css");
  const block = css.slice(css.indexOf("Build 0075: one look for the footer's bordered controls"));
  const rule = (selector: string) => {
    const start = block.indexOf(selector + " {");
    expect(start, selector).toBeGreaterThan(-1);
    return block.slice(start, block.indexOf("}", start));
  };
  it("defines the tokens once", () => {
    for (const token of ["--footer-control-height", "--footer-control-radius", "--footer-control-border", "--footer-control-bg", "--footer-control-bg-hover", "--footer-control-bg-selected", "--footer-control-bg-active"]) {
      expect(css.split(`${token}:`).length - 1, token).toBe(1);
    }
  });
  it("the presentation buttons, the mm/in chooser and the snap menu all read them (height, radius, border, hover, pressed)", () => {
    const presentation = rule(".native-status-bar .native-presentation-exit,\n.native-status-bar .native-presentation-enter,\n.native-status-bar .native-presentation-standby");
    const units = rule(".native-status-bar .native-status-snap .snap-units");
    const select = rule(".native-status-bar .native-status-snap .snap-select");
    for (const body of [presentation, units, select]) {
      expect(body).toContain("height: var(--footer-control-height)");
      expect(body).toContain("border-radius: var(--footer-control-radius)");
      expect(body).toContain("border: var(--footer-control-border)");
      expect(body).toContain("background: var(--footer-control-bg)");
    }
    expect(block).toContain(".native-presentation-enter:hover,\n.native-status-bar .native-presentation-standby:hover { background: var(--footer-control-bg-hover); }");
    expect(block).toContain(".snap-units button:hover { background: var(--footer-control-bg-hover); }");
    expect(block).toContain(".snap-units button:active { background: var(--footer-control-bg-active); }");
  });
  it("no bordered footer control in the new block hard-codes its own stroke, radius or height", () => {
    const body = block.slice(block.indexOf(".native-status-bar .native-presentation-exit"));
    expect(body).not.toMatch(/border(-left)?:\s*1px solid (rgba|#|currentColor)/);
    expect(body).not.toMatch(/border-radius:\s*\d/);
    expect(body).not.toMatch(/height:\s*\d+px/);
  });
});
