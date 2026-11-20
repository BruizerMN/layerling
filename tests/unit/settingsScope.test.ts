import { beforeEach, describe, expect, it } from "vitest";
import { APP_PREFS_STORAGE_KEY, readAppPrefs, writeAppPrefs } from "@/lib/appPrefs";
import { documentSignature } from "@/lib/host/documentRevision";
import { DOCUMENT_SETTING_KEYS, changedKeys, documentSettingsView, effectiveWorkspace, settingScope, splitWorkspace } from "@/lib/settingsScope";
import { DEFAULT_WORKPLANE_WORKSPACE, WORKSPACE_DEFAULT_STORAGE_KEY, normalizeWorkspaceSettings } from "@/lib/workplaneSettings";

class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length() { return this.map.size; }
  clear() { this.map.clear(); }
  getItem(key: string) { return this.map.get(key) ?? null; }
  key(i: number) { return [...this.map.keys()][i] ?? null; }
  removeItem(key: string) { this.map.delete(key); }
  setItem(key: string, value: string) { this.map.set(key, value); }
}
let storage: MemoryStorage;
beforeEach(() => { storage = new MemoryStorage(); });

const D = DEFAULT_WORKPLANE_WORKSPACE;

describe("setting ownership", () => {
  it("every document key exists in the workspace type, and the rest belong to the application", () => {
    const all = Object.keys(normalizeWorkspaceSettings({ plates: ["A"] }));
    for (const key of DOCUMENT_SETTING_KEYS) expect(all).toContain(key);
    expect(settingScope("units")).toBe("doc");
    expect(settingScope("shapeCustomizations")).toBe("doc");
    for (const key of ["background", "surfaceColor", "gridColor", "showShadows", "edgeLines", "lightAzimuth", "mouseScheme", "zoomSpeed", "showGrid", "showAxes", "stlAsDownload", "confirmTabClose"]) expect(settingScope(key)).toBe("app");
  });

  it("splitWorkspace partitions without losing or duplicating a key", () => {
    const w = normalizeWorkspaceSettings({ plates: ["A", "B"], units: "Imperial", background: "#123456" });
    const { doc, app } = splitWorkspace(w);
    expect(Object.keys(doc).filter((k) => k in app)).toEqual([]);
    expect(Object.keys({ ...doc, ...app }).sort()).toEqual(Object.entries(w).filter(([, v]) => v !== undefined).map(([k]) => k).sort());
    expect(doc.plates).toEqual(["A", "B"]);
    expect((app as Record<string, unknown>).background).toBe("#123456");
  });
});

describe("a loaded file's application preferences are never applied", () => {
  const fileWorkspace = normalizeWorkspaceSettings({ units: "Imperial", accuracy: 3, plates: ["A", "B"], background: "#ff0000", mouseScheme: "slicer", zoomSpeed: 12, showShadows: false, lightAzimuth: 90 });

  it("keeps the document's keys from the file and takes every other key from the application", () => {
    const prefs = readAppPrefs(storage);
    const effective = effectiveWorkspace(fileWorkspace, prefs);
    expect(effective.units).toBe("Imperial");
    expect(effective.accuracy).toBe(3);
    expect(effective.plates).toEqual(["A", "B"]);
    expect(effective.background).toBe(D.background);
    expect(effective.mouseScheme).toBe("layerling");
    expect(effective.zoomSpeed).toBe(D.zoomSpeed);
    expect(effective.showShadows).toBe(true);
    expect(effective.lightAzimuth).toBe(D.lightAzimuth);
  });

  it("follows the application's own preferences, not the file's", () => {
    writeAppPrefs({ background: "#00ff00", mouseScheme: "slicer" }, storage);
    const effective = effectiveWorkspace(fileWorkspace, readAppPrefs(storage));
    expect(effective.background).toBe("#00ff00");
    expect(effective.mouseScheme).toBe("slicer");
    expect(effective.zoomSpeed).toBe(D.zoomSpeed); // the file's 12 never arrives
  });

  it("two documents with different embedded preferences open with identical application values and independent document values", () => {
    const a = effectiveWorkspace(normalizeWorkspaceSettings({ units: "Imperial", background: "#aa0000", mouseScheme: "slicer" }), readAppPrefs(storage));
    const b = effectiveWorkspace(normalizeWorkspaceSettings({ units: "Metric (Default)", background: "#0000bb", zoomSpeed: 3 }), readAppPrefs(storage));
    expect(splitWorkspace(a).app).toEqual(splitWorkspace(b).app);
    expect(a.units).toBe("Imperial");
    expect(b.units).toBe("Metric (Default)");
  });
});

describe("application preference store", () => {
  it("is seeded from the look saved earlier with Make Default, once, and then stays put", () => {
    storage.setItem(WORKSPACE_DEFAULT_STORAGE_KEY, JSON.stringify({ workspace: { background: "#112233", units: "Imperial" }, snap: "1.0 mm" }));
    const first = readAppPrefs(storage);
    expect((first as Record<string, unknown>).background).toBe("#112233");
    expect("units" in first).toBe(false);
    storage.setItem(WORKSPACE_DEFAULT_STORAGE_KEY, JSON.stringify({ workspace: { background: "#445566" }, snap: "1.0 mm" }));
    expect((readAppPrefs(storage) as Record<string, unknown>).background).toBe("#112233");
    expect(storage.getItem(APP_PREFS_STORAGE_KEY)).not.toBeNull();
  });

  it("a write reports exactly what changed, ignores document keys and never touches the saved default", () => {
    storage.setItem(WORKSPACE_DEFAULT_STORAGE_KEY, "{\"workspace\":{},\"snap\":\"1.0 mm\"}");
    const before = storage.getItem(WORKSPACE_DEFAULT_STORAGE_KEY);
    readAppPrefs(storage);
    expect(writeAppPrefs({ showGrid: false, units: "Imperial" } as never, storage)).toEqual(["showGrid"]);
    expect(writeAppPrefs({ showGrid: false }, storage)).toEqual([]);
    expect(readAppPrefs(storage).showGrid).toBe(false);
    expect("units" in readAppPrefs(storage)).toBe(false);
    expect(storage.getItem(WORKSPACE_DEFAULT_STORAGE_KEY)).toBe(before);
  });

  it("a damaged store falls back to application defaults, never to a document's values", () => {
    storage.setItem(APP_PREFS_STORAGE_KEY, "{not json");
    expect(readAppPrefs(storage).background).toBe(D.background);
  });
});

describe("application preferences never make a document modified", () => {
  const parts = (workspace: Record<string, unknown>) => ({
    entryFingerprint: "fp", attachments: "", workspace, snapGrid: "1.0 mm", placementElevation: 0, placementWorkplane: "", savedViews: "[]", cornerRulers: "[]", tape: "[]",
  });
  it("the signature ignores application keys and reacts to document keys", () => {
    const w = normalizeWorkspaceSettings({});
    const base = documentSignature(parts(documentSettingsView(w) as Record<string, unknown>));
    const appChanged = documentSignature(parts(documentSettingsView({ ...w, background: "#abcdef", mouseScheme: "slicer", showShadows: false }) as Record<string, unknown>));
    const docChanged = documentSignature(parts(documentSettingsView({ ...w, units: "Imperial" }) as Record<string, unknown>));
    expect(appChanged).toBe(base);
    expect(docChanged).not.toBe(base);
  });
  it("changedKeys separates the two owners", () => {
    const a = normalizeWorkspaceSettings({});
    const b = { ...a, units: "Imperial", background: "#010203" };
    expect(changedKeys(a, b, "doc")).toEqual(["units"]);
    expect(changedKeys(a, b, "app")).toEqual(["background"]);
  });
});
