import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FileDocumentDescriptor, NewDocumentDescriptor } from "@/lib/host/hostDocument";
import { loadNativeDocument } from "@/lib/host/nativeDocumentLoader";
import type { LylRestoredProject } from "@/lib/lylProject";
import { DEFAULT_WORKPLANE_WORKSPACE, normalizeWorkspaceSettings } from "@/lib/workplaneSettings";

const storage = new Map<string, string>();
beforeEach(() => {
  storage.clear();
  vi.stubGlobal("window", { localStorage: { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => void storage.set(k, v), removeItem: (k: string) => void storage.delete(k) } });
});
afterEach(() => vi.unstubAllGlobals());

const file: FileDocumentDescriptor = { kind: "file", documentId: "d0c00002-aaaa-4bbb-8ccc-000000000002", fileName: "Someone else's model.lyl", byteLength: 4, modifiedAt: 1, url: "layerling://app/__host__/doc/x" } as never;
const fresh = { kind: "new", documentId: "d0c00003-aaaa-4bbb-8ccc-000000000003", displayName: "Untitled" } as unknown as NewDocumentDescriptor;
const appPrefs = () => ({ background: "#101010", mouseScheme: "slicer" as const, zoomSpeed: 9, showShadows: false });

function restored(workspace: Record<string, unknown>): LylRestoredProject {
  return {
    sourceProjectId: "p", projectName: "Model", createdAt: 1, modifiedAt: 2, shapes: [], history: [{ shapes: [] } as never], historyIndex: 0, assets: [],
    workspace: normalizeWorkspaceSettings(workspace), snapGrid: "1.0 mm", placementElevation: 0, placementWorkplane: {} as never, sketchPlacementWorkplane: {} as never,
  } as unknown as LylRestoredProject;
}
const deps = (workspace: Record<string, unknown>) => ({
  importLyl: async () => restored(workspace),
  relieve: async (project: LylRestoredProject) => ({ project, relieved: 0 }),
  fetchBytes: async () => new Uint8Array(4),
  appPrefs,
});

describe("opening someone else's model", () => {
  it("keeps its document settings and ignores its embedded application preferences, before the editor sees anything", async () => {
    const state = await loadNativeDocument(file, deps({ units: "Imperial", accuracy: 3, plates: ["A"], background: "#ff00ff", mouseScheme: "layerling", zoomSpeed: 2, showShadows: true }));
    expect(state.workspace.units).toBe("Imperial");
    expect(state.workspace.accuracy).toBe(3);
    expect(state.workspace.plates).toEqual(["A"]);
    expect(state.workspace.background).toBe("#101010");
    expect(state.workspace.mouseScheme).toBe("slicer");
    expect(state.workspace.zoomSpeed).toBe(9);
    expect(state.workspace.showShadows).toBe(false);
  });
  it("a new document starts from the new-document defaults for its own settings and the application's preferences for the rest", async () => {
    storage.set("layerling.workspaceDefault.global", JSON.stringify({ workspace: { units: "Imperial", background: "#abcdef" }, snap: "1.0 mm" }));
    const state = await loadNativeDocument(fresh, deps({}));
    expect(state.workspace.units).toBe("Imperial");
    expect(state.workspace.background).toBe("#101010");
    const none = await loadNativeDocument(fresh, { ...deps({}), appPrefs: () => ({}) });
    storage.clear();
    expect(none.workspace.accuracy).toBe(normalizeWorkspaceSettings(DEFAULT_WORKPLANE_WORKSPACE).accuracy);
  });
});
