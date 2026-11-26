import { parseDocumentDescriptor, type FileDocumentDescriptor } from "@/lib/host/hostDocument";

/**
 * The host protocol: the narrow, versioned contract between the Layerling editor and a native host (the macOS app).
 * Specification: README.md in this folder. Shared fixtures (fixtures/v1) are tested by both sides.
 *
 * Nothing here runs unless a native host is present (see hostBridge.ts): in a browser this file is only types and pure functions.
 */

/** The protocol versions this editor speaks. Raise MAX only together with the host and the README; MIN when a version is dropped. */
export const HOST_PROTOCOL_MIN = 1;
export const HOST_PROTOCOL_MAX = 3;

/** Protocol 2 adds native documents (docs: README.md, "Protocol v2"). Offered by the editor in `hello`, granted by the host in `hello.ok`. */
export const DOCUMENT_CAPABILITY = "document.open";
/** Protocol 3 adds saving (`document.save`): change tracking, the save exchange and its upload. */
export const SAVE_CAPABILITY = "document.save";
export const SAVE_PROTOCOL_MIN = 3;
/**
 * Additive capability (Build 0003, no protocol version change): the native shell's menus and Settings windows talk to the document page.
 * Offered by the editor in `hello`, granted by the host in `hello.ok`; needs protocol 3 and the document capability. A host or editor without
 * it simply never sends these messages.
 */
export const UI_CAPABILITY = "ui.v1";
/**
 * Build 0007 (additive, needs `ui.v1`): the host presents the page's contextual menus as real macOS menus. The page builds the items from its own state and
 * runs the chosen item's own function; the host only draws, tracks and reports (`menu.result`, `menu.highlight`).
 */
export const UI_MENU_CAPABILITY = "ui.menu.v1";
/**
 * Native toolbar prototype (additive, needs `ui.v1`): the host draws some ribbon groups as a native toolbar. The page publishes each group's tools with the state its own
 * rules give them (`ribbon.state`); the host asks the page to run one (`ribbon.invoke`) and tells it when its toolbar is on or off (`ribbon.native`).
 */
export const RIBBON_CAPABILITY = "ribbon.v1";
/**
 * Visual Groups palette (additive, needs `ui.v1`): the host draws a floating palette of the design's Visual Groups. The page publishes what it shows
 * (`visualGroups.state`, while the host says the palette is open: `visualGroups.watch`), asks the host for its chooser (`visualGroups.choose`) and carries
 * out what the palette asks for (`visualGroups.invoke`). The editor stays the only source of truth.
 */
export const VISUAL_GROUPS_CAPABILITY = "visualGroups.v1";
export const VISUAL_GROUPS_OPS = ["create", "rename", "delete", "toggleGroup", "toggleObject", "removeObject", "select", "assign", "pickResult", "move", "focusGroup", "renameObject", "lockGroup", "toggleObjectLock"] as const;
/**
 * Insert Layerling files (additive, needs `ui.v1`; Build 0070): the host owns the menu command and the file panel; the editor owns the import. The host sends
 * the chosen files as resource descriptors (`designInsert.insert`: the same kind of one-file, token-guarded url a document is opened from) and the editor puts
 * their bodies into the open design as ONE undoable step (the engine behind "Insert into this design"), then answers `designInsert.result` with what went in
 * and what did not, file by file. The files are only read.
 */
export const DESIGN_INSERT_CAPABILITY = "designInsert.v1";
/** The most files one insert may carry (the host panel is not limited; a bigger selection is refused with a message, never cut). */
export const DESIGN_INSERT_MAX_FILES = 500;
/** One entry of a native menu. `items` makes it a submenu. */
export interface NativeMenuItem {
  key: string;
  title: string;
  /** As the page writes shortcuts, "Ctrl+Shift+G" or a single letter; the host shows it as a macOS key equivalent (Ctrl = Command). */
  shortcut?: string;
  danger?: boolean;
  separatorBefore?: boolean;
  /** A colour dot before the title (#rrggbb). */
  color?: string;
  enabled?: boolean;
  checked?: boolean;
  items?: NativeMenuItem[];
}
/** Commands a host menu can send to a document page (`ui.command`). */
import { VIEW_COMMANDS } from "@/lib/viewCommands";

export const UI_COMMANDS = ["mode.geometry", "mode.sketch", "focusMode.toggle", "ribbonPin.toggle", "search", "guide", "whatsNew", "shortcuts", "interactiveHelp", "inspector.toggle", "edit.undo", "edit.redo", "edit.history", "edit.cut", "edit.copy", "edit.paste", "edit.duplicate", "edit.delete", "edit.deselectAll", "view.objectList", "view.hideSelected", "view.unhideAll", "view.hideOthers", "view.visualGroupsOnly", "view.notes", "view.overhangs", "file.import", "file.export", "file.attachments", "presentation.enter", "presentation.exit", "presentation.standby", "settings.saveStartView", "settings.resetStartView", "settings.makeFitTest", ...VIEW_COMMANDS] as const;
export type UiCommand = (typeof UI_COMMANDS)[number];
/** The first protocol version that carries the document messages. */
export const DOCUMENT_PROTOCOL_MIN = 2;

/** The page must be served from the host's custom URL scheme; http(s) and file pages never talk to a host. */
export const HOST_SCHEME = "layerling:";
/** `window.webkit.messageHandlers.<name>`: the editor-to-host channel, a WKScriptMessageHandlerWithReply on the host. */
export const HOST_HANDLER_NAME = "layerlingHost";
/** `window.<key>`: the capability the host injects at document start (host identity, protocol range, session). Not a URL parameter. */
export const HOST_BOOTSTRAP_KEY = "__layerlingHostBootstrap";
/** `window.<key>.receive(event)`: the host-to-editor channel, installed by the editor only after a successful handshake. */
export const HOST_RECEIVER_KEY = "layerlingHostBridge";
export const EDITOR_NAME = "layerling";

export interface ProtocolRange {
  min: number;
  max: number;
}

/** Errors a host answers with. Unknown codes from a newer host are read as "internal". */
export const HOST_ERROR_CODES = [
  "unsupported-protocol",
  "protocol-mismatch",
  "bad-session",
  "bad-request",
  "not-ready",
  "internal",
  // protocol 2
  "unsupported-capability",
  "no-such-document",
  "document-changed",
  // protocol 3
  "save-rejected",
] as const;
export type HostErrorCode = (typeof HOST_ERROR_CODES)[number];

export interface HostError {
  code: HostErrorCode;
  message: string;
  /** Present on "unsupported-protocol": the versions the host speaks. */
  supported?: ProtocolRange;
}

export interface HostBootstrap {
  host: { name: string; version: string };
  protocol: ProtocolRange;
  session: string;
}

export interface Described {
  name: string;
  version: string;
}

// --- editor -> host requests ---------------------------------------------------------------------------------------------------------

export interface HelloRequest {
  id: string;
  session: string;
  type: "hello";
  /** `capabilities` (protocol 2): what the editor can do for the host beyond the basics, for example "document.open". Omitted by a v1-only editor. */
  payload: { editor: Described & { build: string }; protocol: ProtocolRange; capabilities?: string[] };
}
export interface ReadyRequest {
  id: string;
  session: string;
  type: "ready";
  protocol: number;
  payload: Record<string, never>;
}
export interface PingRequest {
  id: string;
  session: string;
  type: "ping";
  protocol: number;
  payload: { sentAt: number };
}
export interface PongRequest {
  id: string;
  session: string;
  type: "pong";
  protocol: number;
  payload: { inReplyTo: string };
}

// --- protocol 2: documents -------------------------------------------------------------------------------------------------------------

/** What the editor reports while it opens a document. */
export type DocumentPhase = "transfer" | "unpack" | "build";
/** Why an open failed, as the editor reports it. */
export const DOCUMENT_FAILURE_CODES = ["transfer-failed", "invalid-package", "unsupported-version", "out-of-memory", "cancelled", "internal"] as const;
export type DocumentFailureCode = (typeof DOCUMENT_FAILURE_CODES)[number];

export interface DocumentRequest {
  id: string;
  session: string;
  type: "document.request";
  protocol: number;
  payload: Record<string, never>;
}
export interface DocumentProgressRequest {
  id: string;
  session: string;
  type: "document.progress";
  protocol: number;
  payload: { documentId: string; phase: DocumentPhase; loaded?: number; total?: number };
}
export interface DocumentOpenedRequest {
  id: string;
  session: string;
  type: "document.opened";
  protocol: number;
  payload: {
    documentId: string;
    /** The project id the document carries (a file's metadata.projectId, or one made for a new document): document metadata, distinct from the transient runtime id. */
    projectId: string | null;
    projectName: string;
    stats: { rootObjects: number; historyStates: number };
    timings: { transferMs: number; importMs: number; hydrateMs: number };
    /** Mesh relief (cadMeshRelief.ts): how many bodies it re-meshed while opening. Reported, never silent. */
    meshRelief: { bodies: number };
    /** Always false: nothing was written to the browser library. */
    repack: false;
  };
}
export interface DocumentFailedRequest {
  id: string;
  session: string;
  type: "document.failed";
  protocol: number;
  payload: { documentId: string; code: DocumentFailureCode; message: string };
}

// --- protocol 3: saving ------------------------------------------------------------------------------------------------------------------

export type SavePhase = "wait" | "snapshot" | "serialize" | "compress" | "upload";
export const SAVE_FAILURE_CODES = ["serialize-failed", "too-large", "out-of-memory", "cancelled", "interaction-timeout", "upload-failed", "internal"] as const;
export type SaveFailureCode = (typeof SAVE_FAILURE_CODES)[number];

/** Build 0003 (`ui.v1`): what the native menus need to know about the document page. Sent on change only. */
export interface UiStateRequest {
  id: string;
  session: string;
  type: "ui.state";
  protocol: number;
  payload: { documentId: string; state: { mode: "geometry" | "sketch"; sketchEnabled: boolean; focusMode: boolean; ribbonPinned: boolean; inspectorVisible?: boolean } & Record<string, unknown> };
}
/** Prototype (`ribbon.v1`): the ribbon groups the host draws natively, with each tool's state. Sent on change only. */
export interface RibbonStateRequest {
  id: string;
  session: string;
  type: "ribbon.state";
  protocol: number;
  payload: { documentId: string; state: { mode: "geometry" | "sketch"; groups: Array<{ id: string; label: string; kind: "menu" | "button" | "buttons"; tools: Array<{ id: string; label: string; enabled: boolean; active: boolean; hint: string | null; shortcut: string | null; icon: string; toggle?: boolean; prominent?: boolean; separatorBefore?: boolean }> }> } };
}
/** `visualGroups.v1`: what the palette shows (groups with their aggregate eye, members with name and own hidden flag, the selected members). Sent on change only. */
export interface VisualGroupsStateRequest {
  id: string;
  session: string;
  type: "visualGroups.state";
  protocol: number;
  payload: { documentId: string; state: { readOnly: boolean; groups: unknown[]; selected: string[] } };
}
/** `visualGroups.v1`: show the host's chooser for the group these objects should go into. The answer is an `assign` command; Cancel sends nothing. */
export interface VisualGroupsChooseRequest {
  id: string;
  session: string;
  type: "visualGroups.choose";
  protocol: number;
  payload: { documentId: string; mode: "add" | "move"; objectIds: string[]; groups: unknown[]; newGroupOnly?: boolean };
}
/** `visualGroups.v1`: objects from different Visual Groups are being merged: the host asks which group the new object goes into. The answer is the command `pickResult` with this `requestId`. */
export interface VisualGroupsPickRequest {
  id: string;
  session: string;
  type: "visualGroups.pick";
  protocol: number;
  payload: { documentId: string; requestId: string; operation: string; objectCount: number; candidates: Array<{ id: string; name: string; count: number }> };
}
/** `designInsert.v1`: how an insert ended. Every file the host sent appears exactly once, in `imported` or in `failures` (`objectCount` counts top-level objects). */
export interface DesignInsertResultRequest {
  id: string;
  session: string;
  type: "designInsert.result";
  protocol: number;
  payload: { documentId: string; requestId: string; imported: Array<{ fileName: string; objectCount: number }>; failures: Array<{ fileName: string; reason: string }> };
}
/** Build 0007 (`ui.menu.v1`): show a native menu at a point of the page. Answered at once; the choice comes back as the event `menu.result`. */
export interface MenuShowRequest {
  id: string;
  session: string;
  type: "menu.show";
  protocol: number;
  payload: { documentId: string; menuId: string; x: number; y: number; label?: string; items: NativeMenuItem[] };
}
/** Build 0003 (`ui.v1`): the page asks the host to open one of its windows (the Settings window or this document's Document Settings window). */
export interface UiActionRequest {
  id: string;
  session: string;
  type: "ui.action";
  protocol: number;
  payload: { documentId: string; action: "openSettings" | "openDocumentSettings" | "enterPresentation" | "showMeasureTape" | "showMeasureCornerRuler" | "showMeasureProtractor" };
}
/** Build 0003 (`ui.v1`): the document's own settings, for its Document Settings window. Sent only while that window is watching. */
export interface SettingsStateRequest {
  id: string;
  session: string;
  type: "settings.state";
  protocol: number;
  payload: { documentId: string; workspace: Record<string, unknown>; snap: string; hasStartView: boolean };
}
export interface DocumentChangedRequest {
  id: string;
  session: string;
  type: "document.changed";
  protocol: number;
  /** `revision` grows with every persistent change; `dirty` says whether the document now differs from what was last saved (or opened). */
  payload: { documentId: string; revision: number; dirty: boolean };
}
export interface SaveProgressRequest {
  id: string;
  session: string;
  type: "document.save.progress";
  protocol: number;
  payload: { documentId: string; saveId: string; phase: SavePhase; loaded?: number; total?: number };
}
export interface SaveCommitRequest {
  id: string;
  session: string;
  type: "document.save.commit";
  protocol: number;
  payload: {
    documentId: string;
    saveId: string;
    /** The revision and signature of the snapshot that was packaged: what the host may call saved. */
    revision: number;
    signature: string;
    byteLength: number;
    sha256: string;
    stats: { rootObjects: number; nodes: number; meshObjects: number };
    timings: { waitMs: number; snapshotMs: number; serializeMs: number; uploadMs: number };
    thumbnail: boolean;
  };
}
export interface SaveFailedRequest {
  id: string;
  session: string;
  type: "document.save.failed";
  protocol: number;
  payload: { documentId: string; saveId: string; code: SaveFailureCode; message: string };
}
export type HostRequest =
  | RibbonStateRequest
  | VisualGroupsStateRequest
  | VisualGroupsChooseRequest
  | VisualGroupsPickRequest
  | DesignInsertResultRequest
  | HelloRequest
  | ReadyRequest
  | PingRequest
  | PongRequest
  | DocumentRequest
  | DocumentProgressRequest
  | DocumentOpenedRequest
  | DocumentFailedRequest
  | DocumentChangedRequest
  | UiStateRequest
  | UiActionRequest
  | MenuShowRequest
  | SettingsStateRequest
  | SaveProgressRequest
  | SaveCommitRequest
  | SaveFailedRequest;

// --- host -> editor ---------------------------------------------------------------------------------------------------------------------

/** Answers to requests, as the host returns them from the message handler's reply. */
export interface HelloOk {
  protocol: number;
  host: Described;
  capabilities: string[];
}
export type OkTypeFor = {
  hello: "hello.ok";
  ready: "ready.ok";
  ping: "ping.ok";
  pong: "pong.ok";
  "document.request": "document.request.ok";
  "document.progress": "document.progress.ok";
  "document.opened": "document.opened.ok";
  "document.failed": "document.failed.ok";
  "document.changed": "document.changed.ok";
  "ui.state": "ui.state.ok";
  "ui.action": "ui.action.ok";
  "menu.show": "menu.show.ok";
  "settings.state": "settings.state.ok";
  "document.save.progress": "document.save.progress.ok";
  "document.save.commit": "document.save.commit.ok";
  "document.save.failed": "document.save.failed.ok";
};

export type ParsedResponse =
  | { kind: "ok"; type: string; payload: Record<string, unknown> }
  | { kind: "error"; error: HostError }
  | { kind: "invalid"; reason: string };

/** Pushed by the host through `window.layerlingHostBridge.receive(event)`. The editor answers a ping with a "pong" request. */
export type HostEvent =
  | { session: string; protocol: number; id: string; type: "ping"; payload: Record<string, never> }
  /** Protocol 2: the host is closing or reloading the document; the editor abandons an open in progress. */
  | { session: string; protocol: number; id: string; type: "document.cancel"; payload: { documentId: string } }
  /** Protocol 3: package the document now. `fileName` (no extension) is the native name the design takes. `uploadToken` names this save's upload endpoint. */
  | { session: string; protocol: number; id: string; type: "document.save"; payload: { documentId: string; saveId: string; uploadToken: string; fileName: string | null; reason: string } }
  | { session: string; protocol: number; id: string; type: "document.save.cancel"; payload: { documentId: string; saveId: string } }
  /** The save was committed to the file: `signature` is now the saved one. */
  | { session: string; protocol: number; id: string; type: "document.saved"; payload: { documentId: string; saveId: string; revision: number; signature: string; fileName: string | null } }
  /** The native file name changed (first save, Save As, Finder rename); it is authoritative. */
  | { session: string; protocol: number; id: string; type: "document.renamed"; payload: { documentId: string; fileName: string } }
  /** Build 0003 (`ui.v1`): a menu command for this document page. */
  | { session: string; protocol: number; id: string; type: "ui.command"; payload: { documentId: string; command: UiCommand } }
  /** Build 0003 (`ui.v1`): the Document Settings window changed these document settings; the page applies them like its own settings window did. */
  | { session: string; protocol: number; id: string; type: "settings.apply"; payload: { documentId: string; workspace: Record<string, unknown>; snap: string | null } }
  /** Build 0007 (`ui.menu.v1`): how a native menu ended. `key` null: dismissed without a choice. */
  | { session: string; protocol: number; id: string; type: "menu.result"; payload: { documentId: string; menuId: string; key: string | null; shift: boolean } }
  /** Build 0007 (`ui.menu.v1`): the item under the pointer or the keyboard while the menu is open (null: none). */
  | { session: string; protocol: number; id: string; type: "menu.highlight"; payload: { documentId: string; menuId: string; key: string | null } }
  /** Prototype (`ribbon.v1`): run this tool, as its ribbon button would. The page checks its own rules first. */
  | { session: string; protocol: number; id: string; type: "ribbon.invoke"; payload: { documentId: string; toolId: string } }
  /** Prototype (`ribbon.v1`): the host's native toolbar is on or off for this document. */
  | { session: string; protocol: number; id: string; type: "ribbon.native"; payload: { documentId: string; enabled: boolean } }
  /** `visualGroups.v1`: the palette asks for this; the page checks it and uses its own functions. */
  | { session: string; protocol: number; id: string; type: "visualGroups.invoke"; payload: { documentId: string; op: string; args: Record<string, unknown> } }
  /** `visualGroups.v1`: the palette is open (the page publishes `visualGroups.state`) or closed. */
  | { session: string; protocol: number; id: string; type: "visualGroups.watch"; payload: { documentId: string; watching: boolean } }
  /** `designInsert.v1`: put the bodies of these files into the open design (one undo step) and answer with `designInsert.result` for `requestId`. */
  | { session: string; protocol: number; id: string; type: "designInsert.insert"; payload: { documentId: string; requestId: string; files: FileDocumentDescriptor[] } }
  /** Build 0003 (`ui.v1`): the Document Settings window opened or closed; the page sends `settings.state` while it is open. */
  | { session: string; protocol: number; id: string; type: "settings.watch"; payload: { documentId: string; watching: boolean } }
  /** The file was changed by another application (not reloaded automatically). */
  | { session: string; protocol: number; id: string; type: "document.externalChange"; payload: { documentId: string } };

// --- pure helpers -----------------------------------------------------------------------------------------------------------------------

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isText = (value: unknown): value is string => typeof value === "string" && value.length > 0;
const isVersionNumber = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 1;

export function parseProtocolRange(value: unknown): ProtocolRange | null {
  if (!isRecord(value) || !isVersionNumber(value.min) || !isVersionNumber(value.max) || value.min > value.max) return null;
  return { min: value.min, max: value.max };
}

function parseDescribed(value: unknown): Described | null {
  return isRecord(value) && isText(value.name) && isText(value.version) ? { name: value.name, version: value.version } : null;
}

/** What the host injected, or null when it is missing or malformed. */
export function parseHostBootstrap(value: unknown): HostBootstrap | null {
  if (!isRecord(value)) return null;
  const host = parseDescribed(value.host);
  const protocol = parseProtocolRange(value.protocol);
  if (!host || !protocol || !isText(value.session) || value.session.length < 8) return null;
  return { host, protocol, session: value.session };
}

/** The highest version both sides speak, or null. */
export function negotiateProtocol(a: ProtocolRange, b: ProtocolRange): number | null {
  const highest = Math.min(a.max, b.max);
  return highest >= Math.max(a.min, b.min) ? highest : null;
}

function parseError(value: unknown): HostError | null {
  if (!isRecord(value) || !isText(value.message) || typeof value.code !== "string") return null;
  const known = (HOST_ERROR_CODES as readonly string[]).includes(value.code);
  const supported = value.supported === undefined ? undefined : (parseProtocolRange(value.supported) ?? undefined);
  const message = known ? value.message : `${value.message} (host code "${value.code}")`;
  return { code: known ? (value.code as HostErrorCode) : "internal", message, ...(supported ? { supported } : {}) };
}

/** Reads a host reply to the request `id`; `expectedType` is the success type for that request (for example "hello.ok"). */
export function parseHostResponse(value: unknown, id: string, expectedType: string): ParsedResponse {
  if (!isRecord(value)) return { kind: "invalid", reason: "reply is not an object" };
  if (value.id !== id) return { kind: "invalid", reason: `reply is for request "${String(value.id)}", not "${id}"` };
  if (value.ok === false) {
    const error = parseError(value.error);
    return error ? { kind: "error", error } : { kind: "invalid", reason: "error reply without a valid error" };
  }
  if (value.ok !== true) return { kind: "invalid", reason: "reply has no boolean ok" };
  if (value.type !== expectedType) return { kind: "invalid", reason: `reply type "${String(value.type)}", expected "${expectedType}"` };
  if (!isRecord(value.payload)) return { kind: "invalid", reason: "reply has no payload object" };
  return { kind: "ok", type: expectedType, payload: value.payload };
}

export function parseHelloOk(payload: Record<string, unknown>): HelloOk | null {
  const host = parseDescribed(payload.host);
  if (!host || !isVersionNumber(payload.protocol) || !Array.isArray(payload.capabilities) || !payload.capabilities.every((c) => typeof c === "string")) return null;
  return { protocol: payload.protocol, host, capabilities: payload.capabilities as string[] };
}

export function parseHostEvent(value: unknown): HostEvent | { invalid: string } {
  if (!isRecord(value)) return { invalid: "event is not an object" };
  if (!isText(value.session) || !isVersionNumber(value.protocol) || !isText(value.id)) return { invalid: "event needs session, protocol and id" };
  if (!isRecord(value.payload)) return { invalid: "event has no payload object" };
  if (value.type === "ping") return { session: value.session, protocol: value.protocol, id: value.id, type: "ping", payload: {} };
  if (value.type === "document.cancel") {
    if (!isText(value.payload.documentId)) return { invalid: "document.cancel needs a documentId" };
    return { session: value.session, protocol: value.protocol, id: value.id, type: "document.cancel", payload: { documentId: value.payload.documentId } };
  }
  const documentId = value.payload.documentId;
  const saveId = value.payload.saveId;
  const base = { session: value.session, protocol: value.protocol, id: value.id };
  if (value.type === "document.save") {
    if (!isText(documentId) || !isText(saveId) || !isText(value.payload.uploadToken)) return { invalid: "document.save needs documentId, saveId and uploadToken" };
    return { ...base, type: "document.save", payload: { documentId, saveId, uploadToken: value.payload.uploadToken, fileName: typeof value.payload.fileName === "string" ? value.payload.fileName : null, reason: typeof value.payload.reason === "string" ? value.payload.reason : "save" } };
  }
  if (value.type === "ui.command") {
    return isText(documentId) && typeof value.payload.command === "string" && (UI_COMMANDS as readonly string[]).includes(value.payload.command)
      ? { ...base, type: "ui.command", payload: { documentId, command: value.payload.command as UiCommand } }
      : { invalid: "ui.command needs documentId and a known command" };
  }
  if (value.type === "settings.apply") {
    return isText(documentId) && isRecord(value.payload.workspace)
      ? { ...base, type: "settings.apply", payload: { documentId, workspace: value.payload.workspace, snap: typeof value.payload.snap === "string" ? value.payload.snap : null } }
      : { invalid: "settings.apply needs documentId and a workspace object" };
  }
  if (value.type === "menu.result") {
    return isText(documentId) && isText(value.payload.menuId) && (value.payload.key === null || isText(value.payload.key)) && typeof value.payload.shift === "boolean"
      ? { ...base, type: "menu.result", payload: { documentId, menuId: value.payload.menuId, key: value.payload.key as string | null, shift: value.payload.shift } }
      : { invalid: "menu.result needs documentId, menuId, key (or null) and shift" };
  }
  if (value.type === "menu.highlight") {
    return isText(documentId) && isText(value.payload.menuId) && (value.payload.key === null || isText(value.payload.key))
      ? { ...base, type: "menu.highlight", payload: { documentId, menuId: value.payload.menuId, key: value.payload.key as string | null } }
      : { invalid: "menu.highlight needs documentId, menuId and key (or null)" };
  }
  if (value.type === "ribbon.invoke") {
    return isText(documentId) && isText(value.payload.toolId) ? { ...base, type: "ribbon.invoke", payload: { documentId, toolId: value.payload.toolId } } : { invalid: "ribbon.invoke needs documentId and toolId" };
  }
  if (value.type === "ribbon.native") {
    return isText(documentId) && typeof value.payload.enabled === "boolean" ? { ...base, type: "ribbon.native", payload: { documentId, enabled: value.payload.enabled } } : { invalid: "ribbon.native needs documentId and enabled" };
  }
  if (value.type === "visualGroups.invoke") {
    return isText(documentId) && typeof value.payload.op === "string" && (VISUAL_GROUPS_OPS as readonly string[]).includes(value.payload.op) && isRecord(value.payload.args)
      ? { ...base, type: "visualGroups.invoke", payload: { documentId, op: value.payload.op, args: value.payload.args } }
      : { invalid: "visualGroups.invoke needs documentId, a known op and args" };
  }
  if (value.type === "visualGroups.watch") {
    return isText(documentId) && typeof value.payload.watching === "boolean" ? { ...base, type: "visualGroups.watch", payload: { documentId, watching: value.payload.watching } } : { invalid: "visualGroups.watch needs documentId and watching" };
  }
  if (value.type === "designInsert.insert") {
    if (!isText(documentId) || !isText(value.payload.requestId) || !Array.isArray(value.payload.files) || value.payload.files.length === 0 || value.payload.files.length > DESIGN_INSERT_MAX_FILES) {
      return { invalid: `designInsert.insert needs documentId, requestId and 1-${DESIGN_INSERT_MAX_FILES} files` };
    }
    const files: FileDocumentDescriptor[] = [];
    for (const entry of value.payload.files) {
      const descriptor = parseDocumentDescriptor(entry);
      if ("invalid" in descriptor || descriptor.kind !== "file") return { invalid: `designInsert.insert file: ${"invalid" in descriptor ? descriptor.invalid : "not a file descriptor"}` };
      files.push(descriptor);
    }
    return { ...base, type: "designInsert.insert", payload: { documentId, requestId: value.payload.requestId, files } };
  }
  if (value.type === "settings.watch") {
    return isText(documentId) && typeof value.payload.watching === "boolean" ? { ...base, type: "settings.watch", payload: { documentId, watching: value.payload.watching } } : { invalid: "settings.watch needs documentId and watching" };
  }
  if (value.type === "document.save.cancel") {
    return isText(documentId) && isText(saveId) ? { ...base, type: "document.save.cancel", payload: { documentId, saveId } } : { invalid: "document.save.cancel needs documentId and saveId" };
  }
  if (value.type === "document.saved") {
    if (!isText(documentId) || !isText(saveId) || typeof value.payload.revision !== "number" || typeof value.payload.signature !== "string") return { invalid: "document.saved needs documentId, saveId, revision and signature" };
    return { ...base, type: "document.saved", payload: { documentId, saveId, revision: value.payload.revision, signature: value.payload.signature, fileName: typeof value.payload.fileName === "string" ? value.payload.fileName : null } };
  }
  if (value.type === "document.renamed") {
    return isText(documentId) && isText(value.payload.fileName) ? { ...base, type: "document.renamed", payload: { documentId, fileName: value.payload.fileName } } : { invalid: "document.renamed needs documentId and fileName" };
  }
  if (value.type === "document.externalChange") {
    return isText(documentId) ? { ...base, type: "document.externalChange", payload: { documentId } } : { invalid: "document.externalChange needs documentId" };
  }
  return { invalid: `unknown event type "${String(value.type)}"` };
}
