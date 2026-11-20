import { describe, expect, it } from "vitest";
import { HOME_VIEW_DISTANCE, distanceFromSlider, formatZoomPercent, sliderFromDistance, zoomPercent } from "@/lib/cameraStatus";

describe("status bar zoom scale", () => {
  it("is 100 % at the home framing and grows as the camera comes closer", () => {
    expect(zoomPercent(HOME_VIEW_DISTANCE)).toBeCloseTo(100, 6);
    expect(zoomPercent(HOME_VIEW_DISTANCE / 2)).toBeCloseTo(200, 6);
    expect(zoomPercent(HOME_VIEW_DISTANCE * 2)).toBeCloseTo(50, 6);
  });
  it("formats without false precision", () => {
    expect(formatZoomPercent(HOME_VIEW_DISTANCE)).toBe("100%");
    expect(formatZoomPercent(3)).toBe("6420%");
    expect(formatZoomPercent(9000)).toBe("2.1%");
  });
  it("the slider is logarithmic, right = closer, and round-trips over the camera's own range", () => {
    const min = 3;
    const max = 9000;
    expect(sliderFromDistance(max, min, max)).toBeCloseTo(0, 9);
    expect(sliderFromDistance(min, min, max)).toBeCloseTo(1, 9);
    for (const d of [3, 10, 100, HOME_VIEW_DISTANCE, 2500, 9000]) expect(distanceFromSlider(sliderFromDistance(d, min, max), min, max)).toBeCloseTo(d, 6);
    // equal steps are equal factors
    const a = distanceFromSlider(0.25, min, max) / distanceFromSlider(0.5, min, max);
    const b = distanceFromSlider(0.5, min, max) / distanceFromSlider(0.75, min, max);
    expect(a).toBeCloseTo(b, 9);
    // out-of-range input is clamped
    expect(distanceFromSlider(-1, min, max)).toBeCloseTo(max, 9);
    expect(distanceFromSlider(2, min, max)).toBeCloseTo(min, 9);
  });
});

import { ZOOM_PRESET_PERCENTS, distanceFromPercent, parseZoomPercent, percentRange } from "@/lib/cameraStatus";

describe("zoom percentage entry uses the slider's own scale and limits", () => {
  it("parses what a person types", () => {
    expect(parseZoomPercent("23")).toBe(23);
    expect(parseZoomPercent(" 23% ")).toBe(23);
    expect(parseZoomPercent("12,5 %")).toBe(12.5);
    expect(parseZoomPercent(".5")).toBe(0.5);
    for (const bad of ["", "abc", "-5", "0", "0%", "1e3", "10 20", "%"]) expect(parseZoomPercent(bad)).toBeNull();
  });
  it("a percentage and its distance are the same thing the readout shows", () => {
    for (const p of [10, 23, 100, 400]) expect(zoomPercent(distanceFromPercent(p))).toBeCloseTo(p, 9);
    expect(distanceFromPercent(100)).toBeCloseTo(HOME_VIEW_DISTANCE, 9);
  });
  it("the reachable range comes from the camera's own distance limits, and presets outside it are not offered", () => {
    const range = percentRange(3, 9000);
    expect(range.max).toBeCloseTo(zoomPercent(3), 9);
    expect(range.min).toBeCloseTo(zoomPercent(9000), 9);
    const offered = ZOOM_PRESET_PERCENTS.filter((p) => p >= range.min && p <= range.max);
    expect(offered).toContain(100);
    expect(offered).toContain(1600);
    expect(Math.max(...offered)).toBeLessThanOrEqual(range.max);
    expect(Math.min(...offered)).toBeGreaterThanOrEqual(range.min);
  });
});
