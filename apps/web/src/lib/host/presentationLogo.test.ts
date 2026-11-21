import { describe, expect, it } from "vitest";
import { normalizeLogo } from "./presentationLogo";

describe("presentation logo settings", () => {
  it("defaults to no logo, bottom right, 75%", () => {
    expect(normalizeLogo(null)).toEqual({ url: null, position: "bottomRight", opacity: 0.75 });
    expect(normalizeLogo({ logo: "", logoPosition: "nowhere", logoOpacity: "x" })).toEqual({ url: null, position: "bottomRight", opacity: 0.75 });
  });
  it("takes the host's values and keeps the opacity in range", () => {
    expect(normalizeLogo({ logo: "layerling://app/__host__/background/logo?v=a.png", logoPosition: "topLeft", logoOpacity: 0.4 })).toEqual({ url: "layerling://app/__host__/background/logo?v=a.png", position: "topLeft", opacity: 0.4 });
    expect(normalizeLogo({ logoOpacity: 7 }).opacity).toBe(1);
    expect(normalizeLogo({ logoOpacity: -1 }).opacity).toBe(0.05);
  });
});
