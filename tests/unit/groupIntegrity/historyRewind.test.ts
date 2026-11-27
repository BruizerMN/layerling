import { describe, expect, it } from "vitest";
import { canRewindOpenStep, rewindOpenStep, type OpenStepRecord } from "@/lib/historyRewind";

/*
 * Build 0122: an editing session that changed nothing leaves no trace in the history. These tests pin the rule of `historyRewind.ts` (pure functions over entries);
 * the editor applies the result (rewindOpenSession in LayerlingEditor.tsx). If the rewind is ever found fragile it can be switched off without touching the exact restoration of the group.
 */
const entries = (...fingerprints: string[]) => fingerprints.map((fingerprint) => ({ fingerprint }));
const record = (over: Partial<OpenStepRecord> = {}): OpenStepRecord => ({ index: 2, fingerprint: "open", preIndex: 1, preFingerprint: "before", ...over });

describe("rewinding the open step of an unchanged editing session", () => {
  it("drops the open step and everything after it, returning to the entry before the session", () => {
    const result = rewindOpenStep(entries("a", "before", "open"), 2, record());
    expect(result?.index).toBe(1);
    expect(result?.entries.map((e) => e.fingerprint)).toEqual(["a", "before"]);
  });

  it("also drops a redo tail that follows the open step", () => {
    const result = rewindOpenStep(entries("a", "before", "open", "redo1", "redo2"), 2, record());
    expect(result?.entries.map((e) => e.fingerprint)).toEqual(["a", "before"]);
  });

  it("does not apply once the person has taken another step (the editor is no longer on the open step)", () => {
    expect(rewindOpenStep(entries("a", "before", "open", "edit"), 3, record())).toBeNull();
  });

  it("does not apply after an Undo past the open step, nor after Undo and Redo around it landing elsewhere", () => {
    expect(rewindOpenStep(entries("a", "before", "open"), 1, record())).toBeNull();
    expect(rewindOpenStep(entries("a", "before", "open"), 0, record())).toBeNull();
  });

  it("does not apply when the entries are not the ones recorded (history trimmed or replaced)", () => {
    expect(rewindOpenStep(entries("a", "before", "other"), 2, record())).toBeNull();
    expect(rewindOpenStep(entries("a", "changed", "open"), 2, record())).toBeNull();
  });

  it("does not apply to an open step that was joined to an earlier one (a chain of opens is one step)", () => {
    expect(rewindOpenStep(entries("a", "before", "open"), 2, record({ preIndex: null, preFingerprint: null }))).toBeNull();
    expect(canRewindOpenStep(entries("a", "before", "open"), 2, record({ preIndex: 0 }))).toBe(false);
  });

  it("never rewinds before the first entry", () => {
    expect(rewindOpenStep(entries("open"), 0, record({ index: 0, preIndex: -1 }))).toBeNull();
  });

  it("does not modify the entries it is given", () => {
    const given = entries("a", "before", "open", "redo");
    rewindOpenStep(given, 2, record());
    expect(given).toHaveLength(4);
  });
});
