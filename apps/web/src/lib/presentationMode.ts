/**
 * Presentation Mode (Build 0021, native app only): the editor's own viewport with editing switched off and the chrome gone.
 *
 * Read-only is enforced at the INPUT boundary, not by hiding controls: while the mode is on, a guard in the capture phase of the window (before any editor
 * handler, React's included) decides for every key and pointer event whether it may reach the editor at all. What may: the camera (wheel and pinch, a
 * right or middle drag, Cmd/Ctrl + drag, the modifier keys that go with them), Esc (leaves the mode) and F / Home (fit the whole model). Everything else
 * - a click that would select, a drag that would move, Delete, Cmd+Z, typing a shortcut, dropping a file - is stopped before it arrives. Host commands are
 * refused the same way in the toolbar's command handler. The guard does not prevent the default of Cmd+Q, so the application menu's Quit still works.
 */
export type KeyAction = "exit" | "fit" | "standby" | "swallow" | "allow" | "block";

const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "Meta", "CapsLock", "Fn", "FnLock"]);

export function presentationKeyAction(event: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; type: string; repeat?: boolean }, standby = false): KeyAction {
  if (MODIFIER_KEYS.has(event.key)) return "allow";
  if (event.metaKey && !event.ctrlKey && event.key.toLowerCase() === "q") return "allow";   // Quit stays the menu's
  if (event.key === "Escape") return event.type === "keydown" ? "exit" : "block";
  // Space is Standby / Resume (Build 0022): once per press (auto-repeat does nothing), and never reaches a button or the editor; with a modifier it is blocked like any key.
  if (event.key === " " && !event.ctrlKey && !event.metaKey && !event.altKey) return event.type === "keydown" && !event.repeat ? "standby" : "swallow";
  // While on standby the model is hidden and the camera must stay exactly where it is: no fitting.
  if (!standby && event.type === "keydown" && !event.ctrlKey && !event.metaKey && !event.altKey && (event.key === "Home" || event.key.toLowerCase() === "f")) return "fit";
  return "block";
}

export interface PointerLike { type: string; button: number; buttons: number; ctrlKey: boolean; metaKey: boolean; pointerType?: string }

/** Whether a pointer or mouse event on the viewport is stopped. Camera gestures pass; anything a plain left button would do does not. */
export function presentationBlocksPointer(event: PointerLike, standby = false): boolean {
  // On standby nothing reaches the (hidden) model: no gesture, no wheel, no pinch.
  if (standby) return true;
  if (event.type === "wheel" || event.type.startsWith("gesture")) return false;
  if (event.type === "dblclick" || event.type === "contextmenu") return true;
  if (event.pointerType === "touch") return false;   // a touch screen's fingers turn the view; there are none on a Mac
  const cameraModifier = event.ctrlKey || event.metaKey;
  if (event.type === "pointermove" || event.type === "mousemove") {
    // Hovering would light bodies up; a drag with the right, middle or Cmd/Ctrl + left button is the camera's.
    return !((event.buttons & 6) !== 0 || ((event.buttons & 1) !== 0 && cameraModifier));
  }
  if (event.button === 0) return !cameraModifier;
  return false;
}

export interface GuardOptions {
  onExit: () => void;
  onFit: () => void;
  /** Space: toggle Standby / Resume. */
  onStandby: () => void;
  /** Whether Standby is on now (the guard reads it for every event). */
  standby: () => boolean;
  /** Elements that belong to the viewport: pointer events elsewhere (the footer's buttons) are not the guard's business. */
  viewport: () => Element | null;
}

/** Installs the guard; returns the remover. */
export function startPresentationGuard(options: GuardOptions): () => void {
  const onKey = (event: KeyboardEvent) => {
    const action = presentationKeyAction(event, options.standby());
    if (action === "allow") return;
    // A key typed into the footer's own controls (the zoom slider, the buttons) is theirs: Esc and F still work from there.
    event.stopImmediatePropagation();
    if (action === "exit") { event.preventDefault(); options.onExit(); return; }
    if (action === "fit") { event.preventDefault(); options.onFit(); return; }
    if (action === "standby") { event.preventDefault(); options.onStandby(); return; }
    if (action === "swallow") { event.preventDefault(); return; }
    // Blocked: not default-prevented, so a menu's key equivalent (disabled by the host) and the system keep what is theirs.
  };
  const onPointer = (event: Event) => {
    const target = event.target as Node | null;
    const area = options.viewport();
    if (!area || !target || !area.contains(target)) return;
    const e = event as PointerEvent;
    if (presentationBlocksPointer({ type: e.type, button: e.button, buttons: e.buttons, ctrlKey: e.ctrlKey, metaKey: e.metaKey, pointerType: e.pointerType }, options.standby())) {
      event.stopImmediatePropagation();
      if (event.type === "contextmenu") event.preventDefault();
    }
  };
  const onDrop = (event: Event) => { event.preventDefault(); event.stopImmediatePropagation(); };
  const keyEvents = ["keydown", "keyup", "keypress"] as const;
  const pointerEvents = ["pointerdown", "pointerup", "pointermove", "mousedown", "mouseup", "mousemove", "click", "auxclick", "dblclick", "contextmenu", "wheel", "gesturestart", "gesturechange", "gestureend"] as const;
  const dropEvents = ["dragenter", "dragover", "drop"] as const;
  keyEvents.forEach((name) => window.addEventListener(name, onKey, true));
  pointerEvents.forEach((name) => window.addEventListener(name, onPointer, true));
  dropEvents.forEach((name) => window.addEventListener(name, onDrop, true));
  return () => {
    keyEvents.forEach((name) => window.removeEventListener(name, onKey, true));
    pointerEvents.forEach((name) => window.removeEventListener(name, onPointer, true));
    dropEvents.forEach((name) => window.removeEventListener(name, onDrop, true));
  };
}
