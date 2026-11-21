import { describe, expect, it } from "vitest";
import { NOTICE_ERROR_KEYS, NOTICE_INFO_KEYS } from "./noticeClasses";
import { noteNoticeText, noticeIsError } from "./noticeKind";

describe("which notices are errors (native app)", () => {
  it("sorts the keys the editor uses", () => {
    const errors = new Set(NOTICE_ERROR_KEYS), info = new Set(NOTICE_INFO_KEYS);
    for (const key of ["status.selectTwoToGroup", "status.groupLocked", "status.nothingToUndo"]) expect(errors.has(key) || info.has(key)).toBe(true);
    expect(errors.has("status.selectTwoToGroup")).toBe(true);
    for (const key of ["status.cruisePlace", "status.shapeAdded", "status.copiedMany", "status.pastedMany", "status.selectedAllVisible", "status.alignCancelled"]) expect(info.has(key)).toBe(true);
    for (const key of errors) expect(info.has(key)).toBe(false);
  });
  it("tells a confirmation or guidance from an error by the sentence that was rendered", () => {
    noteNoticeText("status.cruisePlace", "Click to place Box. Esc to cancel.");
    noteNoticeText("status.shapeAdded", "Box added");
    noteNoticeText("status.selectTwoToGroup", "Select at least two shapes to group");
    expect(noticeIsError("Click to place Box. Esc to cancel.")).toBe(false);
    expect(noticeIsError("Box added")).toBe(false);
    expect(noticeIsError("Select at least two shapes to group")).toBe(true);
  });
  it("shows what it does not know, and composes from parts", () => {
    expect(noticeIsError("The CAD kernel gave up: some exception text")).toBe(true);
    noteNoticeText("status.exportedSelectedOne", "Exported 1 selected shape");
    expect(noticeIsError("Exported 1 selected shape (and something composed)")).toBe(false);
    noteNoticeText("status.groupLocked", "Part is locked and stays out of a group");
    expect(noticeIsError("Exported 1 selected shape; Part is locked and stays out of a group")).toBe(true);
  });
});
