import { createContext, useContext } from "react";

/**
 * The hidden objects of the open document, as every part of the native UI counts them (the Inspector's banner, the footer's indicator, the View menu's
 * Unhide All, the ribbon's old visibility badge): the objects of the current scene whose own `hidden` flag is set. A hidden GROUP counts once and its parts
 * are not counted again: they are hidden only because their parent is (visibility is inherited, never set on them), so listing them would double-count
 * what one click of Unhide All reveals. This is exactly the set Unhide All (`showHidden` in the editor) acts on, so the number always says what the
 * command will do. While a group is open for editing, its parts are the scene's objects and are counted as such.
 */
export function countHiddenObjects(shapes: readonly { hidden?: boolean }[]): number {
  let count = 0;
  for (const shape of shapes) if (shape.hidden) count += 1;
  return count;
}

export function hiddenObjectsLabel(count: number): string {
  return count === 1 ? "1 hidden object" : `${count} hidden objects`;
}

/**
 * What the Inspector and the footer share. `ids` is there so that a later version can reveal particular objects instead of all (the banner could list
 * them); nothing uses it yet.
 */
export interface HiddenObjectsState {
  count: number;
  ids: readonly string[];
  unhideAll: () => void;
}

export const HiddenObjectsContext = createContext<HiddenObjectsState>({ count: 0, ids: [], unhideAll: () => undefined });

export function useHiddenObjects(): HiddenObjectsState {
  return useContext(HiddenObjectsContext);
}
