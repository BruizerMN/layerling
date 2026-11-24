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

## Protocol v3: saving

Capability `document.save` (offered in `hello` next to `document.open`; granted only with protocol >= 3). v1/v2 are unchanged.

| Direction | Message | Payload |
|---|---|---|
| editor -> host | `document.changed` | `{documentId, revision, dirty}`: the persistent content changed or the dirty flag flipped (coalesced per tick) |
| host -> editor | event `document.save` | `{documentId, saveId, uploadToken, fileName, reason}` |
| editor -> host | `document.save.progress` | `{documentId, saveId, phase: wait|snapshot|serialize|compress|upload, loaded?, total?}` |
| editor -> host | POST `layerling://app/__host__/save/<uploadToken>?offset=N` | raw bytes, 8 MiB sequential chunks; `200 {"next": N+len}`; wrong offset `409` |
| editor -> host | `document.save.commit` | `{documentId, saveId, revision, signature, byteLength, sha256, stats, timings, thumbnail}`; the host answers `save-rejected` when byte count, SHA-256 or ZIP structure do not verify |
| editor -> host | `document.save.failed` | `{documentId, saveId, code, message}` (`serialize-failed`, `too-large`, `out-of-memory`, `cancelled`, `interaction-timeout`, `upload-failed`, `internal`) |
| host -> editor | events `document.save.cancel`, `document.saved {revision, signature, fileName}`, `document.renamed {fileName}`, `document.externalChange` | |

The editor packages **its current state only** (one history entry, ZIP level 1, the document's own project id, camera/saved views/rulers/tape passed explicitly, a best-effort `thumbnail.png`) with the unchanged `exportLylProject`, from an immutable snapshot taken in one synchronous block; edits made while it packages stay unsaved. The dirty flag is `signature != savedSignature`, where the signature is built from the current history entry's existing fingerprint plus attachments, document settings (not preferences, see `documentRevision.ts`), saved views, rulers and tape: undoing back to the saved content is clean again; camera moves and selection never count. The native file name is authoritative (`document.renamed`); the editor's project-name field is read-only without a rename callback.

Fixtures: `fixtures/v3/`.

## Capability `designInsert.v1`: Import Layerling Files (Build 0070; additive, needs `ui.v1`)

The host owns the menu command (File > Import Layerling Files…) and the file panel; the editor owns the import. Its engine is "Insert into this design" (`insertDesignFile`: `importLylProject` + `placeInsertedDesign`), run for a list of files and committed ONCE.

| Direction | Message | Payload |
|---|---|---|
| editor -> host | `hello` offers `designInsert.v1`; granted in `hello.ok` only with `ui.v1` and a host that handles the result | |
| host -> editor | event `designInsert.insert` | `documentId`, `requestId`, `files`: 1-500 file descriptors exactly as `document.request.ok` sends them (`kind: "file"`, `fileName`, `byteLength`, `modifiedAt`, `url`: a one-file, token-guarded `layerling://app/__host__/doc/<token>`), in the order to import |
| editor -> host | request `designInsert.result` (answered `designInsert.result.ok`) | `documentId`, `requestId`, `imported: [{fileName, objectCount}]`, `failures: [{fileName, reason}]`: every file appears exactly once |
| page -> host | `ui.state.file.insertDesigns` (boolean) | the command can run now (3D, history view closed, not in Presentation Mode) |

Rules: bodies keep their saved coordinates (no centring, scaling or arranging); every body and group below it gets a fresh id (two files that share ids never collide); notes and project assets come along as for "Insert into this design"; Visual Groups metadata of the files is NOT imported. All files that went well are one history step (one Undo). A file that cannot be read or parsed, or has no bodies, is reported and skipped; the others still go in. If the design is closed or replaced, or the history view is opened, while the files are being read, nothing is added and every file is reported as not imported. In Sketch mode, in Presentation Mode, or while another insert runs, the whole request is refused the same way. The files are only read.
