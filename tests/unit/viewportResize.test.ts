// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { resizeRendererIfNeeded } from "../../apps/web/src/components/workplane/viewportScene";

function fakeRenderer(width: number, height: number) {
  const calls: Array<[number, number]> = [];
  return {
    calls,
    getSize(target: THREE.Vector2) { return target.set(width, height); },
    setSize(w: number, h: number) { width = w; height = h; calls.push([w, h]); },
  };
}

describe("viewport resize (Build 0088)", () => {
  it("does nothing when the size is unchanged: setSize would clear the canvas for nothing", () => {
    const renderer = fakeRenderer(800, 600);
    expect(resizeRendererIfNeeded(renderer, 800, 600)).toBe(false);
    expect(renderer.calls).toEqual([]);
  });

  it("resizes once for a change, and the second report of the same change (window event, then ResizeObserver) finds nothing to do", () => {
    const renderer = fakeRenderer(800, 600);
    expect(resizeRendererIfNeeded(renderer, 1080, 600)).toBe(true);
    expect(resizeRendererIfNeeded(renderer, 1080, 600)).toBe(false);
    expect(renderer.calls).toEqual([[1080, 600]]);
  });

  it("a change of only the height or only the width counts", () => {
    const renderer = fakeRenderer(800, 600);
    expect(resizeRendererIfNeeded(renderer, 800, 640)).toBe(true);
    expect(resizeRendererIfNeeded(renderer, 700, 640)).toBe(true);
    expect(renderer.calls.length).toBe(2);
  });
});
