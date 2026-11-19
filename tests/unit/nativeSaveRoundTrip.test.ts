import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { strFromU8, strToU8, unzipSync } from "fflate";
import manifoldModule, { type ManifoldToplevel } from "manifold-3d";
import { typefaceFromFontFile } from "@/lib/customFonts";
import { editorHistoryEntry } from "@/lib/editorHistory";
import { exportLylProject, importLylProject, type LylProjectDocumentV1 } from "@/lib/lylProject";
import { projectAssetFromBytes } from "@/lib/projectAssets";
import { projectAttachmentFromBytes } from "@/lib/projectAttachments";
import { loadTextFonts, registerCustomFont, resetCustomFontsForTests } from "@/lib/textFonts";
import { DEFAULT_SNAP_GRID, DEFAULT_WORKPLANE_WORKSPACE } from "@/lib/workplaneSettings";
import type { WorkplaneShape } from "@/types/layerling";

/*
 * What the native Save packages (step 5B): the editor's CURRENT state only (a single history entry), level 1, the document's own project id,
 * and the camera/saved views passed explicitly. A design with a font of its own, a picture and a text file attached, a source asset and
 * a derived mesh must come back from that package exactly as it went in, and nothing the editor holds may be changed by it.
 */

const modules = join(process.cwd(), "node_modules");
const notoPath = join(modules, "next/dist/compiled/@vercel/og/noto-sans-v27-latin-regular.ttf");
const fileBytes = (path: string) => {
  const buffer = readFileSync(path);
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
};
let runtime: ManifoldToplevel;
beforeAll(async () => {
  runtime = await manifoldModule();
  runtime.setup();
  await loadTextFonts();
});
beforeEach(() => resetCustomFontsForTests());

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const view = { orthographic: false, position: [10, 20, 30], target: [0, 0, 0], up: [0, 1, 0], zoom: 1.5 } as const;
const box = (id: string, x: number): WorkplaneShape => ({ id, name: "Box", kind: "box", color: "#123456", x, z: 0, size: 20, width: 20, depth: 20, height: 10, rotation: 0 });

async function build() {
  const typeface = await typefaceFromFontFile(fileBytes(notoPath), "noto.ttf", runtime);
  registerCustomFont(typeface, true);
  const text: WorkplaneShape = { id: "t", name: "Text", kind: "text", color: "#000", x: 0, z: 30, size: 40, width: 40, depth: 10, height: 3, rotation: 0, text: "Abc", font: typeface.id } as WorkplaneShape;
  const source = await projectAssetFromBytes("plate.svg", "svg", strToU8("svg source"));
  const mesh: WorkplaneShape = {
    id: "m", name: "Plate", kind: "mesh", color: "#abcdef", x: 50, z: 0, size: 10, width: 10, depth: 10, height: 10, rotation: 0,
    importedMesh: { positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], baseWidth: 1, baseDepth: 1, baseHeight: 1, triangleCount: 1, sourceFormat: "svg", assetId: source.id },
  } as WorkplaneShape;
  const picture = await projectAttachmentFromBytes("photo.png", PNG);
  const notes = await projectAttachmentFromBytes("notes.txt", strToU8("print at 0.2"));
  // Three states of history; the open editor is on the last one.
  const states = [[box("b", 0)], [box("b", 0), text], [box("b", 5), text, mesh]];
  const history = states.map((shapes) => editorHistoryEntry(shapes, []));
  return { shapes: states[2], history, assets: [source], attachments: [picture, notes], typeface };
}

/** What the native Save passes to exportLylProject (LayerlingEditor createPackage). */
function nativeInput(state: Awaited<ReturnType<typeof build>>, over: Record<string, unknown> = {}) {
  return {
    projectId: "project-original-id",
    projectName: "Design file name",
    createdAt: 1_700_000_000_000,
    modifiedAt: 1_700_000_100_000,
    shapes: state.shapes,
    history: [state.history[state.history.length - 1]],
    historyIndex: 0,
    assets: state.assets,
    attachments: state.attachments,
    workspace: DEFAULT_WORKPLANE_WORKSPACE,
    snapGrid: DEFAULT_SNAP_GRID,
    placementElevation: 0,
    compressionLevel: 1 as const,
    view: { ...view, position: [...view.position], target: [...view.target], up: [...view.up] },
    savedViews: [{ ...view, position: [1, 2, 3], target: [...view.target], up: [...view.up] }, null, null, null] as never,
    ...over,
  };
}
const read = (bytes: Uint8Array) => {
  const files = unzipSync(bytes);
  return { files, document: JSON.parse(strFromU8(files["project.json"])) as LylProjectDocumentV1 };
};

describe("a native save of the current state", () => {
  it("comes back the way it went in: scene, assets, attachments, font, camera, saved views, ids", async () => {
    const state = await build();
    const bytes = await exportLylProject(nativeInput(state));
    resetCustomFontsForTests();
    const restored = await importLylProject(bytes, { sourceImporter: async () => state.shapes[2].importedMesh! });
    // The scene as the editor holds it (canonical), with the source asset under the id the package gives it.
    const expected = JSON.parse(JSON.stringify(editorHistoryEntry(state.shapes, []).shapes).replace("\"assetId\":\"asset-", "\"assetId\":\"source-")) as WorkplaneShape[];
    expect(JSON.parse(JSON.stringify(restored.shapes))).toEqual(expected);
    expect(restored.shapes.map((shape) => shape.id)).toEqual(["b", "t", "m"]);
    expect(restored.attachments?.map((entry) => [entry.name, entry.sha256])).toEqual(state.attachments.map((entry) => [entry.name, entry.sha256]));
    expect(restored.assets.map((asset) => [asset.sha256, asset.name, asset.sourceFormat])).toEqual(state.assets.map((asset) => [asset.sha256, asset.name, asset.sourceFormat]));
    expect(restored.shapes[1].font).toBe(state.typeface.id);
    expect(restored.view).toMatchObject({ zoom: 1.5, position: [10, 20, 30] });
    expect(restored.savedViews?.[0]).toMatchObject({ position: [1, 2, 3] });
    expect(restored.sourceProjectId).toBe("project-original-id");
    expect(restored.projectName).toBe("Design file name");
    expect(restored.createdAt).toBe(1_700_000_000_000);
  });

  it("writes one history entry, one state, and embeds the font's letters", async () => {
    const state = await build();
    const { document } = read(await exportLylProject(nativeInput(state)));
    expect(document.states).toHaveLength(1);
    expect(document.history.entries).toHaveLength(1);
    expect(document.history.index).toBe(0);
    expect(document.history.entries[0].stateId).toBe(document.sceneStateId);
    expect(document.fonts).toHaveLength(1);
    expect(document.metadata.projectId).toBe("project-original-id");
    expect(document.editor.view).toMatchObject({ zoom: 1.5 });
  });

  it("is smaller than saving the whole history, which is why undo history is not saved", async () => {
    const state = await build();
    const current = await exportLylProject(nativeInput(state));
    const full = await exportLylProject(nativeInput(state, { history: state.history, historyIndex: state.history.length - 1 }));
    expect(read(full).document.states.length).toBeGreaterThan(1);
    expect(read(current).files["project.json"].byteLength).toBeLessThan(read(full).files["project.json"].byteLength);
  });

  it("does not change what the editor holds: the live history, shapes and assets are the same objects afterwards", async () => {
    const state = await build();
    const before = { history: [...state.history], shapes: [...state.shapes], assets: [...state.assets], fingerprints: state.history.map((entry) => entry.fingerprint) };
    await exportLylProject(nativeInput(state));
    expect(state.history).toHaveLength(3);
    expect(state.history.every((entry, index) => entry === before.history[index] && entry.fingerprint === before.fingerprints[index])).toBe(true);
    expect(state.shapes.every((shape, index) => shape === before.shapes[index])).toBe(true);
    expect(state.assets[0]).toBe(before.assets[0]);
  });

  it("is stable: saving what was opened again gives the same content (only the modified time may move)", async () => {
    const state = await build();
    const first = read(await exportLylProject(nativeInput(state)));
    resetCustomFontsForTests();
    const restored = await importLylProject(await exportLylProject(nativeInput(state)), { sourceImporter: async () => state.shapes[2].importedMesh! });
    const second = read(await exportLylProject(nativeInput(state, { shapes: restored.shapes, history: [editorHistoryEntry(restored.shapes, [])], assets: restored.assets, attachments: restored.attachments })));
    expect(second.document.states[0].nodes.length).toBe(first.document.states[0].nodes.length);
    expect(second.document.assets.map((asset) => asset.sha256)).toEqual(first.document.assets.map((asset) => asset.sha256));
    expect(Object.keys(second.files).sort()).toEqual(Object.keys(first.files).sort());
    expect(second.document.editor).toEqual(first.document.editor);
  });

  it("a thumbnail goes in as an extra file and does not disturb the document", async () => {
    const state = await build();
    const { files } = read(await exportLylProject(nativeInput(state, { extraFiles: { "thumbnail.png": PNG } })));
    expect(files["thumbnail.png"]).toBeDefined();
    const restored = await importLylProject(await exportLylProject(nativeInput(state, { extraFiles: { "thumbnail.png": PNG } })), { sourceImporter: async () => state.shapes[2].importedMesh! });
    expect(restored.shapes).toHaveLength(3);
  });
});
