import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pasteKeyHandling } from "@/lib/pasteKey";

describe("pasteKeyHandling", () => {
  it("native app: the page pastes once itself and keeps the key from the AppKit menu", () => {
    expect(pasteKeyHandling(true)).toBe("run-now");
  });

  it("browser edition: the browser's own paste event follows the key, as upstream", () => {
    expect(pasteKeyHandling(false)).toBe("await-paste-event");
  });
});

// The editor's keydown handler must route Ctrl/Cmd+V through the helper, preventing the default only on the native branch
// (a keydown left unhandled is handed to the Edit > Paste menu item, which made the second paste).
describe("Ctrl/Cmd+V in the editor's keydown handler", () => {
  const source = readFileSync(resolve(__dirname, "../../apps/web/src/components/LayerlingEditor.tsx"), "utf8");
  const at = source.indexOf('if (shortcut && key === "v") {');

  it("exists once", () => {
    expect(at).toBeGreaterThan(0);
    expect(source.indexOf('if (shortcut && key === "v") {', at + 1)).toBe(-1);
  });

  it("native branch prevents the default and pastes exactly once, then returns", () => {
    const block = source.slice(at, source.indexOf("window.setTimeout", at));
    expect(block).toContain('pasteKeyHandling(Boolean(nativeDocument)) === "run-now"');
    const native = block.slice(block.indexOf("run-now"));
    expect(native).toMatch(/event\.preventDefault\(\);\s*void pasteShapeRef\.current\(\);\s*return;/);
  });

  it("the browser branch still waits for the paste event and never prevents the default", () => {
    const rest = source.slice(at, source.indexOf('if (shortcut && key === "d")', at));
    const browser = rest.slice(rest.indexOf("The browser's own paste follows the key"));
    expect(browser).toContain("pasteKeyPendingRef.current = press");
    expect(browser).not.toContain("preventDefault");
  });
});
