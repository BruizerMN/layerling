/**
 * What Done says when a group cannot be rebuilt (Build 0122, native app). The session stays intact and Cancel stays available: the person is told which
 * object is the problem where that can be found. English only (like the 0121 guard messages): the native app presents these as error sheets.
 */
export type GroupFinishProblem =
  | { kind: "openMesh"; group: string; objects: string[]; /** Build 0126: a named object is a T-junction defect that Model > Repair Open Meshes can close (only then is the command recommended). */ repairable?: boolean }
  | { kind: "unionFailed"; group: string }
  // Build 0127: an edited group that carries a rotation, mirror or resize (its POSE) and cannot be rebuilt keeping it. Plain language: no transformation mathematics.
  | { kind: "skewed"; group: string; part: string }
  | { kind: "twistLean"; group: string; part: string; what: "twisted" | "leaning" | "twisted and leaning" }
  | { kind: "unsupportedKind"; group: string; part: string; kindName: string }
  | { kind: "rotationStorage"; group: string; part: string; mm: number }
  | { kind: "unsupportedGroup"; group: string; type: string }
  | { kind: "unsupportedFeature"; group: string; part: string; feature: string }
  | { kind: "cutFailed"; group: string }
  | { kind: "degraded"; group: string; reason: string };

const quoted = (names: readonly string[]) => names.map((name) => `“${name}”`).join(", ");
const part = (problem: { part: string }) => `“${problem.part}”`;
/** Said by every Build 0127 refusal: the session is not lost. */
const STAYS_OPEN = "Your changes are still in place and Group Editing remains open.";
const formatMillimetres = (mm: number) => (mm < 1 ? mm.toPrecision(2) : mm.toFixed(2));

export function groupFinishProblemMessage(problem: GroupFinishProblem): string {
  const group = `“${problem.group}”`;
  switch (problem.kind) {
    case "openMesh": {
      // Build 0127 (approved wording): Repair Open Meshes is disabled while a group is open for editing, so the person must cancel first, and cancelling discards this session's changes.
      if (problem.repairable) {
        return problem.objects.length === 1
          ? `Cannot finish ${group}: ${quoted(problem.objects)} is not a closed solid (its mesh has open edges), so the group cannot be rebuilt. To close the gap, cancel group editing (the changes made in this session are discarded), choose Model > Repair Open Meshes, then edit the group again. Or remove the part.`
          : `Cannot finish ${group}: ${quoted(problem.objects)} are not closed solids (their meshes have open edges), so the group cannot be rebuilt. To close the gaps, cancel group editing (the changes made in this session are discarded), choose Model > Repair Open Meshes, then edit the group again. Or remove the parts.`;
      }
      const remedy = "Fix or remove";
      return problem.objects.length === 1
        ? `Cannot finish ${group}: ${quoted(problem.objects)} is not a closed solid (its mesh has open edges), so the group cannot be rebuilt. ${remedy} it, or Cancel to keep the group as it was.`
        : `Cannot finish ${group}: ${quoted(problem.objects)} are not closed solids (their meshes have open edges), so the group cannot be rebuilt. ${remedy} them, or Cancel to keep the group as it was.`;
    }
    case "skewed":
      return `Cannot finish ${group}: ${part(problem)} is turned at an angle inside a group that has been resized unevenly. Its shape would change when the group is rebuilt.\nTry aligning the part with the group's sides, or cancel Group Editing to restore the original group.\n${STAYS_OPEN}`;
    case "twistLean": {
      const remedy = problem.what === "twisted" ? "the twist" : problem.what === "leaning" ? "the lean" : "the twist and lean";
      return `Cannot finish ${group}: ${part(problem)} is ${problem.what} and the group has been resized unevenly, which would change its shape. Remove ${remedy} from ${part(problem)}, or Cancel to keep the group as it was.\n${STAYS_OPEN}`;
    }
    case "unsupportedKind":
      return `Cannot finish ${group}: Group Editing cannot yet keep a ${problem.kindName} (${part(problem)}) exact in a group that has been resized. Cancel to keep the group as it was.\n${STAYS_OPEN}`;
    case "rotationStorage":
      return `Cannot finish ${group}: the current rotation of ${part(problem)} cannot be preserved accurately when the group is rebuilt. Its geometry would shift by up to ${formatMillimetres(problem.mm)} mm.\nAdjust the part's rotation, align it with the group, or cancel Group Editing to restore the original group.\n${STAYS_OPEN}`;
    case "unsupportedGroup":
      return `Cannot finish ${group}: Group Editing does not yet support preserving this type of group (${problem.type}) when it has been rotated, mirrored or resized.\nCancel Group Editing to restore the original group.\n${STAYS_OPEN}`;
    case "unsupportedFeature":
      return `Cannot finish ${group}: ${part(problem)} uses ${problem.feature}, which Group Editing cannot yet keep exact while the group is rotated, mirrored or resized. Change ${part(problem)} back, or Cancel to keep the group as it was.\n${STAYS_OPEN}`;
    case "unionFailed":
      return `Cannot finish ${group}: its holes could not be combined into one clean body. Cancel to keep the group as it was, or change the parts and try again.`;
    case "cutFailed":
      return `Cannot finish ${group}: the cut of its holes could not be computed cleanly. Cancel to keep the group as it was, or change the parts and try again.`;
    case "degraded":
      return `Cannot finish ${group}: ${problem.reason}. Cancel to keep the group as it was.`;
  }
}
