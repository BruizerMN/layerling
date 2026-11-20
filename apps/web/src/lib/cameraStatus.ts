/**
 * What the status bar knows about the 3D camera, and the one way it changes it.
 *
 * Zoom has no unit of its own in this editor: a perspective camera zooms by moving along its view axis, an orthographic one by changing
 * `camera.zoom`. Both are one thing - how much of the scene the view takes in - so the status bar uses the camera's *view distance* (for an
 * orthographic camera the distance a perspective camera would need to frame the same height). The percentage shown is the home framing's
 * distance divided by the current one: 100 % is the view the Home button gives, 200 % twice as close. Nothing here is invented: the clamps are
 * the camera's own (CAMERA_MIN_DISTANCE .. CAMERA_MAX_DISTANCE).
 */
export const HOME_VIEW_DISTANCE = Math.hypot(118, 96, 118); // CAMERA_HOME to CAMERA_TARGET (cameraRig.ts)

export type CameraStatus = { distance: number; orthographic: boolean; minDistance: number; maxDistance: number };

export interface CameraController {
  /** Moves the camera to this view distance (clamped), keeping its direction and target. */
  setDistance(distance: number): void;
  zoomIn(): void;
  zoomOut(): void;
  home(): void;
}

export function zoomPercent(distance: number): number {
  return (HOME_VIEW_DISTANCE / Math.max(distance, 1e-6)) * 100;
}

export function formatZoomPercent(distance: number): string {
  const percent = zoomPercent(distance);
  if (percent >= 1000) return `${Math.round(percent / 10) * 10}%`;
  if (percent >= 100) return `${Math.round(percent)}%`;
  return `${percent.toFixed(percent >= 10 ? 0 : 1)}%`;
}

/** Slider position 0..1 (left = farthest, right = closest) on a logarithmic scale, so every step is the same factor. */
export function sliderFromDistance(distance: number, min: number, max: number): number {
  const d = Math.min(max, Math.max(min, distance));
  return Math.log(max / d) / Math.log(max / min);
}

export function distanceFromSlider(position: number, min: number, max: number): number {
  const p = Math.min(1, Math.max(0, position));
  return max * Math.pow(min / max, p);
}

let status: CameraStatus | null = null;
let controller: CameraController | null = null;
const listeners = new Set<() => void>();

/** Called from the render loop after each frame; only a real change (more than 0.1 %, or the projection) reaches the listeners. */
export function publishCameraStatus(next: CameraStatus) {
  if (status && status.orthographic === next.orthographic && Math.abs(status.distance - next.distance) <= status.distance * 0.001) return;
  status = next;
  listeners.forEach((listener) => listener());
}

export function getCameraStatus(): CameraStatus | null {
  return status;
}

export function subscribeCameraStatus(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function registerCameraController(next: CameraController | null) {
  controller = next;
  if (!next) {
    status = null;
    listeners.forEach((listener) => listener());
  }
}

export function getCameraController(): CameraController | null {
  return controller;
}
