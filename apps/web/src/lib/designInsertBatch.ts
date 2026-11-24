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
