import { nativeUiActive, requestHostAction, subscribeNativeUiEvents } from "@/lib/host/nativeUi";

/*
 * Build 0090: a colour-picker SESSION is the whole time someone is choosing a colour with the native picker: from the moment the picker takes the colour input
 * until they are done with it. The colours chosen on the way are interactive previews (the model follows in real time); the session as a whole is ONE change.
 * The editor holds its "interaction" (one Undo step, nothing saved half-way) for exactly as long as the session lasts.
 *
 * WebKit tells the page when a session starts (the input gets focus, then `input`/`change` events), but it never tells it when the session ends: the native Colors
 * panel is a window of its own, closing it fires no DOM event, and the input stays focused. The macOS host sees it (NSColorPanel closes) and tells the document that
 * declared the session (`colorPanel.closed`, routed per document: see the host's ColorPanelSessionHost). The page also ends a session itself when the input loses
 * focus to something else on the page (the fallback; and the only end in a browser, which has no host).
 */

export interface PickerSession {
  /** The session starts (idempotent: the picker's focus and every colour event may call it). */
  begin(): void;
  /** The session ends; true when one was open (so the caller knows it was the one that ended it). */
  end(): boolean;
  readonly active: boolean;
}

/** `hold` runs the editor's interaction hold on and off; `announce` tells the host which document has a session (a no-op without a host). */
export function createPickerSession(hold: (active: boolean) => void, announce?: (active: boolean) => void): PickerSession {
  let active = false;
  return {
    begin() {
      if (active) return;
      active = true;
      hold(true);
      announce?.(true);
    },
    end() {
      if (!active) return false;
      active = false;
      hold(false);
      announce?.(false);
      return true;
    },
    get active() {
      return active;
    },
  };
}

/** Tells the host that this document has (or no longer has) a colour-picker session, so it can route "the Colors panel closed" to the right document. */
export function announceColorSession(active: boolean) {
  requestHostAction(active ? "colorSessionBegin" : "colorSessionEnd");
}

/** The host says the native Colors panel was closed: the session of this document, if it has one, is over. */
export function subscribeColorPanelClosed(listener: () => void): () => void {
  return subscribeNativeUiEvents((event) => {
    if (event.type === "ui.command" && event.payload.command === "colorPanel.closed") listener();
  });
}

/**
 * Losing the window's focus (switching to another application) is not the user being done with the picker: with the host the session goes on, and the host's
 * "Colors panel closed" (or a real focus change inside the page) ends it. In a browser, which never says, the blur is the only end there is.
 */
export function blurEndsSession(): boolean {
  return !(nativeUiActive() && !document.hasFocus());
}
