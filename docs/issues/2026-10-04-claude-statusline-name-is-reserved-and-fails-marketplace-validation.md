---
id: e6e78dff80031f0d
kind: bug
status: fixed
title: '`claude-statusline` name is reserved, so `claude plugin validate` fails for the marketplace'
tags:
- claude-statusline
- marketplace
- validation
fixed_on: 2026-10-24
last_observed: 2026-10-04
release_pending: true
unverified: 'Fix is in the working tree on effort-routing-r1, not committed and not released: no skill or command channel nor install record outside ~/.claude-kat has seen the new name. No automated regression test pins the validate result, because tests/run-all.sh does not call the claude CLI; the check was a manual `claude plugin validate .` run (passed, 2026-10-24).'
---

## Summary

`claude plugin validate` fails for the whole `sdd-misc-plugins` marketplace. The plugin name `claude-statusline` is now reserved, because it starts with `claude-`. Install and load still work: the docs say only `claude plugin validate`, `init` and `tag` check the name.

## Reader and scope

**Reader:** the maintainer of this marketplace who decides whether to rename `claude-statusline`.

**Scope:** the `claude-statusline` entry in `.claude-plugin/marketplace.json` and its directory. This report changes nothing.

## Reproduction

Claude Code 2.1.289, from the codescout checkout:

```sh
claude plugin validate ../claude-plugins
```

Observed output:

```
✘ Found 1 error:

  ❯ plugins[2].name: Plugin name "claude-statusline" is reserved: it passes as one of Anthropic's own. A third party's plugin name cannot start with "claude-", "anthropic-", "anthropics-", or "cc-plugin-", be "claude", "anthropic", "anthropics", "claude-code", or "claude-mods", or put "official" beside "claude" or "anthropic". Name it for what it does.

✘ Validation failed
```

`claude plugin validate ../claude-plugins/legible` passes on the same run, so the failure is specific to this one entry.

## Impact

- Any marketplace-level `claude plugin validate` run fails, so it cannot serve as a gate for the other plugins.
- `claude-statusline` was not installed in any profile when this was filed (`scripts/check-profile-parity.sh`, 2026-10-04). Re-checked 2026-10-24: `~/.claude-kat/plugins/installed_plugins.json` held a record `claude-statusline@sdd-misc-plugins` at 1.2.0, not enabled in `enabledPlugins`. The other three profiles have none.

## Options

1. Rename the plugin, for example to `statusline` or `rich-statusline`. Update `marketplace.json`, `plugin.json`, the README table, the CHANGELOG, and every hook or `statusLine` setting that names the old path or name.
2. Keep the name and accept that marketplace validation fails. Validate each plugin directory one at a time instead.

Source for the rule: https://code.claude.com/docs/en/plugins-reference.md, section `name`.


## Fix

Option 1 taken on 2026-10-24: the plugin is now `statusline`.

- `git mv claude-statusline statusline`, then `claude-statusline` → `statusline` in every live file: `.claude-plugin/marketplace.json`, `README.md`, `buddy/README.md`, `buddy/scripts/statusline-composed.sh` (the sibling-directory lookup and the cache fallback), `buddy/commands/install.md`, the plugin's own `plugin.json`, commands, hook and README, `scripts/bump-cache.sh`, four tests and two docs. Historical specs, plans and trackers keep the old name on purpose.
- `~/.claude-kat`: renamed the install record key to `statusline@sdd-misc-plugins`, moved its cache dir to `cache/sdd-misc-plugins/statusline/1.2.0` and repointed `installPath`. Backup: `installed_plugins.json.bak-statusline-rename-20261024`.
- Evidence: `claude plugin validate .` → `✔ Validation passed`; `tests/test-statusline*.sh` and `tests/test-cs-workspace-marker.sh` pass (29, 6, 11, 10); `scripts/check-versions.sh` and `scripts/check-profile-parity.sh` pass.
- Not done: commit and release. Users who installed `claude-statusline@…` elsewhere must reinstall under the new name.
