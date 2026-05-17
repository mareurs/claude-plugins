# Design: `version-bump-checklist` Tracker

**Date:** 2026-05-18
**Status:** approved (brainstorm)
**Owner:** @mareurs

## Purpose

Surface release-readiness for every plugin in this marketplace across all three local Claude Code profiles (`~/.claude`, `~/.claude-sdd`, `~/.claude-kat`) in a single artifact. Catch the two known drift classes documented in `CLAUDE.md`:

1. **Missing cache directory** — `installed_plugins.json` claims a version whose `cache/sdd-misc-plugins/<plugin>/<version>/` folder does not exist on disk. CLAUDE.md calls this the #1 cause of "plugin appears installed but hook never fires."
2. **Cross-profile `installPath` drift** — noted 2026-05-16: `~/.claude-kat/`'s install record pointed at a path under `~/.claude/`. Each profile's record should point inside its own root.

Today a bump requires running `scripts/check-versions.sh` plus a bash loop over three profiles plus manual inspection. The tracker collapses this into one query.

## Non-goals

- Not a pre-commit hook — refresh is intentional, manual.
- Not a remote/CI status board — local profiles only.
- Does not perform the bump. Only reports state.

## Artifact

| field | value |
|---|---|
| kind | `tracker` |
| path | `docs/trackers/version-bump-checklist.md` |
| title | "Version-bump checklist" |
| refresh cadence | manual (no stale window) |

### Params shape

```json
{
  "plugins": {
    "codescout-companion": {
      "canonical": "0.3.1",
      "readme": "0.3.1",
      "marketplace_clean": true,
      "profiles": {
        ".claude":     {"installed": "0.3.1", "cache_dir_exists": true,  "install_path_matches_profile": true},
        ".claude-sdd": {"installed": "0.3.0", "cache_dir_exists": true,  "install_path_matches_profile": true},
        ".claude-kat": {"installed": "0.3.1", "cache_dir_exists": false, "install_path_matches_profile": true}
      }
    },
    "buddy": { "...same shape..." },
    "sdd":   { "...same shape..." }
  },
  "last_refresh_commit": "abc1234"
}
```

### Params schema

```json
{
  "type": "object",
  "required": ["plugins"],
  "properties": {
    "plugins": {
      "type": "object",
      "additionalProperties": {
        "type": "object",
        "required": ["canonical", "readme", "marketplace_clean", "profiles"],
        "properties": {
          "canonical": {"type": "string"},
          "readme":    {"type": ["string", "null"]},
          "marketplace_clean": {"type": "boolean"},
          "profiles": {
            "type": "object",
            "additionalProperties": {
              "type": "object",
              "required": ["installed", "cache_dir_exists", "install_path_matches_profile"],
              "properties": {
                "installed":                     {"type": ["string", "null"]},
                "cache_dir_exists":              {"type": "boolean"},
                "install_path_matches_profile":  {"type": "boolean"}
              }
            }
          }
        }
      }
    },
    "last_refresh_commit": {"type": ["string", "null"]}
  }
}
```

### Render template (MiniJinja)

```jinja
_Last refresh: `{{ last_refresh_commit or "—" }}`_

{% for name, p in plugins|items %}
**{{ name }}** — canonical `{{ p.canonical }}` · readme `{{ p.readme or "—" }}` · marketplace clean {{ "✅" if p.marketplace_clean else "❌" }}

| profile | installed | cache dir | install_path ok |
|---|---|---|---|
{% for prof, s in p.profiles|items %}| `~/{{ prof }}` | {{ s.installed or "—" }}{% if s.installed == p.canonical %} ✅{% else %} ❌{% endif %} | {{ "✅" if s.cache_dir_exists else "❌" }} | {{ "✅" if s.install_path_matches_profile else "❌" }} |
{% endfor %}

{% endfor %}
```

### Gather sources

Per refresh the augmentation reads:

| source | type | yields |
|---|---|---|
| `<plugin>/.claude-plugin/plugin.json` | file (JSON) | `canonical` |
| `README.md` | file (markdown table) | `readme` |
| `.claude-plugin/marketplace.json` | file (JSON) | `marketplace_clean` (jq: no `version` key anywhere in tree) |
| `~/.claude{,-sdd,-kat}/plugins/installed_plugins.json` | file (JSON, outside repo) | `installed`, `install_path_matches_profile` |
| `ls ~/.claude{,-sdd,-kat}/plugins/cache/sdd-misc-plugins/<plugin>/<version>/` | shell | `cache_dir_exists` |

Two of these (`installed_plugins.json`, the cache `ls`) reach outside the repo root into `$HOME`. That is intentional — the drift classes the tracker exists to catch live in those paths. The prompt instructs the refresher to use absolute `$HOME` paths.

### Prompt

```
Maintain release-readiness matrix for codescout-companion, buddy, sdd across the three local CC profiles (~/.claude, ~/.claude-sdd, ~/.claude-kat).

For each plugin:
- canonical: read <plugin>/.claude-plugin/plugin.json :: .version
- readme: parse the version table in README.md; null if plugin not listed
- marketplace_clean: true iff `.claude-plugin/marketplace.json` contains zero `version` fields anywhere in the tree

For each (plugin, profile):
- installed: $HOME/<profile>/plugins/installed_plugins.json :: .plugins["<plugin>@sdd-misc-plugins"][0].version (null if absent)
- install_path_matches_profile: that record's installPath starts with $HOME/<profile>/ (catches the 2026-05-16 cross-profile drift class)
- cache_dir_exists: directory $HOME/<profile>/plugins/cache/sdd-misc-plugins/<plugin>/<installed>/ exists on disk (catches the missing-cache class — #1 cause of "plugin appears installed but hook never fires")

Set last_refresh_commit to current HEAD.

Params are strictly mechanical. Body holds only narrative deltas between refreshes — no commentary on green state.
```

### Body skeleton

```markdown
## What this tracks

Release readiness across plugins × profiles. See `docs/superpowers/specs/2026-05-18-version-bump-checklist-tracker-design.md`.

## History

_Append dated session deltas: ### YYYY-MM-DD — <what changed>._
```

## Integration with bump workflow

Insert step 6.5 into `CLAUDE.md` "When bumping a plugin version":

> **6.5.** Refresh the version-bump-checklist tracker and verify all rows green:
> ```
> artifact(action="update", id=<tracker-id>, commit_refresh=true)
> artifact(action="get", id=<tracker-id>)
> ```
> Any ❌ blocks push. The tracker catches the 2026-05-16 cross-profile `installPath` drift and the missing cache-dir class automatically; passing it makes the manual `for p in ~/.claude*; do …` sanity loop redundant.

The existing sanity loop stays in CLAUDE.md as a fallback for environments without codescout MCP available.

## Failure modes

| mode | behavior |
|---|---|
| profile missing entirely (e.g. user removed `~/.claude-sdd`) | profile sub-object marks `installed: null`, others false. Row renders as all ❌ — operator sees and decides whether to drop the profile from the spec. |
| `installed_plugins.json` malformed | refresh errors; previous params retained; user re-runs after fixing. |
| README version table reformatted | `readme` becomes `null`; canonical/profile rows still meaningful. Update the prompt's parse hint if format changes. |

## Open questions

None at brainstorm gate. All defaults confirmed by user 2026-05-18.

## Next step

`writing-plans` to produce the implementation plan: tracker creation call, CLAUDE.md edit, first refresh, verification that all rows render correctly against current repo state.
