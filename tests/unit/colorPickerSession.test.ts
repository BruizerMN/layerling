import { describe, expect, it, vi } from "vitest";
import { createPickerSession } from "@/lib/colorPickerSession";

describe("colour-picker session (Build 0091)", () => {
  it("holds the interaction once for the whole session, however many colours begin() sees", () => {
    const hold = vi.fn();
    const session = createPickerSession(hold);
    expect(session.active).toBe(false);
    for (let i = 0; i < 100; i += 1) session.begin();
    expect(session.active).toBe(true);
    expect(hold.mock.calls).toEqual([[true]]);
  });

  it("ends once, says whether it ended one, and is quiet when nothing is open (a picker closed without choosing creates no history)", () => {
    const hold = vi.fn();
    const session = createPickerSession(hold);
    expect(session.end()).toBe(false);
    expect(hold).not.toHaveBeenCalled();
    session.begin();
    expect(session.end()).toBe(true);
    expect(session.end()).toBe(false);
    expect(hold.mock.calls).toEqual([[true], [false]]);
  });

  it("starts a new session after one ended", () => {
    const hold = vi.fn();
    const session = createPickerSession(hold);
    session.begin();
    session.end();
    session.begin();
    expect(hold.mock.calls).toEqual([[true], [false], [true]]);
  });
});
