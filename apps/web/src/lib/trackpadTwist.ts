/**
 * Two-finger trackpad twist: orbit the 3D camera horizontally (Build 0051).
 *
 * WebKit (Safari, and the WKWebView of the native app) sends a trackpad pinch or twist as `gesturestart` / `gesturechange` / `gestureend` events whose `scale` and
 * `rotation` are CUMULATIVE since the gesture began (`rotation` in degrees, clockwise positive; observed on a real trackpad, see docs/TRACKPAD-TWIST.md). The pinch half of
 * this is already handled in viewportScene.ts (each change of `scale` becomes a Ctrl+wheel step); this file adds only the rotation half and never touches that path.
 *
 * The camera is turned with OrbitControls' own public `rotateLeft(angle)`: azimuth only, so the elevation and the orbit target stay as they are, exactly as the
 * horizontal part of a right-button drag does.
 */

/** The first 8 degrees of a twist are ignored (a pinch or a sloppy touch can carry a few degrees of rotation). Subtracted from what is applied, so nothing jumps. */
export const TWIST_DEAD_ZONE_DEGREES = 8;
/** Degrees the camera turns per degree of twist beyond the dead zone. */
export const TWIST_ORBIT_GAIN = 1;

/** What one gesture remembers; a new gesture starts from nothing (`startTwistGesture`). */
export interface TwistGesture {
  /** `rotation` as the gesture began (WebKit reports about 0, not exactly 0). */
  base: number;
  /** 0 until the dead zone has been crossed; then the side it was crossed on, kept for the rest of the gesture so it is never entered again. */
  direction: 0 | 1 | -1;
  /** The twist already handed to the camera, in degrees. */
  applied: number;
}

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

export function startTwistGesture(rotation: unknown): TwistGesture {
  return { base: finite(rotation) ? rotation : 0, direction: 0, applied: 0 };
}

/**
 * The degrees the camera should turn now, for a `gesturechange` whose cumulative `rotation` is given (updates `gesture`). 0 inside the dead zone, for a missing or
 * malformed value, and when nothing changed. Once the dead zone has been crossed the applied twist is always (turned - side * dead zone): continuous at the crossing,
 * and a reversal simply runs back through it and on, without a second dead zone.
 */
export function twistStep(gesture: TwistGesture, rotation: unknown): number {
  if (!finite(rotation)) return 0;
  const turned = rotation - gesture.base;
  if (gesture.direction === 0) {
    if (Math.abs(turned) <= TWIST_DEAD_ZONE_DEGREES) return 0;
    gesture.direction = turned > 0 ? 1 : -1;
  }
  const target = turned - gesture.direction * TWIST_DEAD_ZONE_DEGREES;
  const delta = target - gesture.applied;
  gesture.applied = target;
  return delta;
}

/**
 * The argument for `OrbitControls.rotateLeft` that turns the model with the fingers, like a turntable: a clockwise twist (positive) makes the model appear to turn
 * clockwise as seen from above. `rotateLeft(a)` lowers the camera's azimuth by `a`, which carries the CAMERA clockwise seen from above (the model then appears to turn
 * counter-clockwise), so the angle is negated. Verified against a real OrbitControls and camera in tests/unit/trackpadTwist.test.ts.
 */
export function orbitAngleForTwist(twistDegrees: number): number {
  return -(twistDegrees * TWIST_ORBIT_GAIN * Math.PI) / 180;
}

/** The part of OrbitControls this needs. */
export interface TwistOrbitControls {
  enabled: boolean;
  rotateLeft: (angle: number) => void;
}

type GestureLike = Event & { rotation?: unknown };

/**
 * Listens for the gesture events on `element` (the 3D canvas) and turns the camera. Observes only: no `preventDefault`, no `stopPropagation`, so the pinch handler and
 * everything else see the same events as before. `onTurning` runs just before each turn (the caller cancels a running view-cube turn there). Returns the detach function.
 * Only a gesture that began on `element` is followed (a change without a start is ignored), and a lost window focus ends it; the next gesture starts from nothing.
 */
export function attachTrackpadTwist(element: EventTarget, controls: TwistOrbitControls, onTurning?: () => void): () => void {
  let gesture: TwistGesture | null = null;
  const onStart = (event: Event) => {
    gesture = startTwistGesture((event as GestureLike).rotation);
  };
  const onChange = (event: Event) => {
    if (!gesture) return;
    // Followed even while the controls are off (a drag in progress) so that nothing is owed afterwards; only the turn itself waits for them.
    const delta = twistStep(gesture, (event as GestureLike).rotation);
    if (delta === 0 || !controls.enabled) return;
    onTurning?.();
    controls.rotateLeft(orbitAngleForTwist(delta));
  };
  const onEnd = () => {
    gesture = null;
  };
  element.addEventListener("gesturestart", onStart);
  element.addEventListener("gesturechange", onChange);
  element.addEventListener("gestureend", onEnd);
  const view = typeof window !== "undefined" ? window : null;
  view?.addEventListener("blur", onEnd);
  return () => {
    element.removeEventListener("gesturestart", onStart);
    element.removeEventListener("gesturechange", onChange);
    element.removeEventListener("gestureend", onEnd);
    view?.removeEventListener("blur", onEnd);
    gesture = null;
  };
}
