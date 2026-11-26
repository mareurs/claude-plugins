---
kind: entry
status: open
title: 'release.sh updates Claude Code and Copilot but not Codex: a Codex plugin stays on the old version until someone runs codex plugin add by hand'
created: 2026-11-26
entry_kind: bug
log:
- '2026-11-26 open created codescout:ce0a6936-5650-4ce2-bd20-10d01f955692'
status_since: 2026-11-26
---

**What happened:** `scripts/release.sh` seeds the cache and repoints the install record of every Claude Code profile (steps 4 to 6.5) and syncs Copilot (4.5). It has no Codex step. `grep -i codex scripts/release.sh` finds one line, about AGENTS.override.md. On this machine Codex has three plugins from the local marketplace `sdd-misc-plugins` (`cs-hint-codex`, `buddy`, `codescout-companion`; config.toml lines 238-270). Their caches under `~/.codex/plugins/cache/sdd-misc-plugins/` match the repository today (buddy 0.12.5, codescout-companion 1.23.9, cs-hint-codex 0.1.1), and the buddy and codescout-companion directories date from 2026-11-26 10:12, after the releases: someone ran `codex plugin add` by hand. Nothing in the release says that it must be done, or by whom.

**Expected:** the same behavior as Claude Code: a release that bumps a plugin installed in Codex updates the Codex copy, or at least prints the exact command and says which plugins are behind.

**Why it is not a one-liner:** (1) `codex plugin marketplace upgrade` does nothing for a local marketplace, so `codex plugin add <plugin>@sdd-misc-plugins` is the only update (runtime ledger: "Codex on this machine: one ~/.codex, a local marketplace"). (2) Every `add` that changes content cancels that plugin's hook approvals (`trustStatus: modified`, runs fail with `plugin contents changed; hook approval required`); the repair writes `trusted_content_hash` into config.toml, and its record sits in the sibling codescout repo. A script that runs `add` without that step leaves the hooks of `cs-hint-codex` and `codescout-companion` unapproved. (3) `sync-cs-hint-codex.sh` already prints "renew the Codex hook approval (codex plugin add, then /hooks)", so the manual routine exists for one plugin only. (4) `sdd` and `session-bridge` are not installed in Codex here; a step must skip a plugin that Codex does not have, as `repoint-install-records.sh` does (F-15).

**Fix direction:** a release step 4.6, after Copilot: for each plugin named in `[plugins."<name>@sdd-misc-plugins"]` of `~/.codex/config.toml`, compare the version in `~/.codex/plugins/cache/sdd-misc-plugins/<name>/` with plugin.json. Soft-skip without a `codex` binary or without the plugin. Then either run `codex plugin add` and the approval repair, or print the commands and the plugins that are behind. The repair step is the design decision: it writes the user's config.toml. Add the same check to `check-profile-parity.sh` so a stale Codex copy fails the release the way a stale profile does. Test with a fake HOME, as `tests/test-release-installed-profiles.sh` does.
