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
