# Version-Bump Checklist Tracker — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create one codescout `tracker` artifact that surfaces release-readiness for `codescout-companion`, `buddy`, `sdd` across `~/.claude`, `~/.claude-sdd`, `~/.claude-kat` in a single render, and wire it into the bump workflow in `CLAUDE.md`.

**Architecture:** Augmented markdown artifact at `docs/trackers/version-bump-checklist.md`. Params hold mechanical state (canonical, readme, marketplace_clean, per-profile {installed, cache_dir_exists, install_path_matches_profile}). Render template projects params into a per-plugin matrix table. Refresh is manual via `artifact(update, commit_refresh=true)`. CLAUDE.md gains a step 6.5 referencing the tracker.

**Tech Stack:** codescout MCP (`artifact`, `artifact_augment`, `librarian`), jq, bash, MiniJinja (render template syntax).

**Spec:** `docs/superpowers/specs/2026-05-18-version-bump-checklist-tracker-design.md`.

---

## File Structure

| Path | Role |
|---|---|
| `docs/trackers/version-bump-checklist.md` | The tracker artifact (created via `artifact(action="create", kind="tracker", augment=...)`). Body holds methodology + history. Render template projects params into the live matrix at read time. |
| `CLAUDE.md` | Add step 6.5 to the "When bumping a plugin version" section, referencing the tracker. |

No source code. No test files (this is a doc/config artifact — verification is "render renders cleanly with current repo state").

---

### Task 1: Gather initial params from filesystem

**Files:**
- Read-only: `<plugin>/.claude-plugin/plugin.json` × 3 plugins
- Read-only: `README.md`
- Read-only: `.claude-plugin/marketplace.json`
- Read-only (outside repo): `$HOME/.claude{,-sdd,-kat}/plugins/installed_plugins.json`
- Read-only (outside repo): `$HOME/.claude{,-sdd,-kat}/plugins/cache/sdd-misc-plugins/`

- [ ] **Step 1: Read canonical versions**

Run:
```bash
for p in codescout-companion buddy sdd; do
  v=$(jq -r .version "$p/.claude-plugin/plugin.json")
  echo "$p $v"
done
```
Expected: three lines `<plugin> <semver>`. Record each version.

- [ ] **Step 2: Read README version table**

Run:
```bash
grep -E '^\| (codescout-companion|buddy|sdd)' README.md
```
Expected: one row per plugin with a version cell. If a plugin is missing, its `readme` field becomes `null`.

- [ ] **Step 3: Check marketplace.json cleanliness**

Run:
```bash
jq '[.. | objects | select(has("version"))] | length' .claude-plugin/marketplace.json
```
Expected: `0`. Any other value means `marketplace_clean: false` and a real bug — stop and fix before continuing.

- [ ] **Step 4: Read each profile's installed versions and installPaths**

Run:
```bash
for prof in .claude .claude-sdd .claude-kat; do
  for plug in codescout-companion buddy sdd; do
    f="$HOME/$prof/plugins/installed_plugins.json"
    [ -f "$f" ] || { echo "$prof $plug ABSENT"; continue; }
    v=$(jq -r ".plugins[\"$plug@sdd-misc-plugins\"][0].version // \"null\"" "$f")
    ip=$(jq -r ".plugins[\"$plug@sdd-misc-plugins\"][0].installPath // \"null\"" "$f")
    case "$ip" in "$HOME/$prof"/*) match=true ;; *) match=false ;; esac
    cache="$HOME/$prof/plugins/cache/sdd-misc-plugins/$plug/$v"
    [ -d "$cache" ] && cd=true || cd=false
    echo "$prof $plug installed=$v installPath_ok=$match cache_dir_exists=$cd"
  done
done
```
Expected: 9 lines. Record each tuple.

- [ ] **Step 5: Read HEAD commit**

Run: `git rev-parse --short HEAD`
Expected: 7-char hex. Record as `last_refresh_commit`.

- [ ] **Step 6: Assemble params JSON**

Build the JSON object matching the schema in the spec. Use the values gathered in steps 1–5. Example skeleton (fill with real values):

```json
{
  "plugins": {
    "codescout-companion": {
      "canonical": "<step1>",
      "readme": "<step2 or null>",
      "marketplace_clean": true,
      "profiles": {
        ".claude":     {"installed": "<step4>", "cache_dir_exists": <step4>, "install_path_matches_profile": <step4>},
        ".claude-sdd": {"installed": "<step4>", "cache_dir_exists": <step4>, "install_path_matches_profile": <step4>},
        ".claude-kat": {"installed": "<step4>", "cache_dir_exists": <step4>, "install_path_matches_profile": <step4>}
      }
    },
    "buddy": { "...repeat shape..." },
    "sdd":   { "...repeat shape..." }
  },
  "last_refresh_commit": "<step5>"
}
```

No commit yet — this is in-memory.

---

### Task 2: Create the tracker artifact

**Files:**
- Create: `docs/trackers/version-bump-checklist.md`

- [ ] **Step 1: Invoke `artifact(action="create", kind="tracker", augment=...)`**

Tool call (single `mcp__codescout__artifact` invocation):

```
action: create
kind: tracker
rel_path: docs/trackers/version-bump-checklist.md
title: Version-bump checklist
body: |
  ## What this tracks

  Release readiness across plugins × profiles. See
  `docs/superpowers/specs/2026-05-18-version-bump-checklist-tracker-design.md`.

  ## History

  _Append dated session deltas: ### YYYY-MM-DD — <what changed>._
augment:
  prompt: |
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
  params: <PASTE PARAMS JSON FROM TASK 1 STEP 6>
  params_schema:
    type: object
    required: [plugins]
    properties:
      plugins:
        type: object
        additionalProperties:
          type: object
          required: [canonical, readme, marketplace_clean, profiles]
          properties:
            canonical: {type: string}
            readme: {type: [string, "null"]}
            marketplace_clean: {type: boolean}
            profiles:
              type: object
              additionalProperties:
                type: object
                required: [installed, cache_dir_exists, install_path_matches_profile]
                properties:
                  installed: {type: [string, "null"]}
                  cache_dir_exists: {type: boolean}
                  install_path_matches_profile: {type: boolean}
      last_refresh_commit: {type: [string, "null"]}
  render_template: |
    _Last refresh: `{{ last_refresh_commit or "—" }}`_

    {% for name, p in plugins|items %}
    **{{ name }}** — canonical `{{ p.canonical }}` · readme `{{ p.readme or "—" }}` · marketplace clean {{ "✅" if p.marketplace_clean else "❌" }}

    | profile | installed | cache dir | install_path ok |
    |---|---|---|---|
    {% for prof, s in p.profiles|items %}| `~/{{ prof }}` | {{ s.installed or "—" }}{% if s.installed == p.canonical %} ✅{% else %} ❌{% endif %} | {{ "✅" if s.cache_dir_exists else "❌" }} | {{ "✅" if s.install_path_matches_profile else "❌" }} |
    {% endfor %}

    {% endfor %}
```

Expected: tool returns an artifact id (e.g. `art_abc123`). Record this id — needed for verification and CLAUDE.md text.

- [ ] **Step 2: Verify file was written to repo**

Run: `ls -la docs/trackers/version-bump-checklist.md`
Expected: file exists, non-zero size.

- [ ] **Step 3: Verify rendered output**

Tool call:
```
artifact(action="get", id="<id from step 1>", full=true)
```
Expected: the response body includes a `## What this tracks` section AND a rendered table block for each of the three plugins, with ✅/❌ marks. If any column shows the literal Jinja syntax (`{{ ... }}`), the render template wasn't applied — investigate before continuing.

- [ ] **Step 4: Confirm matrix matches reality**

Read the rendered tables. Every row should match the values you recorded in Task 1 Step 4. If a row disagrees, the params payload is wrong — re-run `artifact(action="update", patch={"params": <correct>})` before continuing.

---

### Task 3: Wire the tracker into CLAUDE.md

**Files:**
- Modify: `CLAUDE.md` (section `### When bumping a plugin version`)

- [ ] **Step 1: Locate insertion point**

Run: `grep -n "^[0-9]\. " CLAUDE.md | head -20`
Expected: numbered steps under the bump section. Confirm step 6 ("Update `installPath` + `version` in **all three** install records") and step 7 ("Push") are adjacent — step 6.5 goes between them.

- [ ] **Step 2: Insert step 6.5**

Tool call (using `mcp__codescout__edit_markdown`):
```
path: CLAUDE.md
heading: "### When bumping a plugin version"
action: edit
old_string: "7. Push"
new_string: |-
  6.5. Refresh the version-bump-checklist tracker and verify all rows are ✅:
     ```
     artifact(action="update", id=<tracker-id>, commit_refresh=true)
     artifact(action="get", id=<tracker-id>)
     ```
     Any ❌ blocks push. Tracker catches the 2026-05-16 cross-profile `installPath` drift and the missing cache-dir class automatically; passing it makes the `for p in ~/.claude*; do …` sanity loop below redundant (kept as a fallback for non-codescout environments).
  7. Push
```

Replace `<tracker-id>` with the actual id recorded in Task 2 Step 1.

- [ ] **Step 3: Verify the edit**

Run: `grep -n "6.5\|version-bump-checklist" CLAUDE.md`
Expected: matches at the inserted lines. Run `grep -n "^7\. Push" CLAUDE.md` and confirm it still exists (not duplicated, not deleted).

---

### Task 4: Commit and final verification

**Files:**
- Commit: `docs/trackers/version-bump-checklist.md`, `CLAUDE.md`

- [ ] **Step 1: Stage**

Run: `git add docs/trackers/version-bump-checklist.md CLAUDE.md`
Expected: no errors.

- [ ] **Step 2: Inspect diff**

Run: `git diff --cached --stat`
Expected: exactly two files modified/created. No accidental other changes (run `git status` if unsure).

- [ ] **Step 3: Commit**

Run:
```bash
git commit -m "feat(trackers): add version-bump-checklist tracker

Augmented artifact at docs/trackers/version-bump-checklist.md surfaces
release-readiness across 3 plugins × 3 CC profiles. Wired into CLAUDE.md
bump workflow as step 6.5. Catches the missing cache-dir class and the
2026-05-16 cross-profile installPath drift automatically.

Spec: docs/superpowers/specs/2026-05-18-version-bump-checklist-tracker-design.md"
```
Expected: commit succeeds, hash printed.

- [ ] **Step 4: Final smoke test of the refresh loop**

Tool call:
```
artifact(action="get", id="<tracker-id>", full=true)
```
Expected: rendered tables still show today's reality (no drift since Task 1). Every ❌ in the output is a real release blocker that the operator now sees in one query — that's the success condition.

- [ ] **Step 5: Stop here**

No push. User reviews commit before sharing.

---

## Self-Review

**Spec coverage check (against `docs/superpowers/specs/2026-05-18-...`):**
- Purpose §: tracker exists, gathers from listed sources → Tasks 1+2 ✅
- Non-goals §: no pre-commit hook, no CI, no auto-bump → plan has none of these ✅
- Artifact §: kind, path, title, manual refresh → Task 2 Step 1 ✅
- Params shape / schema / render → Task 2 Step 1 (literal copies) ✅
- Gather sources table → Task 1 steps 1–4 cover all five rows ✅
- Prompt block → Task 2 Step 1 literal copy ✅
- Body skeleton → Task 2 Step 1 ✅
- Integration with bump workflow → Task 3 ✅
- Failure modes (`installed: null`, malformed JSON, README reformat) → not separately tested here; documented in spec only. Acceptable: each surfaces as a ❌ or null in the rendered output, which is the spec's stated behavior.

**Placeholder scan:** `<PASTE PARAMS JSON FROM TASK 1 STEP 6>` and `<tracker-id>` in Tasks 2 and 3 are intentional — the engineer fills them with values produced earlier in the plan. Not TODO/TBD/"implement later". `<step1>`/`<step4>` markers in the params skeleton are likewise placeholders the engineer substitutes from Task 1's recorded values. OK.

**Type consistency:** `installed`, `cache_dir_exists`, `install_path_matches_profile`, `canonical`, `readme`, `marketplace_clean`, `last_refresh_commit` — same names appear in spec, params shape, schema, render template, prompt, and Task 1 gathering steps. ✅
