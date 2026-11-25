import { readAppPrefs } from "@/lib/appPrefs";
import { PRINTER_PRESETS } from "@/lib/printerPresets.generated";
import { chooseFitTestPinBase, fitTestPinBaseChosen } from "@/lib/breakawayBase";
import { fitTestLabel } from "@/lib/fitTest";
import { numberLocale, t } from "@/lib/i18n";
import { measurementOptionLabel, normalizeScaleForUnits, parseMeasurementInput, scaleOptionsForUnits, WORKSPACE_UNIT_OPTIONS } from "@/lib/measurementUnits";
import { MAX_OVERHANG_ANGLE, MIN_OVERHANG_ANGLE } from "@/lib/overhangLimits";
import { printerPresetById } from "@/lib/printBed";
import { FIT_TEST_CLEARANCES, getPrinterPlayFor, normalizePrinterPlay, printerPlayShapeStart, printerPlaySource, setPrinterPlayFor } from "@/lib/printerPlay";
import { effectiveWorkspace, splitWorkspace } from "@/lib/settingsScope";
import { shapeAssetDefaultDimensions, shapeAssetLabel, toolbarShapeAssets } from "@/lib/shapeCatalog";
import { DEFAULT_GRIDFINITY_TRAY_SIZE, normalizeGridfinityType } from "@/lib/gridfinityGeometry";
import {
  BOOLEAN_TRIANGLE_LIMIT_PRESETS, DEFAULT_SNAP_GRID, DEFAULT_WORKPLANE_WORKSPACE, MAX_BOOLEAN_TRIANGLE_LIMIT, MAX_CUSTOM_SHAPE_DIMENSION,
  MAX_CUSTOM_SNAP_GRID, MAX_CUSTOM_SNAP_GRID_NAME, MAX_CUSTOM_SNAP_GRIDS, MIN_BOOLEAN_TRIANGLE_LIMIT, MIN_CUSTOM_SHAPE_DIMENSION, MIN_CUSTOM_SNAP_GRID,
  booleanTriangleLimitPreset, customSnapGridDivisors, customSnapGridLabel, customSnapGridSize, normalizeWorkspaceSettings, parseCustomSnapGrid, readWorkspaceDefault,
  resetGridInSavedDefault, saveWorkspaceDefault, snapGridForUnits, snapGridOptions, standardGridSettings, workspaceForUnits, workspaceWithSavedDefault, type BooleanTriangleLimitPreset,
} from "@/lib/workplaneSettings";
import { IMPERIAL_GRID_BLOCK_PRESETS } from "@/lib/workplaneGrid";
import {
  BOOLEAN_LIMIT_PRESET_LABEL_KEYS, GRID_BLOCK_PRESETS, HISTORY_CUSTOM_DEFAULT, MAX_GRID_BLOCK_SIZE, MAX_WORKSPACE_SIZE, MIN_GRID_BLOCK_SIZE, MIN_WORKSPACE_SIZE, PRINTER_VENDORS,
  PRINTERS_BY_VENDOR, WORKSPACE_SIZE_PRESETS, clamp, gridBlockPresetLabel, gridBlockSizeForPreset, isHistoryLimitPreset, specialFieldsForShape, type ShapeSpecialField,
} from "@/components/workplane/WorkspaceSettingsModal";
import type { CustomSnapGrid, GridSize, ShapeCustomization, ShapeKind, WorkplaneWorkspaceSettings } from "@/types/layerling";

void PRINTER_PRESETS;

/**
 * Build 0083: the native Document Settings window, in the page. The native window draws every control itself; THIS module is the document-settings engine's side of it: it describes
 * what each category shows (rows, with the same options, labels, limits and conditional controls as the web Settings window) and turns each user intent into the same change the web
 * window would make (units rules, printer and plate, snap grids, shape defaults, history, Make default). It is built from the editor's own helpers and keeps no settings store of its
 * own: it returns the document's next workspace keys (and snap step) for the host to hand to the document page (settings.apply), and the few things the web window keeps outside the
 * document (printer play, the fit test's base, the saved default) are written through the same functions the web window calls.
 *
 * describe and act are pure apart from those writes, and read nothing but what the host passes in (ctx) plus the application settings.
 */
export type DocSettingsContext = { workspace: Record<string, unknown>; snap: string; hasStartView: boolean; shape?: string };
export type SettingsRow = Record<string, unknown> & { k: string };
export type SettingsAction = { id: string; value?: unknown; index?: number; op?: string; key?: string };
export type SettingsResult = { workspace?: Record<string, unknown>; snap?: string; command?: string };

export const DOC_SETTINGS_CATEGORIES = ["model", "measurement", "workplane", "printer", "shapes", "history"] as const;

/** Transient choices the web window keeps in component state: "Custom" open in the triangle-limit list, and the "Default saved" label. */
const ui: { booleanCustomOpen: boolean | null; defaultSaved: boolean } = { booleanCustomOpen: null, defaultSaved: false };

/** Reads the application settings without ever writing (readAppPrefs seeds a missing store): writes through this view are dropped. */
function readOnlyStorage(): Storage {
  return {
    get length() { return window.localStorage.length; },
    key: (index: number) => window.localStorage.key(index),
    getItem: (key: string) => window.localStorage.getItem(key),
    setItem: () => {},
    removeItem: () => {},
    clear: () => {},
  } as Storage;
}

function effective(ctx: DocSettingsContext): WorkplaneWorkspaceSettings {
  return effectiveWorkspace(normalizeWorkspaceSettings(ctx.workspace), readAppPrefs(readOnlyStorage()));
}
function snapOf(ctx: DocSettingsContext): GridSize {
  return (ctx.snap || DEFAULT_SNAP_GRID) as GridSize;
}
const fixed = (value: number, ws: WorkplaneWorkspaceSettings) => value.toFixed(ws.accuracy);
const count = (value: number) => value.toLocaleString(numberLocale());

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------- describe

export function describeDocumentSettings(category: string, ctx: DocSettingsContext): SettingsRow[] {
  const ws = effective(ctx);
  switch (category) {
    case "model": return modelRows(ws, ctx);
    case "measurement": return measurementRows(ws, ctx);
    case "workplane": return workplaneRows(ws);
    case "printer": return printerRows(ws);
    case "shapes": return shapeRows(ws, ctx.shape);
    case "history": return historyRows(ws);
    default: return [];
  }
}

function modelRows(ws: WorkplaneWorkspaceSettings, ctx: DocSettingsContext): SettingsRow[] {
  const mode = booleanLimitMode(ws);
  const rows: SettingsRow[] = [
    { k: "buttons", label: "Start view:", items: [{ id: "startView.save", title: "Use Current View", enabled: true }, { id: "startView.reset", title: "Standard View", enabled: ctx.hasStartView }], help: t("workspace.startViewHint") },
    { k: "slider", id: "overhang", label: "Overhang angle:", min: MIN_OVERHANG_ANGLE, max: MAX_OVERHANG_ANGLE, step: 5, value: ws.overhangAngle, format: "{v}°", help: `${t("workspace.overhangStrict")} … ${t("workspace.overhangLoose")}` },
    { k: "popup", id: "booleanLimit", label: "Imported mesh limit:", value: mode,
      options: [...BOOLEAN_TRIANGLE_LIMIT_PRESETS.map((preset) => ({ value: preset.id, title: t(BOOLEAN_LIMIT_PRESET_LABEL_KEYS[preset.id as BooleanTriangleLimitPreset], { count: count(preset.limit) }) })), { value: "custom", title: t("workspace.custom") }] },
  ];
  if (mode === "custom") rows.push({ k: "field", id: "booleanLimitCustom", label: "Custom limit:", value: String(ws.booleanTriangleLimit), suffix: "triangles", help: `${count(MIN_BOOLEAN_TRIANGLE_LIMIT)} to ${count(MAX_BOOLEAN_TRIANGLE_LIMIT)}`, numeric: true });
  rows.push({ k: "note", text: t("workspace.booleanTriangleLimitNote") });
  const saved = readWorkspaceDefault();
  rows.push({ k: "buttons", label: "Defaults for new designs:", items: [
    { id: "makeDefault", title: ui.defaultSaved ? t("workspace.defaultSaved") : "Make Default", enabled: true },
    { id: "useMyDefault", title: "Use My Default", enabled: !!saved },
  ], help: "Make Default keeps this document's settings (colours, grid, shape starts, printer and more) as the starting point for new documents. Use My Default puts that saved set on this document. Neither changes the application's own factory defaults." });
  return rows;
}

function booleanLimitMode(ws: WorkplaneWorkspaceSettings): string {
  const preset = booleanTriangleLimitPreset(ws.booleanTriangleLimit);
  if (ui.booleanCustomOpen === null) ui.booleanCustomOpen = preset === null;
  return ui.booleanCustomOpen ? "custom" : (preset ?? "custom");
}

function measurementRows(ws: WorkplaneWorkspaceSettings, ctx: DocSettingsContext): SettingsRow[] {
  const snap = snapOf(ctx);
  const rows: SettingsRow[] = [
    { k: "popup", id: "units", label: t("workspace.units") + ":", value: ws.units, options: WORKSPACE_UNIT_OPTIONS.map((option) => ({ value: option, title: measurementOptionLabel(option) })) },
  ];
  if (ws.units === "Imperial") rows.push({ k: "popup", id: "inchFormat", label: t("workspace.inchFormat") + ":", value: ws.inchFormat, options: [{ value: "fraction", title: t("workspace.inchFormatFraction") }, { value: "decimal", title: t("workspace.inchFormatDecimal") }] });
  rows.push({ k: "popup", id: "scale", label: t("workspace.scale") + ":", value: normalizeScaleForUnits(ws.units, ws.scale), options: scaleOptionsForUnits(ws.units).map((option) => ({ value: option, title: measurementOptionLabel(option) })) });
  rows.push({ k: "popup", id: "accuracy", label: t("workspace.accuracy") + ":", value: `0.${"0".repeat(ws.accuracy)}`, options: ["0.0", "0.00", "0.000"].map((option) => ({ value: option, title: option })) });
  rows.push({ k: "popup", id: "snap", label: t("workspace.snapGrid") + ":", value: snap,
    options: snapGridOptions(ws.units, ws.customSnapGrids).map((option) => ({ value: option, title: customSnapGridLabel(option, ws.customSnapGrids) ?? measurementOptionLabel(option) })) });
  rows.push({ k: "grids", id: "grids", label: t("workspace.customSnapGrids") + ":", help: t("workspace.customSnapGridsHint"), canAdd: ws.customSnapGrids.length < MAX_CUSTOM_SNAP_GRIDS, nameLimit: MAX_CUSTOM_SNAP_GRID_NAME,
    items: ws.customSnapGrids.map((grid) => ({ name: grid.name, size: String(grid.size), wholeOnly: !!grid.wholeOnly, steps: customSnapGridDivisors(grid).map((divisor) => Number((grid.size / divisor).toFixed(4))).join(" · ") })) });
  return rows;
}

function workplaneRows(ws: WorkplaneWorkspaceSettings): SettingsRow[] {
  const rows: SettingsRow[] = [
    { k: "popup", id: "sizePreset", label: t("workspace.size") + ":", value: ws.sizePreset, options: WORKSPACE_SIZE_PRESETS.map((preset) => ({ value: preset.label, title: gridBlockPresetLabel(preset.label) })) },
    { k: "field", id: "width", label: t("workspace.width") + ":", value: fixed(ws.width, ws), suffix: "mm", numeric: true },
    { k: "field", id: "depth", label: t("workspace.length") + ":", value: fixed(ws.depth, ws), suffix: "mm", numeric: true, help: `${MIN_WORKSPACE_SIZE} to ${MAX_WORKSPACE_SIZE} mm. A size typed by hand is no longer the chosen printer's plate.` },
    { k: "popup", id: "gridBlock", label: t("workspace.gridBlockSize") + ":", value: ws.gridBlockPreset,
      options: (ws.units === "Imperial" ? [...IMPERIAL_GRID_BLOCK_PRESETS, "Custom"] : [...GRID_BLOCK_PRESETS]).map((option) => ({ value: option, title: gridBlockPresetLabel(option) })) },
  ];
  if (ws.gridBlockPreset === "Custom") rows.push({ k: "field", id: "gridBlockSize", label: t("workspace.blockSize") + ":", value: fixed(ws.gridBlockSize, ws), suffix: "mm", numeric: true });
  if (ws.units !== "Imperial") rows.push({ k: "popup", id: "gridMajor", label: t("workspace.gridMajorEvery") + ":", value: String(ws.gridMajorInterval === 10 ? 10 : 5), options: ["5", "10"].map((option) => ({ value: option, title: t("workspace.gridMajorSteps", { count: Number(option) }) })) });
  rows.push({ k: "buttons", label: "Grid:", items: [{ id: "resetGrid", title: t("workspace.resetGrid"), enabled: true }], help: t("workspace.resetGridHint") });
  return rows;
}

function printerRows(ws: WorkplaneWorkspaceSettings): SettingsRow[] {
  const chosen = printerPresetById(ws.printer);
  const play = getPrinterPlayFor(ws.printer ?? "");
  const source = printerPlaySource(ws.printer ?? "");
  const name = chosen ? `${chosen.vendor} ${chosen.model}` : "";
  const info = chosen
    ? chosen.round ? t("workspace.printerInfoRound", { diameter: chosen.width, height: chosen.height }) : t("workspace.printerInfo", { width: chosen.width, depth: chosen.depth, height: chosen.height })
    : t("workspace.printerHint");
  const whose = !ws.printer ? t("workspace.printerPlayNoPrinter") : source === "printer" ? t("workspace.printerPlayOwn", { printer: name }) : t("workspace.printerPlayGeneral", { printer: name });
  return [
    { k: "popup", id: "printer", label: t("workspace.printer") + ":", value: chosen?.id ?? "", help: info,
      options: [{ value: "", title: t("workspace.printerNone") }, ...PRINTER_VENDORS.flatMap((vendor) => (PRINTERS_BY_VENDOR.get(vendor) ?? []).map((preset) => ({ value: preset.id, title: `${preset.vendor} ${preset.model}`, group: vendor })))] },
    { k: "field", id: "play", label: t("workspace.printerPlay") + ":", value: play === null ? "" : play.toLocaleString(numberLocale(), { maximumFractionDigits: 3 }), placeholder: t("workspace.printerPlayNone"), suffix: t("workspace.printerPlayUnit"), numeric: true,
      help: `${whose} ${t(play === null ? "workspace.printerPlayHint" : "workspace.printerPlaySetHint")}` },
    { k: "values", id: "playValue", label: t("workspace.printerPlayTested") + ":", active: play, items: FIT_TEST_CLEARANCES.map((clearance) => ({ value: clearance, title: fitTestLabel(clearance) })) },
    { k: "check", id: "pinBase", label: "Fit test:", title: t("workspace.fitTestBase"), value: fitTestPinBaseChosen(), help: t("workspace.fitTestBaseHint") },
    { k: "buttons", items: [{ id: "makeFitTest", title: t("workspace.fitTestMake"), enabled: true }] },
  ];
}

function shapeKindOf(requested: string | undefined): ShapeKind {
  return (toolbarShapeAssets.find((asset) => asset.kind === requested) ?? toolbarShapeAssets[0]).kind as ShapeKind;
}

function shapeRows(ws: WorkplaneWorkspaceSettings, requested: string | undefined): SettingsRow[] {
  const kind = shapeKindOf(requested);
  const asset = toolbarShapeAssets.find((entry) => entry.kind === kind) ?? toolbarShapeAssets[0];
  const custom = (ws.shapeCustomizations[kind] ?? {}) as ShapeCustomization & Record<string, unknown>;
  const appDefaults = kind === "gridfinity" && normalizeGridfinityType(custom.gridfinityType) === "tray" ? DEFAULT_GRIDFINITY_TRAY_SIZE : shapeAssetDefaultDimensions(kind);
  const dims = { width: custom.width ?? appDefaults.width, depth: custom.depth ?? appDefaults.depth, height: custom.height ?? appDefaults.height };
  const play = getPrinterPlayFor(ws.printer ?? "");
  const specials = specialFieldsForShape(kind, dims, custom, play);
  const playStart = printerPlayShapeStart(kind, play) as Record<string, number | undefined>;
  const dimKeys: Array<"width" | "depth" | "height"> = kind === "bentTube" || kind === "pulley" ? [] : kind === "loft" || kind === "thread" ? ["height"] : kind === "cylinder" ? ["width", "height"] : ["width", "depth", "height"];
  const customized = Object.keys(custom).length > 0;
  const rows: SettingsRow[] = [
    { k: "popup", id: "shape", label: t("workspace.shape") + ":", value: kind, local: true, icon: asset.menuIcon,
      options: toolbarShapeAssets.map((entry) => ({ value: entry.kind, title: `${shapeAssetLabel(entry)}${ws.shapeCustomizations[entry.kind as ShapeKind] ? t("workspace.customizedSuffix") : ""}`, icon: entry.menuIcon })) },
    { k: "buttons", label: `${shapeAssetLabel(asset)}:`, items: [{ id: "shapeReset", title: "Use Standard Defaults", enabled: customized }], help: customized ? t("workspace.customActive") : "Using standard defaults" },
  ];
  const fields: SettingsRow[] = [];
  for (const key of dimKeys) {
    fields.push({ k: "field", id: "shapeDim", key, label: t(key === "depth" ? "prop.length" : key === "width" ? (kind === "cylinder" ? "prop.diameter" : "prop.width") : "prop.height") + ":",
      value: fixed(Number((custom as Record<string, unknown>)[key] ?? appDefaults[key]), ws), suffix: "mm", numeric: true, help: `Default: ${appDefaults[key]} mm` });
  }
  for (const field of specials as ShapeSpecialField[]) {
    const own = (custom as Record<string, unknown>)[field.key];
    const value = own ?? field.defaultValue;
    if (field.type === "select") fields.push({ k: "popup", id: "shapeSelect", key: field.key, label: `${field.label}:`, value: String(value), options: field.options.map((option) => ({ value: option.value, title: option.label })), help: `Default: ${field.options.find((option) => option.value === field.defaultValue)?.label ?? field.defaultValue}` });
    else if (field.type === "text") fields.push({ k: "field", id: "shapeText", key: field.key, label: `${field.label}:`, value: String(value), maxLength: field.maxLength, help: `Default: ${field.defaultValue}` });
    else fields.push({ k: "field", id: "shapeNumber", key: field.key, label: `${field.label}:`, numeric: true, value: field.step === 1 ? String(Math.round(Number(value))) : Number(value).toFixed(ws.accuracy), suffix: field.unit ?? "",
      help: `${playStart[field.key] !== undefined ? "Fit test" : "Default"}: ${field.step === 1 ? Math.round(field.defaultValue) : Number(field.defaultValue.toFixed(ws.accuracy))}${field.unit ? ` ${field.unit}` : ""}` });
  }
  if (fields.length) rows.push({ k: "group", rows: fields });
  rows.push({ k: "field", id: "shapeLimit", label: t("workspace.customLimit") + ":", value: custom.maxDimension === undefined ? "" : fixed(Number(custom.maxDimension), ws), placeholder: "Default limits", suffix: "mm", numeric: true, help: t("workspace.customLimitHint") });
  rows.push({ k: "note", text: t("workspace.shapeNote", { max: MAX_CUSTOM_SHAPE_DIMENSION }) });
  return rows;
}

function historyRows(ws: WorkplaneWorkspaceSettings): SettingsRow[] {
  const limit = ws.historyLimit;
  const mode = limit === "unlimited" ? "unlimited" : isHistoryLimitPreset(limit) ? String(limit) : "custom";
  return [
    { k: "history", id: "historyLimit", label: "Keep:", value: mode, custom: typeof limit === "number" ? limit : HISTORY_CUSTOM_DEFAULT, current: limit,
      options: [{ value: "30", title: "30" }, { value: "50", title: "50" }, { value: "100", title: "100" }, { value: "unlimited", title: t("workspace.unlimited") }, { value: "custom", title: t("workspace.custom") }],
      help: t("workspace.savedHistoryHint"), warning: t("workspace.historyNote", { count: DEFAULT_WORKPLANE_WORKSPACE.historyLimit }), min: 1, max: 5000 },
  ];
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------- act

export function actOnDocumentSettings(ctx: DocSettingsContext, action: SettingsAction): SettingsResult {
  const ws = effective(ctx);
  const snap = snapOf(ctx);
  let nextSnap: string | undefined;
  const result = (patch: Partial<WorkplaneWorkspaceSettings>): SettingsResult => {
    ui.defaultSaved = false;
    const next = { ...ws, ...patch };
    const normalized = normalizeWorkspaceSettings({ ...next, scale: normalizeScaleForUnits(next.units, next.scale) });
    return { workspace: splitWorkspace(normalized).doc as Record<string, unknown>, ...(nextSnap === undefined ? {} : { snap: nextSnap }) };
  };
  const number = (raw: unknown) => parseMeasurementInput(String(raw ?? ""));
  const shapeKind = shapeKindOf(ctx.shape);
  const shapePatch = (kind: ShapeKind, patch: Record<string, unknown>) => {
    const entry = Object.fromEntries(Object.entries({ ...ws.shapeCustomizations[kind], ...patch }).filter(([, value]) => value !== undefined)) as ShapeCustomization;
    const all = { ...ws.shapeCustomizations };
    if (Object.keys(entry).length > 0) all[kind] = entry; else delete all[kind];
    return result({ shapeCustomizations: all });
  };
  switch (action.id) {
    case "startView.save": return { command: "settings.saveStartView" };
    case "startView.reset": return { command: "settings.resetStartView" };
    case "makeFitTest": return { command: "settings.makeFitTest" };
    case "overhang": return result({ overhangAngle: Number(action.value) });
    case "booleanLimit": {
      if (action.value === "custom") { ui.booleanCustomOpen = true; return {}; }
      ui.booleanCustomOpen = false;
      const preset = BOOLEAN_TRIANGLE_LIMIT_PRESETS.find((entry) => entry.id === action.value);
      return preset ? result({ booleanTriangleLimit: preset.limit }) : {};
    }
    case "booleanLimitCustom": {
      const parsed = Number.parseInt(String(action.value), 10);
      const next = Number.isFinite(parsed) ? Math.round(clamp(parsed, MIN_BOOLEAN_TRIANGLE_LIMIT, MAX_BOOLEAN_TRIANGLE_LIMIT)) : ws.booleanTriangleLimit;
      return result({ booleanTriangleLimit: next });
    }
    case "units": {
      const units = String(action.value);
      const wanted = snapGridForUnits(units as never, snap);
      if (wanted !== snap) nextSnap = wanted;
      return result(workspaceForUnits(ws, units as never));
    }
    case "inchFormat": return result({ inchFormat: action.value === "decimal" ? "decimal" : "fraction" });
    case "scale": return result({ scale: String(action.value) as never });
    case "accuracy": return result({ accuracy: String(action.value).slice(2).length as WorkplaneWorkspaceSettings["accuracy"] });
    case "snap": ui.defaultSaved = false; return { snap: String(action.value) };
    case "grids": return gridsAction(ws, snap, action, (patch, followed) => { nextSnap = followed; return result(patch); });
    case "sizePreset": {
      const preset = WORKSPACE_SIZE_PRESETS.find((entry) => entry.label === action.value);
      if (!preset || action.value === "Custom") return result({ sizePreset: "Custom" });
      return result({ sizePreset: String(action.value), width: preset.width, depth: preset.depth, printer: "" });
    }
    case "width": case "depth": {
      const key = action.id;
      const parsed = number(action.value);
      const next = clamp(Number.isFinite(parsed) ? parsed : ws[key], MIN_WORKSPACE_SIZE, MAX_WORKSPACE_SIZE);
      return result({ [key]: next, sizePreset: "Custom", printer: "" } as Partial<WorkplaneWorkspaceSettings>);
    }
    case "gridBlock": return result({ gridBlockPreset: String(action.value), gridBlockSize: gridBlockSizeForPreset(String(action.value), ws.gridBlockSize) });
    case "gridBlockSize": {
      const parsed = number(action.value);
      return result({ gridBlockPreset: "Custom", gridBlockSize: clamp(Number.isFinite(parsed) ? parsed : ws.gridBlockSize, MIN_GRID_BLOCK_SIZE, MAX_GRID_BLOCK_SIZE) });
    }
    case "gridMajor": return result({ gridMajorInterval: action.value === "10" ? 10 : 5 });
    case "resetGrid": { const standard = standardGridSettings(ws.units); resetGridInSavedDefault(); return result(standard as Partial<WorkplaneWorkspaceSettings>); }
    case "printer": {
      const printer = printerPresetById(String(action.value ?? ""));
      return printer ? result({ printer: printer.id, width: printer.width, depth: printer.depth, sizePreset: "Custom" }) : result({ printer: "" });
    }
    case "play": {
      const text = String(action.value ?? "");
      if (!text.trim()) setPrinterPlayFor(ws.printer ?? "", null);
      else { const typed = normalizePrinterPlay(text); if (typed !== null) setPrinterPlayFor(ws.printer ?? "", typed); }
      return {};
    }
    case "playValue": setPrinterPlayFor(ws.printer ?? "", Number(action.value)); return {};
    case "pinBase": chooseFitTestPinBase(!!action.value); return {};
    case "shapeReset": { const all = { ...ws.shapeCustomizations }; delete all[shapeKind]; return result({ shapeCustomizations: all }); }
    case "shapeDim": {
      const parsed = number(action.value);
      if (!Number.isFinite(parsed)) return {};
      const value = clamp(parsed, MIN_CUSTOM_SHAPE_DIMENSION, MAX_CUSTOM_SHAPE_DIMENSION);
      const key = String(action.key);
      return shapePatch(shapeKind, key === "width" && shapeKind === "cone" ? { width: value, baseRadius: value / 2 } : key === "width" && shapeKind === "cylinder" ? { width: value, depth: value } : { [key]: value });
    }
    case "shapeNumber": {
      const key = String(action.key);
      if (!String(action.value ?? "").trim()) return shapePatch(shapeKind, { [key]: undefined });
      const dims = { width: Number(ws.shapeCustomizations[shapeKind]?.width ?? shapeAssetDefaultDimensions(shapeKind).width), depth: Number(ws.shapeCustomizations[shapeKind]?.depth ?? shapeAssetDefaultDimensions(shapeKind).depth), height: Number(ws.shapeCustomizations[shapeKind]?.height ?? shapeAssetDefaultDimensions(shapeKind).height) };
      const field = (specialFieldsForShape(shapeKind, dims, (ws.shapeCustomizations[shapeKind] ?? {}) as ShapeCustomization, getPrinterPlayFor(ws.printer ?? "")) as ShapeSpecialField[]).find((entry) => entry.key === key);
      const parsed = number(action.value);
      if (!field || field.type !== "number" || !Number.isFinite(parsed)) return {};
      const clamped = clamp(parsed, field.min, field.max);
      const value = field.step === 1 ? Math.round(clamped) : clamped;
      return shapePatch(shapeKind, key === "baseRadius" && shapeKind === "cone" ? { baseRadius: value, width: value * 2 } : { [key]: value });
    }
    case "shapeSelect": return shapePatch(shapeKind, { [String(action.key)]: String(action.value) });
    case "shapeText": return shapePatch(shapeKind, { [String(action.key)]: String(action.value ?? "").slice(0, 200) || undefined });
    case "shapeLimit": {
      if (!String(action.value ?? "").trim()) return shapePatch(shapeKind, { maxDimension: undefined });
      const parsed = number(action.value);
      return Number.isFinite(parsed) ? shapePatch(shapeKind, { maxDimension: clamp(parsed, MIN_CUSTOM_SHAPE_DIMENSION, MAX_CUSTOM_SHAPE_DIMENSION) }) : {};
    }
    case "historyLimit": {
      const raw = action.value;
      if (raw === "unlimited") return result({ historyLimit: "unlimited" });
      const parsed = Number.parseInt(String(raw), 10);
      return result({ historyLimit: Number.isFinite(parsed) ? Math.round(clamp(parsed, 1, 5000)) : HISTORY_CUSTOM_DEFAULT });
    }
    case "makeDefault": saveWorkspaceDefault(ws, snap); ui.defaultSaved = true; return {};
    case "useMyDefault": {
      const saved = readWorkspaceDefault();
      return saved ? result(workspaceWithSavedDefault(ws, saved.workspace)) : {};
    }
    default: return {};
  }
}

/** The custom snap grids list: the same edits and the same "the step in use follows its measure" rules as the web list. */
function gridsAction(ws: WorkplaneWorkspaceSettings, snap: GridSize, action: SettingsAction, finish: (patch: Partial<WorkplaneWorkspaceSettings>, followedSnap: string | undefined) => SettingsResult): SettingsResult {
  const grids = ws.customSnapGrids;
  const index = action.index ?? -1;
  let next: CustomSnapGrid[] = grids;
  let resized: { from: number; to: number } | undefined;
  switch (action.op) {
    case "add": next = [...grids, { name: "", size: 10 }]; break;
    case "remove": next = grids.filter((_entry, at) => at !== index); break;
    case "name": next = grids.map((entry, at) => (at === index ? { ...entry, name: String(action.value ?? "").slice(0, MAX_CUSTOM_SNAP_GRID_NAME) } : entry)); break;
    case "parts": next = grids.map((entry, at) => {
      if (at !== index) return entry;
      const { wholeOnly: _whole, ...rest } = entry;
      return action.value ? rest : { ...rest, wholeOnly: true };
    }); break;
    case "size": {
      const parsed = Number(String(action.value ?? "").replace(",", "."));
      if (!Number.isFinite(parsed) || parsed <= 0 || !grids[index]) return {};
      const size = Number(clamp(parsed, MIN_CUSTOM_SNAP_GRID, MAX_CUSTOM_SNAP_GRID).toFixed(4));
      const from = grids[index].size;
      if (size === from) return {};
      next = grids.map((entry, at) => (at === index ? { ...entry, size } : entry));
      resized = { from, to: size };
      break;
    }
    default: return {};
  }
  let followed: string | undefined;
  const current = parseCustomSnapGrid(snap);
  if (current) {
    const owner = next.find((grid) => grid.size === (resized && resized.from === current.size ? resized.to : current.size));
    if (owner && !customSnapGridDivisors(owner).includes(current.divisor)) followed = customSnapGridSize(owner.size, 1);
    else if (resized && resized.from === current.size) followed = customSnapGridSize(resized.to, current.divisor);
    else if (!next.some((grid) => grid.size === current.size)) followed = ws.units === "Imperial" ? "1/8 in" : DEFAULT_SNAP_GRID;
  }
  return finish({ customSnapGrids: next }, followed);
}

declare global {
  interface Window {
    layerlingDocumentSettings?: { describe: typeof describeDocumentSettings; act: typeof actOnDocumentSettings };
  }
}

/** Makes the engine reachable for the host (window.layerlingDocumentSettings); a no-op outside a browser. */
export function installDocumentSettingsEngine() {
  if (typeof window === "undefined") return;
  window.layerlingDocumentSettings = { describe: describeDocumentSettings, act: actOnDocumentSettings };
}
