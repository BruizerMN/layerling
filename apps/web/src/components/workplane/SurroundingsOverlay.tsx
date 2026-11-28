"use client";

import { referencesCheckboxDisabled, type SurroundingsState } from "@/lib/surroundings";

/**
 * Build 0131: the interim Surroundings control (Bill, 2026-11-28): a plain page-owned overlay while a group is being edited; Build 0132/0133 give it its permanent place. Deliberately simple.
 * Opacity 0 to 100%; "Use as references" is DISABLED at 0% but keeps its (checked) state, and raising the opacity brings the previous choice back.
 * It only reads and reports the session state: the page owns it, it is never saved, never in history, never dirty.
 */
export function SurroundingsOverlay({ state, onOpacity, onReferences }: { state: SurroundingsState; onOpacity: (value: number) => void; onReferences: (value: boolean) => void }) {
  const percent = Math.round(state.opacity * 100);
  const disabled = referencesCheckboxDisabled(state);
  return (
    <div
      className="surroundings-overlay"
      data-surroundings-overlay=""
      role="group"
      aria-label="Surroundings"
      style={{ position: "fixed", left: 16, bottom: 46, zIndex: 40, display: "flex", flexDirection: "column", gap: 6, padding: "8px 10px", borderRadius: 8, fontSize: 12, background: "rgba(255,255,255,0.88)", color: "#222", boxShadow: "0 1px 4px rgba(0,0,0,0.25)", minWidth: 190 }}
    >
      <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ minWidth: 70 }}>Surroundings</span>
        <input type="range" min={0} max={100} step={1} value={percent} aria-label="Surroundings opacity" aria-valuetext={`${percent} percent`} onChange={(event) => onOpacity(Number(event.target.value) / 100)} style={{ flex: 1 }} />
        <span style={{ width: 34, textAlign: "right" }}>{percent}%</span>
      </label>
      <label style={{ display: "flex", alignItems: "center", gap: 6, opacity: disabled ? 0.55 : 1 }} title={disabled ? "Available when the surroundings are visible" : undefined}>
        <input type="checkbox" checked={state.references} disabled={disabled} onChange={(event) => onReferences(event.target.checked)} />
        <span>Use as references</span>
      </label>
    </div>
  );
}
