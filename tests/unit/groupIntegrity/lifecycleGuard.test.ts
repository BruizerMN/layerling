import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GROUP_EDITING_TITLE, groupEditingMessage } from "@/lib/groupEditingMessages";
import { SAVE_FAILURE_CODES } from "@/lib/host/hostProtocol";

/*
 * Build 0121: an open group is an unresolved editing transaction. These tests pin the wording and, as source-text checks (the precedent of
 * viewBarSuppression.test.ts), that every serialization path of the editor refuses while a group is open. The behaviour itself is exercised
 * in the app (interactive acceptance); see docs/BUILD-0121.md.
 */
const editor = readFileSync(path.resolve(__dirname, "../../../apps/web/src/components/LayerlingEditor.tsx"), "utf8");
const shell = readFileSync(path.resolve(__dirname, "../../../apps/web/src/components/NativeDocumentShell.tsx"), "utf8");

describe("group editing guard: wording", () => {
  it("has the agreed title and the agreed save sentence", () => {
    expect(GROUP_EDITING_TITLE).toBe("Group Editing in Progress");
    expect(groupEditingMessage("save")).toBe("Please complete or cancel your group edits before saving this document.");
  });
  it("adapts the sentence for the other actions", () => {
    expect(groupEditingMessage("close")).toContain("closing this document");
    expect(groupEditingMessage("quit")).toContain("quitting");
    expect(groupEditingMessage("export")).toContain("exporting");
    expect(groupEditingMessage("revert")).toContain("reverting");
  });
  it("the save failure code exists in the protocol", () => {
    expect(SAVE_FAILURE_CODES).toContain("group-editing");
  });
});

describe("group editing guard: serialization paths", () => {
  it("the native package (Save and recovery snapshot) is refused before waiting, after waiting and before the snapshot", () => {
    const count = editor.split('throw new NativeSaveError("group-editing"').length - 1;
    expect(count).toBe(3);
  });
  it("browser saves, exports, the bug report, MCP save_project, autosave, Earlier Versions and the server save all check for an open group", () => {
    expect(editor).toContain('refuseWhileEditingGroup("save")');
    expect(editor.split('refuseWhileEditingGroup("export")').length - 1).toBeGreaterThanOrEqual(4);
    expect(editor).toMatch(/action === "save_project"\) \{\s*\n\s*if \(openGroupsRef\.current\.length > 0\) throw/);
    expect(editor).toMatch(/Build 0121: an open group is an unresolved editing transaction; its loose parts are not a state to keep/);
    expect(editor).toMatch(/snapshotRunningRef\.current \|\| openGroupsRef\.current\.length > 0/);
    expect(editor).toMatch(/serverSavePendingRef\.current\) return;\s*\n\s*if \(openGroupsRef\.current\.length > 0\)/);
  });
  it("the native document publishes the editing flag with every change report", () => {
    expect(shell).toContain("editing: editingRef.current");
    expect(editor).toContain("onNativeEditingChangeRef.current?.(open)");
  });
});
