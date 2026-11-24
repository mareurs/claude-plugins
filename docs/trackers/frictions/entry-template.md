---
kind: tracker
status: active
title: "Frictions — entry template and vocabularies"
tags:
  - frictions
  - template
---

# Frictions — entry template and vocabularies

This tracker holds the template of a friction entry and the vocabularies of its fields. The rules and the verbs are in [the frictions ledger](../ledgers/frictions/readme.md).

## Vocabularies

**Kind:** `wrong-guidance` · `misleading-output` · `gate-too-strict` · `gate-too-loose` · `param-confusion` · `missing-capability` · `silent-failure` · `discoverability` · `hint-ineffective` · `latency` · `other`.

**Severity** (anchored on recovery cost, not on volume): `low` — recovers in one call; `med` — needs two or more calls, or routes around the surface; `high` — silent wrong result, lost work, or no recovery.

## Known tags

A tag says where a friction happened. A tag needs no registration: `note --tag <t>` files an entry with any tag of the right shape, lowercase words joined by hyphens. To keep a new tag, add a bullet here.

- `hook` — a hook of codescout-companion or buddy, on any harness
- `mod` — a Claude Code mod, such as `codescout-redirect` or `codescout-display`
- `skill` — the text or the script of a skill
- `harness-script` — a script this repository ships, such as `scripts/release.sh` or a `tests/*.sh`
- `system` — anything outside a plugin: an OS package, the Python environment

## Template for new entries

**Observed:** what happened, in one or two sentences: the surface, the call, the result, and what you expected instead.

**Query:** the script or command that produced each number. An `inbox` entry may leave this label and the next three out. `codescout box frictions admit` refuses until all four are present.

**Window:** the UTC period of the data.

**Corpus:** which rows, and how many. `usage.db` records MCP calls only, so every rate is partial.

**Recovery sample:** at least five rows, and what the next calls were: fixed on the next call, needed two or more calls, routed around, or abandoned. One `- ` line per row, at least five lines:

- row <id>: <what the next calls were>
