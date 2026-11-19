# Foshay measurement harness (Step 0)

Repeatable open / edit / save / memory measurements for the **Foshay Pedestal** acceptance model (21,833 nodes, 15 assemblies),
plus an acceptance check that compares saved files against the Foshay baseline node by node. It exists so that every later
change (bounded unzip, host mode, ...) can be shown to be **faster or unchanged, and lossless**, against the same yardstick.

Nothing here changes the editor or the deployment. It only reads a static frontend artifact (`ops/hundchen/build-static.sh`)
and a Foshay `.lyl`.

## Pieces

| File | Purpose |
|---|---|
| `baseline-foshay.json` | The document baseline (counts and sha256 of the reference file) and the approved memory targets for hosted mode |
| `compare_lyl.py` | Acceptance check: `compare_lyl.py A.lyl B.lyl --baseline baseline-foshay.json --expect-added N`. Exit 0 = pass. Verifies A matches the baseline, nodes node-by-node, asset hashes, mesh blobs byte for byte, zip integrity |
| `probes/*.js` | Page-side probes (plain async function bodies): `debug-elements.js` (which diagnostic DOM mirrors exist and how big), `edit-probe.js` (one identifiable edit + 15 s of frame-gap/jank + notice latency + working-copy write timings), `await-journal.js` (lag of the IndexedDB repack write) |
| `run_measure.py` | The macOS reference runner: opens Foshay in a WKWebView host app, runs the probes, samples WebContent memory every 250 ms, does a Save As and runs `compare_lyl.py` on it. Writes `runs/<label>/<stamp>-runN/summary.json` |
| `summarize.py` | Aggregates runs into a markdown table: `summarize.py runs/before runs/after` |

The reference **host app** (a throwaway Swift/WKWebView app with a file-based control channel and a 250 ms memory sampler) is not part of this
repository. It lives with the macOS work (currently in the proof-of-concept folder) and moves to the macOS repository. `run_measure.py` documents the control
protocol it needs (`--poc-root`, `--open`, `--store-id`, `--ls key=value`, `-ApplePersistenceIgnoreState YES`, control files `cmd.js`, `mem.request`, `saveas.request`).
The probes and `compare_lyl.py` work in any browser (paste a probe into the console / run it through your automation).

## How to run (Mac)

1. Build the static artifact for each variant on the Ubuntu VM: `ops/hundchen/build-static.sh` (output `~/bin/layerling-static/<commit9>/`), copy the `.tar.gz` over SSH.
2. Build the host app around an artifact: `build-app.sh <artifact.tar.gz> builds/<label>` (reference host).
3. Make a private copy of the Foshay file and **check its sha256 against `baseline-foshay.json`**.
4. `python3 run_measure.py --label before --app builds/before/LayerlingHarness.app --doc work/foshay-source.lyl --runs 3`
   (add `--ls layerling.debugState=1` to switch the diagnostic mirrors on for a run).
5. `python3 summarize.py runs/before runs/after`.

**Rules for fair numbers**
- Interleave variants (A, B, A, B...). The machine drifts.
- Quit heavy apps first. Runs record swap use, load and free memory; a Mac with several GB of swap in use produces outliers (a Save As that normally takes 10 s took 56-60 s in two runs on a swapped Mac).
- Use at least 3 runs per variant; report median and range, never a single run.
- The runner always opens a copy and never modifies the source file.

## Metrics (per run)
open -> ready (s); WebContent peak, at ready, settled (+10 s) in MB (physical footprint, 250 ms sampling);
size of each diagnostic DOM mirror; per edit: "Box added" notice latency, total time in frames longer than 100 ms and the longest frame gap
within 15 s of the edit, time to the project-list write and to the IndexedDB repack write, WebContent peak while repacking, settled memory afterwards;
Save As time and peak; lifetime peak; fidelity verdict.

## Acceptance targets for hosted (native) mode
Peak opening memory <= 4.5 GB, settled <= 2.5 GB on the full Foshay model (macOS 16 GB Macs are a goal, not a requirement). Reliability and
document fidelity come before the targets.

## Reference results
Recorded 2026-11-18 on the 2025 MacBook Air (32 GB, macOS 26.7.3), WKWebView reference host, Foshay file sha256 `cb27f08c...5e4a`.
**The Mac had ~7 GB of swap in use and a load average of 4-5 during these runs**, so absolute numbers carry noise (two runs had a Save As of 56-60 s instead of ~10 s). Medians with [min-max].

### Current web app (before) vs Step 1 (after), different artifacts
`before` = artifact d93a534a4 (fork 8b30152bb); `after` = 87875d24d (debug mirrors gated). The `before` set mixes early runs (busier machine) with interleaved ones.

| metric | before (n=6) | after (n=3) |
|---|---|---|
| open -> ready (s) | 19.8 [17.6-21.7] | 16.6 [16.4-17.0] |
| open: WebContent peak (MB) | 9296 [8983-9619] | 8246 [8225-9144] |
| at ready (MB) | 3991 [3104-6467] | 3412 [3212-3995] |
| settled +10 s (MB) | 3317 [2848-7227] | 3164 [3035-4275] |
| debug state element (chars) | 10569914 [10569914-10569914] | 0 [0-0] |
| edit 1: notice latency (ms) | 574 [537-724] | 530 [497-639] |
| edit 1: blocked frames > 100 ms (ms total, 15 s) | 3382 [0-4026] | 3254 [2968-3319] |
| edit 1: longest frame gap (ms) | 2083 [0-2537] | 2022 [1947-2116] |
| edit 1: project-list write after click (ms) | 3304 [3054-11283] | 3054 [3027-3171] |
| edit 1: IndexedDB repack write after click (ms) | 9775 [8134-34268] | 7771 [7735-7926] |
| edit 1: WebContent peak while repacking (MB) | 7133 [6394-8897] | 6555 [6140-6613] |
| edit 2: blocked frames > 100 ms (ms total, 15 s) | 2611 [0-2882] | 2297 [0-2765] |
| edit 2: IndexedDB repack write after click (ms) | 8952 [7782-38778] | 7647 [7426-37647] |
| after edits: settled (MB) | 3950 [3654-4598] | 5193 [3697-5907] |
| Save As (s) | 12.9 [10.3-56.0] | 10.3 [10.1-59.5] |
| Save As: WebContent peak (MB) | 5993 [5483-7703] | 5783 [5689-7904] |
| lifetime peak (MB) | 9378 [9034-9644] | 8352 [8251-9260] |
| swap used at start (MB) | n/a | n/a |
| load average at start | n/a | n/a |
| fidelity vs Foshay baseline | 6/6 pass | 3/3 pass |

### Controlled toggle: one artifact (87875d24d), mirrors off vs on, interleaved
| metric | toggle-off (n=3) | toggle-on (n=3) |
|---|---|---|
| open -> ready (s) | 16.8 [16.7-17.4] | 17.4 [16.9-17.7] |
| open: WebContent peak (MB) | 8684 [8282-9424] | 8301 [8261-8976] |
| at ready (MB) | 3280 [3250-3326] | 3144 [3029-3835] |
| settled +10 s (MB) | 3707 [3499-3767] | 3218 [2995-3335] |
| debug state element (chars) | 0 [0-0] | 10569914 [10569914-10569914] |
| edit 1: notice latency (ms) | 513 [504-578] | 542 [519-561] |
| edit 1: blocked frames > 100 ms (ms total, 15 s) | 3057 [3045-3243] | 3054 [2937-3219] |
| edit 1: longest frame gap (ms) | 1980 [1973-2113] | 1980 [1950-2003] |
| edit 1: project-list write after click (ms) | 3049 [3029-3099] | 3105 [3033-3108] |
| edit 1: IndexedDB repack write after click (ms) | 7768 [7698-7843] | 7822 [7778-8024] |
| edit 1: WebContent peak while repacking (MB) | 6781 [6670-6957] | 7036 [6683-7040] |
| edit 2: blocked frames > 100 ms (ms total, 15 s) | 2332 [2231-2347] | 2461 [2273-2887] |
| edit 2: IndexedDB repack write after click (ms) | 7725 [7532-7754] | 7689 [7502-7701] |
| after edits: settled (MB) | 5693 [5548-5994] | 4792 [3521-5230] |
| Save As (s) | 11.0 [10.6-11.0] | 10.3 [10.2-10.5] |
| Save As: WebContent peak (MB) | 9141 [8458-9411] | 5884 [5179-7308] |
| lifetime peak (MB) | 8725 [8396-9569] | 8472 [8439-9234] |
| swap used at start (MB) | 7157.0 [7141.0-7165.0] | 7141.0 [7141.0-7157.0] |
| load average at start | 4.0 [3.7-5.5] | 4.8 [4.8-4.8] |
| fidelity vs Foshay baseline | 3/3 pass | 3/3 pass |

### Reading the results
- The hidden scene mirrors are gone by default (0 chars instead of 10,569,914) and come back with the switch.
- On Foshay the mirrors are **not a measurable cost** in the controlled toggle: open 16.8 vs 17.4 s, blocked time after an edit 3.06 vs 3.05 s, repack write 7.8 vs 7.8 s are all within noise. Step 1 is a hygiene change, not a speed-up.
- The dominant per-edit cost is unchanged: after one edit the main thread is blocked for ~3 s (longest frame gap ~2 s), the project list is written ~3 s later and the full-project IndexedDB repack finishes ~7.8 s later, with WebContent memory peaking ~6.7-7.0 GB while it runs. That work is what the host-mode steps remove.
- Open peak is 8.2-9.6 GB; the 4.5 GB target needs the bounded unzip (step 2).


## Soak test (consecutive openings, every outcome counted)

`soak.py --label step2 --app builds/step2/LayerlingHarness.app --doc work/foshay-source.lyl --runs 50`

A fresh process and WebKit data store per run. Each run waits for the editor (timeout 120 s), records open time, memory and the host's worker
bookkeeping (`window.__workerStats`: blob workers created / alive at once / terminated), and every 10th run (plus the first and last) does a Save As and the
acceptance compare. A run that does not finish is never retried or dropped: the page is probed (`probes/health.js`), the WebContent process is sampled, and the
run is classified as a product stall or a harness/environment failure. A disclosed warm-up launch per freshly built host app comes first (macOS checks a new binary's
first access to ~/Documents, which delayed the open request by seconds and once looked like a stalled opening).

## Worker failure and stall tests

`fault_tests.py --label step2-faults --app ... --doc ... --case throw:1:30 --case error:1:30 --case hang:1:30 --case hang:1:1`

The host app can make the first N blob workers (the unpack phase) throw on creation, report an error, or never answer (`--worker-fault MODE[:EVERY[:LIMIT]]`).
Each case does a Save As and the acceptance compare.

## Chromium probe (browser compatibility on the Ubuntu VM)

`node chromium_probe.mjs --url http://127.0.0.1:3111/ --probe probes/smoke-create.js` runs a probe in headless Chromium over the DevTools protocol;
`--file design.lyl` puts a .lyl into the start page's file input and records open time and browser memory. Serve a static artifact with
`python3 -m http.server` or the regular build with `next start` on a spare port (not the deployed service's port 3100), and stop it afterwards.
Do not leave an old `next start` running while rebuilding: it serves a mixture of old and new chunks.

## Environment record
Every run records macOS version, swap in use, load, free memory and the state of the Parallels VMs (`prlctl list -a`). The Ubuntu development VM runs on the
benchmarked Mac (Parallels, "Development"); with it running the Mac was holding about 7 GB of swap. Benchmark with the VM stopped.

## Host window rules (learned the hard way, 2026-11-18)
- A benchmark run is only valid if the page is **visible**. The probes record `document.visibilityState` at page start in `window.__phase` (`start vis=visible`) and the host logs
  `window[...]: isVisible=... occlusionVisible=... activeSpace=...`. A host window that opens on a macOS Space (desktop) you are not looking at, behind another window, or on a
  sleeping display is "hidden" to WebKit: timers are throttled to one tick a second (and worse), threads run at background priority, and an opening takes 3-6x as long (baseline 77-93 s,
  instead of ~16-28 s). The reference host uses `collectionBehavior = [.moveToActiveSpace, .fullScreenAuxiliary]`, a floating window, an App Nap opt-out, and runs under `caffeinate -dis`.
- Never start the host through `open` for benchmarks: LaunchServices vets a freshly built ad-hoc bundle first (20-148 s). `run_measure.launch()` starts the executable directly.
- Never wait for a timer or task between steps of the code being measured: a hidden page may not deliver one for minutes (the first Step 2 version yielded with `setTimeout(0)` and stalled).
- The soak classifies a run that never becomes ready as a stall with diagnostics; read `diagnosis.page.phase` (in-page timestamps) before calling it a product failure or an environment failure.
- Files that every run writes (Save As outputs) go to `/private/tmp/layerling-harness/` and are deleted after the check; the source document is opened in place, read-only. Backup and antivirus agents otherwise load the Mac and slow the very opening being measured.
- Resume: `soak.py` and `ab.py` write `checkpoint.json` after every run; `touch runs/STOP` stops them cleanly after the current run; the same command resumes.
