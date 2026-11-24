# The Windows work box (another host)

## The Windows work box (verified 2026-08-05 — NOT the Linux workstation, see memory `machine-linux`)

> **Scope note, added 2026-08-26.** Everything in this section describes a *different,
> Windows* host. It was written without a machine label, and its claims are false on the
> Linux workstation — it asserts there is no `claude` binary, that "zero active
> Claude Code profiles exist", that `~/.claude-sdd` and `~/.claude-kat` "each contain a
> single empty scaffold entry and were never actually used", and that `release.sh`'s
> profile steps are no-ops. All four are contradicted by direct measurement here. Read it
> as Windows-only history; do not reason about profile state from it.

- **Git Bash is installed**, but not at the usual `C:\Program Files\Git`: it's a
  per-user install at `%LOCALAPPDATA%\Programs\Git\bin\bash.exe` (also
  `...\usr\bin\bash.exe`). The bare `bash` on PATH resolves to Windows' WSL
  launcher stub instead, which fails (`WSL ... Relay ... execvpe failed`) —
  this machine's WSL previously had no Linux distro installed (only a stopped
  `docker-desktop` entry); an Ubuntu distro has since been added. Invoke Git
  Bash by full path, don't rely on bare `bash`/`bash.exe` resolving correctly
  in a plain PowerShell terminal.
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
- **Cross-shell git gotcha**: WSL's git and Git Bash's git can disagree wildly
  on file state for this repo. WSL's git has no `core.autocrlf` set, so it sees
  hundreds of files as "modified" purely from CRLF/LF normalization vs. the
  Windows-native checkout (which has `core.autocrlf=true`) — do NOT run
  `git add`/`git commit` from WSL against this repo; use Git Bash (or native
  PowerShell git) for anything that touches the index, so the working tree
  view matches what's actually committed.
