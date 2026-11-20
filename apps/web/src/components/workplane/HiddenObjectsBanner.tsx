"use client";

import { EyeOff } from "lucide-react";
import { hiddenObjectsLabel, useHiddenObjects } from "@/lib/hiddenObjects";

/**
 * A small notice under the Inspector's header while the document has hidden objects: how many, and Unhide All (the same command as View > Unhide All and
 * its shortcut). Absent, and taking no room, when nothing is hidden; shown whether or not anything is selected. It reads the document's own count from
 * the editor that renders the Inspector, so each window shows its own document.
 */
export function HiddenObjectsBanner() {
  const { count, unhideAll } = useHiddenObjects();
  if (count === 0) return null;
  return (
    <div className="inspector-hidden-banner" role="status" data-hidden-count={count}>
      <EyeOff size={13} aria-hidden="true" />
      <span>{hiddenObjectsLabel(count)}</span>
      <button type="button" onClick={unhideAll}>Unhide All</button>
    </div>
  );
}
