import { useEffect, useRef, useSyncExternalStore } from "react";
import { getUiState, subscribeUiState } from "@/lib/host/nativeUi";

/**
 * Where the Snap Grid selector, its step menu and the mm/in chooser are shown in the native app (Build 0003 refinement): in the status bar, beside
 * the zoom controls, instead of floating over the canvas. It is a presentation change only: the existing control (SnapGridControl) is rendered into
 * the status bar's slot through a portal, with the same state and handlers as before. Focus mode hides the status bar, so there the control stays
 * where it always was. The control is rendered in up to three places (the 3D view, the selection panels, the sketch view); exactly one of them
 * claims the slot at a time, so it is never shown twice.
 */
let slot: HTMLElement | null = null;
let claimant: symbol | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** The status bar registers its slot element (and clears it when it goes away). */
export function setFooterSnapSlot(element: HTMLElement | null) {
  if (slot === element) return;
  slot = element;
  if (!element) claimant = null;
  notify();
}

/** `target` is where to render the control (null: in place, as the browser does); `owner` says whether THIS instance is the one that renders it. */
export function useFooterSnapSlot(): { target: HTMLElement | null; owner: boolean } {
  const id = useRef<symbol>(Symbol("snap")).current;
  const element = useSyncExternalStore(subscribe, () => slot, () => null);
  const focusMode = useSyncExternalStore(subscribeUiState, () => Boolean(getUiState()?.focusMode), () => false);
  const target = element && !focusMode ? element : null;
  const free = useSyncExternalStore(subscribe, () => claimant === null, () => true);
  const owner = useSyncExternalStore(subscribe, () => claimant === id, () => false);
  useEffect(() => {
    if (target && claimant === null) {
      claimant = id;
      notify();
    }
  }, [target, free, id]);
  useEffect(() => {
    if (!target && claimant === id) {
      claimant = null;
      notify();
    }
  }, [target, id]);
  useEffect(
    () => () => {
      if (claimant === id) {
        claimant = null;
        notify();
      }
    },
    [id],
  );
  return { target, owner };
}
