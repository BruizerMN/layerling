import { DocumentTransferError, fetchDocumentBytes } from "@/lib/host/documentTransfer";
import type { DocumentDescriptor, FileDocumentDescriptor } from "@/lib/host/hostDocument";
import type { DocumentFailureCode, DocumentPhase } from "@/lib/host/hostProtocol";
import { transientProjectId } from "@/lib/host/transientProject";
import type { EditorHistoryEntry } from "@/lib/editorHistory";
import type { LylRestoredProject } from "@/lib/lylProject";
import { horizontalPlacementWorkplane, type PlacementWorkplane } from "@/lib/placementWorkplane";
import { DEFAULT_SNAP_GRID, DEFAULT_WORKPLANE_WORKSPACE, readWorkspaceDefault } from "@/lib/workplaneSettings";
import { seedStartCornerRuler, writeCornerRulers } from "@/lib/cornerRulerStore";
import { writeDesignView, writeSavedViews } from "@/lib/designView";
import { writeTape } from "@/lib/tapeStore";
import type { GridSize, ProjectAsset, ProjectAttachment, WorkplaneNote, WorkplaneShape, WorkplaneWorkspaceSettings } from "@/types/layerling";

/**
 * Opens a native document for the editor WITHOUT the browser library: nothing here reads or writes IndexedDB, localStorage project records,
 * thumbnails or the project list, and nothing repacks the design into a .lyl. The same parser (importLylProject) and the same mesh relief
 * as the browser's import are used, so the scene that results is the one the browser would build.
 */
export interface NativeDocumentState {
  documentId: string;
  /** The id the editor runs under: transient, derived from the document id, never stored. */
  runtimeProjectId: string;
  /** The project id the document carries (a file's metadata.projectId; made here for a new document). Document metadata, kept apart from the runtime id. */
  documentProjectId: string | null;
  projectName: string;
  createdAt: number;
  modifiedAt: number;
  shapes: WorkplaneShape[];
  notes?: WorkplaneNote[];
  history?: EditorHistoryEntry[];
  historyIndex?: number;
  assets: ProjectAsset[];
  attachments?: ProjectAttachment[];
  workspace: WorkplaneWorkspaceSettings;
  snapGrid: GridSize;
  placementElevation: number;
  placementWorkplane: PlacementWorkplane;
  sketchPlacementWorkplane: PlacementWorkplane;
  stats: { rootObjects: number; historyStates: number };
  timings: { transferMs: number; importMs: number; hydrateMs: number };
  meshRelief: { bodies: number };
}

export interface NativeDocumentDeps {
  /** The existing parser: importLylProject. */
  importLyl(bytes: Uint8Array): Promise<LylRestoredProject>;
  /** The existing relief: relieveOverFineCadMeshes with the kernel's remesh. */
  relieve(project: LylRestoredProject): Promise<{ project: LylRestoredProject; relieved: number }>;
  fetchBytes?: typeof fetchDocumentBytes;
  now?: () => number;
  createId?: () => string;
}

export interface NativeDocumentOptions {
  signal?: AbortSignal;
  onPhase?: (phase: DocumentPhase, loaded?: number, total?: number) => void;
}

export async function loadNativeDocument(descriptor: DocumentDescriptor, deps: NativeDocumentDeps, options: NativeDocumentOptions = {}): Promise<NativeDocumentState> {
  const now = deps.now ?? (() => performance.now());
  const runtimeProjectId = transientProjectId(descriptor.documentId);
  if (descriptor.kind === "new") return newDocumentState(descriptor.documentId, runtimeProjectId, descriptor.displayName, deps);
  return openFileDocument(descriptor, runtimeProjectId, deps, options, now);
}

function newDocumentState(documentId: string, runtimeProjectId: string, displayName: string, deps: NativeDocumentDeps): NativeDocumentState {
  // The same defaults a new browser design gets (page.tsx newProject / createAndOpenProject): saved workspace default, empty scene, level workplane, start corner ruler.
  const saved = readWorkspaceDefault();
  const stamp = Date.now();
  seedStartCornerRuler(runtimeProjectId);
  return {
    documentId,
    runtimeProjectId,
    documentProjectId: (deps.createId ?? (() => crypto.randomUUID()))(),
    projectName: displayName,
    createdAt: stamp,
    modifiedAt: stamp,
    shapes: [],
    assets: [],
    workspace: saved?.workspace ?? DEFAULT_WORKPLANE_WORKSPACE,
    snapGrid: saved?.snap ?? DEFAULT_SNAP_GRID,
    placementElevation: 0,
    placementWorkplane: horizontalPlacementWorkplane(),
    sketchPlacementWorkplane: horizontalPlacementWorkplane(),
    stats: { rootObjects: 0, historyStates: 1 },
    timings: { transferMs: 0, importMs: 0, hydrateMs: 0 },
    meshRelief: { bodies: 0 },
  };
}

async function openFileDocument(
  descriptor: FileDocumentDescriptor,
  runtimeProjectId: string,
  deps: NativeDocumentDeps,
  options: NativeDocumentOptions,
  now: () => number,
): Promise<NativeDocumentState> {
  const fetchBytes = deps.fetchBytes ?? fetchDocumentBytes;
  const t0 = now();
  let lastReported = 0;
  let bytes: Uint8Array | null = await fetchBytes(descriptor, {
    signal: options.signal,
    onProgress: (loaded, total) => {
      // At most about every 4 MiB: progress is a courtesy to the window, never a cost.
      if (loaded === total || loaded - lastReported >= 4 * 1024 * 1024) {
        lastReported = loaded;
        options.onPhase?.("transfer", loaded, total);
      }
    },
  });
  const t1 = now();
  if (options.signal?.aborted) throw new DOMException("cancelled", "AbortError");
  options.onPhase?.("unpack");
  const parsed = await deps.importLyl(bytes);
  bytes = null; // the package is no longer needed; the parser copied what it keeps
  options.onPhase?.("build");
  const t2 = now();
  if (options.signal?.aborted) throw new DOMException("cancelled", "AbortError");
  const { project: restored, relieved } = await deps.relieve(parsed);
  const t3 = now();

  // Per-document editor state: in memory under the transient id (transientProject.ts).
  writeDesignView(runtimeProjectId, restored.view ?? null);
  writeSavedViews(runtimeProjectId, restored.savedViews ?? null);
  writeCornerRulers(runtimeProjectId, restored.cornerRulers ?? null);
  writeTape(runtimeProjectId, restored.tapeMeasurements ?? null);

  return {
    documentId: descriptor.documentId,
    runtimeProjectId,
    documentProjectId: restored.sourceProjectId ?? null,
    projectName: restored.projectName,
    createdAt: restored.createdAt,
    modifiedAt: restored.modifiedAt,
    shapes: restored.shapes,
    notes: restored.notes,
    history: restored.history,
    historyIndex: restored.historyIndex,
    assets: restored.assets,
    attachments: restored.attachments,
    workspace: restored.workspace,
    snapGrid: restored.snapGrid,
    placementElevation: restored.placementElevation,
    placementWorkplane: restored.placementWorkplane,
    sketchPlacementWorkplane: restored.sketchPlacementWorkplane,
    stats: { rootObjects: restored.shapes.length, historyStates: restored.history.length },
    timings: { transferMs: Math.round(t1 - t0), importMs: Math.round(t2 - t1), hydrateMs: Math.round(t3 - t2) },
    meshRelief: { bodies: relieved },
  };
}

/** Maps what went wrong while opening to the code the host is told (the message is the editor's own text for the person). */
export function classifyOpenError(error: unknown): DocumentFailureCode {
  if (error instanceof DOMException && error.name === "AbortError") return "cancelled";
  if (error instanceof DocumentTransferError) return "transfer-failed";
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof RangeError || /out of memory|allocation|memory/i.test(message)) return "out-of-memory";
  if (/newer layerling|requires a newer layerling|newer than this/i.test(message)) return "unsupported-version";
  return "invalid-package";
}
