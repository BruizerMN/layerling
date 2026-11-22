import { describe, expect, it } from "vitest";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { editorHistoryEntry } from "@/lib/editorHistory";
import {
  exportLylProject,
  importLylProject,
  inspectLylProjectPackage,
  LYL_ATTACHMENTS_FORMAT_VERSION,
  LYL_FILE_TYPES_FORMAT_VERSION,
  LYL_FORMAT_VERSION,
  LYL_MINIMUM_READER_VERSION,
  LYL_NEWEST_READABLE_FORMAT_VERSION,
  LYL_VISUAL_GROUPS_FORMAT_VERSION,
  type LylProjectDocumentV1,
} from "@/lib/lylProject";
import { projectAttachmentFromBytes } from "@/lib/projectAttachments";
import {
  EMPTY_VISUAL_GROUPS,
  createVisualGroup,
  deleteVisualGroup,
  descendantObjectIds,
  findVisualGroup,
  moveObjectsToGroup,
  type VisualGroupsRegistry,
} from "@/lib/visualGroups";
import { DEFAULT_SNAP_GRID, DEFAULT_WORKPLANE_WORKSPACE } from "@/lib/workplaneSettings";
import type { ProjectAttachment, WorkplaneShape } from "@/types/layerling";

/*
 * Visual Groups in the `.lyl` package: a design with a group is a version 5 file that an older layerling refuses, a design
 * without any is written exactly as before, and what comes back is what went in.
 */

const box = (id: string, hidden?: boolean): WorkplaneShape => ({ id, name: id, kind: "box", color: "#123456", x: 0, z: 0, size: 20, width: 20, depth: 20, height: 10, rotation: 0, ...(hidden ? { hidden } : {}) });
const SHAPES = [box("a"), box("b"), box("c", true), box("d")];

function groups(): VisualGroupsRegistry {
  let r = createVisualGroup(EMPTY_VISUAL_GROUPS, { id: "ped", name: "Pedestal" }).registry;
  r = moveObjectsToGroup(r, ["a", "b"], "ped");
  r = createVisualGroup(r, { id: "cor", name: "Cornice", parentId: "ped" }).registry;
  r = moveObjectsToGroup(r, ["c"], "cor");
  r = createVisualGroup(r, { id: "empty", name: "Nothing yet" }).registry;
  return r;
}

async function design(options: { visualGroups?: VisualGroupsRegistry; attachments?: ProjectAttachment[]; shapes?: WorkplaneShape[] } = {}) {
  const shapes = options.shapes ?? SHAPES;
  return exportLylProject({
    projectId: "design-1",
    projectName: "Groups",
    createdAt: 1_700_000_000_000,
    modifiedAt: 1_700_000_100_000,
    shapes,
    history: [editorHistoryEntry(shapes, [])],
    historyIndex: 0,
    assets: [],
    workspace: DEFAULT_WORKPLANE_WORKSPACE,
    snapGrid: DEFAULT_SNAP_GRID,
    placementElevation: 0,
    ...(options.attachments ? { attachments: options.attachments } : {}),
    ...(options.visualGroups ? { visualGroups: options.visualGroups } : {}),
  });
}

function read(bytes: Uint8Array) {
  const files = unzipSync(bytes);
  return { files, text: strFromU8(files["project.json"]), document: JSON.parse(strFromU8(files["project.json"])) as LylProjectDocumentV1 };
}

function mutate(bytes: Uint8Array, change: (document: Record<string, unknown>) => void) {
  const { files, document } = read(bytes);
  change(document as unknown as Record<string, unknown>);
  files["project.json"] = strToU8(JSON.stringify(document));
  return zipSync(files);
}

describe("Visual Groups in a .lyl package", () => {
  it("brings back the groups, their nesting, order and members", async () => {
    const restored = await importLylProject(await design({ visualGroups: groups() }));
    expect(restored.visualGroups).toEqual(groups());
    expect(findVisualGroup(restored.visualGroups!, "cor")?.name).toBe("Cornice");
    expect(descendantObjectIds(restored.visualGroups!, "ped")).toEqual(["a", "b", "c"]);
    expect(findVisualGroup(restored.visualGroups!, "empty")).not.toBeNull(); // empty groups are kept
  });

  it("keeps group ids stable through saving and opening again", async () => {
    const first = await importLylProject(await design({ visualGroups: groups() }));
    const second = await importLylProject(await design({ visualGroups: first.visualGroups }));
    expect(second.visualGroups).toEqual(first.visualGroups);
  });

  it("does not touch the objects: their hidden flags and everything else are as without groups", async () => {
    const withGroups = await importLylProject(await design({ visualGroups: groups() }));
    const without = await importLylProject(await design());
    expect(withGroups.shapes).toEqual(without.shapes);
    expect(withGroups.shapes.find((s) => s.id === "c")?.hidden).toBe(true);
    expect(JSON.stringify(read(await design({ visualGroups: groups() })).document.states)).toBe(JSON.stringify(read(await design()).document.states));
  });

  it("writes a design with groups as version 5, which an older layerling refuses", async () => {
    const { document } = read(await design({ visualGroups: groups() }));
    expect(document.formatVersion).toBe(LYL_VISUAL_GROUPS_FORMAT_VERSION);
    expect(document.minimumReaderVersion).toBe(LYL_VISUAL_GROUPS_FORMAT_VERSION);
    expect(LYL_VISUAL_GROUPS_FORMAT_VERSION).toBeGreaterThan(LYL_FILE_TYPES_FORMAT_VERSION);
    expect(LYL_NEWEST_READABLE_FORMAT_VERSION).toBe(LYL_VISUAL_GROUPS_FORMAT_VERSION);
    expect((await inspectLylProjectPackage(await design({ visualGroups: groups() }))).formatVersion).toBe(LYL_VISUAL_GROUPS_FORMAT_VERSION);
  });

  it("writes a design without groups exactly as before: version 2, no field, identical project.json", async () => {
    const baseline = read(await design());
    for (const variant of [await design({ visualGroups: EMPTY_VISUAL_GROUPS }), await design({ visualGroups: { items: [] } })]) {
      const { document, text } = read(variant);
      expect(document.formatVersion).toBe(LYL_FORMAT_VERSION);
      expect(document.minimumReaderVersion).toBe(LYL_MINIMUM_READER_VERSION);
      expect("visualGroups" in document).toBe(false);
      expect(text).toBe(baseline.text);
      expect((await importLylProject(variant)).visualGroups).toBeUndefined();
    }
    expect(baseline.document.formatVersion).toBe(2);
  });

  it("goes back to version 2 when the last group is deleted", async () => {
    let r = groups();
    for (const id of ["cor", "empty", "ped"]) r = deleteVisualGroup(r, id);
    expect(r.items).toEqual([]);
    expect(read(await design({ visualGroups: r })).document.formatVersion).toBe(LYL_FORMAT_VERSION);
  });

  it("is version 5 when it also has files (the highest version any feature needs)", async () => {
    const attachments = [await projectAttachmentFromBytes("Assembly.md", new TextEncoder().encode("# hi"))];
    const { document } = read(await design({ visualGroups: groups(), attachments }));
    expect(document.formatVersion).toBe(LYL_VISUAL_GROUPS_FORMAT_VERSION);
    expect(read(await design({ attachments })).document.formatVersion).toBe(LYL_ATTACHMENTS_FORMAT_VERSION);
    const restored = await importLylProject(await design({ visualGroups: groups(), attachments }));
    expect(restored.attachments).toHaveLength(1);
    expect(restored.visualGroups).toEqual(groups());
  });

  it("leaves out objects that are not in the saved scene, and keeps the groups", async () => {
    const r = moveObjectsToGroup(groups(), ["gone", "d"], "empty");
    const restored = await importLylProject(await design({ visualGroups: r }));
    expect(descendantObjectIds(restored.visualGroups!, "empty")).toEqual(["d"]);
    const none = await importLylProject(await design({ visualGroups: groups(), shapes: [box("zzz")] }));
    expect(none.visualGroups?.items.map((g) => g.id)).toEqual(["ped", "empty"]);
    expect(descendantObjectIds(none.visualGroups!, "ped")).toEqual([]);
  });

  it("opens a file whose groups are damaged, healing what it can", async () => {
    const bytes = mutate(await design({ visualGroups: groups() }), (document) => {
      document.visualGroups = { items: [{ id: "g", name: "  Kept ", items: [{ object: "a" }, { object: "a" }, 5, { id: "g", name: "dup", items: [] }] }, "junk", { id: "g", name: "again", items: [] }] };
    });
    const restored = await importLylProject(bytes);
    expect(restored.visualGroups).toEqual({ items: [{ id: "g", name: "Kept", items: [{ object: "a" }] }] });
    for (const junk of ["text", 5, [], { items: "no" }, null]) {
      const opened = await importLylProject(mutate(await design({ visualGroups: groups() }), (document) => { document.visualGroups = junk; }));
      expect(opened.visualGroups).toBeUndefined();
      expect(opened.shapes).toHaveLength(SHAPES.length);
    }
  });

  it("refuses a package newer than this layerling reads, as before", async () => {
    const bytes = mutate(await design({ visualGroups: groups() }), (document) => {
      document.formatVersion = LYL_NEWEST_READABLE_FORMAT_VERSION + 1;
      document.minimumReaderVersion = LYL_NEWEST_READABLE_FORMAT_VERSION + 1;
    });
    await expect(importLylProject(bytes)).rejects.toThrow(/requires a newer layerling/);
  });
});
