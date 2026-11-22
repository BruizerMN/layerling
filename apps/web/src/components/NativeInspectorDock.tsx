"use client";

import { File, Shapes, type LucideIcon } from "lucide-react";
import { useCallback, useEffect, useState, type KeyboardEvent, type ReactNode } from "react";
import { InspectorProjectPanel } from "@/components/workplane/InspectorProjectPanel";
import { registerInspectorDock, useInspectorLayoutFlag, useInspectorVisible } from "@/lib/inspectorDock";
import { INSPECTOR_TAB_IDS, setInspectorTab, tabForKey, useInspectorTab, type InspectorTabId } from "@/lib/inspectorTabs";

/**
 * The tabs of the Inspector, left to right. Another tab is one more entry here and in INSPECTOR_TAB_IDS (lib/inspectorTabs.ts).
 * `render` makes the tab's own content; the Object tab has none: its content is the existing Inspector, which the viewport renders into the panel
 * this dock keeps for it (and keeps mounted while another tab shows, so nothing in it is lost by switching).
 */
const INSPECTOR_TABS: { id: InspectorTabId; label: string; Icon: LucideIcon; render?: () => ReactNode }[] = [
  { id: "project", label: "Project", Icon: File, render: () => <InspectorProjectPanel /> },
  { id: "object", label: "Object", Icon: Shapes },
];

function InspectorTabBar({ active }: { active: InspectorTabId }) {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const next = tabForKey(INSPECTOR_TAB_IDS, active, event.key);
    if (!next) return;
    event.preventDefault();
    setInspectorTab(next);
    event.currentTarget.querySelector<HTMLElement>(`[data-inspector-tab="${next}"]`)?.focus();
  };
  return (
    <div className="native-inspector-tabs" role="tablist" aria-label="Inspector" aria-orientation="horizontal" onKeyDown={onKeyDown}>
      {INSPECTOR_TABS.map(({ id, label, Icon }) => (
        <button
          key={id}
          type="button"
          role="tab"
          id={`inspector-tab-${id}`}
          data-inspector-tab={id}
          aria-selected={active === id}
          aria-controls={`inspector-panel-${id}`}
          aria-label={label}
          title={label}
          tabIndex={active === id ? 0 : -1}
          className={active === id ? "native-inspector-tab active" : "native-inspector-tab"}
          onClick={() => setInspectorTab(id)}
        >
          <Icon size={18} strokeWidth={1.75} aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}

/**
 * The docked Inspector's place in the native app: a panel at the right of the 3D view, reserved only while the user has it shown (the view then
 * resizes once, not with the selection). The tab bar stays at the top; the selected tab's content scrolls beneath it. The viewport renders the Object
 * Inspector into the Object panel (WorkplaneViewport, `useInspectorDock`). It exists in 3D editing only: a sketch has its own tools and the full
 * width. Focus mode hides it with the rest of the chrome.
 */
export function NativeInspectorDock({ geometry }: { geometry: boolean }) {
  const visible = useInspectorVisible();
  const tab = useInspectorTab();
  const [element, setElement] = useState<HTMLElement | null>(null);
  const attach = useCallback((node: HTMLElement | null) => setElement(node), []);
  const shown = visible && geometry;
  useInspectorLayoutFlag(geometry);
  // `enabled` is true for the whole native page, so the floating Inspector that follows the selection never comes back, also while a sketch is open.
  useEffect(() => {
    registerInspectorDock(true, shown ? element : null);
  }, [shown, element]);
  useEffect(() => () => registerInspectorDock(false, null), []);
  if (!shown) return null;
  return (
    <aside className="native-inspector-dock" aria-label="Inspector">
      <InspectorTabBar active={tab} />
      <div className="native-inspector-panels">
        {INSPECTOR_TABS.map(({ id, render }) =>
          render ? (
            tab === id ? (
              <div key={id} className="native-inspector-panel" role="tabpanel" id={`inspector-panel-${id}`} aria-labelledby={`inspector-tab-${id}`}>
                {render()}
              </div>
            ) : null
          ) : (
            <div key={id} className="native-inspector-panel" role="tabpanel" id={`inspector-panel-${id}`} aria-labelledby={`inspector-tab-${id}`} hidden={tab !== id} ref={attach} />
          ),
        )}
      </div>
    </aside>
  );
}
