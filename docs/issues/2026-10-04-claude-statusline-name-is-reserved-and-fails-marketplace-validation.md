---
id: e6e78dff80031f0d
kind: bug
status: open
title: '`claude-statusline` name is reserved, so `claude plugin validate` fails for the marketplace'
tags:
- claude-statusline
- marketplace
- validation
last_observed: 2026-10-04
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
- `claude-statusline` is not installed in any profile today (`scripts/check-profile-parity.sh`, 2026-10-04), so a rename has no install record to migrate on this machine.

## Options

1. Rename the plugin, for example to `statusline` or `rich-statusline`. Update `marketplace.json`, `plugin.json`, the README table, the CHANGELOG, and every hook or `statusLine` setting that names the old path or name.
2. Keep the name and accept that marketplace validation fails. Validate each plugin directory one at a time instead.

Source for the rule: https://code.claude.com/docs/en/plugins-reference.md, section `name`.
