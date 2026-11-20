"use client";

import { useCallback, useEffect, useState } from "react";
import { registerInspectorDock, useInspectorLayoutFlag, useInspectorVisible } from "@/lib/inspectorDock";

/**
 * The docked Inspector's place in the native app: a panel at the right of the 3D view, reserved only while the user has it shown (the view then
 * resizes once, not with the selection). The viewport renders the Inspector into it (WorkplaneViewport, `useInspectorDock`). It exists in 3D editing
 * only: a sketch has its own tools and the full width. Focus mode hides it with the rest of the chrome.
 */
export function NativeInspectorDock({ geometry }: { geometry: boolean }) {
  const visible = useInspectorVisible();
  const [element, setElement] = useState<HTMLElement | null>(null);
  const attach = useCallback((node: HTMLElement | null) => setElement(node), []);
  const shown = visible && geometry;
  useInspectorLayoutFlag(geometry);
  // `enabled` is true for the whole native page, so the floating Inspector that follows the selection never comes back, also while a sketch is open.
  useEffect(() => {
    registerInspectorDock(true, shown ? element : null);
  }, [shown, element]);
  useEffect(() => () => registerInspectorDock(false, null), []);
  return shown ? <aside className="native-inspector-dock" aria-label="Inspector" ref={attach} /> : null;
}
