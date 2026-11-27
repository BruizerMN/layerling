/**
 * Build 0103: typed numeric values for host commands (`ui.command` carries `{ command, value? }`). A name-only command stays a name; a command that needs a number (the Section View's
 * position, later others) is registered here with the KIND of value it takes. Validated on BOTH sides of the bridge (the host's Swift mirror is `CommandValue` in `HostProtocol`): a command
 * that takes a value is refused without one, a command that does not take one is refused with one, and a value must be finite and inside the kind's sanity limit.
 *
 * Units: a `length` is a number in the document's DISPLAY unit (what the person reads and types); the page converts it to millimetres and owns every bound. The host never converts.
 * The existing name-encoded commands (`savedView.go.N`...) are unchanged.
 */
export type CommandValueKind = "length" | "integer" | "ratio";

export interface CommandValue {
  kind: CommandValueKind;
  number: number;
}

interface ValueSpec {
  kind: CommandValueKind;
  /** Sanity limits of the protocol (not the page's working bounds, which only the page knows). */
  min: number;
  max: number;
}

/** The commands that take a value, and what kind. */
export const VALUE_COMMANDS: Readonly<Record<string, ValueSpec>> = {
  "section.position": { kind: "length", min: -1_000_000, max: 1_000_000 },
};

export function isValueCommand(command: string): boolean {
  return Object.prototype.hasOwnProperty.call(VALUE_COMMANDS, command);
}

/** A well-formed value for this command, or null (unknown shape, wrong kind, not finite, outside the limit, an integer that is not whole). */
export function validateCommandValue(command: string, raw: unknown): CommandValue | null {
  if (!isValueCommand(command)) return null;
  const spec = VALUE_COMMANDS[command];
  if (typeof raw !== "object" || raw === null) return null;
  const { kind, number } = raw as { kind?: unknown; number?: unknown };
  if (kind !== spec.kind || typeof number !== "number" || !Number.isFinite(number)) return null;
  if (number < spec.min || number > spec.max) return null;
  if (spec.kind === "integer" && !Number.isInteger(number)) return null;
  if (spec.kind === "ratio" && (number < 0 || number > 1)) return null;
  return { kind: spec.kind, number };
}
