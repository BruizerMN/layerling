import { getHostBridge } from "@/lib/host/hostBridge";
import { nativeDocumentId, nativeUiActive } from "@/lib/host/nativeUi";

/*
 * Build 0091: the native colour picker for the Inspector's Solid swatch. Only with the macOS host (capability ui.v1 and a host that presents one); a browser, or a host that
 * says no, keeps the page's own colour input. The host puts a transient, invisible NSColorWell over the swatch's rectangle and clicks it, so macOS presents its own colour
 * popover (swatches and "Show Colors…") next to the swatch. Colours come back through `window.layerlingNativeColor.change(sessionId, "#rrggbb")` (one per change while the
 * person chooses, also from the Colors panel) and `.end(sessionId)` when the picking is over. The page applies them exactly as it applies a colour from its own input.
 */
interface NativeColorSession {
  id: string;
  onChange: (hex: string) => void;
  onEnd: () => void;
}

declare global {
  interface Window {
    layerlingNativeColor?: { change(id: string, hex: string): void; end(id: string): void };
  }
}

let current: NativeColorSession | null = null;

function install() {
  window.layerlingNativeColor = {
    change(id, hex) {
      if (current?.id === id && /^#[0-9a-f]{6}$/i.test(hex)) current.onChange(hex.toLowerCase());
    },
    end(id) {
      if (current?.id !== id) return;
      const session = current;
      current = null;
      session.onEnd();
    },
  };
}

/** True when the host can present the native picker (the request can still be refused: `openNativeColorPicker` then answers false). */
export function nativeColorPickerAvailable(): boolean {
  return nativeUiActive();
}

/** Asks the host for the native picker at the swatch (`rect`: left, top, width, height in page points). Answers false when the host did not take it. */
export async function openNativeColorPicker(args: { color: string; rect: [number, number, number, number]; onChange: (hex: string) => void; onEnd: () => void }): Promise<boolean> {
  const bridge = getHostBridge();
  const documentId = nativeDocumentId();
  if (!bridge || !documentId || !nativeUiActive() || !/^#[0-9a-f]{6}$/i.test(args.color)) return false;
  if (current) {
    // A new picker replaces the one that was still open: the host ends the old one; the page does not wait for it.
    const old = current;
    current = null;
    old.onEnd();
  }
  const id = `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  current = { id, onChange: args.onChange, onEnd: args.onEnd };
  install();
  const answer = await bridge.sendUi("ui.action", { documentId, action: "colorPicker.open", sessionId: id, color: args.color.toLowerCase(), rect: args.rect });
  if (!answer.ok) {
    if (current?.id === id) current = null;
    return false;
  }
  return true;
}
