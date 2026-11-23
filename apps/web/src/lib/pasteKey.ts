/**
 * How the editor's own Ctrl/Cmd+V takes the clipboard (#1548).
 *
 * "await-paste-event": the browser edition leaves the key alone, so the browser fires a paste event that brings the
 * system clipboard along (Firefox then does not ask with its Paste menu); the editor falls back to its own read if
 * none comes.
 *
 * "run-now": in the native app (Hundchen Layers) the key is also a menu key equivalent. A keydown the page leaves
 * unhandled is handed back to AppKit, whose Edit > Paste runs the paste, and a menu action never produces a DOM paste
 * event, so the wait above would end in a second paste: one keyboard paste made two sets of objects and two Undo
 * steps. The page therefore handles the key itself, once, and prevents the default so the menu never sees it (as it
 * does for Copy, Cut and Duplicate). Edit > Paste from the menu is unchanged.
 */
export type PasteKeyHandling = "await-paste-event" | "run-now";

export function pasteKeyHandling(nativeDocument: boolean): PasteKeyHandling {
  return nativeDocument ? "run-now" : "await-paste-event";
}
