import { describe, expect, it } from "vitest";
import { parseHostEvent, RIBBON_CAPABILITY } from "./hostProtocol";

const base = { session: "s", protocol: 3, id: "e1" };

describe("ribbon.v1 events (native toolbar prototype)", () => {
  it("names the capability", () => {
    expect(RIBBON_CAPABILITY).toBe("ribbon.v1");
  });
  it("accepts ribbon.invoke and ribbon.native", () => {
    expect(parseHostEvent({ ...base, type: "ribbon.invoke", payload: { documentId: "d", toolId: "mirror" } })).toMatchObject({ type: "ribbon.invoke", payload: { documentId: "d", toolId: "mirror" } });
    expect(parseHostEvent({ ...base, type: "ribbon.native", payload: { documentId: "d", enabled: true } })).toMatchObject({ type: "ribbon.native", payload: { documentId: "d", enabled: true } });
  });
  it("refuses malformed ones", () => {
    expect(parseHostEvent({ ...base, type: "ribbon.invoke", payload: { documentId: "d" } })).toHaveProperty("invalid");
    expect(parseHostEvent({ ...base, type: "ribbon.invoke", payload: { toolId: "mirror" } })).toHaveProperty("invalid");
    expect(parseHostEvent({ ...base, type: "ribbon.native", payload: { documentId: "d", enabled: "yes" } })).toHaveProperty("invalid");
  });
});
