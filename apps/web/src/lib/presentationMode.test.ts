import { describe, expect, it } from "vitest";
import { presentationBlocksPointer, presentationKeyAction } from "./presentationMode";

const key = (k: string, extra: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean; type: string }> = {}) => ({ key: k, ctrlKey: false, metaKey: false, altKey: false, type: "keydown", ...extra });

describe("Presentation Mode input policy", () => {
  it("leaves with Esc, fits with F or Home, lets modifiers and Cmd+Q through", () => {
    expect(presentationKeyAction(key("Escape"))).toBe("exit");
    expect(presentationKeyAction(key("Escape", { type: "keyup" }))).toBe("block");
    expect(presentationKeyAction(key("f"))).toBe("fit");
    expect(presentationKeyAction(key("F"))).toBe("fit");
    expect(presentationKeyAction(key("Home"))).toBe("fit");
    for (const modifier of ["Shift", "Control", "Alt", "Meta"]) expect(presentationKeyAction(key(modifier))).toBe("allow");
    expect(presentationKeyAction(key("q", { metaKey: true }))).toBe("allow");
  });
  it("blocks every editing key", () => {
    for (const k of ["Delete", "Backspace", "a", "g", "d", "c", "v", "x", "z", "ArrowLeft", "ArrowUp", "Enter", "Tab", "1"]) expect(presentationKeyAction(key(k))).toBe("block");
    for (const k of ["a", "z", "c", "v", "d", "g", "s", "w"]) expect(presentationKeyAction(key(k, { metaKey: true }))).toBe("block");
    expect(presentationKeyAction(key("f", { metaKey: true }))).toBe("block");   // Cmd+F is not "fit"
    expect(presentationKeyAction(key("z", { ctrlKey: true }))).toBe("block");
  });
  it("Space toggles standby once per press and is never a plain key", () => {
    expect(presentationKeyAction({ ...key(" "), repeat: false })).toBe("standby");
    expect(presentationKeyAction({ ...key(" "), repeat: true })).toBe("swallow");
    expect(presentationKeyAction(key(" ", { type: "keyup" }))).toBe("swallow");
    expect(presentationKeyAction(key(" ", { metaKey: true }))).toBe("block");
    expect(presentationKeyAction(key("f"), true)).toBe("block");   // no fitting while the model is hidden
    expect(presentationKeyAction(key("Escape"), true)).toBe("exit");
  });
  it("blocks the wheel and gestures only on standby", () => {
    const base = { buttons: 0, ctrlKey: false, metaKey: false, pointerType: "mouse", button: 0 };
    expect(presentationBlocksPointer({ ...base, type: "wheel" })).toBe(false);
    expect(presentationBlocksPointer({ ...base, type: "gesturechange" })).toBe(false);
    for (const type of ["wheel", "gesturestart", "pointerdown", "pointermove"]) expect(presentationBlocksPointer({ ...base, type, buttons: 2, button: 2 }, true)).toBe(true);
  });
  it("lets the camera's gestures through and stops what would select or move", () => {
    const base = { buttons: 0, ctrlKey: false, metaKey: false, pointerType: "mouse" };
    expect(presentationBlocksPointer({ ...base, type: "pointerdown", button: 0, buttons: 1 })).toBe(true);
    expect(presentationBlocksPointer({ ...base, type: "click", button: 0 })).toBe(true);
    expect(presentationBlocksPointer({ ...base, type: "dblclick", button: 0 })).toBe(true);
    expect(presentationBlocksPointer({ ...base, type: "contextmenu", button: 2 })).toBe(true);
    expect(presentationBlocksPointer({ ...base, type: "pointermove", button: 0, buttons: 0 })).toBe(true);   // hovering
    expect(presentationBlocksPointer({ ...base, type: "pointermove", button: 0, buttons: 1 })).toBe(true);   // dragging with the left button: a selection box, a move
    expect(presentationBlocksPointer({ ...base, type: "pointerdown", button: 2, buttons: 2 })).toBe(false);  // right button: orbit
    expect(presentationBlocksPointer({ ...base, type: "pointerdown", button: 1, buttons: 4 })).toBe(false);  // middle: pan
    expect(presentationBlocksPointer({ ...base, type: "pointermove", button: 0, buttons: 2 })).toBe(false);
    expect(presentationBlocksPointer({ ...base, type: "pointermove", button: 0, buttons: 4 })).toBe(false);
    expect(presentationBlocksPointer({ ...base, type: "pointerdown", button: 0, buttons: 1, metaKey: true })).toBe(false);  // Cmd + drag: the camera
    expect(presentationBlocksPointer({ ...base, type: "pointermove", button: 0, buttons: 1, ctrlKey: true })).toBe(false);
  });
});
