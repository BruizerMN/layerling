import type { WorkplaneWorkspaceSettings } from "@/types/layerling";

/**
 * Who owns each key of the workspace object (Build 0003, native app only).
 *
 * The `.lyl` format is unchanged: every key is still written into every file, so the browser edition reads it as before. In the native app:
 *  - "doc" keys are the document's: loaded from the file, saved to it, part of its dirty state.
 *  - "app" keys are the application's: the app's own preference store is authoritative. A file's embedded values are never applied on
 *    open, and a save writes the CURRENT application values into the file for browser compatibility only (never as a document change).
 * The browser edition never calls any of this.
 */
export type SettingScope = "app" | "doc";

type Key = keyof WorkplaneWorkspaceSettings;

/** The model's own properties: its units, plate, grid spacing, analysis and retention settings, and per-shape defaults. */
export const DOCUMENT_SETTING_KEYS = [
  "width",
  "depth",
  "sizePreset",
  "printer",
  "plates",
  "gridBlockSize",
  "gridBlockPreset",
  "gridBlockOtherUnits",
  "gridMajorInterval",
  "units",
  "inchFormat",
  "scale",
  "accuracy",
  "historyLimit",
  "booleanTriangleLimit",
  "overhangAngle",
  "customSnapGrids",
  "shapeCustomizations",
] as const satisfies readonly Key[];

/** Meaningless in the native app (no browser downloads or tab); never shown there, still carried in files. */
export const BROWSER_ONLY_SETTING_KEYS = ["stlAsDownload", "lylAsDownload", "confirmTabClose"] as const satisfies readonly Key[];

const DOC_KEY_SET: ReadonlySet<string> = new Set(DOCUMENT_SETTING_KEYS);

export function settingScope(key: string): SettingScope {
  return DOC_KEY_SET.has(key) ? "doc" : "app";
}

export function isDocumentSettingKey(key: string): boolean {
  return DOC_KEY_SET.has(key);
}

/** Splits a workspace object by owner. Undefined values are left out (a design without plates has no `plates`). */
export function splitWorkspace<T extends object>(workspace: T): { doc: Partial<T>; app: Partial<T> } {
  const doc: Record<string, unknown> = {};
  const app: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(workspace)) {
    if (value === undefined) continue;
    (DOC_KEY_SET.has(key) ? doc : app)[key] = value;
  }
  return { doc: doc as Partial<T>, app: app as Partial<T> };
}

/** The document's own settings, as the dirty signature sees them: application preferences never make a document modified. */
export function documentSettingsView<T extends object>(workspace: T): Partial<T> {
  return splitWorkspace(workspace).doc;
}

/**
 * The effective workspace of a native document: the document's keys from the file (or a new document's defaults), everything else from the
 * application's preferences. This is the ONE place a loaded file's application keys are dropped, so they cannot reach the editor, even briefly.
 */
export function effectiveWorkspace(documentWorkspace: WorkplaneWorkspaceSettings, appPrefs: Partial<WorkplaneWorkspaceSettings>): WorkplaneWorkspaceSettings {
  const { doc } = splitWorkspace(documentWorkspace);
  const { app } = splitWorkspace(appPrefs);
  return { ...(doc as object), ...(app as object) } as WorkplaneWorkspaceSettings;
}

/** Only the keys of the given scope that actually differ between two workspaces. */
export function changedKeys<T extends object>(before: T, after: T, scope: SettingScope): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changed: string[] = [];
  for (const key of keys) {
    if (settingScope(key) !== scope) continue;
    if (JSON.stringify((before as Record<string, unknown>)[key]) !== JSON.stringify((after as Record<string, unknown>)[key])) changed.push(key);
  }
  return changed;
}
