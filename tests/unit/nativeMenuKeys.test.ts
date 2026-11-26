import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isNativeMenuKey } from "@/lib/nativeMenuKeys";

const press = (key: string, mods: Partial<{ metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }> = {}) =>
  ({ key, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...mods });

describe("keys the native app keeps for its menus", () => {
  it("Cmd+N is File > New in the native app", () => {
    expect(isNativeMenuKey(press("n", { metaKey: true }), true)).toBe(true);
    expect(isNativeMenuKey(press("N", { metaKey: true }), true)).toBe(true);   // Caps Lock
  });
  it("the browser edition is unchanged", () => {
    expect(isNativeMenuKey(press("n", { metaKey: true }), false)).toBe(false);
    expect(isNativeMenuKey(press("n", { ctrlKey: true }), false)).toBe(false);
  });
  it("plain N, Shift+N (notes), Ctrl+N, Option and Shift variants and every other key stay with the page", () => {
    expect(isNativeMenuKey(press("n"), true)).toBe(false);
    expect(isNativeMenuKey(press("N", { shiftKey: true }), true)).toBe(false);
    expect(isNativeMenuKey(press("n", { ctrlKey: true }), true)).toBe(false);
    expect(isNativeMenuKey(press("n", { metaKey: true, shiftKey: true }), true)).toBe(false);
    expect(isNativeMenuKey(press("n", { metaKey: true, altKey: true }), true)).toBe(false);
    for (const k of ["c", "v", "x", "z", "a", "s", "d", "m", "l", "e"]) expect(isNativeMenuKey(press(k, { metaKey: true }), true), k).toBe(false);
  });
  it("Shift+Cmd+A is the native Edit > Deselect All, not Select All (Build 0093)", () => {
    expect(isNativeMenuKey(press("a", { metaKey: true, shiftKey: true }), true)).toBe(true);
    expect(isNativeMenuKey(press("A", { metaKey: true, shiftKey: true }), true)).toBe(true);   // Shift makes it a capital A
    expect(isNativeMenuKey(press("a", { metaKey: true, shiftKey: true }), false)).toBe(false);   // the browser edition is unchanged
    expect(isNativeMenuKey(press("a", { metaKey: true }), true)).toBe(false);   // Cmd+A stays the editor's Select All
    expect(isNativeMenuKey(press("a", { ctrlKey: true, shiftKey: true }), true)).toBe(false);
    expect(isNativeMenuKey(press("a", { metaKey: true, shiftKey: true, altKey: true }), true)).toBe(false);
    expect(isNativeMenuKey(press("a", { shiftKey: true }), true)).toBe(false);
  });
  it("the editor asks before it handles any key, and does not assign Cmd+N to another command", () => {
    const src = readFileSync("apps/web/src/components/LayerlingEditor.tsx", "utf8");
    const at = src.indexOf("const handleKeyDown = (event: KeyboardEvent) => {");
    const guard = src.indexOf("isNativeMenuKey(event, isNativeAppearance())", at);
    const firstUse = src.indexOf("if (shortcut && key === \"s\"", at);
    expect(at).toBeGreaterThan(0);
    expect(guard).toBeGreaterThan(at);
    expect(guard).toBeLessThan(firstUse);   // before Save, before any typing-target logic
  });
});
