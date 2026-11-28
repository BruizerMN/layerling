import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/* Build 0125: source-text checks that the on-load offer is wired where it must be, and only there. */
const root = path.resolve(__dirname, "../../../");
const editor = readFileSync(path.join(root, "apps/web/src/components/LayerlingEditor.tsx"), "utf8");
const nativeUi = readFileSync(path.join(root, "apps/web/src/lib/host/nativeUi.ts"), "utf8");
const scheduler = readFileSync(path.join(root, "apps/web/src/lib/meshRepairOffer.ts"), "utf8");
const from = editor.indexOf("// ---- Build 0125");
const block = editor.slice(from, editor.indexOf("const executeMcpCommand = useCallback", from));

describe("on-load mesh repair offer wiring", () => {
  it("starts only after the host was told the document is open", () => {
    const ready = editor.slice(editor.indexOf("onNativeDocumentReady();"), editor.indexOf("const timer = window.setTimeout(finish, 2000);"));
    expect(ready).toContain("startMeshOfferRef.current?.()");
    expect(ready.indexOf("onNativeDocumentReady();")).toBeLessThan(ready.indexOf("startMeshOfferRef.current"));
    expect((editor.match(/startMeshOfferRef\.current\?\.\(\)/g) ?? []).length).toBe(1);
  });
  it("is native-only and for documents opened from a file only; the browser edition has no scan", () => {
    expect(block).toContain("nativeDocument.fileName !== null");
    expect(block).toMatch(/if \(!opensFromFile\) return;/);
    expect(editor.slice(editor.indexOf("const startMeshOfferRef"), editor.indexOf("const startMeshOfferRef") + 200)).not.toContain("window.confirm");
    expect(block).not.toContain("window.confirm");
  });
  it("scans with the very same read-only scan as the command (apply = false) and keeps only counts", () => {
    expect(block).toContain("repairOpenMeshes(false)");
    expect(block).not.toContain("commitShapes(");
    expect(block).not.toContain("applyMeshRepairs");
    expect(block).toContain("meshes: outcome.report.repairableMeshes, objects: outcome.report.objects");
  });
  it("busy means: the 0124 refusals (group session, History view, drag, repair running) and Sketch mode; the check is deferred, never dropped", () => {
    expect(block).toContain("meshRepairRefusal() !== null || toolbarModeRef.current === \"sketch\"");
    expect(scheduler).toContain("later(retryMs)");
  });
  it("asks the host through the existing confirmation with source \"load\"", () => {
    expect(block).toContain('requestHostAction("confirmMeshRepair", { meshes, objects, source: "load"');
    expect(nativeUi).toContain('source?: "command" | "load"');
    // The explicit command is unchanged: it sends no source.
    const command = editor.slice(editor.indexOf("const startRepairOpenMeshes"), editor.indexOf("// ---- Build 0125"));
    expect(command).toContain('requestHostAction("confirmMeshRepair", { meshes: report.repairableMeshes, objects: report.objects })');
  });
  it("the scheduler dies with the document (abort in the effect cleanup) and uses only setTimeout-style ports", () => {
    expect(block).toContain("scheduler.abort()");
    expect(block).toContain("window.setTimeout(run, ms)");
    expect(scheduler).not.toMatch(/requestIdleCallback|MutationObserver|addEventListener/);   // no new idle-detection infrastructure
  });
});
