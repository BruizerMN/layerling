# HundchenLayerling - build, run and update (Ubuntu dev VM)

`HundchenLayerling` = upstream Layerling v1.165.2 (`3767a34d6`) + our large-project patch + these ops files.
Purpose: save and reopen very large, fully editable designs (e.g. the 21,833-part Foshay pedestal) as one `.lyl`.

## Where things live
| Thing | Location | Notes |
|---|---|---|
| GitHub fork | `github.com/BruizerMN/layerling` | `main` mirrors upstream; `HundchenLayerling` = our customizations |
| Upstream | `github.com/henmedia/layerling` | remote name `upstream` |
| **Development checkout (authoritative)** | Ubuntu VM `bill@depot.local`: `~/bin/layerling` | ALL edits, commits, pushes, installs, tests and builds happen here |
| Mac checkout | `~/Documents/GitHub/layerling` | Reference + Claude session start dir ONLY. No npm, builds or tests. `git pull` to read. |
| Node 24 (user-local, sha256-verified) | `~/bin/layerling-node/current` | no system Node/Docker involved |
| Releases (immutable) | `~/bin/layerling-releases/<commit>/` | live one = `current` symlink; each has `RELEASE.txt` |
| Data | `~/layerling-data/codex` | only preview thumbnails; designs live in the browser / your .lyl files |
| Test/build logs | `~/layerling-logs/` | |
| TLS cert | `~/.local/share/layerling/certs/` | signed by the VM dev CA in `~/sceneryhub-dev/ca` (Macs already trust it; read-only use) |

Flow: edit on VM -> commit -> `git push origin HundchenLayerling` (VM has the GitHub identity) -> Mac checkout `git pull` if wanted.

## Runtime (same pattern as the other VM apps)
`https://layerling.local` (mDNS alias, nginx :443, SNI) -> nginx `layerling-dev.conf` -> `127.0.0.1:3100`
* `layerling.service` - systemd **user** unit, Next.js standalone server, `Restart=on-failure`
* `layerling-mdns.service` - user unit publishing `layerling.local` (follows the VM IP)
* Linger is on, nginx is enabled: everything comes up at boot with no login.
* Shared-projects server storage is deliberately OFF (`LAYERLING_SHARED_PROJECTS_DIR` unset): the browser + local files are the only stores.
* Isolation: own port, own units, own cert, one added nginx file. Nothing of TheDepot / AirwaySim / WX Hub is changed.

## Everyday commands (no sudo)
```
systemctl --user status layerling layerling-mdns     # state
systemctl --user restart layerling                    # restart (after switching release)
systemctl --user stop layerling                       # shutdown (nginx then answers 502)
systemctl --user start layerling                      # startup
journalctl --user -u layerling -f                     # logs
```

## Update: new code or new upstream release
1. On the VM: `cd ~/bin/layerling`, make/merge the change, commit.
   * New upstream: `git fetch upstream --tags && git rebase <upstream-tag>` (or merge). Conflict-prone: `lylProject.ts`, `LayerlingEditor.tsx`, `messages.*.ts` (a new message key must exist in every language marked complete - tests enforce it). `main` can be fast-forwarded to upstream separately.
2. Verify:
   ```
   export PATH=$HOME/bin/layerling-node/current/bin:$PATH
   npm ci && npm run typecheck && npm test && npm run perf
   ```
3. `ops/hundchen/build-release.sh` builds `~/bin/layerling-releases/<commit>/` (does not go live).
4. Go live: `ops/hundchen/rollback.sh <commit>` (repoints `current` + restarts).
5. `git push origin HundchenLayerling`.

## Roll back
`ls ~/bin/layerling-releases` then `ops/hundchen/rollback.sh <older-commit>`. Old releases are never modified or auto-deleted.
Live and validated: `9619afebc` (adds automatic undo-history trimming). Earlier: `085e13341` (raw-error logging), `c02970ed4` (first validated patch build).
Full removal of Layerling: `systemctl --user disable --now layerling layerling-mdns`, delete the two unit files in `~/.config/systemd/user/`, then the nginx undo below.

## One-time sudo steps (done by Bill)
See `sudo-steps.md` (copy conf to `sites-available`, symlink into `sites-enabled`, `nginx -t && reload`; undo = remove symlink, test, reload).

## Verified state (2026-11-18)
typecheck clean; 635 files / 5,960 unit tests pass; perf round-trip of 21,833 parts / 15 states (110.8 MiB project.json, 283.7 MiB meshes, 71.9 MiB .lyl) passes in ~95 s; HTTPS from the Mac verified; service restart, rollback script and crash auto-restart verified; other apps unchanged.

## Large-project notes (learned on the Foshay pedestal, 2026-11-18)
* **Limits we raised:** `project.json` 64 -> 256 MiB, archive entries 4096 -> 32768 (`lylProject.ts`). The 512 MiB archive cap and 1 GiB expanded cap are unchanged.
* **Why big designs hit the limit:** each saved undo state repeats every node. Layerling's *Insert design* appends `-insert-<uuid>` to every object ID at every group level, so nested nodes carry long IDs and a state of ~21.8k nodes is ~31-37 MiB of JSON. 8 states = 247.6 MiB (just under the cap); 16 = over.
* **Automatic trim (commit "Trim undo history automatically"):** `.lyl` export retries with fewer undo steps when the package is too big (`saveWithLessHistoryIfNeeded`) and says so ("only the last N of M undo steps were saved"). The design itself is always saved whole. Setting *Saved action history* to **None** in the Export dialog gives a single-state file (~58 MiB project.json, fastest to open).
* **Diagnosis:** a failed export now logs `[layerling] .lyl export failed:` with the raw error in the browser console (the on-screen text is the friendly version).
* **Opening a big file** takes ~10-20 s (unzip + parse of a 50-250 MiB manifest) with no progress indicator - follow-up idea.
* **Verifying a combined file:** compare node by node against the source assemblies after stripping `-insert-<uuid>` and the `state-N/` prefix (type, definition incl. `hole`, group child counts, mesh blobs by sha256). The Foshay check found 21,833/21,833 identical.

## Acceptance results (Foshay pedestal, Chrome on the Mac, app on this VM)
15 assemblies imported (182 top-level objects, 21,833 nodes, tab ~1.5 GB) -> saved as one `.lyl` -> reopened -> counts, placement, groups, cutters and meshes verified identical -> edited copy saved and reopened with the edit present -> default-settings save auto-trimmed to 5 of 9 undo steps and verified. Originals untouched (sha256 verified). Test files: `~/Documents/Foshay-acceptance/` on the Mac (checksums, baseline, read-only golden copy).

## Static frontend artifact (for the HundchenLayerling-macOS app)
`ops/hundchen/build-static.sh [outdir]` builds the **static export** of the current commit into `~/bin/layerling-static/<commit9>/` and packages it as a deterministic `layerling-static-<ver>-<commit9>.tar.gz` with `.sha256`, `SHA256SUMS-files.txt`, `MANIFEST.json` and `build.log`. It never touches the deployed release or the running service. The same commit always gives the same bytes (build id = commit via `generateBuildId`; verified by building twice).
Results of the first verified artifact (`d93a534a4`, sha256 `d3a08457...1a04`) are in its `VERIFICATION.md`. Not published to GitHub Releases without Bill's OK.
