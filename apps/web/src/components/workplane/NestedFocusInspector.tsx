"use client";

import { useRef, useState } from "react";
import { InspectorDockSection } from "@/components/workplane/InspectorSection";
import type { NestedFocusCardData } from "@/lib/objectsFocus";

/**
 * The Object tab while the Objects Sidebar has FOCUS on an object inside a closed group (Builds 0116/0117). It is a natural variation of the Object Inspector, not a card of its own: the
 * same panel, the General section with the Name field (editable wherever the engine permits renaming: a shape-locked object keeps its name), and in place of the geometry sections one
 * collapsible section, "Object Info" or "Group Info", with what the engine can show about an object it cannot select, the explanation, and the one way to change it (Edit Group).
 * The engine cannot select such an object, so nothing else is editable here. English only, like the native app's other panels of its own; the Inspector will be converted to native.
 */
export function NestedFocusInspector({ card, onRename, onEditGroup }: { card: NestedFocusCardData; onRename?: (name: string) => void; onEditGroup?: () => void }) {
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const cancelRef = useRef(false);
  const frozen = card.shapeLocked || !onRename;
  const format = (n: number) => String(Math.round(n * 100) / 100);
  const title = card.isGroup ? "Group Info" : "Object Info";
  const commit = () => {
    if (nameDraft !== null && onRename) onRename(nameDraft);
    setNameDraft(null);
  };
  return (
    <aside className="shape-inspector docked nested-focus-inspector" aria-label={`Inspector: ${card.name}, inside a group`} onPointerDown={(event) => event.stopPropagation()}>
      <InspectorDockSection name="object.general" title="General">
        <div className="inspector-name-row">
          <div className="inspector-name">
            <span className="inspector-name-label">Name</span>
            <input
              type="text"
              className="inspector-name-input inspector-name-field"
              value={nameDraft ?? card.name}
              disabled={frozen}
              title={card.shapeLocked ? "The shape lock keeps this object's name as it is" : undefined}
              aria-label="Rename"
              spellCheck={false}
              onFocus={(event) => {
                setNameDraft(card.name);
                event.currentTarget.select();
              }}
              onChange={(event) => setNameDraft(event.target.value)}
              onBlur={() => {
                if (cancelRef.current) {
                  cancelRef.current = false;
                  setNameDraft(null);
                  return;
                }
                commit();
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  event.currentTarget.blur();
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  cancelRef.current = true;
                  event.currentTarget.blur();
                }
              }}
            />
          </div>
        </div>
      </InspectorDockSection>
      <InspectorDockSection name="object.info" title={title}>
        <dl className="nested-focus-facts">
          <dt>In</dt><dd className="nested-focus-path" title={card.pathNames.join(" › ")}>{card.pathNames.slice(0, -1).join(" › ")}</dd>
          <dt>Type</dt><dd>{card.isGroup ? (card.hole ? "Group (hole)" : "Group") : card.hole ? "Hole" : "Solid"}</dd>
          <dt>Shape</dt><dd>{card.kind}</dd>
          {card.color ? (<><dt>Color</dt><dd><span className="nested-focus-swatch" style={{ backgroundColor: card.color }} />{card.color}</dd></>) : null}
          <dt>Size</dt><dd>{card.size.map(format).join(" × ")}</dd>
          <dt>Hidden</dt><dd>{card.hidden ? "Yes" : "No"}</dd>
          <dt>Shape lock</dt><dd>{card.shapeLocked ? "On" : "Off"}</dd>
        </dl>
        <p className="nested-focus-note">This {card.isGroup ? "group" : "object"} is inside a closed group, so only its name can be changed here. Use Edit Group to select and change the rest.</p>
        {card.placement === "none" ? (
          <p className="nested-focus-note">{card.hidden ? "It is hidden, so nothing is marked in the Workspace." : "Its place is not marked in the Workspace: the group around it is mirrored, deformed or built from its own settings."}</p>
        ) : null}
        {onEditGroup ? <button type="button" className="nested-focus-edit" onClick={onEditGroup}>Edit Group</button> : null}
      </InspectorDockSection>
    </aside>
  );
}
