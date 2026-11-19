# Native host interface (protocol v1)

A narrow, versioned channel between the editor and a native macOS host (HundchenLayerling for macOS) that embeds it in a WKWebView.
It is **inactive in every ordinary browser**. Step 3 only establishes the handshake and a ping; documents, saving and recovery stay with the editor.

## Activation (all must hold)

1. `location.protocol === "layerling:"` (the host's own scheme; http, https and file never qualify).
2. `window.webkit.messageHandlers.layerlingHost.postMessage` exists (injected by WKWebView for the host).
3. `window.__layerlingHostBootstrap` was injected by the host at document start and parses as a valid capability.

A URL parameter never activates it. Nothing is defined on `window` until the handshake succeeds.

## Bootstrap capability (host -> page, at document start)

`{ "host": {"name","version"}, "protocol": {"min","max"}, "session": "<random, >= 8 chars>" }`

## Messages

Editor -> host, via `layerlingHost.postMessage(request)` (a Promise resolves with the reply):

| type    | purpose                                  | reply        |
|---------|------------------------------------------|--------------|
| `hello` | offer editor identity and protocol range | `hello.ok`   |
| `ready` | editor finished starting                 | `ready.ok`   |
| `ping`  | liveness check                           | `ping.ok`    |
| `pong`  | answer to a host `ping` event            | `pong.ok`    |

Every request: `{ id, session, protocol, type, payload }`. Every reply: `{ id, ok:true, type, payload }` or `{ id, ok:false, error:{ code, message, supported? } }`.
`hello` carries the editor name/version/build and its `{min,max}` range; the host answers with the chosen protocol (the highest common version) or `unsupported-protocol` with its own range.

Host -> editor, via `window.layerlingHostBridge.receive(event)` (installed only after `hello.ok`): `{ session, protocol, id, type:"ping", payload }`; `receive` returns `{ok:true}` or `{ok:false, code, message}`.

## Errors

Host: `unsupported-protocol`, `protocol-mismatch`, `bad-session`, `bad-request`, `not-ready`, `internal` (unknown codes from newer hosts read as `internal`).
Editor-side failures: `bad-bootstrap`, `timeout`, `transport-error`, `malformed-reply`, `protocol-out-of-range`.
On any failure the editor stays a normal editor; no receiver is installed.

## Logging

`[layerling-host]` via `console.debug` / `console.warn`: handshake steps, versions, and each failure with its code.

## Fixtures

`fixtures/v1/*.json` are shared with the native repo; both sides test against them. Changing a message means a new protocol version and new fixtures.

## Protocol v2: native documents

Protocol 2 makes the editor a document view for a native host (HundchenLayerling for macOS). **Every editor window is one native document**; there is no browser library in a host window. Versions are negotiated as before (highest common); a v1-only host and a v2 editor settle on 1 and simply never use documents.

**Activation.** Served from `layerling:` the route (`app/page.tsx`) renders `components/NativeDocumentShell.tsx` instead of the browser start page. Documents need ALL of: the v1 activation conditions, negotiated protocol >= 2, `hello.ok.capabilities` containing `document.open` (the editor offers it in `hello.payload.capabilities`; the host grants it only if it can serve documents). If the handshake fails or documents are not granted the window shows an explanation, never a dashboard.

**Identity.** `documentId` (host-assigned, one per document window, never reused) is distinct from the `session` (one per page load) and from the project id stored inside a `.lyl` (document metadata, reported back in `document.opened.projectId`). The editor runs under a transient runtime project id (`native-doc:<documentId>`) that is never persisted.

| Direction | Type | Payload | Reply |
|---|---|---|---|
| editor -> host | `document.request` | `{}` | `document.request.ok {document}`: `{kind:"new", documentId, displayName}` or `{kind:"file", documentId, fileName, byteLength, modifiedAt, url}` |
| editor -> host | `document.progress` | `{documentId, phase: transfer\|unpack\|build, loaded?, total?}` | `document.progress.ok` |
| editor -> host | `document.opened` | `{documentId, projectId, projectName, stats, timings, meshRelief:{bodies}, repack:false}` | `document.opened.ok` |
| editor -> host | `document.failed` | `{documentId, code, message}` (`transfer-failed`, `invalid-package`, `unsupported-version`, `out-of-memory`, `cancelled`, `internal`) | `document.failed.ok` |
| host -> editor | event `document.cancel` | `{documentId}` | `{ok}` |

New errors: `unsupported-capability`, `no-such-document`, `document-changed`. The editor pulls its document after `ready` (no push race for files opened at launch); a reload of the page (host-side recovery) simply asks again.

**Transfer.** For a file document the editor `fetch`es `url` (only `layerling://app/__host__/doc/<token>`, an unguessable per-document token; any other URL is refused), checks status 200, `Content-Length` equals `byteLength`, and reads into one preallocated array (`lib/host/documentTransfer.ts`). Truncation, growth or change of the file fail the open.

**Opening.** `lib/host/nativeDocumentLoader.ts`: the existing `importLylProject`, then the existing `relieveOverFineCadMeshes` (reported as `meshRelief.bodies`), then the editor is handed the in-memory scene. Nothing is written to IndexedDB, the project list or thumbnails; per-document camera/saved views/framing squares/tape live in memory for transient ids (`lib/host/transientProject.ts`); the automatic "Earlier versions" snapshots and the .lyl export are off for native documents (`LayerlingEditor nativeDocument` prop).

Fixtures: `fixtures/v2/` (together with `fixtures/v1/`, unchanged).
