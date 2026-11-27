/**
 * What a document says when something would write it out (a save, an export, a snapshot) while a group is open for editing (Build 0121).
 *
 * An open group is an editing transaction: the editor holds its parts as loose objects, so anything serialized now would lose the group
 * (Findings, defect D1). Saves, exports and the like are therefore refused until the person finishes (Done) or cancels the group.
 * Kept out of the message catalogues on purpose (20 languages): the native app shows its own alert; the browser notice is English for now.
 */
export type GroupEditingAction = "save" | "export" | "close" | "quit" | "revert";

export const GROUP_EDITING_TITLE = "Group Editing in Progress";

const VERB: Record<GroupEditingAction, string> = {
  save: "saving this document",
  export: "exporting this document",
  close: "closing this document",
  quit: "quitting",
  revert: "reverting this document",
};

export function groupEditingMessage(action: GroupEditingAction): string {
  return `Please complete or cancel your group edits before ${VERB[action]}.`;
}
