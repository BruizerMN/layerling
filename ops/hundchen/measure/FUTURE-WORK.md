# Observations and follow-ups (from the Step 2 acceptance, 2026-11-19)

1. **Peak spikes of 5.5-6.8 GB during opening (7 of 50 soak runs).** They happen at about +22 s, in the web app's existing library repack (`saveProjectShapes` -> `exportLylProject` into IndexedDB), not in the unpack (3.9-4.5 GB at +6-9 s).
   The repack runs after every open and every edit. Native-host mode (host-integration step 4/5) removes it: the .lyl on disk stays authoritative and nothing is repackaged into IndexedDB per edit.
2. **The unpack watchdog is 82 s for Foshay** (`workerTimeoutMs` 20 s + `workerMsPerMiB` 250 ms x 247.6 MiB). It is functional (hang and error cases recover, open 109 s) but slow. A false fallback only costs about 1 s of in-place inflation, so a shorter limit
   (for example 15 s + 50 ms/MiB, about 27 s for Foshay) would be cheap. Not changed: the implementation passed acceptance as it is. Note that fflate's browser build ignores Worker `error` events (it only listens for messages), so an error event is recovered by this watchdog, not immediately.
3. **The repack has its own worker-failure vulnerability, separate from Step 2.** `boundedProjectZip` (export side) has no fallback if a Worker cannot be created or never answers: the opening is left unfinished with no message (observed with injected faults on the first repack worker). Pre-existing; candidate small fix:
   fall back to synchronous `ZipDeflate` after a failure or timeout. Also removed in host mode.
4. **Not yet tested:** Safari.app itself (WKWebView, the Safari engine, and headless Chromium were used) and Macs other than the 32 GB MacBook Air (8/16 GB Macs especially).
5. **Hidden pages are 3-6x slower for both builds** (baseline hidden 77-93 s vs ~28 s visible): WebKit throttles timers and the app relies on timers and idle callbacks. A native host must keep its WebView in a visible window while a document opens (or accept the delay).
6. **Test environment lessons** are in `README.md` (visible page, direct launch, no files written into backed-up folders, caffeinate).
