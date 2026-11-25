---
kind: entry
status: open
title: 'Windows work box (another host): Claude Code is uninstalled, the plugins run through Copilot'
created: 2026-11-24
entry_kind: measurement
log:
- '2026-11-24 open created codescout:9b880af2-23db-4b95-9e16-ebb0c6f8d466'
status_since: 2026-11-24
topics:
- machine-windows
---

- **Claude Code CLI was genuinely installed and used here, then uninstalled**
  — it turned out not to be a company-accepted app. `~/.claude` has real usage
  artifacts (`daemon.log`, `sessions/`, `projects/`, `telemetry/`, a populated
  `settings.json` with `enabledPlugins` for `codescout-companion`/`buddy`/
  `sdd`, last touched 2026-06-17) proving it wasn't a dead scaffold — but
  today there is no `claude` binary on PATH, no install under `Program Files`,
  `LOCALAPPDATA\Programs`, or the global npm prefix. **Zero active Claude Code
  profiles exist now — GitHub Copilot Chat in VS Code is the only agent
  surface on this machine.**
- **The plugins are still needed and actively used** — just exclusively
  through Copilot's own loader now (`.copilot/installed-plugins/`, a separate
  install mechanism from Claude Code's cache; see `INSTALL-COPILOT.md`).
  Uninstalling Claude Code did NOT retire `codescout-companion`/`buddy`/`sdd`
  — don't treat "no Claude Code" as "no plugins in use" when reasoning about
  this repo's relevance.
- Of the three Claude Code profile dirs `release.sh` seeds
  (`~/.claude`/`~/.claude-sdd`/`~/.claude-kat`), only `~/.claude` was ever the
  real one in use; `~/.claude-sdd` and `~/.claude-kat` each contain a single
  empty scaffold entry and were never actually used. All three are now
  entirely inert since Claude Code itself is uninstalled — `release.sh`'s
  Claude-Code-side steps (cache-seeding 3 profiles, cold-restarting 3
  instances) are no-ops here; only the Copilot half (`sync-copilot.sh`) has
  any real effect on this box.

**Valid:** dated 2026-08-05
