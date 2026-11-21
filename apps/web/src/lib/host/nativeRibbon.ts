import { getHostBridge, subscribeToHostBridge, type HostBridge } from "@/lib/host/hostBridge";
import { nativeDocumentId } from "@/lib/host/nativeUi";

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
}
export interface RibbonGroupState {
  id: string;
  label: string;
  tools: RibbonToolState[];
}

let nativeActive = false;
let lastState = "";
const listeners = new Set<() => void>();
const invokeListeners = new Set<(toolId: string) => void>();
let offBridge: (() => void) | null = null;
let started = false;

function setActive(on: boolean) {
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
export function publishRibbonState(groups: RibbonGroupState[]) {
  const bridge = getHostBridge();
  const documentId = nativeDocumentId();
  if (!documentId || !bridge?.supportsRibbon()) return;
  const key = JSON.stringify(groups);
  if (key === lastState) return;
  lastState = key;
  void bridge.sendUi("ribbon.state", { documentId, state: { groups } });
}
