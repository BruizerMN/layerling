import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { buildDesignInsertBatch, EMPTY_DESIGN_REASON, runDesignInsert, type DesignInsertBatch, type RestoredDesign } from "@/lib/designInsertBatch";
import { DESIGN_INSERT_MAX_FILES, parseHostEvent } from "@/lib/host/hostProtocol";
import type { WorkplaneNote, WorkplaneShape } from "@/types/layerling";

function box(id: string, x: number, z: number, elevation: number, overrides: Partial<WorkplaneShape> = {}): WorkplaneShape {
  return { id, name: id, kind: "box", color: "#d41721", x, z, elevation, size: 20, width: 20, depth: 10, height: 6, rotation: 0, locked: false, hidden: false, ...overrides };
}

/** The bytes are just the file's name here; `designs` plays the parser. */
function harness(designs: Record<string, RestoredDesign | Error>) {
  const source = (fileName: string) => ({ fileName, load: async () => new TextEncoder().encode(fileName) });
  const parse = async (bytes: ArrayBuffer | Uint8Array) => {
    const entry = designs[new TextDecoder().decode(bytes as Uint8Array)];
    if (entry instanceof Error) throw entry;
    return entry;
  };
  return { source, parse };
}

describe("buildDesignInsertBatch (Import Layerling Files)", () => {
  it("keeps every body where it was saved, under fresh ids, in the order of the files, groups included", async () => {
    // Two components of one assembly that were exported with the same ids.
    const { source, parse } = harness({
      "a.lyl": { shapes: [box("s1", 40, 10, 5), box("g", 60, 30, 5, { groupedShapes: [box("p", 3, 4, 0)] })], assets: [] },
      "b.lyl": { shapes: [box("s1", -120.5, 77.25, 12.75)], assets: [] },
    });
    const batch = await buildDesignInsertBatch([source("a.lyl"), source("b.lyl")], [], parse);
    expect(batch.failures).toEqual([]);
    expect(batch.cancelled).toBe(false);
    expect(batch.imported).toEqual([{ fileName: "a.lyl", objectCount: 2 }, { fileName: "b.lyl", objectCount: 1 }]);
    // Coordinates exactly as saved, in file order.
    expect(batch.shapes.map((shape) => [shape.x, shape.z, shape.elevation])).toEqual([[40, 10, 5], [60, 30, 5], [-120.5, 77.25, 12.75]]);
    // The group keeps its child, and its place inside the group.
    expect(batch.shapes[1].groupedShapes).toHaveLength(1);
    expect([batch.shapes[1].groupedShapes?.[0].x, batch.shapes[1].groupedShapes?.[0].z]).toEqual([3, 4]);
    // The same source id in two files never collides.
    const ids = [batch.shapes[0].id, batch.shapes[1].id, batch.shapes[1].groupedShapes?.[0].id, batch.shapes[2].id];
    expect(new Set(ids).size).toBe(4);
    expect(batch.shapes[0].id).not.toBe("s1");
  });

  it("imports the good files, skips and names the bad ones, and never stops at a failure", async () => {
    const { source, parse } = harness({
      "ok1.lyl": { shapes: [box("a", 1, 2, 0)], assets: [] },
      "broken.lyl": new Error("Legacy JSON project is malformed"),
      "empty.lyl": { shapes: [], assets: [] },
      "ok2.lyl": { shapes: [box("a", 3, 4, 0)], assets: [] },
    });
    const batch = await buildDesignInsertBatch(["ok1.lyl", "broken.lyl", "empty.lyl", "ok2.lyl"].map(source), [], parse);
    expect(batch.imported.map((entry) => entry.fileName)).toEqual(["ok1.lyl", "ok2.lyl"]);
    expect(batch.failures).toEqual([
      { fileName: "broken.lyl", reason: "Legacy JSON project is malformed" },
      { fileName: "empty.lyl", reason: EMPTY_DESIGN_REASON },
    ]);
    expect(batch.shapes.map((shape) => shape.x)).toEqual([1, 3]);
  });

  it("reports a file whose bytes cannot be loaded", async () => {
    const { parse } = harness({});
    const batch = await buildDesignInsertBatch([{ fileName: "gone.lyl", load: async () => { throw new Error("The host refused to send the file (status 404)"); } }], [], parse);
    expect(batch.shapes).toEqual([]);
    expect(batch.failures).toEqual([{ fileName: "gone.lyl", reason: "The host refused to send the file (status 404)" }]);
  });

  it("numbers notes on from the design's and from the earlier files", async () => {
    const note = (text: string): WorkplaneNote => ({ id: "note-1", text, x: 1, y: 2, z: 3 });
    const { source, parse } = harness({
      "a.lyl": { shapes: [box("a", 0, 0, 0)], notes: [note("from a")], assets: [] },
      "b.lyl": { shapes: [box("b", 0, 0, 0)], notes: [note("from b")], assets: [] },
    });
    const existing: WorkplaneNote[] = [{ id: "note-1", text: "mine", x: 0, y: 0, z: 0 }];
    const batch = await buildDesignInsertBatch([source("a.lyl"), source("b.lyl")], existing, parse);
    expect(batch.notes.map((entry) => entry.text)).toEqual(["from a", "from b"]);
    expect(new Set([...existing, ...batch.notes].map((entry) => entry.id)).size).toBe(3);
  });

  it("stops reading when the design changed, and says so", async () => {
    const { source, parse } = harness({ "a.lyl": { shapes: [box("a", 0, 0, 0)], assets: [] }, "b.lyl": { shapes: [box("b", 0, 0, 0)], assets: [] } });
    let reads = 0;
    const counting = async (bytes: ArrayBuffer | Uint8Array) => { reads += 1; return parse(bytes); };
    const batch = await buildDesignInsertBatch([source("a.lyl"), source("b.lyl")], [], counting, () => reads >= 1);
    expect(batch.cancelled).toBe(true);
    expect(reads).toBe(1);
  });
});

describe("designInsert.insert event", () => {
  const url = `layerling://app/__host__/doc/${"A".repeat(43)}`;
  const file = (name: string) => ({ kind: "file", documentId: "doc-12345678", fileName: name, byteLength: 10, modifiedAt: 1, url });
  const event = (payload: Record<string, unknown>) => ({ session: "session-1", protocol: 3, id: "di-1", type: "designInsert.insert", payload: { documentId: "doc-12345678", ...payload } });

  it("parses the files the host chose", () => {
    const parsed = parseHostEvent(event({ requestId: "r1", files: [file("a.lyl"), file("b.lyl")] }));
    expect("invalid" in parsed).toBe(false);
    if (!("invalid" in parsed) && parsed.type === "designInsert.insert") expect(parsed.payload.files.map((entry) => entry.fileName)).toEqual(["a.lyl", "b.lyl"]);
  });
  it("refuses a bad request: no files, too many, a foreign url, no requestId", () => {
    expect(parseHostEvent(event({ requestId: "r1", files: [] }))).toHaveProperty("invalid");
    expect(parseHostEvent(event({ requestId: "r1", files: Array.from({ length: DESIGN_INSERT_MAX_FILES + 1 }, () => file("a.lyl")) }))).toHaveProperty("invalid");
    expect(parseHostEvent(event({ requestId: "r1", files: [{ ...file("a.lyl"), url: "https://example.com/a.lyl" }] }))).toHaveProperty("invalid");
    expect(parseHostEvent(event({ files: [file("a.lyl")] }))).toHaveProperty("invalid");
  });
});

describe("runDesignInsert (the whole run, Build 0071)", () => {
  function run(designs: Record<string, RestoredDesign | Error>, names: string[], overrides: Partial<Parameters<typeof runDesignInsert>[0]> = {}) {
    const { source, parse } = harness(designs);
    const commits: Array<{ batch: DesignInsertBatch; label: string }> = [];
    const outcome = runDesignInsert({
      sources: names.map(source), existingNotes: () => [], parse, projectId: () => "project-1", historyViewActive: () => false,
      commit: (batch, label) => { commits.push({ batch, label }); return true; },
      ...overrides,
    });
    return { outcome, commits };
  }
  const good = (id: string, x: number) => ({ shapes: [box(id, x, x * 2, 5)], assets: [] }) satisfies RestoredDesign;

  it("a single good file: one commit, reported once, nothing failed", async () => {
    const { outcome, commits } = run({ "a.lyl": good("a", 10) }, ["a.lyl"]);
    expect(await outcome).toEqual({ imported: [{ fileName: "a.lyl", objectCount: 1 }], failures: [] });
    expect(commits).toHaveLength(1);
    expect(commits[0].label).toBe("a.lyl");
    expect([commits[0].batch.shapes[0].x, commits[0].batch.shapes[0].z, commits[0].batch.shapes[0].elevation]).toEqual([10, 20, 5]);
  });

  it("several good files: ONE commit for all of them (one undo step), coordinates and order as saved", async () => {
    const { outcome, commits } = run({ "a.lyl": good("a", 10), "b.lyl": good("b", -30.5), "c.lyl": good("c", 7) }, ["a.lyl", "b.lyl", "c.lyl"]);
    const result = await outcome;
    expect(result.failures).toEqual([]);
    expect(result.imported.map((entry) => entry.fileName)).toEqual(["a.lyl", "b.lyl", "c.lyl"]);
    expect(commits).toHaveLength(1);
    expect(commits[0].label).toBe("3 files");
    expect(commits[0].batch.shapes.map((shape) => [shape.x, shape.z])).toEqual([[10, 20], [-30.5, -61], [7, 14]]);
  });

  it("a partial failure still imports the good files and reports each bad one by name", async () => {
    const { outcome, commits } = run({ "a.lyl": good("a", 1), "broken.lyl": new Error("Legacy JSON project is malformed"), "empty.lyl": { shapes: [], assets: [] } }, ["a.lyl", "broken.lyl", "empty.lyl"]);
    expect(await outcome).toEqual({
      imported: [{ fileName: "a.lyl", objectCount: 1 }],
      failures: [{ fileName: "broken.lyl", reason: "Legacy JSON project is malformed" }, { fileName: "empty.lyl", reason: EMPTY_DESIGN_REASON }],
    });
    expect(commits).toHaveLength(1);
    expect(commits[0].batch.shapes).toHaveLength(1);
  });

  it("an entirely failed batch commits nothing and reports every file", async () => {
    const { outcome, commits } = run({ "x.lyl": new Error("bad zip"), "y.lyl": { shapes: [], assets: [] } }, ["x.lyl", "y.lyl"]);
    expect(await outcome).toEqual({ imported: [], failures: [{ fileName: "x.lyl", reason: "bad zip" }, { fileName: "y.lyl", reason: EMPTY_DESIGN_REASON }] });
    expect(commits).toHaveLength(0);
  });

  it("adds nothing, and reports every file, when the design is replaced while reading", async () => {
    let project = "project-1";
    const { outcome, commits } = run({ "a.lyl": good("a", 1), "b.lyl": good("b", 2) }, ["a.lyl", "b.lyl"], { projectId: () => project, parse: async (bytes) => { project = "project-2"; return good("a", 1) } });
    const result = await outcome;
    expect(result.imported).toEqual([]);
    expect(result.failures.map((failure) => failure.fileName)).toEqual(["a.lyl", "b.lyl"]);
    expect(result.failures[0].reason).toMatch(/closed or replaced/);
    expect(commits).toHaveLength(0);
  });

  it("adds nothing when the history view is open before, or opens while reading", async () => {
    const before = run({ "a.lyl": good("a", 1) }, ["a.lyl"], { historyViewActive: () => true });
    expect((await before.outcome).failures[0].reason).toMatch(/history view is open/);
    expect(before.commits).toHaveLength(0);
    let calls = 0;
    const during = run({ "a.lyl": good("a", 1) }, ["a.lyl"], { historyViewActive: () => ++calls > 1 });
    expect((await during.outcome).failures[0].reason).toMatch(/history view was opened/);
    expect(during.commits).toHaveLength(0);
  });

  it("reports every file as not imported when the editor does not take the bodies", async () => {
    const { outcome } = run({ "a.lyl": good("a", 1), "b.lyl": good("b", 2) }, ["a.lyl", "b.lyl"], { commit: () => false });
    const result = await outcome;
    expect(result.imported).toEqual([]);
    expect(result.failures.map((failure) => failure.fileName)).toEqual(["a.lyl", "b.lyl"]);
  });

  it("raises no editor notice: insertDesignFiles never calls setNotice (a native alert would sit next to the host's report)", () => {
    const source = readFileSync(path.resolve(__dirname, "../../apps/web/src/lib/useCustomShapes.ts"), "utf8");
    const start = source.indexOf("const insertDesignFiles = useCallback(");
    const end = source.indexOf("const renameMyShapeEntry = useCallback(", start);
    expect(start).toBeGreaterThan(0);
    const body = source.slice(start, end);
    expect(body).not.toMatch(/setNotice|status\.validatingFile|status\.insertDesignEmpty|status\.importCancelled|status\.insertDesignFailed/);
    const runner = readFileSync(path.resolve(__dirname, "../../apps/web/src/lib/designInsertBatch.ts"), "utf8");
    expect(runner).not.toMatch(/setNotice|status\./);
  });
});
