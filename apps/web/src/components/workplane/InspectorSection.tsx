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
 * The Object Inspector's first section, "General": the controls that used to sit above Properties (name and actions, Solid/Hole, colour, group
 * controls...). In the docked Inspector they are inside the section; the floating Inspector of a browser shows them as before.
 */
export function InspectorGeneral({ docked, children }: { docked: boolean; children: ReactNode }) {
  if (!docked) return <>{children}</>;
  return (
    <InspectorSection name="object.general" title="General" bare>
      {children}
    </InspectorSection>
  );
}
