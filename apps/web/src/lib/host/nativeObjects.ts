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
  | { op: "openGroupPart"; groupId: string; partId: string };

const MAX_SELECT_IDS = 100_000;
let watching = false;
let lastFlat: ObjectsFlat | null = null;
let lastReadOnly = false;
let rev = 0;
let lastSelectionKey: string | null = null;
let lastSelection: string[] = [];
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
    case "openGroupPart":
      return isText(args.groupId) && isText(args.partId) ? { op, groupId: args.groupId, partId: args.partId } : null;
    default:
      return null;
  }
}

function setWatching(on: boolean) {
  if (watching === on) return;
  watching = on;
  // A tab that has just become visible needs everything again: the hierarchy and the selection.
  lastFlat = null;
  lastSelectionKey = null;
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
  // The host has just rebuilt its outline: tell it the selection again.
  sendSelection(true);
}

/** Publishes the selected ids (in selection order) when they changed. Cheap: it never touches the hierarchy. */
export function publishObjectSelection(ids: readonly string[]) {
  lastSelection = [...ids];
  sendSelection(false);
}
