"use client";

import { Maximize2, Minus, Pin, PinOff, Plus } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ZOOM_PRESET_PERCENTS, distanceFromPercent, distanceFromSlider, formatZoomPercent, getCameraController, getCameraStatus, parseZoomPercent, percentRange, sliderFromDistance, subscribeCameraStatus, zoomPercent, type CameraStatus } from "@/lib/cameraStatus";
import { setFooterSnapSlot } from "@/lib/footerSnap";
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

export function NativeStatusBar({
  objectCount,
  selectionLabel,
  unitsLabel,
  plateLabel,
}: {
  objectCount: number;
  selectionLabel: string;
  unitsLabel: string;
  plateLabel: string;
}) {
  const camera = useSyncExternalStore(subscribeCameraStatus, getCameraStatus, () => null);
  const [zoomMenuOpen, setZoomMenuOpen] = useState(false);
  const ui = useSyncExternalStore(subscribeUiState, getUiState, () => null);
  const controller = getCameraController();
  const position = camera ? sliderFromDistance(camera.distance, camera.minDistance, camera.maxDistance) : 0;
  const mode = ui?.mode ?? "geometry";

  return (
    <footer className="dashboard-legal editor-legal native-status-bar" aria-label="Status bar">
      <div className="native-status-group native-status-info">
        <span className="native-status-item" data-status="selection" title="Selection">{selectionLabel}</span>
        <span className="native-status-sep" aria-hidden="true" />
        <span className="native-status-item" data-status="objects" title="Objects in the model">{objectCount === 1 ? "1 object" : `${objectCount} objects`}</span>
        <span className="native-status-sep" aria-hidden="true" />
        <span className="native-status-item" data-status="units" title="Measurement units">{unitsLabel}</span>
        <span className="native-status-sep" aria-hidden="true" />
        <span className="native-status-item" data-status="plate" title="Workplane">{plateLabel}</span>
        <span className="native-status-sep" aria-hidden="true" />
        <span className="native-status-item" data-status="mode" title="Editing mode (Model menu)">
          {mode === "sketch" ? "Sketch" : "3D Editor"}
          {mode === "geometry" && camera ? ` · ${camera.orthographic ? "Orthographic" : "Perspective"}` : ""}
        </span>
      </div>
      <div className="native-status-group native-status-controls">
        <button type="button" className="native-status-button" aria-label="Focus mode" title="Focus mode (View menu)" aria-pressed={Boolean(ui?.focusMode)} onClick={() => runUiCommand("focusMode.toggle")}>
          <Maximize2 size={13} aria-hidden="true" />
        </button>
        <button type="button" className="native-status-button" aria-label="Pin ribbon" title="Keep every ribbon group open (View menu)" aria-pressed={Boolean(ui?.ribbonPinned)} onClick={() => runUiCommand("ribbonPin.toggle")}>
          {ui?.ribbonPinned ? <Pin size={13} aria-hidden="true" /> : <PinOff size={13} aria-hidden="true" />}
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
