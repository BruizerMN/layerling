import { describe, expect, it } from "vitest";
import type { EditorHistoryEntry } from "@/lib/editorHistory";
import { appendInSession, boundSession, endSession, pinBaseline, sessionFrame, type HistoryFrame } from "@/lib/historyFrames";

/*
 * Build 0123: the transaction rules of group editing, on the pure history functions. A tiny model of the editor drives them (append, Undo, Redo, bound, end) through
 * thousands of random sequences and checks the contract after every step: the stash never changes; the baseline is never evicted; Undo cannot go below it; ending gives
 * either the very same stash (nothing changed) or the stash plus exactly one entry.
 */
const entry = (fingerprint: string): EditorHistoryEntry => ({ fingerprint, shapes: [], selectedIds: [], at: 1 }) as unknown as EditorHistoryEntry;
const fps = (frame: HistoryFrame) => frame.entries.map((e) => e.fingerprint);

/** A small deterministic generator (mulberry32). */
function random(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

describe("session history frame", () => {
  it("starts with the baseline alone", () => {
    const b = entry("open");
    expect(sessionFrame(b)).toEqual({ entries: [b], index: 0 });
  });

  it("appending drops Redo inside the session and never touches the stash", () => {
    const stash = { entries: [entry("d0"), entry("d1"), entry("d2")], index: 1 };
    const snapshot = JSON.stringify(stash);
    const baseline = entry("open");
    let frame: HistoryFrame = sessionFrame(baseline);
    frame = appendInSession(frame, baseline, entry("s1"), 100, 1);
    frame = appendInSession(frame, baseline, entry("s2"), 100, 2);
    frame = { ...frame, index: 1 };                                   // Undo once
    frame = appendInSession(frame, baseline, entry("s3"), 100, 3);   // a new step: s2 (Redo) is gone
    expect(fps(frame)).toEqual(["open", "s1", "s3"]);
    expect(JSON.stringify(stash)).toBe(snapshot);
  });

  it("the history limit never evicts the baseline", () => {
    const baseline = entry("open");
    let frame: HistoryFrame = sessionFrame(baseline);
    for (let i = 1; i <= 30; i += 1) frame = appendInSession(frame, baseline, entry(`s${i}`), 3, i);
    expect(frame.entries[0]).toBe(baseline);
    expect(frame.entries.length).toBeLessThanOrEqual(3 + 2);
    expect(frame.entries[frame.index].fingerprint).toBe("s30");
  });

  it("a lowered limit mid-session also keeps the baseline", () => {
    const baseline = entry("open");
    let frame: HistoryFrame = sessionFrame(baseline);
    for (let i = 1; i <= 20; i += 1) frame = appendInSession(frame, baseline, entry(`s${i}`), 100, i);
    const bounded = boundSession(frame, baseline, 2);
    expect(bounded.entries[0]).toBe(baseline);
    expect(bounded.entries[bounded.index].fingerprint).toBe("s20");
  });

  it("pinBaseline leaves a frame that already starts with the baseline alone", () => {
    const baseline = entry("open");
    const frame = { entries: [baseline, entry("a")], index: 1 };
    expect(pinBaseline(frame, baseline)).toBe(frame);
  });
});

describe("ending a session", () => {
  const stashOf = (n: number, index: number) => ({ entries: Array.from({ length: n }, (_, i) => entry(`d${i}`)), index });

  it("nothing changed: the document history comes back as the same entries, Redo tail included", () => {
    const stash = stashOf(5, 2);
    const result = endSession({ stash }, stash.entries[2], 100, 9);
    expect(result.changed).toBe(false);
    expect(result.entries).toBe(stash.entries);
    expect(result.index).toBe(2);
  });

  it("a change adds exactly one entry and drops Redo in the normal way", () => {
    const stash = stashOf(5, 2);
    const result = endSession({ stash }, entry("edited"), 100, 9);
    expect(result.changed).toBe(true);
    expect(fps(result)).toEqual(["d0", "d1", "d2", "edited"]);
    expect(result.index).toBe(3);
    expect(stash.entries).toHaveLength(5);                 // the stash itself is untouched
  });

  it("applies the document's own limit when the entry is added", () => {
    const stash = stashOf(10, 9);
    const result = endSession({ stash }, entry("edited"), 4, 9);
    expect(result.entries.length).toBeLessThanOrEqual(5);
    expect(result.entries[result.entries.length - 1].fingerprint).toBe("edited");
  });
});

describe("random sessions keep the contract", () => {
  it("5,000 random sessions: stash untouched, baseline pinned, Undo floor, one entry at most", () => {
    for (let seed = 1; seed <= 5000; seed += 1) {
      const rnd = random(seed);
      const docLength = 1 + Math.floor(rnd() * 8);
      const docIndex = Math.floor(rnd() * docLength);
      const stash = { entries: Array.from({ length: docLength }, (_, i) => entry(`d${i}`)), index: docIndex };
      const stashCopy = stash.entries.map((e) => e.fingerprint);
      const limit = 1 + Math.floor(rnd() * 6);
      const baseline = entry("open");
      let frame: HistoryFrame = sessionFrame(baseline);
      let counter = 0;
      const steps = Math.floor(rnd() * 40);
      for (let s = 0; s < steps; s += 1) {
        const r = rnd();
        if (r < 0.5) frame = appendInSession(frame, baseline, entry(`s${seed}_${counter++}`), limit, s);
        else if (r < 0.75) frame = { ...frame, index: Math.max(0, frame.index - 1) };                   // Undo
        else if (r < 0.9) frame = { ...frame, index: Math.min(frame.entries.length - 1, frame.index + 1) }; // Redo
        else frame = boundSession(frame, baseline, 1 + Math.floor(rnd() * 6));
        expect(frame.entries[0]).toBe(baseline);
        expect(frame.index).toBeGreaterThanOrEqual(0);
        expect(frame.index).toBeLessThan(frame.entries.length);
      }
      expect(stash.entries.map((e) => e.fingerprint)).toEqual(stashCopy);
      const finalEntry = frame.entries[frame.index];
      const unchanged = rnd() < 0.3;
      const ended = endSession({ stash }, unchanged ? stash.entries[stash.index] : finalEntry, 100, 99);
      if (unchanged || finalEntry.fingerprint === stash.entries[stash.index].fingerprint) {
        expect(ended.entries).toBe(stash.entries);
        expect(ended.index).toBe(stash.index);
      } else {
        expect(ended.entries.length).toBe(Math.min(stash.index + 2, 101));
        expect(ended.entries[ended.entries.length - 1]).toBe(finalEntry);
        expect(ended.entries.slice(0, stash.index + 1).map((e) => e.fingerprint)).toEqual(stashCopy.slice(0, stash.index + 1));
      }
      expect(stash.entries.map((e) => e.fingerprint)).toEqual(stashCopy);
    }
  });
});
