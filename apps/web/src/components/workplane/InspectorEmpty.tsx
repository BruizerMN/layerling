"use client";

import { Shapes } from "lucide-react";
import { useLanguage } from "@/lib/useLanguage";

/**
 * The Object tab with nothing to inspect (native app): only a message, centred in the panel - the Object tab's icon, enlarged, and "Please select an object".
 * No property controls, no sections. While a tool owns the view (an object may be selected, but it is not inspectable now) it says so instead.
 */
export function InspectorEmpty({ toolActive = false }: { toolActive?: boolean }) {
  useLanguage();
  return (
    <aside className="shape-inspector docked inspector-empty" aria-label={toolActive ? "Inspector: tool active" : "Inspector: nothing selected"} onPointerDown={(event) => event.stopPropagation()}>
      <div className="inspector-empty-message" role="status">
        <Shapes size={56} strokeWidth={1.25} aria-hidden="true" />
        <p className="inspector-empty-note">{toolActive ? "Finish the current tool to inspect an object" : "Please select an object"}</p>
      </div>
    </aside>
  );
}
