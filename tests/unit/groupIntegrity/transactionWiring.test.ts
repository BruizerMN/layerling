import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/*
 * Build 0123: source-text checks that the group editing transaction is wired at every place that matters (the pure frame rules are in historyFrames.test.ts; the
 * interactive contract is in docs/BUILD-0123.md in the native repo).
 */
const editor = readFileSync(path.resolve(__dirname, "../../../apps/web/src/components/LayerlingEditor.tsx"), "utf8");

describe("group editing transaction wiring", () => {
  it("the outermost open (native) begins a session, the session history starts at the opened state", () => {
    expect(editor).toContain("const beginsSession = Boolean(nativeDocument) && levels.length === 0 && !groupSessionRef.current;");
    expect(editor).toContain("if (beginsSession) beginGroupSession();");
    expect(editor).toContain("if (beginsSession) rebaseGroupSession(entry);");
  });
  it("every exit ends the session: Done, Cancel / unchanged, one part left, and a safety net for any other way the last level disappears", () => {
    expect(editor).toContain('endGroupSession("restore", session.original.id)');
    expect(editor).toContain('if (nativeDocument && openGroupsRef.current.length === 0) endGroupSession("done");');
    expect(editor).toMatch(/if \(!levels\.length\) \{\s*\n\s*openGroupsRef\.current = levels;\s*\n\s*endGroupSession\("done"\);/);
    expect(editor).toContain('if (!openGroups.length && groupSessionRef.current) endGroupSession("done");');
  });
  it("the history limit applies to the session's own history with its first entry pinned, never to the stash", () => {
    expect(editor).toContain("boundSession({ entries: historyRef.current, index: historyIndexRef.current }, historyRef.current[0]");
    expect(editor).toContain("appendInSession({ entries: historyRef.current, index: historyIndexRef.current }, historyRef.current[0]");
  });
  it("the History view and the history-deleting commands are off inside a session, in the editor and in MCP", () => {
    expect((editor.match(/if \(groupSessionRef\.current\) \{\s*\n\s*(\/\/[^\n]*\n\s*)?setNotice\(t\("status\.historyViewInGroupSession"\)\);/g) ?? []).length).toBe(3);
    expect(editor).toContain('command.action === "clear_history" || command.action === "delete_history_steps" || command.action === "restore_from_history"');
    expect(editor).toContain('historyScope: "group-editing-session"');
  });
  it("a loaded document drops a session without touching the loaded history", () => {
    expect(editor).toMatch(/projectHydratingRef\.current = true;\s*\n\s*\/\/[^\n]*\n\s*groupSessionRef\.current = null;/);
  });
});
