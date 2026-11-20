"use client";

import { Maximize2, Minus, Pin, PinOff, Plus } from "lucide-react";
import { useSyncExternalStore } from "react";
import { distanceFromSlider, formatZoomPercent, getCameraController, getCameraStatus, sliderFromDistance, subscribeCameraStatus } from "@/lib/cameraStatus";
import { getUiState, runUiCommand, subscribeUiState } from "@/lib/host/nativeUi";

/**
 * The native app's status bar (Build 0003): replaces the browser footer in the macOS app only. It is a web bar inside the editor because
 * everything it shows - selection, object count, units, mode, the camera - is editor state that changes constantly; an AppKit bar would need all
 * of it streamed over the bridge. It reads that state from the editor and the camera on change only, and acts through the same functions as the
 * view bar, the mouse and the Model/View menus. Styled with system fonts and colours.
 */
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
          <span className="native-zoom-value" data-status="zoom" title="Zoom relative to the home view">{camera ? formatZoomPercent(camera.distance) : "—"}</span>
        </div>
      </div>
    </footer>
  );
}
