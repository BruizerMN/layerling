import { appendEditorHistorySnapshot, boundedEditorHistoryState, type EditorHistoryEntry, type EditorHistoryExportLimit } from "@/lib/editorHistory";

/**
 * Build 0123: group editing is a transaction with its own history.
 *
 * While a group is open for editing (native app) the editor works on a SESSION history: a frame swapped in for the document's history. The document's own history
 * (entries, index and the level map that goes with it) is STASHED, untouched, and comes back when the session ends:
 *  - Done: one entry for the finished state is appended to the stashed history in the normal way (drops Redo, applies the limit), whatever happened inside;
 *  - Cancel, or a session that changed nothing: the stash comes back as it was, Redo included; the session history is discarded;
 *  - a refused Done changes nothing at all.
 * Undo and Redo inside the session work on the session history through the very same refs the editor always used, so they can neither leave the editing context
 * nor reach into the document's history. The session's first entry (the state right after the group opened) is PINNED: no history limit can evict it.
 * Pure functions over entries, tested without the editor (tests/unit/groupIntegrity/historyFrames.test.ts).
 */
export type HistoryFrame = { entries: EditorHistoryEntry[]; index: number };

/** The baseline (the state right after the group opened, the floor of Undo inside the session) is always the FIRST entry of the session frame; callers pass the frame's own first entry as `baseline`, so other code that replaces an entry by value (selection sync, mesh rebuild) cannot make the pin stale. */
export type GroupEditSession<Levels = unknown> = {
  /** The document history exactly as it was when the session began. Never modified; the entries array itself is what comes back when nothing changed. */
  readonly stash: Readonly<HistoryFrame>;
  /** The document's level map (scene fingerprint to open levels), swapped out for the session's own. */
  readonly stashLevels: Map<string, Levels>;
};

/** A frame of one entry: the baseline of a new session, and the state Undo inside the session cannot go below. */
export function sessionFrame(baseline: EditorHistoryEntry): HistoryFrame {
  return { entries: [baseline], index: 0 };
}

/** The entries with the baseline first again if the limit pushed it out (the entry after it then follows it directly); the index follows the same entry. */
export function pinBaseline(frame: HistoryFrame, baseline: EditorHistoryEntry): HistoryFrame {
  if (frame.entries[0] === baseline) return frame;
  return { entries: [baseline, ...frame.entries], index: frame.index + 1 };
}

/** One more entry in the session (the normal append: Redo dropped, limit applied), with the baseline pinned. */
export function appendInSession(
  frame: HistoryFrame,
  baseline: EditorHistoryEntry,
  entry: EditorHistoryEntry,
  limit: EditorHistoryExportLimit,
  now: number,
  replaceCurrent = false,
): HistoryFrame & { changed: boolean } {
  const result = appendEditorHistorySnapshot(frame.entries, frame.index, entry, limit, now, replaceCurrent);
  const pinned = pinBaseline({ entries: result.entries, index: result.index }, baseline);
  return { entries: pinned.entries, index: pinned.index, changed: result.changed };
}

/** The session history bounded by a (new) limit, baseline pinned. */
export function boundSession(frame: HistoryFrame, baseline: EditorHistoryEntry, limit: EditorHistoryExportLimit): HistoryFrame {
  const bounded = boundedEditorHistoryState(frame.entries, frame.index, limit);
  return pinBaseline(bounded, baseline);
}

/**
 * The document history after the session: the stash when nothing changed (the SAME entries array: untouched, Redo tail included), else the stash with ONE entry for
 * the finished state appended in the normal way. `finalEntry` is the session's current entry. Never modifies the stash.
 */
export function endSession(session: Pick<GroupEditSession, "stash">, finalEntry: EditorHistoryEntry, limit: EditorHistoryExportLimit, now: number): HistoryFrame & { changed: boolean } {
  const merged = appendEditorHistorySnapshot(session.stash.entries as EditorHistoryEntry[], session.stash.index, finalEntry, limit, now);
  return { entries: merged.entries, index: merged.index, changed: merged.changed };
}
