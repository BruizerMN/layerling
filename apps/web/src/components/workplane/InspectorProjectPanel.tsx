"use client";

import { EyeOff } from "lucide-react";
import { hiddenObjectsLabel, useHiddenObjects } from "@/lib/hiddenObjects";
import { InspectorSection } from "@/components/workplane/InspectorSection";

/**
 * The Project tab: what belongs to the whole document rather than to the selected object. For now its General section holds the hidden objects and Unhide All (the same
 * command as View > Unhide All and its shortcut, moved here from the Object tab's banner). Its count is the document's own, from the editor that renders
 * the Inspector, so each window shows its own document. Unhide All is disabled, as the menu item is, when nothing is hidden.
 * More project-wide sections go here as further `InspectorSection`s.
 */
export function InspectorProjectPanel() {
  const { count, unhideAll, unavailable } = useHiddenObjects();
  return (
    <div className="inspector-project-panel" data-inspector-panel="project">
      <InspectorSection name="project.general" title="General">
        <div className="inspector-hidden-banner" role="status" data-hidden-count={count}>
          <EyeOff size={13} aria-hidden="true" />
          <span>{count === 0 ? "No hidden objects" : hiddenObjectsLabel(count)}</span>
          <button type="button" disabled={count === 0 || unavailable} title={unavailable ? "Unavailable while a group is being edited" : undefined} onClick={unhideAll}>
            Unhide All
          </button>
        </div>
      </InspectorSection>
    </div>
  );
}
