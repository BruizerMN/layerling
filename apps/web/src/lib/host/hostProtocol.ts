/**
 * The host protocol: the narrow, versioned contract between the Layerling editor and a native host (the macOS app).
 * Specification: README.md in this folder. Shared fixtures (fixtures/v1) are tested by both sides.
 *
 * Nothing here runs unless a native host is present (see hostBridge.ts): in a browser this file is only types and pure functions.
 */

/** The protocol versions this editor speaks. Raise MAX only together with the host and the README; MIN when a version is dropped. */
export const HOST_PROTOCOL_MIN = 1;
export const HOST_PROTOCOL_MAX = 2;

/** Protocol 2 adds native documents (docs: README.md, "Protocol v2"). Offered by the editor in `hello`, granted by the host in `hello.ok`. */
export const DOCUMENT_CAPABILITY = "document.open";
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
export type HostRequest = HelloRequest | ReadyRequest | PingRequest | PongRequest | DocumentRequest | DocumentProgressRequest | DocumentOpenedRequest | DocumentFailedRequest;

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
};

export type ParsedResponse =
  | { kind: "ok"; type: string; payload: Record<string, unknown> }
  | { kind: "error"; error: HostError }
  | { kind: "invalid"; reason: string };

/** Pushed by the host through `window.layerlingHostBridge.receive(event)`. The editor answers a ping with a "pong" request. */
export type HostEvent =
  | { session: string; protocol: number; id: string; type: "ping"; payload: Record<string, never> }
  /** Protocol 2: the host is closing or reloading the document; the editor abandons an open in progress. */
  | { session: string; protocol: number; id: string; type: "document.cancel"; payload: { documentId: string } };

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
  return { invalid: `unknown event type "${String(value.type)}"` };
}
