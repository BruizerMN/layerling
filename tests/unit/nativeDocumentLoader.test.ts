import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readCornerRulers } from "@/lib/cornerRulerStore";
import { readDesignView, readSavedViews } from "@/lib/designView";
import { DocumentTransferError } from "@/lib/host/documentTransfer";
import type { FileDocumentDescriptor } from "@/lib/host/hostDocument";
import { classifyOpenError, loadNativeDocument } from "@/lib/host/nativeDocumentLoader";
import { isTransientProjectId, projectStorage, transientProjectId } from "@/lib/host/transientProject";
import type { LylRestoredProject } from "@/lib/lylProject";

const written: string[] = [];
const storage = new Map<string, string>();

beforeEach(() => {
  written.length = 0;
  storage.clear();
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        written.push(key);
        storage.set(key, value);
      },
      removeItem: (key: string) => void storage.delete(key),
    },
  });
  // Any use of IndexedDB by the native open path is a bug: make it loud.
  vi.stubGlobal("indexedDB", new Proxy({}, { get: () => { throw new Error("indexedDB must not be used for a native document"); } }));
});
afterEach(() => vi.unstubAllGlobals());

const file: FileDocumentDescriptor = { kind: "file", documentId: "d0c00002-aaaa-4bbb-8ccc-000000000002", fileName: "Foshay.lyl", byteLength: 4, modifiedAt: 1, url: "layerling://app/__host__/doc/AbCdEfGhIjKlMnOpQrStUvWxYz012345" };
const view = { orthographic: false, position: [1, 2, 3], target: [0, 0, 0], up: [0, 1, 0], zoom: 2 } as const;

function restored(over: Partial<LylRestoredProject> = {}): LylRestoredProject {
  const shape = { id: "s1" } as never;
  return {
    sourceProjectId: "project-original-id",
    projectName: "Foshay",
    createdAt: 100,
    modifiedAt: 200,
    shapes: [shape, { id: "s2" } as never],
    history: [{ shapes: [shape] } as never, { shapes: [shape, { id: "s2" }] } as never],
    historyIndex: 1,
    assets: [],
    workspace: {} as never,
    snapGrid: "1.0 mm",
    placementElevation: 0,
    placementWorkplane: {} as never,
    sketchPlacementWorkplane: {} as never,
    view: { ...view, position: [...view.position], target: [...view.target], up: [...view.up] },
    savedViews: { 7: { ...view, position: [...view.position], target: [...view.target], up: [...view.up] } } as never,
    ...over,
  };
}

describe("a file document", () => {
  it("uses the existing parser and relief, keeps identities apart, reports the relief", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const calls: string[] = [];
    const state = await loadNativeDocument(file, {
      fetchBytes: async () => (calls.push("fetch"), bytes),
      importLyl: async (b) => (calls.push("import"), expect(b).toBe(bytes), restored()),
      relieve: async (project) => (calls.push("relieve"), { project, relieved: 3 }),
    });
    expect(calls).toEqual(["fetch", "import", "relieve"]);
    expect(state.meshRelief).toEqual({ bodies: 3 });
    expect(state.stats).toEqual({ rootObjects: 2, historyStates: 2 });
    expect(state.documentProjectId).toBe("project-original-id");
    expect(state.runtimeProjectId).toBe(transientProjectId(file.documentId));
    expect(isTransientProjectId(state.runtimeProjectId)).toBe(true);
    expect(new Set([state.documentProjectId, state.runtimeProjectId, file.documentId]).size).toBe(3);
    expect(state.shapes).toHaveLength(2);
    expect(state.historyIndex).toBe(1);
  });
  it("keeps the camera, saved views and framing squares in memory, not in localStorage", async () => {
    const state = await loadNativeDocument(file, { fetchBytes: async () => new Uint8Array(4), importLyl: async () => restored(), relieve: async (project) => ({ project, relieved: 0 }) });
    expect(readDesignView(state.runtimeProjectId)).toMatchObject({ zoom: 2 });
    expect(readSavedViews(state.runtimeProjectId)).not.toBeNull();
    expect(written.filter((key) => key.includes("native-doc"))).toEqual([]);
    expect(written.filter((key) => key.startsWith("layerling.projects"))).toEqual([]);
    expect([...storage.keys()].some((key) => key.includes("native-doc"))).toBe(false);
  });
  it("leaves ordinary project ids on localStorage as before", () => {
    expect(projectStorage("project-123")).toBe(window.localStorage);
    expect(projectStorage(transientProjectId("abc"))).not.toBe(window.localStorage);
  });
  it("reports phases and stops when cancelled", async () => {
    const phases: string[] = [];
    const controller = new AbortController();
    const result = loadNativeDocument(
      file,
      { fetchBytes: async () => new Uint8Array(4), importLyl: async () => (controller.abort(), restored()), relieve: async (project) => ({ project, relieved: 0 }) },
      { signal: controller.signal, onPhase: (phase) => phases.push(phase) },
    );
    await expect(result).rejects.toMatchObject({ name: "AbortError" });
    expect(phases).toEqual(["unpack", "build"]);
  });
  it("lets a parser error through for the host to be told", async () => {
    await expect(loadNativeDocument(file, { fetchBytes: async () => new Uint8Array(4), importLyl: async () => { throw new Error("This file is not a layerling project"); }, relieve: async (project) => ({ project, relieved: 0 }) })).rejects.toThrow("not a layerling project");
  });
});

describe("a new document", () => {
  it("is an empty design with the browser's new-design defaults and never touches the parser, the transfer or storage records", async () => {
    let touched = false;
    const state = await loadNativeDocument(
      { kind: "new", documentId: "d0c00001-aaaa-4bbb-8ccc-000000000001", displayName: "Untitled" },
      { importLyl: async () => ((touched = true), restored()), relieve: async (p) => ((touched = true), { project: p, relieved: 0 }), fetchBytes: async () => ((touched = true), new Uint8Array()), createId: () => "fresh-project-id" },
    );
    expect(touched).toBe(false);
    expect(state).toMatchObject({ projectName: "Untitled", shapes: [], assets: [], placementElevation: 0, documentProjectId: "fresh-project-id", meshRelief: { bodies: 0 } });
    expect(state.runtimeProjectId).toBe(transientProjectId("d0c00001-aaaa-4bbb-8ccc-000000000001"));
    expect(written.filter((key) => key.includes("native-doc"))).toEqual([]);
    expect(readCornerRulers(state.runtimeProjectId)).toBeDefined();
  });
  it("two new documents are independent: different runtime ids", async () => {
    const make = (id: string) => loadNativeDocument({ kind: "new", documentId: id, displayName: "Untitled" }, { importLyl: async () => restored(), relieve: async (p) => ({ project: p, relieved: 0 }) });
    const [a, b] = await Promise.all([make("d0c00001-aaaa-4bbb-8ccc-000000000001"), make("d0c00001-aaaa-4bbb-8ccc-000000000009")]);
    expect(a.runtimeProjectId).not.toBe(b.runtimeProjectId);
    expect(a.documentProjectId).not.toBe(b.documentProjectId);
  });
});

describe("classifyOpenError", () => {
  it("maps what went wrong to the code the host is told", () => {
    expect(classifyOpenError(new DOMException("x", "AbortError"))).toBe("cancelled");
    expect(classifyOpenError(new DocumentTransferError("x"))).toBe("transfer-failed");
    expect(classifyOpenError(new RangeError("Array buffer allocation failed"))).toBe("out-of-memory");
    expect(classifyOpenError(new Error("This design was saved with layerling 9.0.0, newer than this layerling 1.165.2"))).toBe("unsupported-version");
    expect(classifyOpenError(new Error("Project is malformed"))).toBe("invalid-package");
  });
});

describe("the native open path stays out of the browser library", () => {
  const root = path.resolve(__dirname, "../../apps/web/src");
  const files = ["components/NativeDocumentShell.tsx", "lib/host/nativeDocumentLoader.ts", "lib/host/documentTransfer.ts", "lib/host/hostDocument.ts", "lib/host/transientProject.ts"];
  const forbidden = [/indexedDB/i, /PROJECT_SHAPES/, /saveProjectShapes/, /loadProjectShapes/, /PROJECTS_STORAGE_KEY/, /layerling\.projects/, /exportLylProject/, /projectShapeCacheEntry/, /saveDesignThumbnail/, /from "@\/app\/page"/, /openProjectShapesDb/];
  for (const file of files) {
    it(`${file} has no library calls`, () => {
      const source = readFileSync(path.join(root, file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      for (const pattern of forbidden) expect(source, String(pattern)).not.toMatch(pattern);
    });
  }
});
