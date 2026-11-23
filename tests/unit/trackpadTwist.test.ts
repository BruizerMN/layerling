// @vitest-environment jsdom
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { presentationBlocksPointer } from "@/lib/presentationMode";
import { attachTrackpadTwist, orbitAngleForTwist, startTwistGesture, TWIST_DEAD_ZONE_DEGREES, TWIST_ORBIT_GAIN, twistStep } from "@/lib/trackpadTwist";

/** Build 0051. What can only be judged with a real trackpad (feel, sensitivity, whether the direction suits the hand, that pinch and scroll zoom are unchanged to the touch) is NOT covered here. */

/** Feeds a list of cumulative rotations to a fresh gesture and returns the degrees handed out per step. */
function run(rotations: unknown[], start: unknown = 0) {
  const gesture = startTwistGesture(start);
  return rotations.map((rotation) => twistStep(gesture, rotation));
}
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

describe("the 8 degree dead zone", () => {
  it("is 8 degrees at 1:1", () => {
    expect(TWIST_DEAD_ZONE_DEGREES).toBe(8);
    expect(TWIST_ORBIT_GAIN).toBe(1);
  });

  it("ignores up to 8 degrees clockwise, including exactly 8", () => {
    expect(run([1, 3, 5.5, 7.9, 8])).toEqual([0, 0, 0, 0, 0]);
  });

  it("ignores up to 8 degrees counter-clockwise, including exactly -8", () => {
    expect(run([-1, -3, -5.5, -7.9, -8])).toEqual([0, 0, 0, 0, 0]);
  });

  it("starts turning only beyond 8 degrees, and by the excess (no jump at the threshold)", () => {
    const steps = run([6, 8, 9, 10.5]);
    expect(steps[0]).toBe(0);
    expect(steps[1]).toBe(0);
    expect(steps[2]).toBeCloseTo(1);
    expect(steps[3]).toBeCloseTo(1.5);
    // a single big first step does not jump either: 20 degrees of twist is 12 of turn
    expect(run([20])[0]).toBeCloseTo(12);
    expect(run([-20])[0]).toBeCloseTo(-12);
  });

  it("counter-clockwise mirrors clockwise", () => {
    const cw = run([5, 9, 15, 30]);
    const ccw = run([-5, -9, -15, -30]);
    cw.forEach((step, i) => expect(ccw[i]).toBeCloseTo(-step));
  });
});

describe("cumulative rotation to applied angle", () => {
  it("hands out only the new part of the cumulative value (never applies earlier movement twice)", () => {
    const steps = run([10, 20, 20, 35, 35.0]);
    expect(steps[0]).toBeCloseTo(2);
    expect(steps[1]).toBeCloseTo(10);
    expect(steps[2]).toBe(0);
    expect(steps[3]).toBeCloseTo(15);
    expect(steps[4]).toBe(0);
    expect(sum(steps)).toBeCloseTo(35 - 8);
  });

  it("the sum of the steps is always (rotation - dead zone) however the events are chopped up", () => {
    const rotations = [0.5, 2, 4, 9, 9.2, 14, 22, 22.5, 30, 41, 40.5, 47];
    expect(sum(run(rotations))).toBeCloseTo(47 - 8);
    expect(sum(run(rotations.map((r) => -r)))).toBeCloseTo(-(47 - 8));
  });

  it("measures from the rotation the gesture began with (WebKit begins near, not at, zero)", () => {
    const steps = run([0.04, 4, 8, 8.04, 9.04, 12.04], 0.04);
    expect(steps.slice(0, 3)).toEqual([0, 0, 0]);
    expect(steps[3]).toBe(0);
    expect(steps[4]).toBeCloseTo(1);
    expect(sum(steps)).toBeCloseTo(12 - 8);
  });
});

describe("reversal after the dead zone was crossed", () => {
  it("turns back smoothly, without a second dead zone and without a jump", () => {
    // out to 20 (12 applied), then back past the start to -20: the applied total is rotation - 8 all the way (-28), continuous
    const gesture = startTwistGesture(0);
    const out = [10, 20].map((r) => twistStep(gesture, r));
    expect(sum(out)).toBeCloseTo(12);
    const back = [15, 10, 8, 5, 0, -5, -20].map((r) => twistStep(gesture, r));
    expect(back[0]).toBeCloseTo(-5);
    expect(back[1]).toBeCloseTo(-5);
    // at turned = 8 the old dead zone edge: the turn goes straight on, no flat spot
    expect(back[2]).toBeCloseTo(-2);
    expect(back[3]).toBeCloseTo(-3);
    expect(back[4]).toBeCloseTo(-5);
    expect(back[5]).toBeCloseTo(-5);
    expect(back[6]).toBeCloseTo(-15);
    expect(sum(out) + sum(back)).toBeCloseTo(-20 - 8);
  });

  it("works the same way round for a counter-clockwise start", () => {
    const gesture = startTwistGesture(0);
    const steps = [-12, -30, -10, 5, 25].map((r) => twistStep(gesture, r));
    expect(sum(steps)).toBeCloseTo(25 + 8);
    expect(steps[2]).toBeCloseTo(20);
  });
});

describe("no state between gestures", () => {
  it("a new gesture starts from nothing: the dead zone applies again and nothing is carried over", () => {
    const first = startTwistGesture(0);
    twistStep(first, 40);
    const second = startTwistGesture(0);
    expect(twistStep(second, 5)).toBe(0);
    expect(twistStep(second, 9)).toBeCloseTo(1);
  });

  it("is a plain object: starting one does not touch another", () => {
    const a = startTwistGesture(0);
    const b = startTwistGesture(0);
    twistStep(a, 30);
    expect(b).toEqual({ base: 0, direction: 0, applied: 0 });
  });
});

describe("zero-change and malformed events", () => {
  it("does nothing for a gesture without changes and for repeated identical values", () => {
    expect(run([])).toEqual([]);
    expect(run([0, 0, 0, 0])).toEqual([0, 0, 0, 0]);
    expect(run([15, 15, 15]).slice(1)).toEqual([0, 0]);
  });

  it("ignores a missing, non-numeric or non-finite rotation, and carries on correctly afterwards", () => {
    const gesture = startTwistGesture(0);
    for (const bad of [undefined, null, "12", {}, [], Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(twistStep(gesture, bad)).toBe(0);
    }
    expect(gesture).toEqual({ base: 0, direction: 0, applied: 0 });
    expect(twistStep(gesture, 18)).toBeCloseTo(10);
  });

  it("a gesture that begins with a malformed rotation measures from 0", () => {
    for (const bad of [undefined, null, "x", Number.NaN]) {
      expect(startTwistGesture(bad).base).toBe(0);
    }
  });
});

/** An element, an event helper and spy controls. */
function rig(enabled = true) {
  const element = new EventTarget();
  const turns: number[] = [];
  const order: string[] = [];
  const controls = { enabled, rotateLeft: (angle: number) => { turns.push(angle); order.push("turn"); } };
  const gesture = (type: string, rotation?: unknown, scale = 1) => {
    const event = new Event(type, { cancelable: true, bubbles: true }) as Event & { rotation?: unknown; scale?: number };
    if (rotation !== undefined) event.rotation = rotation;
    event.scale = scale;
    element.dispatchEvent(event);
    return event;
  };
  const detach = attachTrackpadTwist(element, controls, () => order.push("cancel view cube turn"));
  return { element, controls, turns, order, gesture, detach };
}

describe("attachTrackpadTwist", () => {
  afterEach(() => vi.restoreAllMocks());

  it("turns the camera by the twist beyond the dead zone and cancels a running view cube turn first", () => {
    const { gesture, turns, order } = rig();
    gesture("gesturestart", 0);
    gesture("gesturechange", 5);
    expect(turns).toEqual([]);
    gesture("gesturechange", 18);
    expect(turns).toHaveLength(1);
    expect(turns[0]).toBeCloseTo(orbitAngleForTwist(10));
    expect(order).toEqual(["cancel view cube turn", "turn"]);
    gesture("gestureend", 18);
  });

  it("a pinch (scale changes, no rotation or a little noise) never turns the camera", () => {
    const { gesture, turns, order } = rig();
    gesture("gesturestart", 0, 1);
    for (const [rotation, scale] of [[0, 1.2], [0.12, 1.9], [0, 3], [0.12, 6]] as const) gesture("gesturechange", rotation, scale);
    gesture("gestureend", 0, 6);
    expect(turns).toEqual([]);
    expect(order).toEqual([]);
  });

  it("a change without a gesturestart is ignored (a gesture that began outside the canvas)", () => {
    const { gesture, turns } = rig();
    gesture("gesturechange", 40);
    expect(turns).toEqual([]);
  });

  it("consecutive gestures share nothing: the next one meets the dead zone again", () => {
    const { gesture, turns } = rig();
    gesture("gesturestart", 0); gesture("gesturechange", 40); gesture("gestureend", 40);
    const first = turns.length;
    gesture("gesturestart", 0); gesture("gesturechange", 6); gesture("gestureend", 6);
    expect(turns).toHaveLength(first);
    gesture("gesturestart", 0); gesture("gesturechange", 10);
    expect(turns).toHaveLength(first + 1);
    expect(turns[turns.length - 1]).toBeCloseTo(orbitAngleForTwist(2));
  });

  it("an unexpected end (window focus lost) leaves nothing behind", () => {
    const { gesture, turns } = rig();
    gesture("gesturestart", 0); gesture("gesturechange", 30);
    const before = turns.length;
    window.dispatchEvent(new Event("blur"));
    gesture("gesturechange", 60);   // no gesture any more
    expect(turns).toHaveLength(before);
  });

  it("with the controls off (a drag in progress) nothing turns, and nothing is owed afterwards", () => {
    const { gesture, turns, controls } = rig(false);
    gesture("gesturestart", 0); gesture("gesturechange", 30);
    expect(turns).toEqual([]);
    controls.enabled = true;
    gesture("gesturechange", 31);
    expect(turns).toHaveLength(1);
    expect(turns[0]).toBeCloseTo(orbitAngleForTwist(1));   // just the new degree, no catching up
  });

  it("only observes: it neither prevents the default nor stops the event, so the pinch handler and others see the same events", () => {
    const { gesture, element } = rig();
    const other = vi.fn();
    element.addEventListener("gesturechange", other);
    gesture("gesturestart", 0);
    const change = gesture("gesturechange", 30);
    expect(change.defaultPrevented).toBe(false);
    expect(other).toHaveBeenCalledTimes(1);
  });

  it("ignores malformed rotations in events", () => {
    const { gesture, turns } = rig();
    gesture("gesturestart", Number.NaN);
    gesture("gesturechange", undefined);
    gesture("gesturechange", "30");
    gesture("gesturechange", Number.NaN);
    expect(turns).toEqual([]);
    gesture("gesturechange", 20);
    expect(turns).toHaveLength(1);
  });

  it("detaches completely", () => {
    const { gesture, turns, detach } = rig();
    detach();
    gesture("gesturestart", 0); gesture("gesturechange", 40);
    expect(turns).toEqual([]);
  });
});

/** The sign, against the real camera and controls rather than an assumption about rotateLeft(). */
describe("turntable direction and what the orbit leaves alone (real OrbitControls and camera)", () => {
  const target = new THREE.Vector3(5, 2, 3);

  function scene(polarDegrees: number, azimuthDegrees: number, radius = 40) {
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 6000);
    const spherical = new THREE.Spherical(radius, THREE.MathUtils.degToRad(polarDegrees), THREE.MathUtils.degToRad(azimuthDegrees));
    camera.position.setFromSpherical(spherical).add(target);
    const element = document.createElement("div");
    const controls = new OrbitControls(camera, element);
    controls.target.copy(target);
    controls.enableDamping = false;
    controls.update();
    camera.updateMatrixWorld(true);
    const events = new EventTarget();
    attachTrackpadTwist(events, controls);
    const fire = (type: string, rotation: number) => {
      const event = new Event(type) as Event & { rotation?: number };
      event.rotation = rotation;
      events.dispatchEvent(event);
    };
    const spherical3 = () => new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target));
    // where a model point 10 units to the +X side of the target appears, relative to the target's own place on the screen, as a mathematical angle (y up)
    const screenAngleOfModelPoint = () => {
      camera.updateMatrixWorld(true);
      const centre = target.clone().project(camera);
      const point = target.clone().add(new THREE.Vector3(10, 0, 0)).project(camera);
      return Math.atan2(point.y - centre.y, point.x - centre.x);
    };
    return { camera, controls, fire, spherical3, screenAngleOfModelPoint };
  }

  it("changes only the azimuth: elevation, distance and target stay put", () => {
    const { fire, controls, spherical3 } = scene(55, 20, 40);
    const before = spherical3();
    fire("gesturestart", 0);
    fire("gesturechange", 20);
    fire("gesturechange", 48);
    const after = spherical3();
    expect(controls.target.distanceTo(target)).toBe(0);
    expect(after.phi).toBeCloseTo(before.phi, 9);
    expect(after.radius).toBeCloseTo(before.radius, 9);
    expect(after.theta).not.toBeCloseTo(before.theta, 3);
  });

  it("turns one degree of azimuth per degree of twist beyond the dead zone (1:1)", () => {
    const { fire, spherical3 } = scene(60, 0);
    const before = spherical3().theta;
    fire("gesturestart", 0);
    fire("gesturechange", 38);   // 30 beyond the dead zone
    const turned = THREE.MathUtils.radToDeg(spherical3().theta - before);
    expect(Math.abs(turned)).toBeCloseTo(30, 6);
  });

  it("a clockwise twist makes the model appear to turn clockwise on the screen (turntable), counter-clockwise the other way", () => {
    const cw = scene(35, 15);
    const startAngle = cw.screenAngleOfModelPoint();
    cw.fire("gesturestart", 0);
    cw.fire("gesturechange", 38);
    // clockwise on screen = the mathematical angle (y up) decreases
    expect(cw.screenAngleOfModelPoint()).toBeLessThan(startAngle);

    const ccw = scene(35, 15);
    ccw.fire("gesturestart", 0);
    ccw.fire("gesturechange", -38);
    expect(ccw.screenAngleOfModelPoint()).toBeGreaterThan(startAngle);
  });

  it("the direction does not depend on the elevation or on where the camera stands", () => {
    for (const [polar, azimuth] of [[20, 0], [50, 135], [80, -70], [30, 200]] as const) {
      const { fire, screenAngleOfModelPoint } = scene(polar, azimuth);
      const before = screenAngleOfModelPoint();
      fire("gesturestart", 0);
      fire("gesturechange", 38);
      let change = screenAngleOfModelPoint() - before;
      change = Math.atan2(Math.sin(change), Math.cos(change));
      expect(change).toBeLessThan(0);
    }
  });

  it("the sign used is the one named in the file: rotateLeft(negative) for a clockwise twist", () => {
    expect(orbitAngleForTwist(10)).toBeLessThan(0);
    expect(orbitAngleForTwist(-10)).toBeGreaterThan(0);
    expect(orbitAngleForTwist(180)).toBeCloseTo(-Math.PI);
  });
});

/** Build 0051 adds a path; the existing zoom paths, Sketch mode and Presentation Mode must be exactly as they were. */
describe("existing navigation is untouched", () => {
  const root = resolve(__dirname, "../../apps/web/src");
  const scene = readFileSync(join(root, "components/workplane/viewportScene.ts"), "utf8");

  it("the pinch handler and the wheel-notch logic are byte-for-byte as in Build 0050", () => {
    const from = scene.indexOf("  // Safari on a Mac sends no wheel steps for a pinch");
    const endMark = "  SAFARI_GESTURES.forEach((name) => renderer.domElement.addEventListener(name, preventSafariGesture));\n";
    const to = scene.indexOf(endMark) + endMark.length;
    expect(from).toBeGreaterThan(0);
    const block = scene.slice(from, to);
    // If this fails on purpose (you changed pinch or scroll zoom), update the hash together with a manual trackpad test.
    expect(createHash("sha256").update(block).digest("hex")).toBe("99661ea681d6682b72de01cfebbf398d0831994f2cf2f52a5f15bf060bdb224f");
  });

  it("the wheel listeners (two-finger scroll zoom) are registered as before", () => {
    for (const line of [
      '  renderer.domElement.addEventListener("wheel", requestRender, { passive: true });',
      '  renderer.domElement.addEventListener("wheel", pullPivotToSurface, { passive: true, capture: true });',
      '  renderer.domElement.addEventListener("wheel", countWheelNotch, { passive: true, capture: true });',
      '  renderer.domElement.addEventListener("wheel", endWheelNotch, { passive: true });',
    ]) {
      expect(scene).toContain(line);
    }
  });

  it("the twist is attached once, after the pinch handler, on the same canvas, and detached with the others", () => {
    expect(scene.match(/attachTrackpadTwist\(/g)).toHaveLength(1);
    expect(scene.indexOf("attachTrackpadTwist(renderer.domElement, controls, cancelCameraTurn)")).toBeGreaterThan(scene.indexOf("SAFARI_GESTURES.forEach((name) => renderer.domElement.addEventListener"));
    expect(scene.match(/detachTrackpadTwist\(\)/g)).toHaveLength(1);
  });

  it("right-button orbit, the view cube and the mouse buttons are as before", () => {
    expect(scene).toContain("RIGHT: THREE.MOUSE.ROTATE,");
    expect(scene).toContain('controls.addEventListener("start", cancelCameraTurn);');
    expect(scene).toContain("controls.rotateSpeed = 0.58;");
  });

  it("only the 3D viewport scene uses the twist: Sketch mode's own gestures are not touched", () => {
    const users: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.(ts|tsx)$/.test(name) && readFileSync(path, "utf8").includes("trackpadTwist")) users.push(path.slice(root.length + 1));
      }
    };
    walk(root);
    expect(users.sort()).toEqual(["components/workplane/viewportScene.ts", "lib/trackpadTwist.ts"]);
    const sketch = readFileSync(join(root, "components/SketchWorkspace.tsx"), "utf8");
    expect(sketch).toContain('const names = ["gesturestart", "gesturechange", "gestureend"] as const;');
  });

  it("Presentation Mode: standby blocks every gesture before it reaches the canvas; otherwise gestures and wheel stay allowed, as before", () => {
    for (const type of ["gesturestart", "gesturechange", "gestureend", "wheel"]) {
      expect(presentationBlocksPointer({ type, button: 0, buttons: 0, ctrlKey: false, metaKey: false, pointerType: "mouse" }, true)).toBe(true);
      expect(presentationBlocksPointer({ type, button: 0, buttons: 0, ctrlKey: false, metaKey: false, pointerType: "mouse" }, false)).toBe(false);
    }
    const guard = readFileSync(join(root, "lib/presentationMode.ts"), "utf8");
    expect(guard).toContain('"wheel", "gesturestart", "gesturechange", "gestureend"');
    expect(guard).toContain("window.addEventListener(name, onPointer, true)");   // capture on the window: runs before the canvas
  });
});
