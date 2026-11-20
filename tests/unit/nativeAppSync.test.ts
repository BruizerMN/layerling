import { describe, expect, it, vi } from "vitest";
import { APP_THEME_STORAGE_KEY } from "@/lib/appTheme";
import { LANGUAGE_STORAGE_KEY } from "@/lib/i18n";
import { SHAPE_COLORS_STORAGE_KEY } from "@/lib/shapeColors";
import { SIMPLE_MODE_STORAGE_KEY } from "@/lib/simpleMode";
import { TOOLBAR_SIZE_STORAGE_KEY } from "@/lib/toolbarSize";
import { VIEW_CUBE_POSITION_STORAGE_KEY } from "@/lib/viewCubePosition";
import { INSPECTOR_VISIBLE_STORAGE_KEY } from "@/lib/inspectorDock";
import { startNativeAppSync, syncAppPreference, type AppSyncActions } from "@/lib/nativeAppSync";

const actions = (): { calls: string[]; a: AppSyncActions } => {
  const calls: string[] = [];
  const mk = (name: string) => () => void calls.push(name);
  return { calls, a: { theme: mk("theme"), language: mk("language"), toolbarSize: mk("toolbarSize"), shapeColors: mk("shapeColors"), viewCubePosition: mk("viewCubePosition"), simpleMode: mk("simpleMode"), inspector: mk("inspector") } };
};

describe("application preferences changed in another window reach this one", () => {
  it("each preference key runs exactly its own action", () => {
    const table: Array<[string, string]> = [
      [APP_THEME_STORAGE_KEY, "theme"], [LANGUAGE_STORAGE_KEY, "language"], [TOOLBAR_SIZE_STORAGE_KEY, "toolbarSize"],
      [SHAPE_COLORS_STORAGE_KEY, "shapeColors"], [VIEW_CUBE_POSITION_STORAGE_KEY, "viewCubePosition"], [SIMPLE_MODE_STORAGE_KEY, "simpleMode"], [INSPECTOR_VISIBLE_STORAGE_KEY, "inspector"],
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
    expect(syncAppPreference(null, a)).toHaveLength(7);
  });
  it("the page listens to the storage event and stops when asked", () => {
    const handlers = new Map<string, (event: unknown) => void>();
    const root = { dataset: {} as Record<string, string> };
    vi.stubGlobal("document", { documentElement: root });
    vi.stubGlobal("window", { addEventListener: (type: string, fn: (event: unknown) => void) => handlers.set(type, fn), removeEventListener: (type: string) => handlers.delete(type) });
    const { calls, a } = actions();
    const stop = startNativeAppSync(a);
    expect(root.dataset.nativeApp).toBe("on");
    handlers.get("storage")!({ key: APP_THEME_STORAGE_KEY });
    expect(calls).toEqual(["theme"]);
    stop();
    expect(handlers.has("storage")).toBe(false);
    expect(root.dataset.nativeApp).toBeUndefined();
    vi.unstubAllGlobals();
  });
});
