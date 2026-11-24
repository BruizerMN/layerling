import {
  EDITOR_NAME,
  DOCUMENT_CAPABILITY,
  DOCUMENT_PROTOCOL_MIN,
  SAVE_CAPABILITY,
  SAVE_PROTOCOL_MIN,
  UI_CAPABILITY,
  UI_MENU_CAPABILITY,
  RIBBON_CAPABILITY,
  VISUAL_GROUPS_CAPABILITY,
  DESIGN_INSERT_CAPABILITY,
  HOST_BOOTSTRAP_KEY,
  HOST_HANDLER_NAME,
  HOST_PROTOCOL_MAX,
  HOST_PROTOCOL_MIN,
  HOST_RECEIVER_KEY,
  HOST_SCHEME,
  negotiateProtocol,
  parseHelloOk,
  parseHostBootstrap,
  parseHostEvent,
  parseHostResponse,
  type Described,
  type HostEvent,
  type HostErrorCode,
  type HostRequest,
  type ProtocolRange,
} from "@/lib/host/hostProtocol";

/**
 * The editor's side of the host protocol (README.md in this folder): detect a native host, shake hands, answer host events.
 *
 * INACTIVE UNLESS A NATIVE HOST IS PRESENT. `readHostEnvironment` returns null - and nothing below runs, posts or defines a global - unless ALL hold:
 *   1. the page is served from the host's custom scheme (`layerling:`), so no http(s) or file page can qualify;
 *   2. the host installed its message handler (`window.webkit.messageHandlers.layerlingHost`);
 *   3. the host injected its bootstrap capability (`window.__layerlingHostBootstrap`), which parseHostBootstrap then validates.
 * A URL parameter never activates it.
 */

export type HostFailureCode = HostErrorCode | "bad-bootstrap" | "timeout" | "transport-error" | "malformed-reply" | "protocol-out-of-range";

export interface HostFailure {
  code: HostFailureCode;
  message: string;
  /** For "unsupported-protocol": what the host speaks. */
  supported?: ProtocolRange;
}

export type HostConnection =
  | { state: "inactive" }
  | { state: "connecting" }
  | { state: "connected"; protocol: number; host: Described; capabilities: string[] }
  | { state: "ready"; protocol: number; host: Described; capabilities: string[] }
  | { state: "failed"; failure: HostFailure };

export type ReceiveResult = { ok: true } | { ok: false; code: HostErrorCode; message: string };
export type HostReceiver = (event: unknown) => ReceiveResult;

/** Everything the bridge needs from the page, so tests can supply it. */
export interface HostEnvironment {
  bootstrap: unknown;
  /** Posts a request to the host's message handler; resolves with the host's reply, rejects with a transport error. */
  post(request: HostRequest): Promise<unknown>;
  /** Makes `window.layerlingHostBridge.receive` available; returns the remover. */
  installReceiver(receiver: HostReceiver): () => void;
  log(level: "debug" | "warn", message: string): void;
}

/** The slice of `window` that is read. */
export interface HostWindow {
  location?: { protocol?: string };
  webkit?: { messageHandlers?: Record<string, { postMessage?: (message: unknown) => Promise<unknown> } | undefined> };
  [key: string]: unknown;
}

const LOG_PREFIX = "[layerling-host]";

export function readHostEnvironment(win: HostWindow | undefined): HostEnvironment | null {
  if (!win || win.location?.protocol !== HOST_SCHEME) return null;
  const handler = win.webkit?.messageHandlers?.[HOST_HANDLER_NAME];
  if (!handler || typeof handler.postMessage !== "function") return null;
  if (win[HOST_BOOTSTRAP_KEY] === undefined) return null;
  const post = handler.postMessage.bind(handler);
  return {
    bootstrap: win[HOST_BOOTSTRAP_KEY],
    post: (request) => post(request),
    installReceiver: (receiver) => {
      win[HOST_RECEIVER_KEY] = Object.freeze({ receive: receiver });
      return () => {
        delete win[HOST_RECEIVER_KEY];
      };
    },
    log: (level, message) => (level === "warn" ? console.warn(`${LOG_PREFIX} ${message}`) : console.debug(`${LOG_PREFIX} ${message}`)),
  };
}

export interface HostBridgeOptions {
  editorVersion: string;
  editorBuild: string;
  /** The protocol versions this bridge offers (default: everything this editor speaks). Tests use it to play a v1-only editor. */
  range?: ProtocolRange;
  /** Capabilities offered to the host in `hello` (protocol 2), for example "document.open". Omitted from `hello` when empty. */
  capabilities?: string[];
  /** How long a reply may take before the attempt is recorded as failed (default 5000 ms). It only decides the failure; it gates nothing else. */
  timeoutMs?: number;
}

export interface HostBridge {
  connect(): Promise<HostConnection>;
  markReady(): Promise<HostConnection>;
  ping(): Promise<{ ok: true; roundTripMs: number } | { ok: false; failure: HostFailure }>;
  /**
   * Sends a protocol 2 document message and returns the host's success payload or the failure. Refused locally (nothing is posted) unless the
   * handshake negotiated protocol 2 AND the host granted the document capability.
   */
  send(type: DocumentMessageType, payload: Record<string, unknown>): Promise<{ ok: true; payload: Record<string, unknown> } | { ok: false; failure: HostFailure }>;
  /** Host events other than ping (protocol 2: "document.cancel"). */
  onEvent(listener: (event: HostEvent) => void): () => void;
  /** True once connected with protocol 2 and the document capability granted. */
  supportsDocuments(): boolean;
  /** Protocol 3: send a save-related message; refused locally unless protocol 3 and the `document.save` capability were negotiated. */
  sendSave(type: SaveMessageType, payload: Record<string, unknown>): Promise<{ ok: true; payload: Record<string, unknown> } | { ok: false; failure: HostFailure }>;
  /** True once connected with protocol 3 and the save capability granted. */
  supportsSave(): boolean;
  /** Build 0003 (`ui.v1`): send a menu-state or settings-state message; refused locally unless the host granted `ui.v1`. */
  sendUi(type: UiMessageType, payload: Record<string, unknown>): Promise<{ ok: true; payload: Record<string, unknown> } | { ok: false; failure: HostFailure }>;
  /** True once the host granted `ui.v1`. */
  supportsUi(): boolean;
  /** True once the host granted `ui.menu.v1` (native contextual menus). */
  supportsMenu(): boolean;
  /** True once the host granted `ribbon.v1` (the native toolbar prototype). */
  supportsRibbon(): boolean;
  /** True once the host granted `visualGroups.v1` (the Visual Groups palette). */
  supportsVisualGroups(): boolean;
  /** True once the host granted `designInsert.v1` (File > Import Layerling Files). */
  supportsDesignInsert(): boolean;
  getConnection(): HostConnection;
  subscribe(listener: (connection: HostConnection) => void): () => void;
  dispose(): void;
}

class TimedOut extends Error {}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimedOut(`no reply within ${ms} ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export type DocumentMessageType = "document.request" | "document.progress" | "document.opened" | "document.failed";
export type UiMessageType = "ui.state" | "ui.action" | "settings.state" | "menu.show" | "ribbon.state" | "visualGroups.state" | "visualGroups.choose" | "visualGroups.pick" | "designInsert.result";
export type SaveMessageType = "document.changed" | "document.save.progress" | "document.save.commit" | "document.save.failed";

export function createHostBridge(env: HostEnvironment | null, options: HostBridgeOptions): HostBridge {
  const editorRange: ProtocolRange = options.range ?? { min: HOST_PROTOCOL_MIN, max: HOST_PROTOCOL_MAX };
  const offered = options.capabilities ?? [];
  const eventListeners = new Set<(event: HostEvent) => void>();
  const timeoutMs = options.timeoutMs ?? 5000;
  let connection: HostConnection = { state: "inactive" };
  const listeners = new Set<(c: HostConnection) => void>();
  let session = "";
  let negotiated = 0;
  let counter = 0;
  let removeReceiver: (() => void) | null = null;

  const set = (next: HostConnection) => {
    connection = next;
    listeners.forEach((listener) => listener(next));
  };
  const fail = (failure: HostFailure): HostConnection => {
    env?.log("warn", `${failure.code}: ${failure.message}`);
    set({ state: "failed", failure });
    return connection;
  };
  const nextId = () => `e${++counter}`;

  type Outcome = { kind: "ok"; payload: Record<string, unknown> } | { kind: "failed"; failure: HostFailure };
  /** One request/response exchange, folded into a success payload or a HostFailure. */
  async function exchange(request: HostRequest, expectedType: string): Promise<Outcome> {
    if (!env) return { kind: "failed", failure: { code: "transport-error", message: "no host environment" } };
    let reply: unknown;
    try {
      reply = await withTimeout(env.post(request), timeoutMs);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { kind: "failed", failure: { code: error instanceof TimedOut ? "timeout" : "transport-error", message } };
    }
    const parsed = parseHostResponse(reply, request.id, expectedType);
    if (parsed.kind === "invalid") return { kind: "failed", failure: { code: "malformed-reply", message: parsed.reason } };
    if (parsed.kind === "error") return { kind: "failed", failure: { code: parsed.error.code, message: parsed.error.message, supported: parsed.error.supported } };
    return { kind: "ok", payload: parsed.payload };
  }

  const documentsGranted = () =>
    (connection.state === "connected" || connection.state === "ready") && negotiated >= DOCUMENT_PROTOCOL_MIN && connection.capabilities.includes(DOCUMENT_CAPABILITY);

  const saveGranted = () =>
    (connection.state === "connected" || connection.state === "ready") && negotiated >= SAVE_PROTOCOL_MIN && connection.capabilities.includes(SAVE_CAPABILITY);

  const uiGranted = () => saveGranted() && connection.state !== "failed" && connection.state !== "inactive" && connection.state !== "connecting" && connection.capabilities.includes(UI_CAPABILITY);

  const ribbonGranted = () => uiGranted() && (connection.state === "connected" || connection.state === "ready") && connection.capabilities.includes(RIBBON_CAPABILITY);
  const visualGroupsGranted = () => uiGranted() && (connection.state === "connected" || connection.state === "ready") && connection.capabilities.includes(VISUAL_GROUPS_CAPABILITY);
  const designInsertGranted = () => uiGranted() && (connection.state === "connected" || connection.state === "ready") && connection.capabilities.includes(DESIGN_INSERT_CAPABILITY);
  const menuGranted = () => uiGranted() && (connection.state === "connected" || connection.state === "ready") && connection.capabilities.includes(UI_MENU_CAPABILITY);

  const receive: HostReceiver = (event) => {
    if (connection.state !== "connected" && connection.state !== "ready") return { ok: false, code: "not-ready", message: "handshake not complete" };
    const parsed = parseHostEvent(event);
    if ("invalid" in parsed) return { ok: false, code: "bad-request", message: parsed.invalid };
    if (parsed.session !== session) return { ok: false, code: "bad-session", message: "session does not match" };
    if (parsed.protocol !== negotiated) return { ok: false, code: "protocol-mismatch", message: `negotiated ${negotiated}, event says ${parsed.protocol}` };
    if (parsed.type === "document.cancel") {
      if (!documentsGranted()) return { ok: false, code: "bad-request", message: "document events were not negotiated" };
      env?.log("debug", `host event document.cancel ${parsed.payload.documentId}`);
      eventListeners.forEach((listener) => listener(parsed));
      return { ok: true };
    }
    if (parsed.type === "ui.command" || parsed.type === "settings.apply" || parsed.type === "settings.watch" || parsed.type === "menu.result" || parsed.type === "menu.highlight" || parsed.type === "ribbon.invoke" || parsed.type === "ribbon.native" || parsed.type === "visualGroups.invoke" || parsed.type === "visualGroups.watch" || parsed.type === "designInsert.insert") {
      if (!uiGranted() || (parsed.type === "designInsert.insert" && !designInsertGranted()) || ((parsed.type === "ribbon.invoke" || parsed.type === "ribbon.native") && !ribbonGranted()) || ((parsed.type === "visualGroups.invoke" || parsed.type === "visualGroups.watch") && !visualGroupsGranted())) return { ok: false, code: "bad-request", message: "ui events were not negotiated" };
      env?.log("debug", `host event ${parsed.type}`);
      eventListeners.forEach((listener) => listener(parsed));
      return { ok: true };
    }
    if (parsed.type !== "ping") {
      // protocol 3 events
      if (!saveGranted()) return { ok: false, code: "bad-request", message: "save events were not negotiated" };
      env?.log("debug", `host event ${parsed.type}`);
      eventListeners.forEach((listener) => listener(parsed));
      return { ok: true };
    }
    env?.log("debug", `host ping ${parsed.id} -> pong`);
    // Answer with a request the host acknowledges; a failure is logged, never thrown into the host's script call.
    void exchange({ id: nextId(), session, type: "pong", protocol: negotiated, payload: { inReplyTo: parsed.id } }, "pong.ok").then((outcome) => {
      if (outcome.kind === "failed") env?.log("warn", `pong for ${parsed.id} failed: ${outcome.failure.code}: ${outcome.failure.message}`);
    });
    return { ok: true };
  };

  return {
    async connect() {
      if (!env || connection.state !== "inactive") return connection;
      set({ state: "connecting" });
      const bootstrap = parseHostBootstrap(env.bootstrap);
      if (!bootstrap) return fail({ code: "bad-bootstrap", message: "the host's bootstrap capability is missing or malformed" });
      session = bootstrap.session;
      env.log("debug", `hello -> ${bootstrap.host.name} ${bootstrap.host.version} (host speaks ${bootstrap.protocol.min}-${bootstrap.protocol.max}, editor ${editorRange.min}-${editorRange.max})`);
      const outcome = await exchange(
        { id: nextId(), session, type: "hello", payload: { editor: { name: EDITOR_NAME, version: options.editorVersion, build: options.editorBuild }, protocol: editorRange, ...(offered.length > 0 ? { capabilities: offered } : {}) } },
        "hello.ok",
      );
      if (outcome.kind === "failed") return fail(outcome.failure);
      const hello = parseHelloOk(outcome.payload);
      if (!hello) return fail({ code: "malformed-reply", message: "hello.ok payload is incomplete" });
      if (negotiateProtocol(editorRange, { min: hello.protocol, max: hello.protocol }) === null) {
        return fail({ code: "protocol-out-of-range", message: `host chose protocol ${hello.protocol}; this editor speaks ${editorRange.min}-${editorRange.max}` });
      }
      negotiated = hello.protocol;
      removeReceiver = env.installReceiver(receive);
      env.log("debug", `connected to ${hello.host.name} ${hello.host.version}, protocol ${negotiated}`);
      set({ state: "connected", protocol: negotiated, host: hello.host, capabilities: hello.capabilities });
      return connection;
    },

    async markReady() {
      if (connection.state !== "connected") return connection;
      const { host, capabilities } = connection;
      const outcome = await exchange({ id: nextId(), session, type: "ready", protocol: negotiated, payload: {} }, "ready.ok");
      if (outcome.kind === "failed") return fail(outcome.failure);
      set({ state: "ready", protocol: negotiated, host, capabilities });
      return connection;
    },

    async ping() {
      if (connection.state !== "connected" && connection.state !== "ready") return { ok: false as const, failure: { code: "not-ready" as const, message: "no connection" } };
      const sentAt = Date.now();
      const outcome = await exchange({ id: nextId(), session, type: "ping", protocol: negotiated, payload: { sentAt } }, "ping.ok");
      if (outcome.kind === "failed") return { ok: false as const, failure: outcome.failure };
      return { ok: true as const, roundTripMs: Date.now() - sentAt };
    },

    async send(type, payload) {
      if (!documentsGranted()) return { ok: false as const, failure: { code: "unsupported-capability" as const, message: "the host did not grant document support" } };
      const request = { id: nextId(), session, type, protocol: negotiated, payload } as HostRequest;
      const outcome = await exchange(request, `${type}.ok`);
      return outcome.kind === "ok" ? { ok: true as const, payload: outcome.payload } : { ok: false as const, failure: outcome.failure };
    },
    onEvent(listener) {
      eventListeners.add(listener);
      return () => eventListeners.delete(listener);
    },
    async sendSave(type, payload) {
      if (!saveGranted()) return { ok: false as const, failure: { code: "unsupported-capability" as const, message: "the host did not grant save support" } };
      const request = { id: nextId(), session, type, protocol: negotiated, payload } as HostRequest;
      const outcome = await exchange(request, `${type}.ok`);
      return outcome.kind === "ok" ? { ok: true as const, payload: outcome.payload } : { ok: false as const, failure: outcome.failure };
    },
    async sendUi(type, payload) {
      if (!uiGranted() || (type === "menu.show" && !menuGranted()) || (type === "ribbon.state" && !ribbonGranted()) || ((type === "visualGroups.state" || type === "visualGroups.choose" || type === "visualGroups.pick") && !visualGroupsGranted()) || (type === "designInsert.result" && !designInsertGranted())) return { ok: false as const, failure: { code: "unsupported-capability" as const, message: "the host did not grant ui support" } };
      const request = { id: nextId(), session, type, protocol: negotiated, payload } as HostRequest;
      const outcome = await exchange(request, `${type}.ok`);
      return outcome.kind === "ok" ? { ok: true as const, payload: outcome.payload } : { ok: false as const, failure: outcome.failure };
    },
    supportsUi: uiGranted,
    supportsMenu: menuGranted,
    supportsRibbon: ribbonGranted,
    supportsVisualGroups: visualGroupsGranted,
    supportsDesignInsert: designInsertGranted,
    supportsDocuments: documentsGranted,
    supportsSave: saveGranted,

    getConnection: () => connection,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      removeReceiver?.();
      removeReceiver = null;
      listeners.clear();
      eventListeners.clear();
    },
  };
}

let activeBridge: HostBridge | null = null;
const bridgeListeners = new Set<(bridge: HostBridge | null) => void>();

/** Told when the bridge appears or goes away (a page can render before the layout's effect has started it). Never fires in a browser. */
export function subscribeToHostBridge(listener: (bridge: HostBridge | null) => void): () => void {
  bridgeListeners.add(listener);
  return () => bridgeListeners.delete(listener);
}

/** The running bridge, or null when no native host is present (always null in a browser). */
export function getHostBridge(): HostBridge | null {
  return activeBridge;
}

/**
 * Called once from the root layout. In a browser it does nothing at all. In the native host it connects, then reports ready.
 * Returns a cleanup for effect teardown.
 */
export function startHostBridge(win?: HostWindow): () => void {
  if (activeBridge) return () => undefined;
  const target = win ?? (typeof window === "undefined" ? undefined : (window as unknown as HostWindow));
  const env = readHostEnvironment(target);
  if (!env) return () => undefined;
  const bridge = createHostBridge(env, {
    editorVersion: process.env.NEXT_PUBLIC_APP_VERSION ?? "unknown",
    editorBuild: process.env.NEXT_PUBLIC_BUILD_ID ?? "unknown",
    capabilities: [DOCUMENT_CAPABILITY, SAVE_CAPABILITY, UI_CAPABILITY, UI_MENU_CAPABILITY, RIBBON_CAPABILITY, VISUAL_GROUPS_CAPABILITY, DESIGN_INSERT_CAPABILITY],
  });
  activeBridge = bridge;
  bridgeListeners.forEach((listener) => listener(bridge));
  void bridge.connect().then((connection) => (connection.state === "connected" ? bridge.markReady() : connection));
  return () => {
    bridge.dispose();
    if (activeBridge === bridge) {
      activeBridge = null;
      bridgeListeners.forEach((listener) => listener(null));
    }
  };
}
