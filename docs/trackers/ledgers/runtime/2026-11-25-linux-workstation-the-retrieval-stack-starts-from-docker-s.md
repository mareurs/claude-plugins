---
kind: entry
status: open
title: 'Linux workstation: the retrieval stack starts from Docker''s restart policy, and a dead sparse container hangs every index build'
created: 2026-11-25
entry_kind: measurement
log:
- '2026-11-25 open created codescout:f28fefc6-99c0-4659-8dd2-25250cd05f33'
status_since: 2026-11-25
---

- **The retrieval stack is three Docker containers** of the compose project `codescout-retrieval`: `codescout-qdrant` (ports 6333 and 6334), `codescout-dense-amd` (48081, dimension 768) and `codescout-sparse-amd` (48084). Every codescout server of every repository on this host shares them.
- **What starts it:** `docker.service` (enabled) and the restart policy `unless-stopped` of each container. No systemd unit runs `docker compose`. The other codescout units (`codescout-gate-ram-pool.service`, the user timer `codescout-gate-ram-evict.timer`, `mcpo-codescout.service`) do not touch the stack. Measured 2026-11-25.
- **A dead sparse container makes every `codescout index` hang and not fail.** The process sleeps with almost no CPU and holds the index lock, and `index(action="status")` reports `running_elsewhere` with a holder pid. The signs: `curl http://127.0.0.1:48084/health` answers 503 `{"error":"unhealthy"}`, and `docker ps` shows `codescout-sparse-amd` as `(unhealthy)`. The dense embedder and qdrant stay healthy, so a check of those two alone misses it. On 2026-11-25 this kept the index 26 commits behind HEAD for hours.
- **Restart:** `docker restart` each container in turn (sparse, dense, qdrant) and wait for `healthy` before the next. The qdrant restart kept all 121 collections, and the stuck index process then exited by itself. Do not run `docker compose down` or `up`: only `codescout-sparse-amd` matches the current compose file by config hash, and the other two carry labels of a compose file that no longer exists.
- **The full runbook and the one-pass check** are in the codescout private memory `local-environment`, § "Retrieval stack on this host", at `~/work/claude/codescout/.codescout/private-memories/local-environment.md`.

**Valid:** conditional — the containers are recreated from a compose file, or the unit set of docker.service changes
