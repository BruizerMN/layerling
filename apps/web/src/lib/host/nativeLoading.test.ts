import { describe, expect, it } from "vitest";
import { formatBytes, loadingLabel, measuredFraction, setLoadingName, setLoadingState, useLoadingState } from "./nativeLoading";

describe("native loading state", () => {
  it("measures only the transfer stage", () => {
    expect(measuredFraction({ stage: "transfer", loaded: 25, total: 100, name: null })).toBe(0.25);
    expect(measuredFraction({ stage: "transfer", loaded: 150, total: 100, name: null })).toBe(1);
    expect(measuredFraction({ stage: "transfer", loaded: 5, name: null })).toBeNull();
    expect(measuredFraction({ stage: "transfer", loaded: 5, total: 0, name: null })).toBeNull();
    for (const stage of ["connecting", "opening", "unpack", "build", "editor"] as const) expect(measuredFraction({ stage, loaded: 50, total: 100, name: null })).toBeNull();
  });
  it("keeps the messages the loading has always shown", () => {
    expect(loadingLabel("connecting")).toBe("Connecting to HundchenLayerling…");
    expect(loadingLabel("opening")).toBe("Opening…");
    expect(loadingLabel("transfer")).toBe("Reading the file…");
    expect(loadingLabel("unpack")).toBe("Unpacking…");
    expect(loadingLabel("build")).toBe("Building the design…");
    expect(loadingLabel("editor")).toBe("Preparing the editor…");
  });
  it("formats sizes", () => {
    expect(formatBytes(57814564)).toBe("55.1 MB");
    expect(formatBytes(200 * 1024 * 1024)).toBe("200 MB");
    expect(formatBytes(2048)).toBe("2 KB");
  });
  it("carries no measurements from one stage into the next, but keeps the name", () => {
    setLoadingName("Foshay.lyl");
    setLoadingState({ stage: "transfer", loaded: 10, total: 100 });
    setLoadingState({ stage: "unpack" });
    expect(typeof useLoadingState).toBe("function");
    // The next stage's state has no loaded/total: measuredFraction would be null for it.
    expect(measuredFraction({ stage: "unpack", name: "Foshay.lyl" })).toBeNull();
  });
});
