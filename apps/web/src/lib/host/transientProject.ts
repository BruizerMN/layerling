/**
 * Per-document editor state for a native document that must never reach the browser's storage.
 *
 * The camera, the saved views, the framing squares and the tape measurements are kept per design in localStorage under the design's
 * id (designView.ts, cornerRulerStore.ts, tapeStore.ts). A native document has a transient runtime id (prefix below): for such ids the
 * same calls read and write this in-memory store instead, so nothing of the document is left in the browser and nothing needs cleaning up
 * (the store dies with the page, i.e. with the document window). Every other id uses localStorage exactly as before.
 */
export const TRANSIENT_PROJECT_PREFIX = "native-doc:";

export const isTransientProjectId = (projectId: string | null | undefined): projectId is string =>
  typeof projectId === "string" && projectId.startsWith(TRANSIENT_PROJECT_PREFIX);

export const transientProjectId = (documentId: string) => `${TRANSIENT_PROJECT_PREFIX}${documentId}`;

const memory = new Map<string, string>();

type KeyValueStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const changeListeners = new Set<(key: string) => void>();

/** Told when something is written to the in-memory store (the editor tracks saved views, rulers and tape measurements as document state). */
export function subscribeTransientStore(listener: (key: string) => void): () => void {
  changeListeners.add(listener);
  return () => changeListeners.delete(listener);
}

const memoryStore: KeyValueStore = {
  getItem: (key) => memory.get(key) ?? null,
  setItem: (key, value) => {
    memory.set(key, value);
    changeListeners.forEach((listener) => listener(key));
  },
  removeItem: (key) => {
    memory.delete(key);
    changeListeners.forEach((listener) => listener(key));
  },
};

/** The store for a design's per-project keys: memory for a native document, localStorage otherwise. */
export function projectStorage(projectId: string | null | undefined): KeyValueStore {
  return isTransientProjectId(projectId) ? memoryStore : window.localStorage;
}
