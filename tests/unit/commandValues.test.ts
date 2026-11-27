import { describe, expect, it } from "vitest";
import { VALUE_COMMANDS, isValueCommand, validateCommandValue } from "@/lib/commandValues";
import { UI_COMMANDS, parseHostEvent } from "@/lib/host/hostProtocol";
import { VIEW_COMMANDS } from "@/lib/viewCommands";
import { isSectionPopoverOpen, setSectionPopoverOpen } from "@/lib/sectionPopover";

const event = (command: string, value?: unknown) => ({ session: "s", protocol: 3, id: "e1", type: "ui.command", payload: { documentId: "d", command, ...(value === undefined ? {} : { value }) } });

describe("typed command values (Build 0103)", () => {
  it("only registered commands take a value, and every one is a known ui command", () => {
    for (const command of Object.keys(VALUE_COMMANDS)) {
      expect(isValueCommand(command)).toBe(true);
      expect((UI_COMMANDS as readonly string[]).includes(command), command).toBe(true);
    }
    expect(isValueCommand("section.flip")).toBe(false);
    expect(isValueCommand("savedView.go.2")).toBe(false);
    expect(isValueCommand("toString")).toBe(false);
  });

  it("validates kind, finiteness and the sanity limit", () => {
    expect(validateCommandValue("section.position", { kind: "length", number: 12.5 })).toEqual({ kind: "length", number: 12.5 });
    expect(validateCommandValue("section.position", { kind: "length", number: -3, extra: 1 })).toEqual({ kind: "length", number: -3 });
    for (const bad of [null, undefined, 5, "5", {}, { kind: "length" }, { kind: "integer", number: 1 }, { kind: "length", number: "1" }, { kind: "length", number: Number.NaN }, { kind: "length", number: Number.POSITIVE_INFINITY }, { kind: "length", number: 1e9 }]) {
      expect(validateCommandValue("section.position", bad), JSON.stringify(bad)).toBeNull();
    }
    expect(validateCommandValue("section.flip", { kind: "length", number: 1 })).toBeNull();
  });

  it("the Section View commands are in the registry once", () => {
    const section = VIEW_COMMANDS.filter((c) => c.startsWith("section."));
    expect(section.length).toBe(new Set(section).size);
    for (const c of ["section.toggle", "section.position", "section.measure", "section.popoverOpened", "section.popoverDetached", "section.popoverClosed"]) expect(section).toContain(c);
  });

  it("Build 0105: the Measure popover reports attached, detached and closed (once each)", () => {
    for (const c of ["measure.popoverOpened", "measure.popoverDetached", "measure.popoverClosed"]) expect(VIEW_COMMANDS.filter((x) => x === c)).toHaveLength(1);
  });

  it("ui.command: a value command needs a valid value, any other command takes none", () => {
    const ok = parseHostEvent(event("section.position", { kind: "length", number: 4 }));
    expect(ok).toMatchObject({ type: "ui.command", payload: { command: "section.position", value: { kind: "length", number: 4 } } });
    expect(parseHostEvent(event("section.position"))).toHaveProperty("invalid");
    expect(parseHostEvent(event("section.position", { kind: "length", number: Number.NaN }))).toHaveProperty("invalid");
    expect(parseHostEvent(event("section.position", { kind: "integer", number: 4 }))).toHaveProperty("invalid");
    expect(parseHostEvent(event("section.flip", { kind: "length", number: 1 }))).toHaveProperty("invalid");
    const plain = parseHostEvent(event("section.flip"));
    expect(plain).toMatchObject({ type: "ui.command", payload: { command: "section.flip" } });
    expect((plain as { payload: Record<string, unknown> }).payload).not.toHaveProperty("value");
    expect(parseHostEvent(event("savedView.go.2"))).toMatchObject({ type: "ui.command" });
    expect(parseHostEvent(event("section.nope"))).toHaveProperty("invalid");
  });

  it("the attached-popover flag", () => {
    expect(isSectionPopoverOpen()).toBe(false);
    setSectionPopoverOpen(true);
    expect(isSectionPopoverOpen()).toBe(true);
    setSectionPopoverOpen(false);
  });
});
