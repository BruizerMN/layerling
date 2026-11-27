/**
 * Build 0122: an editing session that changed nothing leaves no trace in the history. When a group is opened the editor records where the open step stands
 * (its index and fingerprint) and the entry before it; finishing or cancelling with no commit since can then drop the open step and every redo step after it,
 * returning the history to exactly what it was before the session. Pure functions over the entries, so the rule is tested without the editor.
 */
export type OpenStepRecord = {
  /** Where the open step stands in the history, and its fingerprint (the scene right after opening). */
  index: number;
  fingerprint: string;
  /** The entry before the open step; null when the open step was joined to an earlier one (a chain of opens is one step) and cannot be taken back alone. */
  preIndex: number | null;
  preFingerprint: string | null;
};

type Entry = { fingerprint: string };

/** Whether the history is still exactly as the open step left it: the editor is on that step, which is where the entries before the session end. */
export function canRewindOpenStep(entries: readonly Entry[], currentIndex: number, record: OpenStepRecord): boolean {
  if (record.preIndex === null || record.preFingerprint === null) return false;
  if (record.preIndex !== record.index - 1 || record.preIndex < 0) return false;
  if (currentIndex !== record.index) return false;
  if (entries[record.index]?.fingerprint !== record.fingerprint) return false;
  if (entries[record.preIndex]?.fingerprint !== record.preFingerprint) return false;
  return true;
}

/** The history without the open step and everything after it (the redo tail), and the index of the entry the editor returns to; null when the rewind does not apply. */
export function rewindOpenStep<T extends Entry>(entries: readonly T[], currentIndex: number, record: OpenStepRecord): { entries: T[]; index: number } | null {
  if (!canRewindOpenStep(entries, currentIndex, record)) return null;
  return { entries: entries.slice(0, record.preIndex! + 1), index: record.preIndex! };
}
