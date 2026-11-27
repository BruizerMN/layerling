"use client";

import { Shapes } from "lucide-react";
import type { NestedFocusCardData } from "@/lib/objectsFocus";

/**
 * The Object tab while the Objects Sidebar has FOCUS on an object inside a closed group (Build 0116): a compact, read-only card. The engine cannot select such an object, so the
 * ordinary Inspector has nothing to show; this says what the object is, where it lives, and offers the one way to change it (Edit Group). Deliberately modest: the Inspector is
 * to be converted to native in its own initiative. English only, like the rest of the native app's own panels.
 */
export function NestedFocusCard({ card, onEditGroup }: { card: NestedFocusCardData; onEditGroup?: () => void }) {
  const format = (n: number) => String(Math.round(n * 100) / 100);
  return (
    <aside className="shape-inspector docked nested-focus-card" aria-label={`Inspector: ${card.name}, inside a group`} onPointerDown={(event) => event.stopPropagation()}>
      <div className="nested-focus-head">
        <Shapes size={22} strokeWidth={1.5} aria-hidden="true" />
        <div>
          <strong className="nested-focus-name">{card.name}</strong>
          <div className="nested-focus-path" title={card.pathNames.join(" › ")}>{card.pathNames.slice(0, -1).join(" › ")}</div>
        </div>
      </div>
      <dl className="nested-focus-facts">
        <dt>Type</dt><dd>{card.hole ? "Hole" : "Solid"}</dd>
        <dt>Shape</dt><dd>{card.kind}</dd>
        {card.color ? (<><dt>Color</dt><dd><span className="nested-focus-swatch" style={{ backgroundColor: card.color }} />{card.color}</dd></>) : null}
        <dt>Size</dt><dd>{card.size.map(format).join(" × ")}</dd>
        <dt>Hidden</dt><dd>{card.hidden ? "Yes" : "No"}</dd>
        <dt>Shape lock</dt><dd>{card.shapeLocked ? "On" : "Off"}</dd>
      </dl>
      <p className="nested-focus-note">This object is inside a closed group, so it is shown here for reference only. Use Edit Group to select and change it.</p>
      {card.placement === "none" ? (
        <p className="nested-focus-note">{card.hidden ? "It is hidden, so nothing is marked in the Workspace." : "Its place is not marked in the Workspace: the group around it is mirrored, deformed or built from its own settings."}</p>
      ) : null}
      {onEditGroup ? <button type="button" className="nested-focus-edit" onClick={onEditGroup}>Edit Group</button> : null}
    </aside>
  );
}
