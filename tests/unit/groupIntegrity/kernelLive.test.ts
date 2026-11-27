import { beforeAll, describe, it, vi } from "vitest";
import { assertKernelLive, startKernel } from "./support";

/*
 * The geometry runtime loader (`getManifoldRuntime`) imports manifold.js by URL, which does not work in Node: without this mock every async
 * boolean returns null silently and tests of grouping, cutting and reconstruction "fail" or "pass" for the wrong reasons.
 * Every file in this directory repeats this block (vi.mock is hoisted per file) and calls `assertKernelLive()` once.
 */
const kernel = vi.hoisted(() => ({ runtime: null as Promise<unknown> | null }));
vi.mock("@/lib/editorMeshCore", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/editorMeshCore")>()), getManifoldRuntime: () => kernel.runtime }));

beforeAll(async () => {
  kernel.runtime = Promise.resolve(await startKernel());
});

describe("model-integrity kernel", () => {
  it("is operational: grouping merges through the real kernel", async () => {
    await assertKernelLive();
  });
});
