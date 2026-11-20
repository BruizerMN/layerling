import { beforeEach, describe, expect, it, vi } from "vitest";
import { INSPECTOR_VISIBLE_STORAGE_KEY, getInspectorVisible, readInspectorVisible, refreshInspectorVisible, setInspectorVisible, toggleInspectorVisible } from "@/lib/inspectorDock";

class MemoryStorage {
  private map = new Map<string, string>();
  getItem(key: string) { return this.map.get(key) ?? null; }
  setItem(key: string, value: string) { this.map.set(key, value); }
  removeItem(key: string) { this.map.delete(key); }
}
let storage: MemoryStorage;
beforeEach(() => {
  storage = new MemoryStorage();
  vi.stubGlobal("window", { localStorage: storage, dispatchEvent: () => true, addEventListener: () => undefined, removeEventListener: () => undefined });
  setInspectorVisible(true, storage);
});

describe("Inspector visibility is the user's preference, never the selection's", () => {
  it("a first run shows the Inspector, and only an explicit hide is remembered", () => {
    expect(readInspectorVisible(new MemoryStorage())).toBe(true);
    const s = new MemoryStorage();
    s.setItem(INSPECTOR_VISIBLE_STORAGE_KEY, "hidden");
    expect(readInspectorVisible(s)).toBe(false);
    s.setItem(INSPECTOR_VISIBLE_STORAGE_KEY, "garbage");
    expect(readInspectorVisible(s)).toBe(true);
  });

  it("hiding and showing persist (so they survive a restart) and are the only way it changes", () => {
    setInspectorVisible(false, storage);
    expect(getInspectorVisible()).toBe(false);
    expect(storage.getItem(INSPECTOR_VISIBLE_STORAGE_KEY)).toBe("hidden");
    setInspectorVisible(true, storage);
    expect(storage.getItem(INSPECTOR_VISIBLE_STORAGE_KEY)).toBeNull();
  });

  it("toggle flips it; another window's change is picked up from storage without echoing back", () => {
    toggleInspectorVisible();
    expect(getInspectorVisible()).toBe(false);
    storage.removeItem(INSPECTOR_VISIBLE_STORAGE_KEY);   // another window showed it again
    refreshInspectorVisible();
    expect(getInspectorVisible()).toBe(true);
    expect(storage.getItem(INSPECTOR_VISIBLE_STORAGE_KEY)).toBeNull();
  });
});
