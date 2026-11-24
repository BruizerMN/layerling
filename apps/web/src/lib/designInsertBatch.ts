import { placeInsertedDesign } from "@/lib/customShapePackage";
import type { ProjectAsset, WorkplaneNote, WorkplaneShape } from "@/types/layerling";

/*
 * Several saved designs (.lyl) read and prepared to go into the open one together (Build 0070, "Import Layerling Files"; host protocol `designInsert.v1`).
 * Pure: reading and parsing are handed in, nothing here touches the editor. It is `insertDesignFile` for a list - the same parser and the same
 * `placeInsertedDesign` (bodies where they were saved, fresh ids for every body and group below it, notes pinned to them) - but it only PREPARES: the caller
 * puts the result into the design with one commit, so the whole batch is one undo step. A file that cannot be read, parsed or has no bodies is reported and
 * skipped; it never stops the others.
 */

export interface DesignInsertSource {
  /** The name shown in the report. */
  fileName: string;
  /** The package's bytes (read from the host's resource endpoint). May throw. */
  load: () => Promise<ArrayBuffer | Uint8Array>;
}

export interface RestoredDesign {
  shapes: WorkplaneShape[];
  notes?: WorkplaneNote[];
  assets: ProjectAsset[];
}

export interface DesignInsertBatch {
  /** The bodies of every file that went well, in the order of the sources: ready for one commit. */
  shapes: WorkplaneShape[];
  /** Their notes, numbered on from the notes already in the design and from each other. */
  notes: WorkplaneNote[];
  assets: ProjectAsset[];
  /** Notes that did not fit under the notes limit. */
  dropped: number;
  imported: Array<{ fileName: string; objectCount: number }>;
  failures: Array<{ fileName: string; reason: string }>;
  /** `cancelled()` turned true while reading: the rest was not read; the caller must not use `shapes`. */
  cancelled: boolean;
}

export const EMPTY_DESIGN_REASON = "The file contains no objects to import";

function reasonFrom(error: unknown): string {
  const text = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return text.trim() || "The file could not be read";
}

export async function buildDesignInsertBatch(
  sources: readonly DesignInsertSource[],
  existingNotes: readonly WorkplaneNote[],
  parse: (bytes: ArrayBuffer | Uint8Array) => Promise<RestoredDesign>,
  cancelled: () => boolean = () => false,
): Promise<DesignInsertBatch> {
  const batch: DesignInsertBatch = { shapes: [], notes: [], assets: [], dropped: 0, imported: [], failures: [], cancelled: false };
  for (const source of sources) {
    if (cancelled()) { batch.cancelled = true; break; }
    let restored: RestoredDesign;
    try {
      restored = await parse(await source.load());
    } catch (error) {
      batch.failures.push({ fileName: source.fileName, reason: reasonFrom(error) });
      continue;
    }
    if (cancelled()) { batch.cancelled = true; break; }
    if (restored.shapes.length === 0) {
      batch.failures.push({ fileName: source.fileName, reason: EMPTY_DESIGN_REASON });
      continue;
    }
    try {
      const placed = placeInsertedDesign(restored, [...existingNotes, ...batch.notes]);
      batch.shapes.push(...placed.shapes);
      batch.notes.push(...placed.notes);
      batch.dropped += placed.dropped;
      batch.assets.push(...restored.assets);
      batch.imported.push({ fileName: source.fileName, objectCount: placed.shapes.length });
    } catch (error) {
      batch.failures.push({ fileName: source.fileName, reason: reasonFrom(error) });
    }
  }
  return batch;
}

/**
 * What `insertDesignFiles` needs from the editor, so the whole run can be tested without it. Build 0071: a run raises NO editor notices of its own. In the native
 * app every error-class notice becomes a modal sheet (useEditorNotice) and the generated notice classes put "Validating {name} before opening it as a new design",
 * "{name} has no bodies to insert" and "Import cancelled" among the errors, so Build 0070's progress and failure notices produced spurious alerts next to the host's own
 * report. The answer (`imported` / `failures`, every file exactly once) is the report; the host shows it.
 */
export interface DesignInsertRun {
  sources: readonly DesignInsertSource[];
  existingNotes: () => readonly WorkplaneNote[];
  parse: (bytes: ArrayBuffer | Uint8Array) => Promise<RestoredDesign>;
  /** The open design's id: a run whose design was closed or replaced meanwhile adds nothing. */
  projectId: () => string | null;
  historyViewActive: () => boolean;
  /** Puts the prepared bodies into the design in ONE commit (one undo step); false when the editor did not take them. */
  commit: (batch: DesignInsertBatch, label: string) => boolean;
}

export interface DesignInsertOutcome {
  imported: Array<{ fileName: string; objectCount: number }>;
  failures: Array<{ fileName: string; reason: string }>;
}

export async function runDesignInsert(run: DesignInsertRun): Promise<DesignInsertOutcome> {
  const { sources } = run;
  const refuseAll = (reason: string): DesignInsertOutcome => ({ imported: [], failures: sources.map((source) => ({ fileName: source.fileName, reason })) });
  if (run.historyViewActive()) return refuseAll("The history view is open. Close it and try again");
  const startProject = run.projectId();
  const changed = () => run.projectId() !== startProject;
  const batch = await buildDesignInsertBatch(sources, run.existingNotes(), run.parse, changed);
  if (batch.cancelled || changed()) return refuseAll("The design was closed or replaced while the files were being read, so nothing was imported");
  if (run.historyViewActive()) return refuseAll("The history view was opened while the files were being read, so nothing was imported");
  if (batch.shapes.length === 0) return { imported: [], failures: batch.failures };
  const label = sources.length === 1 ? sources[0].fileName : `${sources.length} files`;
  // commitShapes can refuse (with its own notice) in a few states; the bodies must really be in the design before anything is reported as imported.
  if (!run.commit(batch, label)) return refuseAll("The editor did not accept the change, so nothing was imported");
  return { imported: batch.imported, failures: batch.failures };
}
