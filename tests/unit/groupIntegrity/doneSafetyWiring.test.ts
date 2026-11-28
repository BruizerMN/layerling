import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { OBJECTS_OPS } from "@/lib/host/hostProtocol";

/*
 * Build 0122: source-text checks (precedent: viewBarSuppression.test.ts) that the Done safety pieces are wired where the editor needs them; the behaviour of the
 * pieces themselves is tested in historyFrames, sessionRestore and groupFinish. The interactive flows are in docs/BUILD-0122.md.
 */
const editor = readFileSync(path.resolve(__dirname, "../../../apps/web/src/components/LayerlingEditor.tsx"), "utf8");
const objects = readFileSync(path.resolve(__dirname, "../../../apps/web/src/lib/host/nativeObjects.ts"), "utf8");

describe("Done safety wiring", () => {
  it("an unchanged session is restored, not rebuilt, in the native app only", () => {
    expect(editor).toMatch(/if \(nativeDocument && openSessionUnchanged\(session\)\) return restoreOriginalSession\(/);
    expect(editor).toMatch(/levels\.length === 1 && endGroupSession\("restore", session\.original\.id\)/);
  });
  it("Done reconstructs strictly in the native app and as before in the browser", () => {
    expect(editor).toContain("rebuildGroupFromParts(original, parts, Boolean(nativeDocument), session.openedParts)");
    expect(editor).toContain("strict = false");
  });
  it("Cancel from the button and the Objects Sidebar asks the host when changes would be discarded; the confirmed op cancels", () => {
    expect(editor).toContain('requestHostAction("confirmCancelGroupEditing")');
    expect(editor).toContain('onClick={() => requestCancelOpenGroup()}');
    // Build 0132: the confirmation answers either the whole-session question (the Context Bar) or the one-level question (a row's Cancel)
    expect(editor).toContain('command.op === "cancelGroupConfirmed") {');
    expect(editor).toContain("if (wholeCancelPendingRef.current) { wholeCancelPendingRef.current = false; cancelWholeSession(); } else cancelOpenGroup();");
    expect(OBJECTS_OPS).toContain("cancelGroupConfirmed");
    expect(objects).toContain('case "cancelGroupConfirmed"');
  });
  it("MCP still cancels without asking", () => {
    expect(editor).toContain('params.cancel === true ? cancelOpenGroup() : await finishOpenGroup()');
  });
});
