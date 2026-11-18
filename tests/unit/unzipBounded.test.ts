import { strToU8, unzipSync, zipSync, type Zippable } from "fflate";
import { describe, expect, it } from "vitest";
import { defaultUnzipDeps, readZipDirectory, unzipBounded, type InflateJob, type UnzipDeps, type UnzipEvent } from "@/lib/unzipBounded";

const MIB = 1024 * 1024;
const compressible = (size: number, seed: number) => Uint8Array.from({ length: size }, (_, index) => (index * 7 + seed) % 251);
const same = (a: Uint8Array, b: Uint8Array) => a.byteLength === b.byteLength && Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;

function fixture() {
  const files: Zippable = {
    "project.json": [strToU8(JSON.stringify({ shapes: Array.from({ length: 4000 }, (_, i) => ({ id: `s-${i}`, x: i * 1.5 })) })), { level: 6 }],
    "assets/a.bin": [compressible(1024, 1), { level: 6 }],
    "assets/b.bin": [compressible(600 * 1024, 2), { level: 6 }],
    "assets/stored.bin": [compressible(2 * MIB, 3), { level: 0 }],
    "assets/empty.bin": [new Uint8Array(0), { level: 6 }],
    "ünï/çode-ß.txt": [strToU8("unicode name"), { level: 6 }],
    "assets/big1.bin": [compressible(9 * MIB, 4), { level: 6 }],
    "assets/big2.bin": [compressible(10 * MIB, 5), { level: 6 }],
    "assets/big3.bin": [compressible(12 * MIB, 6), { level: 6 }],
  };
  return { bytes: zipSync(files), files };
}

/** A zip of `count` equal entries, each expanding to `size`, for the cases that need many "large" entries cheaply (workerFromBytes is lowered). */
function manyEntries(count: number, size: number) {
  const files: Zippable = {};
  for (let index = 0; index < count; index += 1) files[`e/${String(index).padStart(4, "0")}.bin`] = [compressible(size, index), { level: 6 }];
  return { bytes: zipSync(files), files };
}

/** Deps whose Worker side is replaceable: `onJob` returns what the "worker" does for an entry. */
function fakeDeps(overrides: Partial<UnzipDeps> & { job?: (name: string, run: () => Uint8Array) => InflateJob }): UnzipDeps {
  return {
    inflateHere: defaultUnzipDeps.inflateHere,
    yieldThread: defaultUnzipDeps.yieldThread,
    inflateInWorker: (bytes, entry) => {
      const run = () => defaultUnzipDeps.inflateHere(bytes, new Set([entry.name]))[entry.name];
      return overrides.job ? overrides.job(entry.name, run) : { promise: Promise.resolve(run()), cancel: () => undefined };
    },
    ...overrides,
  } as UnzipDeps;
}

describe("readZipDirectory", () => {
  it("reads names, methods and sizes without expanding", () => {
    const { bytes, files } = fixture();
    const entries = readZipDirectory(bytes);
    expect(entries.map((entry) => entry.name)).toEqual(Object.keys(files));
    const stored = entries.find((entry) => entry.name === "assets/stored.bin")!;
    expect(stored.method).toBe(0);
    expect(stored.expandedSize).toBe(2 * MIB);
    expect(entries.find((entry) => entry.name === "assets/big3.bin")!.method).toBe(8);
    expect(entries.find((entry) => entry.name === "assets/empty.bin")!.expandedSize).toBe(0);
  });

  it("refuses what is not a ZIP", () => {
    expect(() => readZipDirectory(new Uint8Array(64))).toThrow();
  });
});

describe("unzipBounded gives exactly what unzipSync gives", () => {
  it("with the real Workers, same bytes, same order", async () => {
    const { bytes } = fixture();
    const events: UnzipEvent[] = [];
    const got = await unzipBounded(bytes, { onEvent: (event) => events.push(event) });
    const expected = unzipSync(bytes);
    expect(Object.keys(got)).toEqual(Object.keys(expected));
    for (const name of Object.keys(expected)) expect(same(got[name], expected[name]), name).toBe(true);
    // The three big entries went to Workers (at most two at a time), nothing fell back.
    expect(events.filter((event) => event.type === "worker-start").map((event) => event.name).sort()).toEqual(["assets/big1.bin", "assets/big2.bin", "assets/big3.bin"]);
    expect(events.some((event) => event.type === "fallback")).toBe(false);
  });

  it("with a filter reads only what was asked for", async () => {
    const { bytes } = fixture();
    const got = await unzipBounded(bytes, { filter: (entry) => entry.name === "project.json" || entry.name === "assets/big2.bin" });
    expect(Object.keys(got)).toEqual(["project.json", "assets/big2.bin"]);
    expect(same(got["assets/big2.bin"], compressible(10 * MIB, 5))).toBe(true);
  });

  it("with many small entries starts no Worker at all", async () => {
    const { bytes, files } = manyEntries(3000, 2000);
    let workers = 0;
    let yields = 0;
    const deps = fakeDeps({
      inflateInWorker: () => {
        workers += 1;
        throw new Error("no Worker expected");
      },
      yieldThread: async () => {
        yields += 1;
      },
    });
    const got = await unzipBounded(bytes, { sliceBytes: 256 * 1024 }, deps);
    expect(workers).toBe(0);
    expect(yields).toBeGreaterThan(5);
    expect(Object.keys(got).length).toBe(3000);
    expect(same(got["e/1234.bin"], (files["e/1234.bin"] as [Uint8Array, unknown])[0])).toBe(true);
  });
});

describe("unzipBounded keeps Workers bounded", () => {
  it("never runs more than maxWorkers inflations at once", async () => {
    const { bytes } = manyEntries(9, 4000);
    let running = 0;
    let most = 0;
    const deps = fakeDeps({
      job: (_name, run) => {
        running += 1;
        most = Math.max(most, running);
        return { promise: new Promise<Uint8Array>((resolve) => setTimeout(() => { running -= 1; resolve(run()); }, 8)), cancel: () => undefined };
      },
    });
    const got = await unzipBounded(bytes, { workerFromBytes: 1000, maxWorkers: 3 }, deps);
    expect(Object.keys(got).length).toBe(9);
    expect(most).toBe(3);
  });
});

describe("unzipBounded recovers from a bad Worker", () => {
  it("terminates a Worker that never answers and inflates the entry itself", async () => {
    const { bytes, files } = manyEntries(3, 4000);
    const cancelled: string[] = [];
    const events: UnzipEvent[] = [];
    const deps = fakeDeps({
      job: (name, run) => (name === "e/0001.bin"
        ? { promise: new Promise<Uint8Array>(() => undefined), cancel: () => cancelled.push(name) }
        : { promise: Promise.resolve(run()), cancel: () => undefined }),
    });
    const started = Date.now();
    const got = await unzipBounded(bytes, { workerFromBytes: 1000, workerTimeoutMs: 40, workerMsPerMiB: 0, onEvent: (event) => events.push(event) }, deps);
    expect(Date.now() - started).toBeLessThan(3000);
    expect(cancelled).toContain("e/0001.bin");
    expect(events.find((event) => event.type === "fallback")).toMatchObject({ name: "e/0001.bin", reason: "timeout" });
    expect(same(got["e/0001.bin"], (files["e/0001.bin"] as [Uint8Array, unknown])[0])).toBe(true);
  });

  it("falls back when a Worker reports an error", async () => {
    const { bytes, files } = manyEntries(2, 4000);
    const events: UnzipEvent[] = [];
    const deps = fakeDeps({ job: (name, run) => (name === "e/0000.bin" ? { promise: Promise.reject(new Error("worker exploded")), cancel: () => undefined } : { promise: Promise.resolve(run()), cancel: () => undefined }) });
    const got = await unzipBounded(bytes, { workerFromBytes: 1000, onEvent: (event) => events.push(event) }, deps);
    expect(events.find((event) => event.type === "fallback")).toMatchObject({ name: "e/0000.bin", reason: "error", message: "worker exploded" });
    expect(same(got["e/0000.bin"], (files["e/0000.bin"] as [Uint8Array, unknown])[0])).toBe(true);
  });

  it("falls back when a Worker cannot even be created", async () => {
    const { bytes, files } = manyEntries(2, 4000);
    const events: UnzipEvent[] = [];
    const deps = fakeDeps({ inflateInWorker: () => { throw new Error("Failed to create worker"); } });
    const got = await unzipBounded(bytes, { workerFromBytes: 1000, onEvent: (event) => events.push(event) }, deps);
    expect(events.filter((event) => event.type === "fallback").length).toBe(2);
    expect(same(got["e/0001.bin"], (files["e/0001.bin"] as [Uint8Array, unknown])[0])).toBe(true);
  });

  it("ignores an answer that arrives after the fallback", async () => {
    const { bytes, files } = manyEntries(1, 4000);
    const late = new Uint8Array(4000).fill(9);
    const deps = fakeDeps({ job: () => ({ promise: new Promise<Uint8Array>((resolve) => setTimeout(() => resolve(late), 120)), cancel: () => undefined }) });
    const got = await unzipBounded(bytes, { workerFromBytes: 1000, workerTimeoutMs: 20, workerMsPerMiB: 0 }, deps);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(same(got["e/0000.bin"], (files["e/0000.bin"] as [Uint8Array, unknown])[0])).toBe(true);
  });

  it("reports damaged data when the fallback fails too, and stops the other jobs", async () => {
    const { bytes } = manyEntries(8, 4000);
    const started: string[] = [];
    const cancelled: string[] = [];
    const deps = fakeDeps({
      inflateHere: (data, names) => {
        if (names.has("e/0001.bin")) throw new Error("invalid data in e/0001.bin");
        return defaultUnzipDeps.inflateHere(data, names);
      },
      job: (name, run) => {
        started.push(name);
        return name === "e/0001.bin"
          ? { promise: Promise.reject(new Error("worker failed")), cancel: () => cancelled.push(name) }
          : { promise: new Promise<Uint8Array>((resolve) => setTimeout(() => resolve(run()), 30)), cancel: () => cancelled.push(name) };
      },
    });
    await expect(unzipBounded(bytes, { workerFromBytes: 1000, maxWorkers: 2 }, deps)).rejects.toThrow("invalid data in e/0001.bin");
    expect(started.length).toBeLessThan(8);
    expect(cancelled).toContain("e/0001.bin");
  });

  it("never waits forever: a hung Worker plus a slow neighbour still finishes", async () => {
    const { bytes } = manyEntries(4, 4000);
    const deps = fakeDeps({ job: () => ({ promise: new Promise<Uint8Array>(() => undefined), cancel: () => undefined }) });
    const got = await unzipBounded(bytes, { workerFromBytes: 1000, maxWorkers: 2, workerTimeoutMs: 25, workerMsPerMiB: 0 }, deps);
    expect(Object.keys(got).length).toBe(4);
  });
});
