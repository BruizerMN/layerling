import { describe, expect, it } from "vitest";
import { createMeshOfferScheduler, type MeshOfferPorts, type MeshOfferScan } from "@/lib/meshRepairOffer";

/* Build 0125: the pure scheduler, driven by a fake clock. No editor, no timers of the real kind. */

type Harness = ReturnType<typeof harness>;
function harness(over: Partial<{ busy: () => boolean; scan: () => Promise<MeshOfferScan>; canOffer: boolean }> = {}) {
  let now = 0;
  let nextId = 1;
  const timers = new Map<number, { at: number; run: () => void }>();
  const state = { busy: false, scene: {} as object, offers: [] as { meshes: number; objects: number; busyAtOffer: boolean; sceneAtOffer: object }[], logs: [] as string[], scanResult: { kind: "counts", meshes: 3, objects: 7 } as { kind: "counts"; meshes: number; objects: number } | { kind: "busy" } | { kind: "failed" }, scanScene: null as object | null };
  const ports: MeshOfferPorts = {
    isBusy: over.busy ?? (() => state.busy),
    scan: over.scan ?? (async () => {
      const scene = state.scene;
      state.scanScene = scene;
      const r = state.scanResult;
      return r.kind === "counts" ? { kind: "counts", meshes: r.meshes, objects: r.objects, scene, ms: 5 } : r;
    }),
    isCurrent: (scene) => scene === state.scene,
    offer: (c) => { state.offers.push({ meshes: c.meshes, objects: c.objects, busyAtOffer: (over.busy ?? (() => state.busy))(), sceneAtOffer: state.scene }); return over.canOffer ?? true; },
    setTimer: (run, ms) => { const id = nextId++; timers.set(id, { at: now + ms, run }); return id; },
    clearTimer: (h) => { timers.delete(h as number); },
    log: (l) => state.logs.push(l),
  };
  const scheduler = createMeshOfferScheduler(ports, { settleMs: 1000, retryMs: 2000 });
  /** Advances the fake clock, running due timers in order, letting promises settle after each. */
  const advance = async (ms: number) => {
    const end = now + ms;
    for (;;) {
      const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!due) break;
      timers.delete(due[0]);
      now = due[1].at;
      due[1].run();
      for (let i = 0; i < 5; i++) await Promise.resolve();
    }
    now = end;
  };
  return { state, scheduler, advance, timers: () => timers.size };
}

describe("mesh repair offer scheduler", () => {
  it("waits for the settle delay, scans once, offers once", async () => {
    const h = harness();
    h.scheduler.start();
    expect(h.scheduler.state()).toBe("waiting");
    await h.advance(999);
    expect(h.scheduler.scans()).toBe(0);
    await h.advance(1);
    expect(h.scheduler.scans()).toBe(1);
    expect(h.scheduler.state()).toBe("offered");
    expect(h.state.offers).toEqual([expect.objectContaining({ meshes: 3, objects: 7 })]);
    await h.advance(60_000);
    expect(h.state.offers.length).toBe(1);
    expect(h.scheduler.scans()).toBe(1);
  });
  it("start() is once per load", async () => {
    const h = harness();
    h.scheduler.start(); h.scheduler.start();
    await h.advance(5000);
    h.scheduler.start();
    await h.advance(5000);
    expect(h.scheduler.scans()).toBe(1);
    expect(h.state.offers.length).toBe(1);
  });
  it("is silent when nothing is found, and when the scan fails or throws: nothing is ever offered", async () => {
    for (const result of [{ kind: "counts", meshes: 0, objects: 0 }, { kind: "failed" }] as const) {
      const h = harness();
      h.state.scanResult = result;
      h.scheduler.start();
      await h.advance(30_000);
      expect(h.scheduler.state()).toBe("silent");
      expect(h.state.offers).toEqual([]);
      expect(h.scheduler.scans()).toBe(1);
    }
    const h = harness({ scan: async () => { throw new Error("boom"); } });
    h.scheduler.start();
    await h.advance(30_000);
    expect(h.scheduler.state()).toBe("silent");
    expect(h.state.offers).toEqual([]);
  });
  it("DEFERS while the person is busy, never abandons: the offer comes at the first idle opportunity, however late", async () => {
    const h = harness();
    h.state.busy = true;
    h.scheduler.start();
    await h.advance(10 * 60_000);
    expect(h.scheduler.scans()).toBe(0);
    expect(h.scheduler.state()).toBe("waiting");
    expect(h.state.offers).toEqual([]);
    h.state.busy = false;
    await h.advance(2000);
    expect(h.scheduler.state()).toBe("offered");
    expect(h.state.offers.length).toBe(1);
  });
  it("a scan that reports busy is retried later, not dropped", async () => {
    const h = harness();
    h.state.scanResult = { kind: "busy" };
    h.scheduler.start();
    await h.advance(7000);
    expect(h.scheduler.scans()).toBeGreaterThan(1);
    expect(h.state.offers).toEqual([]);
    h.state.scanResult = { kind: "counts", meshes: 1, objects: 1 };
    await h.advance(2000);
    expect(h.scheduler.state()).toBe("offered");
  });
  it("a result for a scene that changed meanwhile is discarded and rescanned (the 0124 identity check)", async () => {
    let first = true;
    const h = harness();
    const original = h.state;
    // the scene changes while the first scan runs
    const inner = h;
    const wrapped = harness({
      scan: async () => {
        const scene = wrapped.state.scene;
        if (first) { first = false; wrapped.state.scene = {}; }
        return { kind: "counts", meshes: 4, objects: 4, scene, ms: 1 };
      },
    });
    void original; void inner;
    wrapped.scheduler.start();
    await wrapped.advance(1000);
    expect(wrapped.scheduler.state()).toBe("waiting");
    expect(wrapped.state.offers).toEqual([]);
    await wrapped.advance(2000);
    expect(wrapped.scheduler.scans()).toBe(2);
    expect(wrapped.scheduler.state()).toBe("offered");
  });
  it("the person starting to work during the scan defers the offer", async () => {
    let busy = false;
    const h = harness({ busy: () => busy, scan: async () => { busy = true; return { kind: "counts", meshes: 2, objects: 2, scene: null, ms: 1 }; } });
    const original = h.state.scene;
    void original;
    h.scheduler.start();
    await h.advance(1000);
    expect(h.state.offers).toEqual([]);
    expect(h.scheduler.state()).toBe("waiting");
  });
  it("abort (document closed, reloaded) ends everything: no timer left, no offer, even from inside a scan", async () => {
    const a = harness();
    a.scheduler.start();
    a.scheduler.abort();
    expect(a.timers()).toBe(0);
    await a.advance(60_000);
    expect(a.state.offers).toEqual([]);
    expect(a.scheduler.state()).toBe("aborted");
    let release: (v: MeshOfferScan) => void = () => {};
    const b = harness({ scan: () => new Promise<MeshOfferScan>((resolve) => { release = resolve; }) });
    b.scheduler.start();
    await b.advance(1000);
    expect(b.scheduler.state()).toBe("scanning");
    b.scheduler.abort();
    release({ kind: "counts", meshes: 9, objects: 9, scene: b.state.scene, ms: 1 });
    await b.advance(60_000);
    expect(b.state.offers).toEqual([]);
    expect(b.timers()).toBe(0);
  });
  it("when the host cannot be asked, nothing is shown and nothing repeats", async () => {
    const h = harness({ canOffer: false });
    h.scheduler.start();
    await h.advance(60_000);
    expect(h.scheduler.state()).toBe("silent");
    expect(h.scheduler.scans()).toBe(1);
  });
  it("one diagnostic line per completed scan, counts and time only", async () => {
    const h = harness();
    h.scheduler.start();
    await h.advance(1000);
    expect(h.state.logs).toEqual(["mesh offer scan: 3 repairable meshes, 7 objects, 5 ms"]);
  });
  it("a revert is a new load: a new scheduler, a new offer", async () => {
    const first = harness();
    first.scheduler.start();
    await first.advance(1000);
    expect(first.state.offers.length).toBe(1);
    first.scheduler.abort();
    const second = harness();
    second.scheduler.start();
    await second.advance(1000);
    expect(second.state.offers.length).toBe(1);
  });

  it("seeded random event sequences keep every invariant (3,000 sequences)", async () => {
    let seed = 20261127;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 0x100000000; };
    for (let run = 0; run < 3000; run++) {
      const h = harness();
      let aborted = false;
      let offeredCounts = 0;
      h.state.scanResult = rnd() < 0.2 ? { kind: "counts", meshes: 0, objects: 0 } : rnd() < 0.1 ? { kind: "failed" } : { kind: "counts", meshes: 1 + Math.floor(rnd() * 300), objects: 1 + Math.floor(rnd() * 800) };
      h.scheduler.start();
      const steps = 4 + Math.floor(rnd() * 20);
      for (let i = 0; i < steps; i++) {
        const r = rnd();
        if (r < 0.3) h.state.busy = !h.state.busy;
        else if (r < 0.45) h.state.scene = {};
        else if (r < 0.5) h.state.scanResult = rnd() < 0.5 ? { kind: "busy" } : { kind: "counts", meshes: 2, objects: 3 };
        else if (r < 0.55 && !aborted && rnd() < 0.5) { h.scheduler.abort(); aborted = true; }
        else if (r < 0.6) h.scheduler.start();
        await h.advance(Math.floor(rnd() * 3500));
        // invariants, checked after every step
        expect(h.state.offers.length).toBeLessThanOrEqual(1);
        for (const o of h.state.offers) expect(o.busyAtOffer).toBe(false);
        for (const o of h.state.offers) expect(o.sceneAtOffer).toBe(h.state.scanScene);
        if (aborted) expect(h.state.offers.length).toBe(offeredCounts);
        offeredCounts = h.state.offers.length;
        if (h.scheduler.state() === "offered") expect(h.state.offers.length).toBe(1);
        if (h.scheduler.state() === "silent") expect(h.state.offers.length).toBe(0);
        if (aborted) expect(h.timers()).toBe(0);
      }
    }
  });
});
