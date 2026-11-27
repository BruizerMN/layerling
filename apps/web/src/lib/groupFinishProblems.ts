/**
 * What Done says when a group cannot be rebuilt (Build 0122, native app). The session stays intact and Cancel stays available: the person is told which
 * object is the problem where that can be found. English only (like the 0121 guard messages): the native app presents these as error sheets.
 */
export type GroupFinishProblem =
  | { kind: "openMesh"; group: string; objects: string[] }
  | { kind: "cutFailed"; group: string }
  | { kind: "degraded"; group: string; reason: string };

const quoted = (names: readonly string[]) => names.map((name) => `“${name}”`).join(", ");

export function groupFinishProblemMessage(problem: GroupFinishProblem): string {
  const group = `“${problem.group}”`;
  switch (problem.kind) {
    case "openMesh":
      return problem.objects.length === 1
        ? `Cannot finish ${group}: ${quoted(problem.objects)} is not a closed solid (its mesh has open edges), so the group cannot be rebuilt. Fix or remove it, or Cancel to keep the group as it was.`
        : `Cannot finish ${group}: ${quoted(problem.objects)} are not closed solids (their meshes have open edges), so the group cannot be rebuilt. Fix or remove them, or Cancel to keep the group as it was.`;
    case "cutFailed":
      return `Cannot finish ${group}: the cut of its holes could not be computed cleanly. Cancel to keep the group as it was, or change the parts and try again.`;
    case "degraded":
      return `Cannot finish ${group}: ${problem.reason}. Cancel to keep the group as it was.`;
  }
}
