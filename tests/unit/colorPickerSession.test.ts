import { describe, expect, it, vi } from "vitest";
import { createPickerSession } from "@/lib/colorPickerSession";
import { UI_COMMANDS } from "@/lib/host/hostProtocol";

describe("colour-picker session (Build 0090)", () => {
  it("holds the interaction once for the whole session, however many colour events begin() sees", () => {
    const hold = vi.fn();
    const announce = vi.fn();
    const session = createPickerSession(hold, announce);
    expect(session.active).toBe(false);
    for (let i = 0; i < 100; i += 1) session.begin();
    expect(session.active).toBe(true);
    expect(hold.mock.calls).toEqual([[true]]);
    expect(announce.mock.calls).toEqual([[true]]);
  });

  it("ends once, says whether it was the one that ended the session, and is quiet when nothing is open", () => {
    const hold = vi.fn();
    const announce = vi.fn();
    const session = createPickerSession(hold, announce);
    expect(session.end()).toBe(false);
    expect(hold).not.toHaveBeenCalled();
    session.begin();
    expect(session.end()).toBe(true);
    expect(session.end()).toBe(false);
    expect(hold.mock.calls).toEqual([[true], [false]]);
    expect(announce.mock.calls).toEqual([[true], [false]]);
    expect(session.active).toBe(false);
  });

  it("starts a new session after one ended (colour events that arrive later hold again)", () => {
    const hold = vi.fn();
    const session = createPickerSession(hold);
    session.begin();
    session.end();
    session.begin();
    expect(session.active).toBe(true);
    expect(hold.mock.calls).toEqual([[true], [false], [true]]);
  });

  it("works without a host announcement", () => {
    const hold = vi.fn();
    const session = createPickerSession(hold);
    session.begin();
    expect(session.end()).toBe(true);
  });

  it("the host command that ends a session is a known ui command", () => {
    expect(UI_COMMANDS).toContain("colorPanel.closed");
  });
});
