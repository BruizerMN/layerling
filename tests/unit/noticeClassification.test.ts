import { describe, expect, it } from "vitest";
import { NOTICE_ERROR_KEYS, NOTICE_INFO_KEYS } from "@/lib/noticeClasses";
import { noteNoticeText, noticeIsError } from "@/lib/noticeKind";

// Build 0073. The native app shows error-class notices as blocking sheets and drops the rest, so a progress or confirmation message filed under ERROR becomes a
// pointless alert. (src/lib/noticeKind.test.ts sits outside the vitest include, so these cases live here.)
describe("notice classes the native app depends on", () => {
  const errors = new Set(NOTICE_ERROR_KEYS), info = new Set(NOTICE_INFO_KEYS);

  it("progress and the Objects Browser eye and lock confirmations are information, not alerts", () => {
    for (const key of ["status.validatingFile", "notice.validatingFile", "status.shapeHidden", "status.shapeShown", "status.shapeLocked", "status.shapeUnlocked"]) {
      expect(info.has(key), key).toBe(true);
      expect(errors.has(key), key).toBe(false);
    }
    noteNoticeText("status.validatingFile", "Validating Part.lyl before opening it as a new design");
    noteNoticeText("status.shapeHidden", "\"Box\" hidden");
    noteNoticeText("status.shapeLocked", "\"Box\" locked");
    expect(noticeIsError("Validating Part.lyl before opening it as a new design")).toBe(false);
    expect(noticeIsError("\"Box\" hidden")).toBe(false);
    expect(noticeIsError("\"Box\" locked")).toBe(false);
  });

  it("the failures of the single-file Insert into this design are still reported", () => {
    for (const key of ["status.insertDesignEmpty", "status.insertDesignFailed", "status.importCancelled"]) expect(errors.has(key), key).toBe(true);
    noteNoticeText("status.insertDesignEmpty", "Part.lyl has no bodies to insert");
    noteNoticeText("status.insertDesignFailed", "Part.lyl could not be inserted");
    expect(noticeIsError("Part.lyl has no bodies to insert")).toBe(true);
    expect(noticeIsError("Part.lyl could not be inserted")).toBe(true);
    expect(noticeIsError("The project file is damaged")).toBe(true);   // an exception message is not a catalogue sentence: shown
  });

  it("the shape lock refusal is still shown", () => {
    expect(errors.has("status.shapeLockHeld") || !info.has("status.shapeLockHeld")).toBe(true);
  });

  it("entering, finishing and cancelling group editing are information: the native app raises no modal for them (Build 0115)", () => {
    for (const key of ["status.groupOpened", "status.groupClosed", "status.groupOpenCancelled"]) {
      expect(info.has(key), key).toBe(true);
      expect(errors.has(key), key).toBe(false);
    }
    noteNoticeText("status.groupOpened", "Editing \"Group\"");
    noteNoticeText("status.groupOpenCancelled", "\"Group\" back unchanged");
    noteNoticeText("status.groupClosed", "Rebuilt \"Group\"");
    for (const text of ["Editing \"Group\"", "\"Group\" back unchanged", "Rebuilt \"Group\""]) expect(noticeIsError(text), text).toBe(false);
  });

  it("genuine group refusals and warnings are still shown", () => {
    for (const key of ["group.busy", "group.finishOpenFirst", "status.groupChanged", "status.groupPartsShrunk", "status.groupStretchedInstead"]) {
      expect(info.has(key), key).toBe(false);
    }
    noteNoticeText("group.finishOpenFirst", "Only groups inside \"Pedestal\" can be edited now");
    expect(noticeIsError("Only groups inside \"Pedestal\" can be edited now")).toBe(true);
  });

  it("no key is in both lists", () => {
    for (const key of errors) expect(info.has(key), key).toBe(false);
  });
});
