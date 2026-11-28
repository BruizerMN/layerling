import { getHostBridge, subscribeToHostBridge, type HostBridge } from "@/lib/host/hostBridge";
import { nativeDocumentId } from "@/lib/host/nativeUi";
import { diffObjects, flattenObjectRows, type ObjectRow, type ObjectsFlat } from "@/lib/objectsSnapshot";

/**
 * The page side of the Objects Sidebar (capability `objects.v1`, needs `ui.v1`; Build 0114). The host draws the hierarchy (an NSOutlineView); the editor stays the single
 * authority. It publishes only while the host says the Objects tab is visible (`objects.watch`), and with three messages of different cost so that ordinary selection never
 * retransmits the hierarchy: `objects.tree` (structure changed), `objects.patch` (properties of existing rows changed) and `objects.selection` (ids only).
 * Without a host that granted the capability (every browser) nothing here does anything.
 */
export type ObjectsInvoke =
  | { op: "select"; ids: string[]; mode: "replace" | "toggle" }
  | { op: "focus"; rootId: string; indices: number[] }
  | { op: "rename"; target: ObjectTarget; name: string }
  | { op: "setHidden"; id: string; value: boolean }
  | { op: "setLocked"; id: string; value: boolean }
  | { op: "setShapeLocked"; target: ObjectTarget; value: boolean }
  | { op: "moveObjects"; ids: string[]; beforeId: string | null }
  | { op: "addToGroup"; ids: string[]; groupId: string }
  | { op: "takeOutOfGroup"; groupId: string; partId: string; beforeId: string | null; intoGroupId: string | null }
  | { op: "openGroup"; rootId: string; indices: number[] }
  | { op: "finishGroup" }
  /** Build 0132: a click on an ancestor in the breadcrumbs: that group becomes the current context; the levels deeper than it complete, transactionally. */
  | { op: "finishToLevel"; groupId: string }
  | { op: "cancelGroup" }
  /** Build 0122: the host asked the person and they confirmed discarding the changes of the group being edited. */
  | { op: "cancelGroupConfirmed" };

/** An object the host's row action is for: a live object (by id), or one inside a closed group (by path: the live group it starts at and the position of each next object inside the one before). */
export type ObjectTarget = { id: string } | { rootId: string; indices: number[] };
const MAX_SELECT_IDS = 100_000;
const MAX_NAME_LENGTH = 1_000;
const MAX_MOVE_IDS = 10_000;

function parseTarget(args: Record<string, unknown>): ObjectTarget | null {
  if (isText(args.id)) return { id: args.id };
  if (isText(args.rootId) && Array.isArray(args.indices) && args.indices.length >= 1 && args.indices.length <= 64 && args.indices.every((n) => Number.isInteger(n) && (n as number) >= 0)) {
    return { rootId: args.rootId, indices: args.indices as number[] };
  }
  return null;
}
let watching = false;
let lastFlat: ObjectsFlat | null = null;
let lastReadOnly = false;
let rev = 0;
let lastSelectionKey: string | null = null;
let lastSelection: string[] = [];
let lastFocusKey: string | null = null;
let lastFocusId: string | null = null;
const watchListeners = new Set<(on: boolean) => void>();
const invokeListeners = new Set<(command: ObjectsInvoke) => void>();
let offBridge: (() => void) | null = null;
let started = false;

const isText = (value: unknown): value is string => typeof value === "string" && value.length > 0;

/** Checks what the host sent; anything that is not one of the known commands is dropped. */
export function parseObjectsInvoke(op: string, args: Record<string, unknown>): ObjectsInvoke | null {
  switch (op) {
    case "select":
      return Array.isArray(args.ids) && args.ids.length <= MAX_SELECT_IDS && args.ids.every(isText) && (args.mode === "replace" || args.mode === "toggle")
        ? { op, ids: args.ids as string[], mode: args.mode }
        : null;
    case "focus":
      // A click on an object inside a closed group: `rootId` is the live group the path starts at, `indices` the position of each next object inside the one before (never empty).
      return isText(args.rootId) && Array.isArray(args.indices) && args.indices.length >= 1 && args.indices.length <= 64 && args.indices.every((n) => Number.isInteger(n) && (n as number) >= 0)
        ? { op, rootId: args.rootId, indices: args.indices as number[] }
        : null;
    case "rename": {
      const target = parseTarget(args);
      return target && typeof args.name === "string" && args.name.length <= MAX_NAME_LENGTH ? { op, target, name: args.name } : null;
    }
    case "setHidden":
    case "setLocked":
      return isText(args.id) && typeof args.value === "boolean" ? { op, id: args.id, value: args.value } : null;
    case "setShapeLocked": {
      const target = parseTarget(args);
      return target && typeof args.value === "boolean" ? { op, target, value: args.value } : null;
    }
    // Drag-and-drop (Build 0118). Reordering: objects moved together in front of another (null: to the end) in the design's own order. Regrouping: the engine's own operations (the object list's).
    case "moveObjects":
      return Array.isArray(args.ids) && args.ids.length >= 1 && args.ids.length <= MAX_MOVE_IDS && args.ids.every(isText) && (args.beforeId === null || args.beforeId === undefined || isText(args.beforeId))
        ? { op, ids: args.ids as string[], beforeId: isText(args.beforeId) ? args.beforeId : null }
        : null;
    case "addToGroup":
      return Array.isArray(args.ids) && args.ids.length >= 1 && args.ids.length <= MAX_MOVE_IDS && args.ids.every(isText) && isText(args.groupId) ? { op, ids: args.ids as string[], groupId: args.groupId } : null;
    case "takeOutOfGroup":
      // One part of a group on the workplane, out of it: loose in front of `beforeId` (null: last), or, with `intoGroupId`, straight into another group (one Undo step).
      return isText(args.groupId) && isText(args.partId) && (args.beforeId === null || args.beforeId === undefined || isText(args.beforeId)) && (args.intoGroupId === null || args.intoGroupId === undefined || isText(args.intoGroupId))
        ? { op, groupId: args.groupId, partId: args.partId, beforeId: isText(args.beforeId) ? args.beforeId : null, intoGroupId: isText(args.intoGroupId) ? args.intoGroupId : null }
        : null;
    case "openGroup":
      // `rootId`: the group on the workplane (or a part of a group being edited) at the start of the path; `indices`: for a nested group, the position of each next group inside the one before.
      return isText(args.rootId) && Array.isArray(args.indices) && args.indices.length <= 64 && args.indices.every((n) => Number.isInteger(n) && (n as number) >= 0)
        ? { op, rootId: args.rootId, indices: args.indices as number[] }
        : null;
    case "finishToLevel":
      return isText(args.groupId) ? { op, groupId: args.groupId } : null;
    case "finishGroup":
    case "cancelGroup":
    case "cancelGroupConfirmed":
      return { op };
    default:
      return null;
  }
}

function setWatching(on: boolean) {
  // `watch: true` while already watching is a RESYNC (the host missed a message): the same as a tab that has just become visible.
  if (watching === on && !on) return;
  watching = on;
  // A tab that has just become visible needs everything again: the hierarchy and the selection.
  lastFlat = null;
  lastSelectionKey = null;
  lastFocusKey = null;
  watchListeners.forEach((listener) => listener(on));
}

function attach(bridge: HostBridge | null) {
  offBridge?.();
  offBridge = bridge
    ? bridge.onEvent((event) => {
        if (event.type === "objects.watch" && event.payload.documentId === nativeDocumentId()) setWatching(event.payload.watching);
        else if (event.type === "objects.invoke" && event.payload.documentId === nativeDocumentId()) {
          const command = parseObjectsInvoke(event.payload.op, event.payload.args);
          if (command) invokeListeners.forEach((listener) => listener(command));
        }
      })
    : null;
}

function ensureStarted() {
  if (started || typeof window === "undefined") return;
  started = true;
  attach(getHostBridge());
  subscribeToHostBridge(attach);
}

/** Whether the host offers the Objects Sidebar for this document. */
export function nativeObjectsAvailable(): boolean {
  return Boolean(nativeDocumentId() && getHostBridge()?.supportsObjects());
}
/** Whether the Objects tab is visible, i.e. whether publishing is worth the work. */
export function nativeObjectsWatching(): boolean {
  return watching;
}
export function onNativeObjectsWatch(listener: (on: boolean) => void): () => void {
  ensureStarted();
  watchListeners.add(listener);
  return () => watchListeners.delete(listener);
}
export function onNativeObjectsInvoke(listener: (command: ObjectsInvoke) => void): () => void {
  ensureStarted();
  invokeListeners.add(listener);
  return () => invokeListeners.delete(listener);
}

function sendSelection(force: boolean) {
  const bridge = getHostBridge();
  const documentId = nativeDocumentId();
  if (!documentId || !bridge?.supportsObjects() || !watching) return;
  const key = lastSelection.join("\u0000");
  if (!force && key === lastSelectionKey) return;
  lastSelectionKey = key;
  void bridge.sendUi("objects.selection", { documentId, rev, ids: lastSelection });
}

/**
 * Publishes the hierarchy when it changed: the whole tree for a new structure, only the changed rows for new properties, nothing when nothing changed.
 * `rows` null: the hierarchy is beyond the bounds the host accepts (the host is told with an empty read-only tree).
 */
export function publishObjectRows(rows: readonly ObjectRow[] | null, readOnly: boolean) {
  const bridge = getHostBridge();
  const documentId = nativeDocumentId();
  if (!documentId || !bridge?.supportsObjects() || !watching) return;
  const flat = flattenObjectRows(rows ?? []);
  const diff = readOnly !== lastReadOnly ? ({ kind: "tree" } as const) : diffObjects(lastFlat, flat);
  if (diff.kind === "none") return;
  const baseRev = rev;
  rev += 1;
  lastFlat = flat;
  lastReadOnly = readOnly;
  if (diff.kind === "patch") {
    void bridge.sendUi("objects.patch", { documentId, baseRev, rev, rows: diff.rows });
    return;
  }
  void bridge.sendUi("objects.tree", { documentId, rev, readOnly: readOnly || rows === null, rows: rows ?? [] });
  // The host has just rebuilt its outline: tell it the selection and the focus again.
  sendSelection(true);
  sendFocus(true);
}

function sendFocus(force: boolean) {
  const bridge = getHostBridge();
  const documentId = nativeDocumentId();
  if (!documentId || !bridge?.supportsObjects() || !watching) return;
  const key = lastFocusId ?? "";
  if (!force && key === lastFocusKey) return;
  lastFocusKey = key;
  void bridge.sendUi("objects.focus", { documentId, rev, id: lastFocusId });
}

/** Publishes the row the sidebar has navigational focus on (null: none) when it changed. Cheap and independent of the hierarchy and the selection. */
export function publishObjectFocus(id: string | null) {
  lastFocusId = id;
  sendFocus(false);
}

/** Publishes the selected ids (in selection order) when they changed. Cheap: it never touches the hierarchy. */
export function publishObjectSelection(ids: readonly string[]) {
  lastSelection = [...ids];
  sendSelection(false);
}
