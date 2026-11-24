import { getHostBridge, subscribeToHostBridge, type HostBridge } from "@/lib/host/hostBridge";
import { nativeDocumentId } from "@/lib/host/nativeUi";
import type { NativeShapesCatalog } from "@/lib/host/nativeShapes";

/**
 * The native toolbar prototype's page side (capability `ribbon.v1`). The host can draw some ribbon groups itself (as an NSToolbar); the editor stays the single
 * authority: it works out which tools exist, which are enabled (by its own rules) and which is active, publishes that as `ribbon.state`, and runs a tool when the
 * host sends `ribbon.invoke`. Nothing here runs without a host that granted `ribbon.v1`; in a browser the ribbon is simply the ribbon.
 */
export interface RibbonToolState {
  id: string;
  label: string;
  enabled: boolean;
  active: boolean;
  /** Why the tool is unavailable, or its own hint (the tooltip). */
  hint: string | null;
  shortcut: string | null;
  /** The canonical ribbon icon key (lib/host/ribbonIconCatalog.ts). */
  icon: string;
  /** A switch that is on or off beside the tools of its group (Construction line): it does not stand for the group. */
  toggle?: boolean;
  /** Drawn prominent (Finish sketch). */
  prominent?: boolean;
  /** A separator before this entry in the group's menu. */
  separatorBefore?: boolean;
}
export interface RibbonGroupState {
  id: string;
  label: string;
  /** menu: one split button with the tools in a menu; button: one button; buttons: each tool its own button. */
  kind: "menu" | "button" | "buttons";
  tools: RibbonToolState[];
}
export interface RibbonState {
  mode: "geometry" | "sketch";
  groups: RibbonGroupState[];
  /** The shape catalogue for the native Shapes popover (Build 0061), 3D editor only; see lib/host/nativeShapes.ts. */
  shapes?: NativeShapesCatalog;
}

let nativeActive = false;
let lastState = "";
const listeners = new Set<() => void>();
const invokeListeners = new Set<(toolId: string) => void>();
let offBridge: (() => void) | null = null;
let started = false;

function clearPending() {
  if (typeof document !== "undefined") delete document.documentElement.dataset.nativeRibbonPending;
}

function setActive(on: boolean) {
  clearPending();   // the host has answered (Native or Classic): the page decides from here
  if (nativeActive === on) return;
  nativeActive = on;
  lastState = "";   // a toolbar that has just appeared needs the whole state
  if (typeof document !== "undefined") {
    if (on) document.documentElement.dataset.nativeRibbon = "on";
    else delete document.documentElement.dataset.nativeRibbon;
  }
  listeners.forEach((listener) => listener());
}

function attach(bridge: HostBridge | null) {
  offBridge?.();
  offBridge = bridge
    ? bridge.onEvent((event) => {
        if (event.type === "ribbon.native" && event.payload.documentId === nativeDocumentId()) setActive(event.payload.enabled);
        else if (event.type === "ribbon.invoke" && event.payload.documentId === nativeDocumentId()) invokeListeners.forEach((listener) => listener(event.payload.toolId));
      })
    : null;
}

function ensureStarted() {
  if (started || typeof window === "undefined") return;
  started = true;
  // The host marks the page before it starts when Toolbar Appearance is Native; a host that never answers must not leave the ribbon hidden.
  if (typeof document !== "undefined" && document.documentElement.dataset.nativeRibbonPending !== undefined) setTimeout(clearPending, 8000);
  attach(getHostBridge());
  subscribeToHostBridge(attach);
}

/** Whether the host is drawing its own toolbar for this document (the web ribbon hides the groups the host draws). */
export function useNativeRibbonActiveSubscribe(listener: () => void): () => void {
  ensureStarted();
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export function nativeRibbonActive(): boolean {
  return nativeActive;
}
export function onNativeRibbonInvoke(listener: (toolId: string) => void): () => void {
  ensureStarted();
  invokeListeners.add(listener);
  return () => invokeListeners.delete(listener);
}

/** Sends the groups to the host when they changed. */
export function publishRibbonState(state: RibbonState) {
  const bridge = getHostBridge();
  const documentId = nativeDocumentId();
  if (!documentId || !bridge?.supportsRibbon()) return;
  const key = JSON.stringify(state);
  if (key === lastState) return;
  lastState = key;
  void bridge.sendUi("ribbon.state", { documentId, state });
}
