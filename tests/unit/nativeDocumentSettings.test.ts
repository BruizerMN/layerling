// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_WORKPLANE_WORKSPACE } from "../../apps/web/src/lib/workplaneSettings";
import { splitWorkspace } from "../../apps/web/src/lib/settingsScope";
import { DOC_SETTINGS_CATEGORIES, actOnDocumentSettings, describeDocumentSettings, type DocSettingsContext } from "../../apps/web/src/lib/host/nativeDocumentSettings";

const doc = splitWorkspace(DEFAULT_WORKPLANE_WORKSPACE).doc as Record<string, unknown>;
const ctx = (overrides: Partial<DocSettingsContext> = {}): DocSettingsContext => ({ workspace: doc, snap: "1.0 mm", hasStartView: false, ...overrides });

describe("native Document Settings engine (Build 0083)", () => {
  beforeEach(() => window.localStorage.clear());

  it("describes every category without writing anything", () => {
    for (const category of DOC_SETTINGS_CATEGORIES) {
      const rows = describeDocumentSettings(category, ctx());
      expect(rows.length, category).toBeGreaterThan(0);
      expect(rows.every((row) => typeof row.k === "string")).toBe(true);
    }
    expect(window.localStorage.length).toBe(0);
  });

  it("shows conditional controls: inch format only for Imperial, grid-major only for metric", () => {
    const metric = describeDocumentSettings("measurement", ctx()).map((row) => row.id);
    expect(metric).not.toContain("inchFormat");
    const imperial = act({ id: "units", value: "Imperial" });
    const rows = describeDocumentSettings("measurement", ctx({ workspace: imperial.workspace, snap: imperial.snap ?? "1.0 mm" })).map((row) => row.id);
    expect(rows).toContain("inchFormat");
    expect(describeDocumentSettings("workplane", ctx({ workspace: imperial.workspace })).map((row) => row.id)).not.toContain("gridMajor");
  });

  it("switching units also moves the snap step, as the web window does", () => {
    const result = act({ id: "units", value: "Imperial" });
    expect(result.workspace?.units).toBe("Imperial");
    expect(result.snap).toBeDefined();
    expect(result.snap).not.toBe("1.0 mm");
  });

  it("a printer sets its plate; a hand-typed size forgets the printer", () => {
    const rows = describeDocumentSettings("printer", ctx());
    const printers = (rows[0].options as Array<{ value: string }>).filter((option) => option.value);
    expect(printers.length).toBeGreaterThan(10);
    const chosen = act({ id: "printer", value: printers[0].value });
    expect(chosen.workspace?.printer).toBe(printers[0].value);
    const typed = act({ id: "width", value: "321" }, ctx({ workspace: chosen.workspace }));
    expect(typed.workspace?.width).toBe(321);
    expect(typed.workspace?.printer).toBe("");
  });

  it("custom snap grids: add, rename, resize and remove", () => {
    const added = act({ id: "grids", op: "add" });
    expect(added.workspace?.customSnapGrids).toEqual([{ name: "", size: 10 }]);
    const next = ctx({ workspace: added.workspace });
    expect((act({ id: "grids", op: "size", index: 0, value: "12,5" }, next).workspace?.customSnapGrids as Array<{ size: number }>)[0].size).toBe(12.5);
    expect((act({ id: "grids", op: "name", index: 0, value: "Pitch" }, next).workspace?.customSnapGrids as Array<{ name: string }>)[0].name).toBe("Pitch");
    expect(act({ id: "grids", op: "remove", index: 0 }, next).workspace?.customSnapGrids).toEqual([]);
  });

  it("history: presets, unlimited and a clamped custom value", () => {
    expect(act({ id: "historyLimit", value: "50" }).workspace?.historyLimit).toBe(50);
    expect(act({ id: "historyLimit", value: "unlimited" }).workspace?.historyLimit).toBe("unlimited");
    expect(act({ id: "historyLimit", value: "99999" }).workspace?.historyLimit).toBe(5000);
    const row = describeDocumentSettings("history", ctx())[0];
    expect(row.k).toBe("history");
    expect(String(row.warning)).toMatch(/discard/i);
  });

  it("shape defaults: edit a dimension, then use the standard defaults again", () => {
    const withBox = act({ id: "shapeDim", key: "width", value: "42" }, ctx({ shape: "box" }));
    expect((withBox.workspace?.shapeCustomizations as Record<string, { width: number }>).box.width).toBe(42);
    const reset = act({ id: "shapeReset" }, ctx({ shape: "box", workspace: withBox.workspace }));
    expect((reset.workspace?.shapeCustomizations as Record<string, unknown>).box).toBeUndefined();
    const rows = describeDocumentSettings("shapes", ctx({ shape: "box" }));
    expect(rows[0].id).toBe("shape");
    expect(rows.some((row) => row.k === "group")).toBe(true);
  });

  it("Make default stores what Use my default later puts on a document", () => {
    act({ id: "makeDefault" });
    const stored = window.localStorage.getItem("layerling.workspaceDefault.global");
    expect(stored).toBeTruthy();
    const used = act({ id: "useMyDefault" });
    expect(used.workspace).toBeDefined();
  });

  it("returns host commands for start view and fit test", () => {
    expect(act({ id: "startView.save" }).command).toBe("settings.saveStartView");
    expect(act({ id: "makeFitTest" }).command).toBe("settings.makeFitTest");
  });

  function act(action: Parameters<typeof actOnDocumentSettings>[1], context: DocSettingsContext = ctx()) {
    return actOnDocumentSettings(context, action);
  }
});
