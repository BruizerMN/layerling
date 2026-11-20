import { describe, expect, it, vi } from "vitest";
import { APP_THEME_STORAGE_KEY } from "@/lib/appTheme";
import { LANGUAGE_STORAGE_KEY } from "@/lib/i18n";
import { SHAPE_COLORS_STORAGE_KEY } from "@/lib/shapeColors";
import { SIMPLE_MODE_STORAGE_KEY } from "@/lib/simpleMode";
import { TOOLBAR_SIZE_STORAGE_KEY } from "@/lib/toolbarSize";
import { VIEW_CUBE_POSITION_STORAGE_KEY } from "@/lib/viewCubePosition";
import { startNativeAppSync, syncAppPreference, type AppSyncActions } from "@/lib/nativeAppSync";

const actions = (): { calls: string[]; a: AppSyncActions } => {
  const calls: string[] = [];
  const mk = (name: string) => () => void calls.push(name);
  return { calls, a: { theme: mk("theme"), language: mk("language"), toolbarSize: mk("toolbarSize"), shapeColors: mk("shapeColors"), viewCubePosition: mk("viewCubePosition"), simpleMode: mk("simpleMode") } };
};

describe("application preferences changed in another window reach this one", () => {
  it("each preference key runs exactly its own action", () => {
    const table: Array<[string, string]> = [
      [APP_THEME_STORAGE_KEY, "theme"], [LANGUAGE_STORAGE_KEY, "language"], [TOOLBAR_SIZE_STORAGE_KEY, "toolbarSize"],
      [SHAPE_COLORS_STORAGE_KEY, "shapeColors"], [VIEW_CUBE_POSITION_STORAGE_KEY, "viewCubePosition"], [SIMPLE_MODE_STORAGE_KEY, "simpleMode"],
    ];
    for (const [key, name] of table) {
      const { calls, a } = actions();
      expect(syncAppPreference(key, a)).toEqual([name]);
      expect(calls).toEqual([name]);
    }
  });
  it("unrelated keys do nothing, and a cleared storage re-reads everything", () => {
    const { calls, a } = actions();
    expect(syncAppPreference("layerling.projects", a)).toEqual([]);
    expect(calls).toEqual([]);
    expect(syncAppPreference(null, a)).toHaveLength(6);
  });
  it("the page listens to the storage event and stops when asked", () => {
    const handlers = new Map<string, (event: unknown) => void>();
    vi.stubGlobal("window", { addEventListener: (type: string, fn: (event: unknown) => void) => handlers.set(type, fn), removeEventListener: (type: string) => handlers.delete(type) });
    const { calls, a } = actions();
    const stop = startNativeAppSync(a);
    handlers.get("storage")!({ key: APP_THEME_STORAGE_KEY });
    expect(calls).toEqual(["theme"]);
    stop();
    expect(handlers.has("storage")).toBe(false);
    vi.unstubAllGlobals();
  });
});
