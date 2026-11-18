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
Last known good (the validated build): `c02970ed4`.
Full removal of Layerling: `systemctl --user disable --now layerling layerling-mdns`, delete the two unit files in `~/.config/systemd/user/`, then the nginx undo below.

## One-time sudo steps (done by Bill)
See `sudo-steps.md` (copy conf to `sites-available`, symlink into `sites-enabled`, `nginx -t && reload`; undo = remove symlink, test, reload).

## Verified state (2026-11-18)
typecheck clean; 635 files / 5,960 unit tests pass; perf round-trip of 21,833 parts / 15 states (110.8 MiB project.json, 283.7 MiB meshes, 71.9 MiB .lyl) passes in ~95 s; HTTPS from the Mac verified; service restart, rollback script and crash auto-restart verified; other apps unchanged.
Real-project (Foshay, in Chrome) acceptance: pending.
