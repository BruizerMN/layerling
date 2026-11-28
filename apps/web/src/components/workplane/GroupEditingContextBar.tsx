"use client";

import { referencesCheckboxDisabled, type SurroundingsState } from "@/lib/surroundings";

/**
 * Build 0132: the permanent Workspace Context Bar (native Group Editing). Page-owned, so it needs no host traffic: it spans exactly the Workspace column (CSS, like the Inspector dock), in the system accent colour with the host's
 * contrasting foreground (--accent-live, --accent-live-fg), in one row: LEFT the Surroundings controls (Build 0131: opacity slider, percentage, "Use as references", disabled at 0% yet keeping its state), CENTRE
 * "Editing Group {name}" (the innermost context, centred on the Workspace, truncated before any control is hidden), RIGHT Cancel then Done (the primary action). Done and Cancel always apply to the ENTIRE session,
 * whatever the nesting depth; the individual levels are resolved in the Objects Sidebar. The state is the page's session state (never saved, never in history, never dirty).
 */
export type GroupEditingContextBarProps = {
  name: string;
  state: SurroundingsState;
  busy: boolean;
  onOpacity: (value: number) => void;
  onReferences: (value: boolean) => void;
  onDone: () => void;
  onCancel: () => void;
};

export function GroupEditingContextBar({ name, state, busy, onOpacity, onReferences, onDone, onCancel }: GroupEditingContextBarProps) {
  const percent = Math.round(state.opacity * 100);
  const disabled = referencesCheckboxDisabled(state);
  return (
    <div className="group-editing-context-bar" data-context-bar="" role="region" aria-label="Group editing">
      <div className="context-bar-left">
        <label className="context-bar-slider" title="Opacity of everything outside the group being edited">
          <span>Surroundings</span>
          <input type="range" min={0} max={100} step={1} value={percent} aria-label="Surroundings opacity" aria-valuetext={`${percent} percent`} onChange={(event) => onOpacity(Number(event.target.value) / 100)} />
          <span className="context-bar-percent">{percent}%</span>
        </label>
        <label className="context-bar-check" data-disabled={disabled ? "" : undefined} title={disabled ? "Available when the surroundings are visible" : "Let the visible surroundings serve as geometric references"}>
          <input type="checkbox" checked={state.references} disabled={disabled} onChange={(event) => onReferences(event.target.checked)} />
          <span>Use as references</span>
        </label>
      </div>
      <div className="context-bar-centre" title={`Editing Group ${name}`}>
        <span className="context-bar-title">Editing Group {name}</span>
      </div>
      <div className="context-bar-right">
        <button type="button" className="context-bar-button" disabled={busy} title="Cancel the entire editing session" onClick={onCancel}>Cancel</button>
        <button type="button" className="context-bar-button primary" disabled={busy} title="Finish the entire editing session" onClick={onDone}>Done</button>
      </div>
    </div>
  );
}
