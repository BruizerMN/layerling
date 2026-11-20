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
