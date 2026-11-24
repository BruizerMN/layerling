/**
 * Keys the native app (Hundchen Layers) keeps for its own menus (Build 0074). The page sees every key first, and a page that handles one with preventDefault takes it away from the
 * menu: Cmd+N reached the 3D editor's N key (the note tool) instead of File > New. In the native app Cmd+N belongs to the host's New command (which will also carry the New Window /
 * New Tab preference), so the page lets it pass untouched: no handling, no preventDefault. The browser edition is unchanged: there Ctrl/Cmd+N stays the browser's own, as before.
 * Plain and Shift N (notes), and every other key, are not affected.
 */
export type NativeMenuKeyEvent = Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">;

export function isNativeMenuKey(event: NativeMenuKeyEvent, native: boolean): boolean {
  if (!native) return false;
  return event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && (event.key ?? "").toLowerCase() === "n";
}
