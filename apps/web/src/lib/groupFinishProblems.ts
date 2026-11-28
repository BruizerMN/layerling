/**
 * What Done says when a group cannot be rebuilt (Build 0122, native app). The session stays intact and Cancel stays available: the person is told which
 * object is the problem where that can be found. English only (like the 0121 guard messages): the native app presents these as error sheets.
 */
export type GroupFinishProblem =
  | { kind: "openMesh"; group: string; objects: string[]; /** Build 0126: a named object is a T-junction defect that Model > Repair Open Meshes can close (only then is the command recommended). */ repairable?: boolean }
  | { kind: "unionFailed"; group: string }
  | { kind: "cutFailed"; group: string }
  | { kind: "degraded"; group: string; reason: string };

const quoted = (names: readonly string[]) => names.map((name) => `“${name}”`).join(", ");

export function groupFinishProblemMessage(problem: GroupFinishProblem): string {
  const group = `“${problem.group}”`;
  switch (problem.kind) {
    case "openMesh": {
      const remedy = problem.repairable
        ? "Run Model > Repair Open Meshes (it closes gaps like this without changing any shape), remove"
        : "Fix or remove";
      return problem.objects.length === 1
        ? `Cannot finish ${group}: ${quoted(problem.objects)} is not a closed solid (its mesh has open edges), so the group cannot be rebuilt. ${remedy} it, or Cancel to keep the group as it was.`
        : `Cannot finish ${group}: ${quoted(problem.objects)} are not closed solids (their meshes have open edges), so the group cannot be rebuilt. ${remedy} them, or Cancel to keep the group as it was.`;
    }
    case "unionFailed":
      return `Cannot finish ${group}: its holes could not be combined into one clean body. Cancel to keep the group as it was, or change the parts and try again.`;
    case "cutFailed":
      return `Cannot finish ${group}: the cut of its holes could not be computed cleanly. Cancel to keep the group as it was, or change the parts and try again.`;
    case "degraded":
      return `Cannot finish ${group}: ${problem.reason}. Cancel to keep the group as it was.`;
  }
}
