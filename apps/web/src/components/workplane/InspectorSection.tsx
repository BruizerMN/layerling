"use client";

import { ChevronUp } from "lucide-react";
import type { ReactNode } from "react";
import { useInspectorSection } from "@/lib/inspectorCards";

/**
 * One collapsible section of an Inspector tab. It uses the same markup and classes as every card of the Object tab (`property-card`,
 * `property-card-header`), so the full-width section bar of nativeInspector.css is drawn by one set of rules for all of them. Open or closed is the
 * session state of lib/inspectorCards.ts (`useInspectorSection`): open at first, remembered while the document stays open, never stored.
 * `bare` leaves the body without the list's side padding, for content that brings its own (the Object Inspector's General section).
 */
export function InspectorSection({ name, title, bare = false, children }: { name: string; title: string; bare?: boolean; children: ReactNode }) {
  const [open, setOpen] = useInspectorSection(name, true);
  const bodyId = `inspector-section-${name}`;
  return (
    <div className={`property-card ${open ? "" : "collapsed"}`} data-inspector-section={name}>
      <button className="property-card-header" type="button" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen((value) => !value)}>
        <span className="property-card-title">{title}</span>
        <ChevronUp className={open ? "" : "collapsed"} size={25} strokeWidth={2.8} />
      </button>
      {open ? (
        <div className={bare ? "property-list inspector-section-bare" : "property-list"} id={bodyId}>
          {children}
        </div>
      ) : null}
    </div>
  );
}

/**
 * A section of the Object Inspector in the docked (native) Inspector: General, Group. Like every section it starts open and keeps the user's choice for
 * the session; its content brings its own padding.
 */
export function InspectorDockSection({ name, title, children }: { name: string; title: string; children: ReactNode }) {
  return (
    <InspectorSection name={name} title={title} bare>
      {children}
    </InspectorSection>
  );
}
