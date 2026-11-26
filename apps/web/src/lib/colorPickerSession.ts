/*
 * A colour-picker SESSION is the whole time someone is choosing a colour: the colours chosen on the way are interactive previews (the model follows in real time); the
 * session as a whole is ONE change. The editor holds its "interaction" (one Undo step, nothing saved half-way) for exactly as long as the session lasts: `begin` on the
 * first colour, `end` when the picker says it is over (Build 0091: the macOS host, which owns the native picker, says so).
 */
export interface PickerSession {
  /** The session starts (idempotent: every colour that arrives may call it). */
  begin(): void;
  /** The session ends; true when one was open. */
  end(): boolean;
  readonly active: boolean;
}

export function createPickerSession(hold: (active: boolean) => void): PickerSession {
  let active = false;
  return {
    begin() {
      if (active) return;
      active = true;
      hold(true);
    },
    end() {
      if (!active) return false;
      active = false;
      hold(false);
      return true;
    },
    get active() {
      return active;
    },
  };
}
