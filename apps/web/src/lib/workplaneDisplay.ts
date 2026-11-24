/**
 * Whether the workplane (the build plate: its surface, boundary, grid and labels) is shown in this window's 3D view (Build 0075).
 *
 * The switch itself is the viewport's existing one (the eye in the camera bar, `window.layerlingWorkplaneDisplay`): a view setting of this page only, never part of the
 * document, so it makes no undo step and no unsaved change, every window and tab has its own (each is its own page), and a page starts with the workplane shown. This module only
 * lets the native footer's button show the state: the viewport publishes it whenever it changes, and it outlives the viewport (leaving and re-entering Sketch mode keeps it).
 */
let visible = true;
const listeners = new Set<() => void>();

export function getWorkplaneVisible(): boolean {
  return visible;
}

/** Called by the viewport when its workplane visibility changes. */
export function publishWorkplaneVisible(next: boolean): void {
  if (next === visible) return;
  visible = next;
  for (const listener of listeners) listener();
}

export function subscribeWorkplaneVisible(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
