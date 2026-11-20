import { getHostBridge, subscribeToHostBridge, type HostBridge } from "@/lib/host/hostBridge";
import type { HostEvent, UiCommand } from "@/lib/host/hostProtocol";

/**
 * The page's side of the native shell's menus and Settings windows (capability `ui.v1`, hostProtocol.ts). Nothing here does anything in a browser:
 * without a host that granted `ui.v1` every function is a no-op, and the editor's own controls work as they always did.
 */
export type NativeUiState = { mode: "geometry" | "sketch"; sketchEnabled: boolean; focusMode: boolean; ribbonPinned: boolean };

let documentId: string | null = null;
let lastState = "";
let latestUiState: NativeUiState | null = null;
const uiStateListeners = new Set<() => void>();

/** The menu-relevant state as the toolbar last reported it (the status bar's focus and pin buttons read it). */
export function getUiState(): NativeUiState | null {
  return latestUiState;
}
export function subscribeUiState(listener: () => void): () => void {
  uiStateListeners.add(listener);
  return () => uiStateListeners.delete(listener);
}
/** Runs a menu command from inside the page (the status bar's buttons): the toolbar owns the functions, exactly as for a host menu. */
export function runUiCommand(command: UiCommand) {
  window.dispatchEvent(new CustomEvent("layerling:ui-command", { detail: command }));
}

/** The page runs exactly one document; the editor says which when it opens (and clears it when it goes away). */
export function setNativeUiDocument(id: string | null) {
  documentId = id;
  lastState = "";
  // The toolbar (a child of the editor) reports before the editor says which document it is: send what it already reported.
  if (id && latestUiState) publishUiState(latestUiState);
}

export function nativeUiActive(): boolean {
  return documentId !== null && Boolean(getHostBridge()?.supportsUi());
}

/** Reports what the menus show (the mode checkmark, focus mode, ribbon pin). Only when it changed. */
export function publishUiState(state: NativeUiState) {
  const key = JSON.stringify(state);
  if (JSON.stringify(latestUiState) !== key) {
    latestUiState = state;
    uiStateListeners.forEach((listener) => listener());
  }
  const bridge = getHostBridge();
  if (!documentId || !bridge?.supportsUi()) return;
  if (key === lastState) return;
  lastState = key;
  void bridge.sendUi("ui.state", { documentId, state });
}

/** Asks the host to open one of its windows. */
export function requestHostAction(action: "openSettings" | "openDocumentSettings") {
  const bridge = getHostBridge();
  if (!documentId || !bridge?.supportsUi()) return false;
  void bridge.sendUi("ui.action", { documentId, action });
  return true;
}

/** Sends the document's own settings to its Document Settings window (only while it watches). */
export function publishSettingsState(payload: { workspace: Record<string, unknown>; snap: string; hasStartView: boolean }) {
  const bridge = getHostBridge();
  if (!documentId || !bridge?.supportsUi()) return;
  void bridge.sendUi("settings.state", { documentId, ...payload });
}

type UiEvent = Extract<HostEvent, { type: "ui.command" | "settings.apply" | "settings.watch" }>;

/** Subscribes to the host's ui events for as long as the page lives, also when the bridge appears after the subscription. */
export function subscribeNativeUiEvents(listener: (event: UiEvent) => void): () => void {
  let offEvents: (() => void) | null = null;
  const attach = (bridge: HostBridge | null) => {
    offEvents?.();
    offEvents = bridge
      ? bridge.onEvent((event) => {
          if (event.type === "ui.command" || event.type === "settings.apply" || event.type === "settings.watch") {
            if (documentId === null || event.payload.documentId === documentId) listener(event);
          }
        })
      : null;
  };
  attach(getHostBridge());
  const off = subscribeToHostBridge(attach);
  return () => {
    off();
    offEvents?.();
  };
}

export type { UiCommand };
