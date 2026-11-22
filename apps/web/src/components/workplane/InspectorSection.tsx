"use client";

import { ChevronUp } from "lucide-react";
import type { ReactNode } from "react";
import { useInspectorCard } from "@/lib/inspectorCards";

/**
 * One collapsible section of an Inspector tab. It uses the same markup and classes as every card of the Object tab (`property-card`,
 * `property-card-header`), so the full-width section bar of nativeInspector.css is drawn by one set of rules for all of them. Open or closed is kept
 * with the other cards (lib/inspectorCards.ts), under `name`.
 */
export function InspectorSection({ name, title, initialOpen = true, children }: { name: string; title: string; initialOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useInspectorCard(name, initialOpen);
  const bodyId = `inspector-section-${name}`;
  return (
    <div className={`property-card ${open ? "" : "collapsed"}`}>
      <button className="property-card-header" type="button" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen((value) => !value)}>
        <span className="property-card-title">{title}</span>
        <ChevronUp className={open ? "" : "collapsed"} size={25} strokeWidth={2.8} />
      </button>
      {open ? (
        <div className="property-list" id={bodyId}>
          {children}
        </div>
      ) : null}
    </div>
  );
}
