import { getHostBridge, subscribeToHostBridge, type HostBridge } from "@/lib/host/hostBridge";
import type { HostEvent, NativeMenuItem } from "@/lib/host/hostProtocol";

/**
 * Presents a contextual menu as a real macOS menu (capability `ui.menu.v1`, hostProtocol.ts). The page keeps ALL the logic: it builds the items from its
 * own state exactly as it does for its web menu, hands the host their titles and structure, and runs the chosen item's own function when the host reports
 * the choice. The host knows nothing about what a command does. In a browser, or with a host that does not offer menus, `showNativeMenu` returns false and
 * the caller shows its web menu as before.
 */
export interface NativeMenuHandlers {
  /** The user chose the item with this key (`shift`: Shift was held). */
  onChoose: (key: string, modifiers: { shift: boolean }) => void;
  /** The pointer or the keyboard is on the item with this key, or on none (null). */
  onHighlight?: (key: string | null) => void;
  /** The menu closed without a choice. */
  onCancel?: () => void;
}

let counter = 0;
const pending = new Map<string, NativeMenuHandlers>();
let unsubscribe: (() => void) | null = null;
let offBridge: (() => void) | null = null;

function ensureListening() {
  if (unsubscribe) return;
  const attach = (bridge: HostBridge | null) => {
    offBridge?.();
    offBridge = bridge
      ? bridge.onEvent((event: HostEvent) => {
          if (event.type === "menu.result") {
            const handlers = pending.get(event.payload.menuId);
            if (!handlers) return;
            pending.delete(event.payload.menuId);
            if (event.payload.key === null) handlers.onCancel?.();
            else handlers.onChoose(event.payload.key, { shift: event.payload.shift });
          } else if (event.type === "menu.highlight") {
            pending.get(event.payload.menuId)?.onHighlight?.(event.payload.key);
          }
        })
      : null;
  };
  attach(getHostBridge());
  const off = subscribeToHostBridge(attach);
  unsubscribe = () => {
    off();
    offBridge?.();
    offBridge = null;
    unsubscribe = null;
  };
}

export function nativeMenusAvailable(): boolean {
  return Boolean(getHostBridge()?.supportsMenu());
}

/** Shows the menu at the pointer (page coordinates). Returns false (and shows nothing) when the host cannot present it. */
export function showNativeMenu(documentId: string, request: { x: number; y: number; label?: string; items: NativeMenuItem[] }, handlers: NativeMenuHandlers): boolean {
  const bridge = getHostBridge();
  if (!bridge?.supportsMenu() || request.items.length === 0) return false;
  ensureListening();
  const menuId = `m${++counter}`;
  pending.set(menuId, handlers);
  void bridge.sendUi("menu.show", { documentId, menuId, x: request.x, y: request.y, ...(request.label ? { label: request.label } : {}), items: request.items }).then((reply) => {
    if (!reply.ok) {
      pending.delete(menuId);
      handlers.onCancel?.();
    }
  });
  return true;
}
