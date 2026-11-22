"use client";

import { ChevronUp } from "lucide-react";
import { t } from "@/lib/i18n";
import { useLanguage } from "@/lib/useLanguage";

/**
 * The Inspector with nothing to inspect (native app). The panel stays where it is; every object-specific control stays in its place, disabled, with no
 * value shown, so there are no stale numbers that look editable. It uses the same markup and classes as the real Inspector, so it is styled by the same rules.
 */
function Row({ label }: { label: string }) {
  return (
    <div className="range-property">
      <span className="range-property-header">
        <span className="range-property-name">{label}</span>
        <span className="range-value-control">
          <input type="text" disabled value="—" readOnly aria-label={label} />
        </span>
      </span>
      <div className="range-control">
        <input type="range" disabled tabIndex={-1} min={0} max={1} value={0} readOnly />
      </div>
    </div>
  );
}

function Card({ title, labels }: { title: string; labels: string[] }) {
  return (
    <div className="property-card">
      <button className="property-card-header" type="button" disabled aria-expanded="true">
        <span className="property-card-title">{title}</span>
        <ChevronUp size={14} />
      </button>
      <div className="property-list">
        {labels.map((label) => (
          <Row key={label} label={label} />
        ))}
      </div>
    </div>
  );
}

export function InspectorEmpty({ toolActive = false }: { toolActive?: boolean }) {
  useLanguage();
  return (
    <aside className="shape-inspector docked inspector-empty" aria-label="Inspector: nothing selected" onPointerDown={(event) => event.stopPropagation()}>
      <div className="shape-inspector-header">
        <div className="inspector-name">
          <strong>{toolActive ? "Tool Active" : "No Selection"}</strong>
        </div>
      </div>
      <div className="shape-state-card" role="group" aria-label={t("inspector.shapeMode")} aria-disabled="true">
        <button className="solid-choice" type="button" disabled>
          <span className="large-solid-swatch" />
          <span>{t("inspector.solid")}</span>
        </button>
        <button className="hole-choice" type="button" disabled>
          <span className="large-hole-swatch" />
          <span>{t("inspector.hole")}</span>
        </button>
      </div>
      <Card title="Size" labels={["Length", "Width", "Height"]} />
      <Card title="Position" labels={["X", "Y", "Z"]} />
      <Card title="Rotation" labels={["X", "Y", "Z"]} />
      <p className="inspector-empty-note">{toolActive ? "Finish the current tool to inspect an object." : "Select an object to see its properties."}</p>
    </aside>
  );
}
