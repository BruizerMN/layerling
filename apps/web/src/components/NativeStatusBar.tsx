"use client";

import { EyeOff, Maximize2, Minus, PanelRight, Pin, PinOff, Plus } from "lucide-react";
import { GridEyeIcon } from "@/components/GridEyeIcon";
import { hiddenObjectsLabel } from "@/lib/hiddenObjects";
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { ZOOM_PRESET_PERCENTS, distanceFromPercent, distanceFromSlider, formatZoomPercent, getCameraController, getCameraStatus, parseZoomPercent, percentRange, sliderFromDistance, subscribeCameraStatus, zoomPercent, type CameraStatus } from "@/lib/cameraStatus";
import { setFooterSnapSlot } from "@/lib/footerSnap";
import { toggleInspectorVisible, useInspectorVisible } from "@/lib/inspectorDock";
import { formatPlateValue, parsePlateInput, plateRange, plateSizePatch, plateSummary, plateUnitLabel } from "@/lib/plateSize";
import type { WorkplaneWorkspaceSettings } from "@/types/layerling";
import { getUiState, runUiCommand, subscribeUiState } from "@/lib/host/nativeUi";

/**
 * The native app's status bar (Build 0003): replaces the browser footer in the macOS app only. It is a web bar inside the editor because
 * everything it shows - selection, object count, units, mode, the camera - is editor state that changes constantly; an AppKit bar would need all
 * of it streamed over the bridge. It reads that state from the editor and the camera on change only, and acts through the same functions as the
 * view bar, the mouse and the Model/View menus. Styled with system fonts and colours.
 */
/**
 * The zoom percentage as a compact pop-up menu: common percentages plus a field for a specific one. It uses the slider's own scale (percent of the
 * Home view) and the camera's own limits: a typed value outside them is clamped by the camera exactly as dragging the slider would be.
 */
function ZoomPercentMenu({ camera, onClose }: { camera: CameraStatus; onClose: () => void }) {
  const controller = getCameraController();
  const range = percentRange(camera.minDistance, camera.maxDistance);
  const current = zoomPercent(camera.distance);
  const [text, setText] = useState("");
  const [invalid, setInvalid] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("pointerdown", onPointer, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointerdown", onPointer, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [onClose]);
  const apply = (percent: number) => {
    controller?.setDistance(distanceFromPercent(percent));
    onClose();
  };
  const presets = ZOOM_PRESET_PERCENTS.filter((percent) => percent >= range.min && percent <= range.max);
  return (
    <div className="native-zoom-menu" role="menu" aria-label="Zoom percentage" ref={rootRef}>
      {presets.map((percent) => (
        <button key={percent} type="button" role="menuitemradio" aria-checked={Math.abs(current - percent) < percent * 0.005} className="native-zoom-menu-item" onClick={() => apply(percent)}>
          <span>{percent}%</span>
          {percent === 100 ? <small>Home view</small> : null}
        </button>
      ))}
      <form
        className="native-zoom-menu-custom"
        onSubmit={(event) => {
          event.preventDefault();
          const value = parseZoomPercent(text);
          if (value === null) return setInvalid(true);
          apply(Math.min(range.max, Math.max(range.min, value)));
        }}
      >
        <input
          ref={inputRef}
          type="text"
          inputMode="decimal"
          aria-label="Zoom percentage"
          aria-invalid={invalid}
          placeholder={`${formatZoomPercent(camera.distance).replace("%", "")} %`}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setInvalid(false);
          }}
          title={`Enter a percentage from ${range.min < 10 ? range.min.toFixed(1) : Math.round(range.min)} to ${Math.round(range.max)}`}
        />
      </form>
    </div>
  );
}

/**
 * The build plate's Width and Depth as a compact popover above the footer's plate label. It edits the workspace's own `width` / `depth` (the editor's one
 * update, `onApply`); Enter or Apply commits valid values, Escape or a click outside cancels and changes nothing. Shown and typed in the document's units.
 */
function PlateEditor({ anchor, workspace, widthMm, depthMm, onApply, onClose }: {
  anchor: DOMRect;
  workspace: Pick<WorkplaneWorkspaceSettings, "units" | "scale" | "accuracy">;
  widthMm: number;
  depthMm: number;
  onApply: (widthMm: number, depthMm: number) => void;
  onClose: () => void;
}) {
  const [width, setWidth] = useState(() => formatPlateValue(widthMm, workspace));
  const [depth, setDepth] = useState(() => formatPlateValue(depthMm, workspace));
  const [touched, setTouched] = useState(false);
  const rootRef = useRef<HTMLFormElement>(null);
  const firstRef = useRef<HTMLInputElement>(null);
  const [position, setPosition] = useState<{ left: number; bottom: number }>({ left: anchor.left, bottom: window.innerHeight - anchor.top + 6 });
  const unit = plateUnitLabel(workspace);
  const range = plateRange(workspace);
  const parsedWidth = parsePlateInput(width, workspace);
  const parsedDepth = parsePlateInput(depth, workspace);
  const valid = parsedWidth.ok && parsedDepth.ok;
  const changed = valid && (Math.abs(parsedWidth.mm - widthMm) > 1e-6 || Math.abs(parsedDepth.mm - depthMm) > 1e-6);

  useLayoutEffect(() => {
    const element = rootRef.current;
    if (element) {
      const { width: w } = element.getBoundingClientRect();
      setPosition({ left: Math.max(8, Math.min(anchor.left, window.innerWidth - w - 8)), bottom: window.innerHeight - anchor.top + 6 });
    }
    firstRef.current?.focus();
    firstRef.current?.select();
  }, [anchor]);

  useEffect(() => {
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("pointerdown", onPointer, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", onClose);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("pointerdown", onPointer, true);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  const apply = () => {
    setTouched(true);
    if (!parsedWidth.ok || !parsedDepth.ok) return;
    if (changed) onApply(parsedWidth.mm, parsedDepth.mm);
    onClose();
  };
  const field = (label: string, value: string, set: (text: string) => void, parsed: typeof parsedWidth, ref?: React.Ref<HTMLInputElement>) => (
    <label className="native-plate-field">
      <span>{label}</span>
      <input
        ref={ref}
        type="text"
        inputMode="decimal"
        value={value}
        aria-label={`Build plate ${label.toLowerCase()} in ${unit}`}
        aria-invalid={!parsed.ok}
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => set(event.currentTarget.value)}
      />
      <em>{unit}</em>
      {!parsed.ok && (touched || value.trim() === "" || value !== "") ? <small role="alert">{parsed.error}</small> : null}
    </label>
  );
  return createPortal(
    <form
      ref={rootRef}
      className="native-plate-editor"
      role="dialog"
      aria-label="Build plate size"
      style={{ left: position.left, bottom: position.bottom }}
      onSubmit={(event) => {
        event.preventDefault();
        apply();
      }}
    >
      <strong>Build plate</strong>
      {field("Width", width, setWidth, parsedWidth, firstRef)}
      {field("Depth", depth, setDepth, parsedDepth)}
      <p className="native-plate-hint">{range.min}–{range.max} {unit}</p>
      <div className="native-plate-actions">
        <button type="button" onClick={onClose}>Cancel</button>
        <button type="submit" className="primary" disabled={!valid}>Apply</button>
      </div>
    </form>,
    document.body,
  );
}

export function NativeStatusBar({
  objectCount,
  hiddenCount,
  presentation = false,
  onExitPresentation,
  selectionLabel,
  unitsLabel,
  plate,
  workspace,
  onPlateChange,
}: {
  objectCount: number;
  /** The document's hidden objects (lib/hiddenObjects.ts): the same count as the Inspector's banner. */
  hiddenCount: number;
  /** Presentation Mode: the footer holds only the Exit button (centred in the window), a grid toggle and the zoom controls. */
  presentation?: boolean;
  onExitPresentation?: () => void;
  selectionLabel: string;
  unitsLabel: string;
  /** The build plate, in millimetres. */
  plate: { width: number; depth: number };
  /** Only what is needed to show and read lengths in the document's units. */
  workspace: Pick<WorkplaneWorkspaceSettings, "units" | "scale" | "accuracy">;
  onPlateChange: (widthMm: number, depthMm: number) => void;
}) {
  const [plateAnchor, setPlateAnchor] = useState<DOMRect | null>(null);
  void plateSizePatch;
  const camera = useSyncExternalStore(subscribeCameraStatus, getCameraStatus, () => null);
  const [zoomMenuOpen, setZoomMenuOpen] = useState(false);
  // The grid as the presentation starts with it; the footer's toggle changes the view only (nothing of the document).
  const [gridVisible, setGridVisible] = useState(true);
  useEffect(() => {
    if (presentation) setGridVisible(window.layerlingWorkplaneDisplay?.().visible ?? true);
  }, [presentation]);
  const inspectorShown = useInspectorVisible();
  const ui = useSyncExternalStore(subscribeUiState, getUiState, () => null);
  const controller = getCameraController();
  const position = camera ? sliderFromDistance(camera.distance, camera.minDistance, camera.maxDistance) : 0;
  const mode = ui?.mode ?? "geometry";

  return (
    <footer className="dashboard-legal editor-legal native-status-bar" aria-label="Status bar" data-presentation={presentation ? "on" : undefined}>
      {presentation ? (
        <button type="button" className="native-presentation-exit" data-presentation-exit onClick={onExitPresentation} title="Exit Presentation Mode (Esc)">
          Exit Presentation Mode
        </button>
      ) : null}
      <div className="native-status-group native-status-info">
        <span className="native-status-item" data-status="selection" title="Selection">{selectionLabel}</span>
        <span className="native-status-sep" aria-hidden="true" />
        <span className="native-status-item" data-status="objects" title="Objects in the model">{objectCount === 1 ? "1 object" : `${objectCount} objects`}</span>
        {hiddenCount > 0 ? (
          <>
            <span className="native-status-sep" aria-hidden="true" />
            <span className="native-status-item native-status-hidden" data-status="hidden" title="Hidden objects (View > Unhide All)"><EyeOff size={12} aria-hidden="true" />{hiddenObjectsLabel(hiddenCount)}</span>
          </>
        ) : null}
        <span className="native-status-sep" aria-hidden="true" />
        <span className="native-status-item" data-status="units" title="Measurement units">{unitsLabel}</span>
        <span className="native-status-sep" aria-hidden="true" />
        <button
          type="button"
          className="native-status-item native-status-plate"
          data-status="plate"
          title="Edit the build plate size"
          aria-haspopup="dialog"
          aria-expanded={plateAnchor !== null}
          onClick={(event) => {
            // Read the rectangle NOW: React may run the updater after the event's currentTarget has been cleared.
            const rect = event.currentTarget.getBoundingClientRect();
            setPlateAnchor((open) => (open ? null : rect));
          }}
        >
          {plateSummary(plate.width, plate.depth, workspace)}
        </button>
        {plateAnchor ? <PlateEditor anchor={plateAnchor} workspace={workspace} widthMm={plate.width} depthMm={plate.depth} onApply={onPlateChange} onClose={() => setPlateAnchor(null)} /> : null}
        <span className="native-status-sep" aria-hidden="true" />
        <span className="native-status-item" data-status="mode" title="Editing mode (Model menu)">
          {mode === "sketch" ? "Sketch" : "3D Editor"}
          {mode === "geometry" && camera ? ` · ${camera.orthographic ? "Orthographic" : "Perspective"}` : ""}
        </span>
      </div>
      <div className="native-status-group native-status-controls">
        {presentation ? (
          <button
            type="button"
            className="native-status-button"
            data-presentation-grid
            aria-label="Show grid"
            title={gridVisible ? "Hide the grid" : "Show the grid"}
            aria-pressed={gridVisible}
            onClick={() => {
              const next = !gridVisible;
              window.layerlingWorkplaneDisplay?.(next);
              setGridVisible(next);
            }}
          >
            <GridEyeIcon size={15} strokeWidth={2.1} crossed={!gridVisible} aria-hidden="true" />
          </button>
        ) : null}
        <button type="button" className="native-status-button" aria-label="Focus mode" title="Focus mode (View menu)" aria-pressed={Boolean(ui?.focusMode)} onClick={() => runUiCommand("focusMode.toggle")}>
          <Maximize2 size={13} aria-hidden="true" />
        </button>
        <button type="button" className="native-status-button" aria-label="Pin ribbon" title="Keep every ribbon group open (View menu)" aria-pressed={Boolean(ui?.ribbonPinned)} onClick={() => runUiCommand("ribbonPin.toggle")}>
          {ui?.ribbonPinned ? <Pin size={13} aria-hidden="true" /> : <PinOff size={13} aria-hidden="true" />}
        </button>
        <button type="button" className="native-status-button" aria-label="Inspector" title={inspectorShown ? "Hide Inspector (⌥⌘I)" : "Show Inspector (⌥⌘I)"} aria-pressed={inspectorShown} onClick={toggleInspectorVisible}>
          <PanelRight size={13} aria-hidden="true" />
        </button>
        <span className="native-status-sep" aria-hidden="true" />
        {/* The Snap Grid selector and the mm/in chooser: the editor's own control, shown here (footerSnap.ts). */}
        <div className="native-status-snap" ref={setFooterSnapSlot} />
        <span className="native-status-sep native-status-snap-sep" aria-hidden="true" />
        <div className="native-zoom" role="group" aria-label="Zoom" data-disabled={camera && mode === "geometry" ? undefined : "true"}>
          <button type="button" className="native-status-button" aria-label="Zoom out" title="Zoom out" disabled={!camera || mode !== "geometry"} onClick={() => controller?.zoomOut()}>
            <Minus size={13} aria-hidden="true" />
          </button>
          <input
            type="range"
            className="native-zoom-slider"
            aria-label="Zoom"
            min={0}
            max={1000}
            step={1}
            value={Math.round(position * 1000)}
            disabled={!camera || mode !== "geometry"}
            onChange={(event) => {
              if (camera) controller?.setDistance(distanceFromSlider(Number(event.target.value) / 1000, camera.minDistance, camera.maxDistance));
            }}
            onDoubleClick={() => controller?.home()}
            title="Zoom (double-click for the home view)"
          />
          <button type="button" className="native-status-button" aria-label="Zoom in" title="Zoom in" disabled={!camera || mode !== "geometry"} onClick={() => controller?.zoomIn()}>
            <Plus size={13} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="native-zoom-value"
            data-status="zoom"
            title="Choose or enter a zoom percentage (relative to the home view)"
            aria-haspopup="menu"
            aria-expanded={zoomMenuOpen}
            disabled={!camera || mode !== "geometry"}
            onClick={() => setZoomMenuOpen((open) => !open)}
          >
            {camera ? formatZoomPercent(camera.distance) : "—"}
          </button>
          {zoomMenuOpen && camera ? <ZoomPercentMenu camera={camera} onClose={() => setZoomMenuOpen(false)} /> : null}
        </div>
      </div>
    </footer>
  );
}
