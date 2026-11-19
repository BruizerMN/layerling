# Step 2 (bounded unzip) results - 2026-11-18

Branch feature/step2-bounded-unzip = 6a646188a (pushed; NOT merged, NOT deployed). Code under test: a853a4059 (artifact sha256 09cebb2bdf1e2c7bb61fd6995787326cd6115c8ac046cd0ecefe22d36381bfab).
Baseline = merged Steps 0+1 behaviour (artifact a829bbbe5). Mac: 2025 MacBook Air, 32 GB, macOS 26.7.3, Parallels VM STOPPED, host window visible on the active Space, runs under caffeinate. Foshay file sha256 cb27f08c...

## Opening Foshay (visible page, VM stopped), 10 interleaved pairs, medians [min-max]
| | Baseline | Step 2 |
|---|---|---|
| open -> ready | 28.1 s [26.9-31.6] | 26.1 s [25.9-26.8] |
| WebContent peak | 9.4 GB [8.9-9.6] | 4.4 GB [4.2-6.5] |
| settled (ready + 4 s) | 3.1 GB [2.6-4.3] | 1.9 GB [1.8-3.0] |
| workers alive at once | 81 | 2 |
Fidelity (Save As + node-by-node + mesh-bytes compare vs Foshay baseline): 3/3 each.

## 50 consecutive opens, Step 2 (runs/step2fix-soak): 50/50 OK
0 stalls, 0 failures, 0 interrupted, 0 worker errors, 0 fallbacks, 2 workers max, all pages visible, Save As fidelity PASS on runs 1,10,20,30,40,50.
open 26.2 s median [21.6-27.2]; peak 4,494 MB median [4,102-6,822] (<=4.5 GB in 28/50, 4.5-5.5 GB in 15, >5.5 GB in 7); settled 2,593 MB median [1,824-3,407] (<=2.5 GB in 19/50, all <=3.5 GB). Load average 1.95-12.1 during the soak.
The peak spikes (5.5-6.8 GB) are in the web app's own repack phase (+21-27 s), not the unpack (3.9-4.5 GB at +6-9 s); host mode removes the repack.

## Worker failure / hang recovery (WKWebView, faults only on the unpack worker)
| case | Step 2 | Baseline |
|---|---|---|
| Worker creation throws | recovered (fallback), open 26.0 s, fidelity PASS | opening never finishes, no message |
| Worker error event | recovered by watchdog after 82 s (fflate ignores Worker error events), open 109.5 s, PASS | (not run) |
| Worker never answers | recovered by watchdog after 82 s, open 108.8 s, PASS | stalls (150 s cap), no fallback |
No workers left alive after any case.

## Round trip
Original -> Save As -> reopen -> Save As: 0 nodes added/removed/changed vs the original, mesh blobs byte-identical, camera view preserved. Two-edit flow: +2 nodes, fidelity PASS in all 4 runs (baseline 2, Step 2 2).
Per-edit costs are unchanged by Step 2 (3.4 s blocked frames, ~7.7 s repack write); peak while repacking after an edit: 7.5 GB baseline vs 4.4 GB Step 2.

## Stalls found and root causes (nothing retried-and-ignored)
1. Stage C cap-8 stall and every "stall after a rebuild": macOS vetting freshly built ad-hoc bundles launched via `open` (20-148 s). Fix: runners exec the binary directly.
2. Soak attempts 12/13 and the hardened-harness stalls: host window on a macOS Space not being viewed -> page hidden -> WebKit throttles timers. Exposed a REAL flaw in the first Step 2 build (setTimeout yield between slices; 92 s tick gap; message-channel yield stalled too). Fixed in a853a4059 (no yielding). Hidden pages are 3-6x slower for BOTH builds (baseline hidden 77-93 s).
3. Open delays under load 5-13 (Spotlight, CrashPlan, Sophos scanning files the harness wrote): environmental; harness now opens the source in place and writes big files to /private/tmp.

## Not covered / limits
Safari.app itself (WKWebView = Safari engine was used; Chrome extension unavailable, headless Chromium on the VM used: baseline background tab 26-27 s / 7.3-7.9 GB, fixed Step 2 24 s / 2.4-2.5 GB, no errors). 32 GB Mac only. Tooling updates made after commit 6a646188a (soak invalid-environment guard, reopen_test.py, KEEP_SAVEAS) are in this folder, not yet in the fork (VM stopped).
