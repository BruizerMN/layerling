import { afterEach, describe, expect, it, vi } from "vitest";
import { APP_THEME_STORAGE_KEY, APPEARANCE_MIGRATION_KEY, appThemeOptions, appThemePalette, migrateLegacyAppearance, normalizeAppThemePreference, resolveAppTheme, scenePalette, themeFromSettingsFile, themeToSettingsFile } from "@/lib/appTheme";
import { macDarkGrey, macLightGrey, recolor } from "../../scripts/generate-native-themes.mjs";

class Mem {
  map = new Map<string, string>();
  getItem(k: string) { return this.map.get(k) ?? null; }
  setItem(k: string, v: string) { this.map.set(k, v); }
}
const native = () => vi.stubGlobal("window", { location: { protocol: "layerling:" } });
const browser = () => vi.stubGlobal("window", { location: { protocol: "https:" } });
afterEach(() => vi.unstubAllGlobals());

describe("native appearances", () => {
  it("offers System, Light, Dark and Classic Layerling in the app, and the browser's own four in a browser", () => {
    native();
    expect(appThemeOptions().map((o) => o.label)).toEqual(["System", "Light", "Dark", "Classic Layerling"]);
    browser();
    expect(appThemeOptions().map((o) => o.value)).toEqual(["system", "light", "dark", "graphite"]);
  });

  it("System/Light/Dark use the neutral mac palette, Classic keeps the original brown dark theme; a browser never changes", () => {
    native();
    for (const p of ["system", "light", "dark"] as const) expect(appThemePalette(p)).toBe("mac");
    expect(appThemePalette("classic")).toBe("default");
    expect(resolveAppTheme("classic", false)).toBe("dark");
    expect(resolveAppTheme("system", true)).toBe("dark");
    // the 3D scene: neutral grey where the interface is neutral dark
    expect(scenePalette("dark", "dark")).toBe("graphite");
    expect(scenePalette("system", "dark")).toBe("graphite");
    expect(scenePalette("light", "light")).toBe("default");
    expect(scenePalette("classic", "dark")).toBe("default");
    browser();
    expect(appThemePalette("dark")).toBe("default");
    expect(appThemePalette("graphite")).toBe("graphite");
    expect(scenePalette("graphite", "dark")).toBe("graphite");
    expect(normalizeAppThemePreference("classic")).toBe("dark");
  });

  it("migrates an explicit choice without changing how it LOOKS, once, and never touches a fresh installation", () => {
    const brownDark = new Mem(); brownDark.setItem(APP_THEME_STORAGE_KEY, "dark");
    expect(migrateLegacyAppearance(brownDark, true)).toBe(true);
    expect(brownDark.getItem(APP_THEME_STORAGE_KEY)).toBe("classic");
    const graphite = new Mem(); graphite.setItem(APP_THEME_STORAGE_KEY, "graphite");
    migrateLegacyAppearance(graphite, true);
    expect(graphite.getItem(APP_THEME_STORAGE_KEY)).toBe("dark");
    for (const keep of ["light", "system"]) {
      const s = new Mem(); s.setItem(APP_THEME_STORAGE_KEY, keep);
      migrateLegacyAppearance(s, true);
      expect(s.getItem(APP_THEME_STORAGE_KEY)).toBe(keep);
    }
    const fresh = new Mem();
    expect(migrateLegacyAppearance(fresh, true)).toBe(false);
    expect(fresh.getItem(APP_THEME_STORAGE_KEY)).toBeNull();   // nothing stored = System, the default
    // once: after migration a "dark" the user picks later means the new Dark
    brownDark.setItem(APP_THEME_STORAGE_KEY, "dark");
    expect(migrateLegacyAppearance(brownDark, true)).toBe(false);
    expect(brownDark.getItem(APP_THEME_STORAGE_KEY)).toBe("dark");
    expect(brownDark.getItem(APPEARANCE_MIGRATION_KEY)).toBe("0007");
    // never in a browser
    const b = new Mem(); b.setItem(APP_THEME_STORAGE_KEY, "dark");
    expect(migrateLegacyAppearance(b, false)).toBe(false);
    expect(b.getItem(APP_THEME_STORAGE_KEY)).toBe("dark");
  });

  it("settings files keep the original theme names in both directions", () => {
    for (const [app, file] of [["classic", "dark"], ["dark", "graphite"], ["light", "light"], ["system", "system"]] as const) {
      expect(themeToSettingsFile(app, true)).toBe(file);
      expect(themeFromSettingsFile(file, true)).toBe(app);
    }
    // a browser writes and reads its own names unchanged
    expect(themeToSettingsFile("graphite", false)).toBe("graphite");
    expect(themeFromSettingsFile("dark", false)).toBe("dark");
  });
});

describe("generated neutral palettes", () => {
  it("light: warm neutrals become neutral greys, text goes near black, accents and cool colours stay", () => {
    const [r, g, b] = macLightGrey(0x5d, 0x47, 0x31)!;
    expect(r).toBe(g); expect(g).toBe(b); expect(r).toBeLessThan(0x40);
    expect(macLightGrey(0xdd, 0x79, 0x06)).toBeNull();      // orange accent
    expect(macLightGrey(0x69, 0xd9, 0xff)).toBeNull();      // cool colour
    expect(macLightGrey(0x2d, 0x2d, 0x2d)).toBeNull();      // already grey
  });
  it("dark: warm browns become charcoal in macOS's steps, light text stays light", () => {
    const bg = macDarkGrey(0x1b, 0x14, 0x0d)!;
    expect(bg[0]).toBe(bg[1]); expect(bg[1]).toBe(bg[2]);
    expect(bg[0]).toBeGreaterThanOrEqual(0x1a); expect(bg[0]).toBeLessThanOrEqual(0x2c);
    const text = macDarkGrey(0xf1, 0xe8, 0xd8)!;
    expect(text[0]).toBeGreaterThan(0xd0);
    expect(recolor("1px solid #5c4b3a", macDarkGrey)).toMatch(/#[0-9a-f]{2}\1\1/i === undefined ? /x/ : /#[0-9a-f]{6}/);
  });
});

import { readFileSync } from "node:fs";
import path from "node:path";
import { MAC_DARK_TARGET, MAC_LIGHT_TARGET, macDarkThemeCss, macLightThemeCss } from "../../scripts/generate-native-themes.mjs";
import { readGraphiteSources } from "../../scripts/generate-graphite-theme.mjs";

describe("generated native palette files", () => {
  const root = path.resolve(__dirname, "../..");
  const source = readGraphiteSources(root);
  it("are up to date with the style sheets (run `npm run theme:native` after colour changes)", () => {
    expect(readFileSync(path.join(root, MAC_LIGHT_TARGET), "utf8")).toBe(macLightThemeCss(source));
    expect(readFileSync(path.join(root, MAC_DARK_TARGET), "utf8")).toBe(macDarkThemeCss(source));
  });
  it("match only where the native app sets the mac palette", () => {
    for (const css of [macLightThemeCss(source), macDarkThemeCss(source)]) {
      for (const selector of css.split("{").filter((chunk) => /[a-z]/i.test(chunk)).slice(0, 400)) {
        if (selector.trim().startsWith("@") || selector.includes(":") === false) continue;
        expect(selector).toContain('data-palette="mac"');
      }
    }
  });
});
