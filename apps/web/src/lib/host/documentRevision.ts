import type { WorkplaneShape } from "@/types/layerling";

/**
 * Change tracking for a native document (protocol 3). The document is "dirty" when its PERSISTENT content differs from what was last saved
 * (or opened): not when the history index differs, not after camera moves or selections. The comparison is cheap: it uses the fingerprint every
 * history entry already carries (computed once when the entry is created) plus a few small strings; nothing is serialised here.
 */

/**
 * Workspace settings that are the person's own look-and-feel or browser-style preferences. The file still stores them (the whole object is
 * written, nothing is dropped), but changing one does not make the design "modified". Any key NOT listed counts as document state, so a setting
 * added in the future dirties the document rather than risking a lost change.
 */
export const PREFERENCE_WORKSPACE_KEYS: ReadonlySet<string> = new Set([
  // appearance of the work area and the 3D view
  "gridColor", "gridMajorInterval", "gridMajorColor", "background", "surfaceColor", "showAxes", "showPlateLabels", "gridLinesGrow", "edgeLines", "edgeColor",
  "strongHoles", "holeOpacity", "showShadows", "cameraInertia", "fastMode", "shadeContrast", "softLighting", "shadowStrength", "shadowSoftness",
  "lightAzimuth", "lightElevation", "sketchBackground", "sketchGridColor", "sketchPlateColor", "showGrid",
  // behavior and interface preferences
  "clickToPlaceShapes", "selectBeforeMove", "frameByDirection", "pasteCentered", "doubleClickOpensSketch", "doubleClickOpensGroup", "doubleClickCentersView",
  "objectSnap", "confirmTabClose", "dimensionsAlwaysVisible", "dimensionAxisColors", "showRotationAngles", "showSlideArrows", "startWithScrollbars",
  "viewBarOpensOnHover", "showStepNotices", "zoomSpeed", "panSpeed", "mouseScheme",
  // browser download behavior (meaningless in the native app)
  "stlAsDownload", "lylAsDownload",
]);

export function documentSettingsSignature(workspace: Record<string, unknown>): string {
  const keys = Object.keys(workspace).filter((key) => !PREFERENCE_WORKSPACE_KEYS.has(key)).sort();
  return JSON.stringify(keys.map((key) => [key, workspace[key]]));
}

export interface SignatureParts {
  /** Fingerprint of the current history entry: scene, notes and workplane. */
  entryFingerprint: string;
  attachments: string;
  /** The Visual Groups as a save would write them (empty text: none). Optional so callers that know nothing of them still compile. */
  visualGroups?: string;
  workspace: Record<string, unknown>;
  snapGrid: unknown;
  placementElevation: number;
  placementWorkplane: string;
  savedViews: string;
  cornerRulers: string;
  tape: string;
}

/** Everything that a saved file would hold (apart from the camera, selection and the project name, which the file name decides). */
export function documentSignature(parts: SignatureParts): string {
  return [
    parts.entryFingerprint,
    parts.attachments,
    parts.visualGroups ?? "",
    documentSettingsSignature(parts.workspace),
    JSON.stringify(parts.snapGrid),
    String(parts.placementElevation),
    parts.placementWorkplane,
    parts.savedViews,
    parts.cornerRulers,
    parts.tape,
  ].join("\u0001");
}

export interface RevisionState {
  revision: number;
  dirty: boolean;
  signature: string;
}

export class DocumentRevisionTracker {
  private currentSignature = "";
  private savedSignature: string | null = null;
  private currentRevision = 0;

  constructor(private readonly onChange: (state: RevisionState) => void = () => undefined) {}

  get revision() {
    return this.currentRevision;
  }
  get signature() {
    return this.currentSignature;
  }
  get dirty() {
    return this.savedSignature !== null && this.currentSignature !== this.savedSignature;
  }
  state(): RevisionState {
    return { revision: this.currentRevision, dirty: this.dirty, signature: this.currentSignature };
  }

  /** The document as it was opened (or created) is the saved state. Called once, when the editor is on screen. */
  baseline(signature: string) {
    this.currentSignature = signature;
    this.savedSignature = signature;
    this.onChange(this.state());
  }

  /** A change of persistent content raises the revision; the same content again does nothing. Before `baseline` only the signature is kept. */
  update(signature: string): boolean {
    if (signature === this.currentSignature) return false;
    this.currentSignature = signature;
    if (this.savedSignature === null) return true;
    this.currentRevision += 1;
    this.onChange(this.state());
    return true;
  }

  /** A save was committed: `signature` is what the file now holds. Later changes (the current signature differs) stay dirty. */
  markSaved(signature: string) {
    this.savedSignature = signature;
    this.onChange(this.state());
  }
}

/** What a save reports about the scene it packaged: objects at the top level, all nodes (group children included), distinct mesh objects. */
export function summarizeShapes(shapes: readonly WorkplaneShape[]) {
  const meshes = new Set<object>();
  const count = (list: readonly WorkplaneShape[]): number =>
    list.reduce((total, shape) => {
      if (shape.importedMesh) meshes.add(shape.importedMesh as object);
      return total + 1 + count(shape.groupedShapes ?? []);
    }, 0);
  const nodes = count(shapes);
  return { rootObjects: shapes.length, nodes, meshObjects: meshes.size };
}
