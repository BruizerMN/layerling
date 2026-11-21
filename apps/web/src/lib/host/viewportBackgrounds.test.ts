import { afterEach, describe, expect, it } from "vitest";
import { chooseBackground } from "./viewportBackgrounds";
import { coverTransform } from "../../components/workplane/viewportBackgroundImage";

const images = { light: "L", dark: "D", presentation: "P" };
const none = { light: null, dark: null, presentation: null };

function native(on: boolean) {
  (globalThis as unknown as { window?: unknown }).window = on ? { location: { protocol: "layerling:" } } : undefined;
}
afterEach(() => native(false));

describe("which viewport background applies (native app)", () => {
  it("follows the effective appearance in ordinary editing", () => {
    native(true);
    expect(chooseBackground(images, { presentation: false, preference: "light", resolved: "light" }).url).toBe("L");
    expect(chooseBackground(images, { presentation: false, preference: "dark", resolved: "dark" }).url).toBe("D");
    expect(chooseBackground(images, { presentation: false, preference: "system", resolved: "dark" }).url).toBe("D");
    expect(chooseBackground(images, { presentation: false, preference: "system", resolved: "light" }).url).toBe("L");
    expect(chooseBackground({ ...none, dark: "D" }, { presentation: false, preference: "light", resolved: "light" }).url).toBeNull();
  });
  it("leaves Classic Layerling alone", () => {
    native(true);
    expect(chooseBackground(images, { presentation: false, preference: "classic", resolved: "dark" }).url).toBeNull();
  });
  it("Presentation: its own image, else the Dark image, else the standard dark background, whatever the appearance", () => {
    native(true);
    expect(chooseBackground(images, { presentation: true, preference: "light", resolved: "light" })).toEqual({ url: "P", theme: "dark", forcedDark: true });
    expect(chooseBackground({ ...images, presentation: null }, { presentation: true, preference: "light", resolved: "light" }).url).toBe("D");
    expect(chooseBackground(none, { presentation: true, preference: "light", resolved: "light" })).toEqual({ url: null, theme: "dark", forcedDark: true });
    expect(chooseBackground(images, { presentation: true, preference: "classic", resolved: "dark" }).url).toBe("P");
  });
  it("does nothing in a browser", () => {
    native(false);
    expect(chooseBackground(images, { presentation: false, preference: "light", resolved: "light" }).url).toBeNull();
    expect(chooseBackground(images, { presentation: true, preference: "dark", resolved: "dark" }).url).toBeNull();
  });
});

describe("cover fit", () => {
  it("crops the overflow instead of stretching", () => {
    expect(coverTransform(2, 4)).toEqual({ repeat: [1, 0.5], offset: [0, 0.25] });   // a wide view: the picture's top and bottom are cropped
    expect(coverTransform(2, 1)).toEqual({ repeat: [0.5, 1], offset: [0.25, 0] });   // a tall view: its sides are cropped
    expect(coverTransform(1.5, 1.5)).toEqual({ repeat: [1, 1], offset: [0, 0] });
    expect(coverTransform(0, 1)).toEqual({ repeat: [1, 1], offset: [0, 0] });
  });
});
