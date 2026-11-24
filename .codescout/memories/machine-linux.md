# This machine — Linux workstation

## This Machine — Linux workstation (verified 2026-08-26)

**All four Claude Code profiles are live and in use here** — `~/.claude`, `~/.claude-sdd`,
`~/.claude-kat`, `~/.claude-stef`. The list is `PROFILES` in `scripts/lib-profiles.sh`, and each
profile has a `claude-*` alias in `~/.bashrc`. Measured 2026-08-26 (the first three) and
2026-11-12 (all four):

- `claude` is on PATH at `~/.local/bin/claude`. `uname -sr` → `Linux 7.1.9-zen1-2-zen`
  (Arch zen kernel — **not** WSL, which reports `*-microsoft-standard-WSL2`).
- `~/.claude` (657 project dirs), `~/.claude-sdd` (183), `~/.claude-kat` (110),
  `~/.claude-stef` (26) — all four carry real session history, and `.claude-kat` is a routine
  working profile. (The 2026-08-26 counts for the first three were 256, 49 and 18.)
- **`release.sh`'s Claude-Code-side steps are real here, not no-ops.** A release seeds a
  versioned cache in every profile whose install record has the plugin, and repoints that
  record; a profile without the plugin is skipped. The 1.16.17 release did exactly that, for
  the three profiles the scripts covered then.
- **Enabled plugins** (`enabledPlugins` is what actually loads), measured 2026-11-12:
  `superpowers`, `codescout-companion`, `buddy`, `legible` and `hint-echo` in all four profiles.
  `~/.claude-sdd` and `~/.claude-stef` additionally enable `hookify` + `andrej-karpathy-skills` —
  that is profile purpose, not drift. `~/.claude`, `~/.claude-sdd` and `~/.claude-kat` also
  enable `chrome-devtools-mcp`, `document-skills`, `frontend-design` and `claude-md-management`;
  `~/.claude` adds `context7`. A project can enable a plugin too: this repo's
  `.claude/settings.local.json` enables `sdd@sdd-misc-plugins`. Other installed plugins are
  enabled nowhere and load nothing.
- **The marketplace key is `sdd-misc-plugins`** (the `name` in `.claude-plugin/marketplace.json`),
  which is what every install record, `release.sh` and the install lines in § Installing use.
- **Native Linux git. The cross-shell CRLF advice in the Windows section below does not
  apply** — `core.autocrlf` is not in play and the working tree does not go pseudo-dirty.
- **Cross-profile parity is checked, not assumed:** `./scripts/check-profile-parity.sh`
  verifies every *array element* of each record **and** every marketplace registration
  (see its header for the seven drift classes and why `[0]`-only checks missed one).
  `release.sh` runs it at step 6.5 and refuses to push on failure.
- **Our HOOKS load from the REPO WORKING TREE, not from a versioned cache dir.**
  `known_marketplaces.json` records `sdd-misc-plugins` as
  `{"source": "directory", "path": "/home/marius/work/claude/claude-plugins"}` with
  `installLocation` set to that same repo path. Confirmed at runtime, not inferred:
  `.buddy/.session-start-trace.log` shows every hook invocation resolving
  `plugin_root=/home/marius/work/claude/claude-plugins/buddy`, including entries written
  after a release repointed `installPath` at a cache dir. **So a HOOK edit in `buddy/` or
  `codescout-companion/` is live in the working tree immediately.**
  **This holds for hooks and is FALSE for skills and commands** — those are read from
  `installPath`, the versioned cache dir, so a skill edit reaches nobody until a release
  seeds a new cache and repoints the records. Measured 2026-09-01: a skill cut 44,375 →
  13,680 B was still served at its old 44,673 B from
  `…/codescout-companion/1.19.11/skills/reconnaissance/SKILL.md`, exactly where that
  profile's `installPath` points. **So `bump-cache.sh` seeding and the `installPath`
  repointing are the load path for skills and commands, and belt-and-braces only for
  hooks** — and a skill edit is `committed`, not `live`, until a release runs. The editing
  session is the least representative observer of that. What a restart/reload buys you on
  top is *registration* — which hooks, skills and commands exist — resolved at process
  launch. See § *Plugin Install Path* for the per-channel table, and
  `docs/trackers/skill-loading-session-log.md` F-5 for the measurement. Third-party
  github-source marketplaces load everything from `<profile>/plugins/marketplaces/…`.
- **Marketplace registrations drifted for months in two files nothing checked** (fixed
  2026-08-26). `~/.claude-kat/plugins/known_marketplaces.json` pointed five of six
  marketplaces at `~/.claude/plugins/marketplaces/…`, and
  `~/.claude-sdd/plugins/marketplaces/caveman` was a *symlink* into `~/.claude`. The
  pointer was also **hiding** a second fault: kat's own `superpowers` clone had rotted to
  `91cb319` (2026-05-06) while the other two profiles ran `1ab7b8e` (2026-08-12), so
  repointing without refreshing first would have silently downgraded an enabled plugin by
  three months. **Refresh the local copy, then repoint — never the reverse.**

## Codex on this machine (verified 2026-11-09)

- Only `~/.codex` exists. Marketplace `sdd-misc-plugins` is the LOCAL path of this checkout (`[marketplaces.sdd-misc-plugins] source_type = "local"`), so `codex plugin marketplace upgrade` does nothing for it; `codex plugin add <plugin>@sdd-misc-plugins` re-copies a plugin into `~/.codex/plugins/cache/` byte-identical with the working tree.
- Installed and approved: `cs-hint-codex`, `buddy`, `codescout-companion`. `buddy`'s PostToolUse hook is switched off there (`[hooks.state."buddy@sdd-misc-plugins:hooks/hooks.json:post_tool_use:0:0"] enabled = false`) because it would double the advisories.
- Every `codex plugin add` that changes content cancels that plugin's approvals (`trustStatus: modified`, runs fail with `plugin contents changed; hook approval required`; in the one case measured a failing PostToolUse hook did not stop its tool call, PreToolUse guard hooks were not measured). The repair writes the content half of `currentHash` (`declaration/content`) from `hooks/list` into `trusted_content_hash` of each hook-state record. Record, method and backups: codescout memories `codex-hook-content-trust-20261107` and `research/hint-visibility-channels-20261109`, both stored in the sibling `codescout` repo (`/home/marius/work/claude/codescout/.codescout/memories/`), not in this one. Later Codex measurements (stamp hook failure and positional hook keys on 0.167.1, the wake daemon `userAgent` prefix) are in this repo: `research/codex-hook-measurements-20261111`.
- Nothing writes into `~/.codex/plugins/cache/` from this repo's scripts: do not edit files there by hand.

