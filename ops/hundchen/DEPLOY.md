# HundchenLayerling - build and deploy (Ubuntu dev VM only)

Branch `HundchenLayerling` = upstream v1.165.2 (`3767a34d6`) + large-project patch (3 commits). All work happens on the VM, in `~/bin/layerling`.

## Layout
| What | Where |
|---|---|
| Source | `~/bin/layerling` |
| Node 24 (user-local, sha256-verified) | `~/bin/layerling-node/current` |
| Built releases (immutable) | `~/bin/layerling-releases/<commit>/` ; live one = `current` symlink |
| Data (thumbnails) | `~/layerling-data/codex` |
| Logs of test/build runs | `~/layerling-logs/` |
| App | systemd **user** unit `layerling` on `127.0.0.1:3100` |
| Name | `layerling.local` via user unit `layerling-mdns` (avahi alias, same as the other apps) |
| TLS | nginx :443, server_name `layerling.local`, mkcert cert from the VM-local CA |

## Build a release
```
export PATH=$HOME/bin/layerling-node/current/bin:$PATH NEXT_TELEMETRY_DISABLED=1
cd ~/bin/layerling && npm ci && npm run typecheck && npm test && npm run perf
NODE_ENV=production LAYERLING_STANDALONE=true npm run build
```
Then assemble `~/bin/layerling-releases/<commit>/` from `apps/web/.next/standalone`, `.next/static` and `public` exactly as `docker/Dockerfile` does (see the first release for the recipe), and link `apps/web/.codex` to `~/layerling-data/codex`.

## Deploy / roll back (no sudo)
`ops/hundchen/rollback.sh <commit>` repoints `current` and restarts the service. First-time setup: `install-user.sh`, plus the one-time nginx steps in `sudo-steps.md`.

## Merging a new upstream release
`git fetch upstream && git checkout HundchenLayerling && git rebase <upstream tag>` (or merge). Conflict-prone files: `lylProject.ts`, `LayerlingEditor.tsx`, `messages.*.ts` (any new key we add must exist in every language marked complete). Re-run the full suite and perf test before building.

## Does not touch
TheDepot, the other apps, prod keys, existing nginx blocks.
