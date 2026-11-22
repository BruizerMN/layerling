import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_INSPECTOR_TAB,
  INSPECTOR_TAB_IDS,
  getInspectorTab,
  isInspectorTabId,
  resetInspectorTab,
  setInspectorTab,
  tabForKey,
} from "@/lib/inspectorTabs";

describe("Inspector tabs (native app)", () => {
  beforeEach(() => resetInspectorTab());

  it("lists Project, then Object, and starts on Object", () => {
    expect([...INSPECTOR_TAB_IDS]).toEqual(["project", "object"]);
    expect(DEFAULT_INSPECTOR_TAB).toBe("object");
    expect(getInspectorTab()).toBe("object");
  });

  it("switches between the tabs and ignores anything that is not one", () => {
    setInspectorTab("project");
    expect(getInspectorTab()).toBe("project");
    setInspectorTab("nonsense");
    setInspectorTab(undefined);
    expect(getInspectorTab()).toBe("project");
    setInspectorTab("object");
    expect(getInspectorTab()).toBe("object");
    expect(isInspectorTabId("project")).toBe(true);
    expect(isInspectorTabId("Project")).toBe(false);
  });

  it("moves with the arrow keys, wraps, and jumps with Home and End", () => {
    const ids = INSPECTOR_TAB_IDS;
    expect(tabForKey(ids, "project", "ArrowRight")).toBe("object");
    expect(tabForKey(ids, "object", "ArrowRight")).toBe("project");
    expect(tabForKey(ids, "project", "ArrowLeft")).toBe("object");
    expect(tabForKey(ids, "object", "Home")).toBe("project");
    expect(tabForKey(ids, "project", "End")).toBe("object");
    expect(tabForKey(ids, "object", "Enter")).toBeNull();
  });

  it("navigates any number of tabs without changes to the logic", () => {
    const more = ["project", "object", "history", "notes"] as const;
    expect(tabForKey(more, "object", "ArrowRight")).toBe("history");
    expect(tabForKey(more, "notes", "ArrowRight")).toBe("project");
    expect(tabForKey(more, "project", "ArrowLeft")).toBe("notes");
    expect(tabForKey(more, "object", "End")).toBe("notes");
  });
});
