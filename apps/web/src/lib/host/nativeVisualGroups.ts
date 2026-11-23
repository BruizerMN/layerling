import { getHostBridge, subscribeToHostBridge, type HostBridge } from "@/lib/host/hostBridge";
import { nativeDocumentId } from "@/lib/host/nativeUi";
import type { ChooserGroup, VisualGroupsPaletteState } from "@/lib/visualGroupsSnapshot";

/**
 * The page side of the Visual Groups palette (capability `visualGroups.v1`, needs `ui.v1`). The host draws the palette (an NSOutlineView in a floating
 * panel); the editor stays the single authority: it publishes what the palette shows (`visualGroups.state`, only while the host says the palette is
 * open: `visualGroups.watch`) and carries out what the palette asks for (`visualGroups.invoke`) through its own functions, then publishes again.
 * Without a host that granted the capability (every browser) nothing here does anything.
 */
export type VisualGroupsInvoke =
  | { op: "create"; name?: string; parentId?: string | null }
  | { op: "rename"; groupId: string; name: string }
  | { op: "delete"; groupId: string }
  | { op: "toggleGroup"; groupId: string }
  | { op: "toggleObject"; id: string }
  | { op: "removeObject"; id: string }
  | { op: "select"; ids: string[]; mode: "replace" | "toggle" }
  | { op: "assign"; objectIds: string[]; groupId?: string | null; newName?: string; parentId?: string | null }
  | { op: "pickResult"; requestId: string; cancelled: boolean; groupId?: string }
  | { op: "focusGroup"; groupId: string }
  | { op: "renameObject"; id: string; name: string }
  | { op: "lockGroup"; groupId: string; locked: boolean }
  | { op: "toggleObjectLock"; id: string }
  | { op: "move"; items: Array<{ kind: "group" | "object"; id: string }>; parentId: string | null; index: number };

let watching = false;
let lastState = "";
const watchListeners = new Set<(on: boolean) => void>();
const invokeListeners = new Set<(command: VisualGroupsInvoke) => void>();
let offBridge: (() => void) | null = null;
let started = false;

const isText = (value: unknown): value is string => typeof value === "string" && value.length > 0;

/** Checks what the host sent; anything that is not one of the known commands is dropped (the host is trusted, a bug in it is not). */
export function parseVisualGroupsInvoke(op: string, args: Record<string, unknown>): VisualGroupsInvoke | null {
  switch (op) {
    case "create": return { op, ...(typeof args.name === "string" ? { name: args.name } : {}), ...(typeof args.parentId === "string" ? { parentId: args.parentId } : {}) };
    case "rename": return isText(args.groupId) && typeof args.name === "string" ? { op, groupId: args.groupId, name: args.name } : null;
    case "delete": return isText(args.groupId) ? { op, groupId: args.groupId } : null;
    case "toggleGroup": return isText(args.groupId) ? { op, groupId: args.groupId } : null;
    case "toggleObject": return isText(args.id) ? { op, id: args.id } : null;
    case "removeObject": return isText(args.id) ? { op, id: args.id } : null;
    case "select": return Array.isArray(args.ids) && args.ids.every(isText) && (args.mode === "replace" || args.mode === "toggle") ? { op, ids: args.ids as string[], mode: args.mode } : null;
    case "assign": {
      if (!Array.isArray(args.objectIds) || !args.objectIds.every(isText) || args.objectIds.length === 0) return null;
      if (!isText(args.groupId) && !isText(args.newName)) return null;
      return { op, objectIds: args.objectIds as string[], ...(isText(args.groupId) ? { groupId: args.groupId } : {}), ...(isText(args.newName) ? { newName: args.newName } : {}), ...(typeof args.parentId === "string" ? { parentId: args.parentId } : {}) };
    }
    case "pickResult": return isText(args.requestId) && typeof args.cancelled === "boolean" ? { op, requestId: args.requestId, cancelled: args.cancelled, ...(isText(args.groupId) ? { groupId: args.groupId } : {}) } : null;
    case "focusGroup": return isText(args.groupId) ? { op, groupId: args.groupId } : null;
    case "lockGroup": return isText(args.groupId) && typeof args.locked === "boolean" ? { op, groupId: args.groupId, locked: args.locked } : null;
    case "toggleObjectLock": return isText(args.id) ? { op, id: args.id } : null;
    case "renameObject": return isText(args.id) && typeof args.name === "string" ? { op, id: args.id, name: args.name } : null;
    case "move": {
      if (!Array.isArray(args.items) || args.items.length === 0 || args.items.length > 1000) return null;
      const items: Array<{ kind: "group" | "object"; id: string }> = [];
      for (const entry of args.items) {
        if (typeof entry !== "object" || entry === null) return null;
        const { kind, id } = entry as Record<string, unknown>;
        if ((kind !== "group" && kind !== "object") || !isText(id)) return null;
        items.push({ kind, id });
      }
      if (args.parentId !== undefined && args.parentId !== null && !isText(args.parentId)) return null;
      if (typeof args.index !== "number" || !Number.isFinite(args.index)) return null;
      return { op, items, parentId: typeof args.parentId === "string" ? args.parentId : null, index: Math.trunc(args.index) };
    }
    default: return null;
  }
}

function setWatching(on: boolean) {
  if (watching === on) return;
  watching = on;
  lastState = ""; // a palette that has just opened needs the whole state
  watchListeners.forEach((listener) => listener(on));
}

function attach(bridge: HostBridge | null) {
  offBridge?.();
  offBridge = bridge
    ? bridge.onEvent((event) => {
        if (event.type === "visualGroups.watch" && event.payload.documentId === nativeDocumentId()) setWatching(event.payload.watching);
        else if (event.type === "visualGroups.invoke" && event.payload.documentId === nativeDocumentId()) {
          const command = parseVisualGroupsInvoke(event.payload.op, event.payload.args);
          if (command?.op === "pickResult") settlePick(command.requestId, command.cancelled ? { cancelled: true } : { cancelled: false, groupId: command.groupId ?? null });
          else if (command) invokeListeners.forEach((listener) => listener(command));
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

/** Whether the host offers the palette for this document (the viewport menu offers Visual Groups only then). */
export function nativeVisualGroupsAvailable(): boolean {
  return Boolean(nativeDocumentId() && getHostBridge()?.supportsVisualGroups());
}
/** Whether the palette is open, i.e. whether publishing is worth the work. */
export function nativeVisualGroupsWatching(): boolean {
  return watching;
}
export function onNativeVisualGroupsWatch(listener: (on: boolean) => void): () => void {
  ensureStarted();
  watchListeners.add(listener);
  return () => watchListeners.delete(listener);
}
export function onNativeVisualGroupsInvoke(listener: (command: VisualGroupsInvoke) => void): () => void {
  ensureStarted();
  invokeListeners.add(listener);
  return () => invokeListeners.delete(listener);
}

/** Sends what the palette shows when it changed. */
export function publishVisualGroupsState(state: VisualGroupsPaletteState) {
  const bridge = getHostBridge();
  const documentId = nativeDocumentId();
  if (!documentId || !bridge?.supportsVisualGroups() || !watching) return;
  const key = JSON.stringify(state);
  if (key === lastState) return;
  lastState = key;
  void bridge.sendUi("visualGroups.state", { documentId, state });
}

/**
 * Asks the host to show its chooser for where objects should go (Add to / Move to Visual Group). The answer arrives as an `assign` command; Cancel sends nothing.
 * `newGroupOnly`: only ask for the name of a new group (the menu's "New Visual Group…").
 */
export function requestVisualGroupChooser(request: { mode: "add" | "move"; objectIds: string[]; groups: ChooserGroup[]; newGroupOnly?: boolean }) {
  const bridge = getHostBridge();
  const documentId = nativeDocumentId();
  if (!documentId || !bridge?.supportsVisualGroups()) return;
  void bridge.sendUi("visualGroups.choose", { documentId, ...request });
}

// ---- the question a merge asks when its objects are in different Visual Groups ------------------------------------------------

export type VisualGroupPickAnswer = { cancelled: true } | { cancelled: false; groupId: string | null };
const pendingPicks = new Map<string, (answer: VisualGroupPickAnswer) => void>();
let pickCounter = 0;

function settlePick(requestId: string, answer: VisualGroupPickAnswer) {
  const resolve = pendingPicks.get(requestId);
  if (!resolve) return;
  pendingPicks.delete(requestId);
  resolve(answer);
}

/**
 * Asks the host's sheet which of these groups the merged object goes into (`groupId: null`: none). Cancel stops the merge. Without a host that
 * offers the palette nothing can be asked: the answer is then "none", which is also what the callers do when they do not ask.
 */
export function requestVisualGroupPick(request: { operation: string; objectCount: number; candidates: Array<{ id: string; name: string; count: number }> }): Promise<VisualGroupPickAnswer> {
  const bridge = getHostBridge();
  const documentId = nativeDocumentId();
  if (!documentId || !bridge?.supportsVisualGroups()) return Promise.resolve({ cancelled: false, groupId: null });
  ensureStarted();
  const requestId = `pick${++pickCounter}`;
  return new Promise<VisualGroupPickAnswer>((resolve) => {
    pendingPicks.set(requestId, resolve);
    void bridge.sendUi("visualGroups.pick", { documentId, requestId, ...request }).then((reply) => {
      // The host refused the question: do not leave the merge waiting.
      if (!reply.ok) settlePick(requestId, { cancelled: false, groupId: null });
    });
  });
}
