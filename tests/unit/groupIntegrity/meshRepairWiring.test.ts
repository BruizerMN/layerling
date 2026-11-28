import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { UI_COMMANDS } from "@/lib/host/hostProtocol";

/*
 * Build 0124: source-text checks that the repair command is wired where it must be (the interactive flows are in docs/BUILD-0124.md in the native repo).
 */
const root = path.resolve(__dirname, "../../../");
const editor = readFileSync(path.join(root, "apps/web/src/components/LayerlingEditor.tsx"), "utf8");
const toolbar = readFileSync(path.join(root, "apps/web/src/components/workplane/SecondaryToolbar.tsx"), "utf8");
const nativeUi = readFileSync(path.join(root, "apps/web/src/lib/host/nativeUi.ts"), "utf8");
const tools = readFileSync(path.join(root, "scripts/layerling-mcp-tools.mjs"), "utf8");
const server = readFileSync(path.join(root, "scripts/layerling-mcp-server.mjs"), "utf8");

describe("Repair Open Meshes wiring", () => {
  it("refuses in a group session, in the History view, during an action and while busy, like any change to the design", () => {
    const refusal = editor.slice(editor.indexOf("const meshRepairRefusal"), editor.indexOf("type MeshRepairReport"));
    for (const needle of ["groupSessionRef.current", "openGroupsRef.current.length", "historyViewStateRef.current", "projectInteractionActiveRef.current", "openGroupBusyRef.current", "meshRepairBusyRef.current"]) expect(refusal).toContain(needle);
  });
  it("the scan is read-only; the repair is one commit, of the scene the scan saw, after a fresh scan", () => {
    const body = editor.slice(editor.indexOf("const repairOpenMeshes = useCallback"), editor.indexOf("const meshRepairNothingMessage"));
    expect((body.match(/commitShapes\(/g) ?? []).length).toBe(1);
    expect(body).toContain("if (!apply || scan.repairs.size === 0) return { ok: true, report };");
    expect(body).toContain("shapesRef.current !== source");
    expect(body).toContain("createKernelMeshCheck");
  });
  it("the document is always the scope, never the selection", () => {
    const body = editor.slice(editor.indexOf("const repairOpenMeshes = useCallback"), editor.indexOf("const meshRepairNothingMessage"));
    expect(body).toContain("scanForOpenMeshes(source,");
    expect(body).not.toMatch(/selectedIds(?!Ref)/);
  });
  it("the interactive command asks first (the host natively, the browser with a confirm) and reports quietly", () => {
    const from = editor.indexOf("const startRepairOpenMeshes");
    const start = editor.slice(from, editor.indexOf("const executeMcpCommand = useCallback", from));
    expect(start).toContain('requestHostAction("confirmMeshRepair"');
    expect(start).toContain("window.confirm(");
    const confirmed = editor.slice(editor.indexOf("const confirmedRepairOpenMeshes"), editor.indexOf("const startRepairOpenMeshes"));
    expect(confirmed).toMatch(/false, null, true\)/);
  });
  it("the host's two commands are known and reach the editor; the command is not offered in Sketch mode or the History view", () => {
    expect(UI_COMMANDS).toContain("repair.openMeshes");
    expect(UI_COMMANDS).toContain("meshRepair.confirmed");
    expect(toolbar).toContain('case "repair.openMeshes": if (toolbarMode !== "sketch" && !historyViewActive) onRepairOpenMeshes?.()');
    expect(toolbar).toContain('case "meshRepair.confirmed"');
    expect(toolbar).toContain('plain("repair-open-meshes"');
    expect(nativeUi).toContain('"confirmMeshRepair"');
  });
  it("MCP: dry run is the default and read-only; a repair needs confirm: true and is not a dry run", () => {
    expect(editor).toContain('const apply = params.confirm === true && params.dryRun !== true;');
    expect(tools).toContain('name: "layerling_repair_open_meshes"');
    expect(server).toContain('bridgeCommand("repair_open_meshes", args)');
  });
});
