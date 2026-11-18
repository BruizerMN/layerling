import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { unzipBounded, type UnzipEvent } from "@/lib/unzipBounded";

/**
 * Real-file check of the bounded unzip: every entry of a large .lyl (the Foshay model: 8,616 entries, project.json of ~248 MiB) must come back
 * byte for byte as fflate's unzipSync returns it, with at most two Workers, no fallback, and the same order.
 *   FOSHAY_LYL=/path/to/Foshay-Pedestal-combined.lyl npm run perf -- unzipBoundedFoshay
 */
const file = process.env.FOSHAY_LYL;
const sha = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");

describe.skipIf(!file)("unzipBounded on the Foshay model", () => {
  it("returns every entry byte for byte as unzipSync does", async () => {
    const bytes = new Uint8Array(readFileSync(file as string));
    const events: UnzipEvent[] = [];
    let running = 0;
    let most = 0;
    const started = performance.now();
    const got = await unzipBounded(bytes, {
      onEvent: (event) => {
        events.push(event);
        if (event.type === "worker-start") { running += 1; most = Math.max(most, running); }
        if (event.type === "worker-done" || event.type === "fallback") running -= 1;
      },
    });
    const boundedMs = Math.round(performance.now() - started);
    const expected = unzipSync(bytes);
    const names = Object.keys(expected);
    expect(Object.keys(got)).toEqual(names);
    let mismatched = 0;
    for (const name of names) if (got[name].byteLength !== expected[name].byteLength || sha(got[name]) !== sha(expected[name])) mismatched += 1;
    console.info(`[unzipBounded Foshay] entries ${names.length}, bounded ${boundedMs} ms, workers started ${events.filter((e) => e.type === "worker-start").length}, most at once ${most}, fallbacks ${events.filter((e) => e.type === "fallback").length}, mismatched ${mismatched}`);
    expect(mismatched).toBe(0);
    expect(most).toBeLessThanOrEqual(2);
    expect(events.some((event) => event.type === "fallback")).toBe(false);
  }, 300_000);
});
