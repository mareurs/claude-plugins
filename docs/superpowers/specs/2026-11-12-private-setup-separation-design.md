# Separate the maintainer's private setup from the public repo — design

Date: 2026-11-12. Status: draft, awaiting approval. 2026-11-13: D2 changed to local config by maintainer.

## Intent and why

This repository is public. Its live instructions, some shipped plugin code, some shipped skill
text and one live tracker describe the maintainer's private setup: a machine that runs several
Claude Code profiles, and client and employer project names. A person who clones the repo, or
installs a plugin, receives those as if they were facts about their own machine.

The goal is a public tree that reads as a generic project. The private facts stay on the
maintainer's machine. Git history is not rewritten.

## Goals, non-goals, anti-goals

**Goals**
- A clone user's Claude session loads no instruction that describes the maintainer's machine.
- Shipped code works for any profile layout, not only the maintainer's.
- No client, employer or project name appears in live, non-history files.
- The separation survives the next release.

**Non-goals**
- No history rewrite. Dated history stays as it is: plans, specs, issues, archived trackers and
  session logs under `docs/`.
- No removal of the home-directory prefix from recorded transcripts and fixtures (boundary B).
  Exception: a fixture path that contains a client or project name is rewritten.
- No change to how `release.sh` works.

**Anti-goals** (the work fails even if every file is clean)
- A fix that holds only until the next release refresh rewrites private values into a tracked file.
- A deny-list of private strings that is itself committed. That would publish the names.
- A plugin that works only when the user's profile directories are named like the maintainer's.
- A broken release flow on the maintainer's machine.

## Measured state (2026-11-12)

- 267 tracked files match any of: an extra-profile directory name, the maintainer's home path,
  or "this machine".
- 87 files name an extra-profile directory. About half are dated history. The rest are live
  instructions, code and tests.
- Client or project names appear in 16 tracked files. Two of them are shipped skill files and
  one is a shipped hook comment.
- Seven code files hold the profile list or names built in: `scripts/lib-profiles.sh`,
  `buddy/scripts/migrate_global.py` (also feeds `hook_helpers._LEGACY_PROFILES`),
  `statusline/bin/statusline.sh`, `session-bridge/hooks/lib.sh`,
  `legible/scripts/style_probe.py`, `codescout-companion/scripts/rollout-inventory.py`, and
  `buddy/scripts/statusline-composed.sh` (comment only). Two of these lists lack one profile
  that the others have.
- On the maintainer's machine the glob `~/.claude*/plugins/installed_plugins.json` matches
  exactly the managed profiles and nothing else.
- The installed Claude Code binary names `CLAUDE.local.md` as a project instruction file. No
  load test has been run. Neither `.gitignore` nor git tracks that file today.
- No script reads the `version-bump-checklist` tracker. `release.sh` prints a reminder with its
  catalog id. Five live files tell a reader to refresh it: `CLAUDE.md`, `AGENTS.md`,
  `.codescout/memories/development-commands.md`, `scripts/release.sh` and `docs/trackers/INDEX.md`.

## Approaches considered

1. **Layered sweep with a regression guard.** Chosen.
2. One-time sweep, no guard. Cheapest. Breaks at the next release, because the tracker refresh
   writes private values back into a tracked file.
3. Private overlay repo with a filtered public export. Strongest split. It doubles the release
   flow, and the maintainer ruled out history work.

## Decisions

**D1. Approach 1.** Seven ordered steps, one commit each, tests first. The guard (layer 6) is
built first. It fails on the current tree and goes green as the sweep proceeds, which is the
red-then-green order the project requires.

**D2. Profile list comes from local config, not discovery (maintainer's decision).** The list is
not discovered. It lives in a local, untracked file inside `.codescout/`. The repo's `.gitignore`
already ignores everything under `/.codescout/` except `memories/` and `system-prompt.md`, so a
file there stays local with no new ignore rule.
- Shell: `scripts/lib-profiles.sh` reads `PROFILES` from a local env-style file
  `.codescout/private.env` (key `CLAUDE_PROFILES`, colon-separated directory paths). It falls back
  to the single default `$HOME/.claude` when the file is absent.
- Python plugin code reads the same file through a small function with the same default.
- *Designer's call: an env-style file, not `project.toml`, because bash cannot parse TOML cheaply
  and codescout may reject unknown keys in `project.toml` (unverified; the builder must check
  before choosing `project.toml`).*
- Maintainer scripts in `scripts/` read the file. Shipped plugins cannot (see "To verify before
  relying on it"), so they need no list: they derive from the directory name or from
  `$CLAUDE_CONFIG_DIR`.
- `migrate_global` and the two Python inventory scripts (`legible/scripts/style_probe.py`,
  `codescout-companion/scripts/rollout-inventory.py`) default to the `~/.claude*` directories that
  contain a `buddy` directory or a `plugins/installed_plugins.json`, found at run time. This is
  allowed only for shipped code, where a repo file is unreachable.
- The statusline badge is derived from the directory name and needs no list. It has no built-in
  names. Rule: `.claude` shows `claude` on the model background; `.claude-<x>` shows `<x>` on the
  agent background; any other path shows nothing. The badge text of a profile that today shows its
  full directory name changes to the short form.
- `sb_instance` in `session-bridge/hooks/lib.sh` derives its label from the directory name, with
  no list: `main` for `.claude`, `<x>` for `.claude-<x>`. The fallback branch does this already
  when `CLAUDE_CONFIG_DIR` is set.

**D3. Machine facts live in one local source, `.codescout/private-facts.md`, and a script
generates two gitignored files from it (maintainer's decision: one source for Claude Code and
Codex).**
- `CLAUDE.local.md` holds the facts only. Claude Code loads it in addition to `CLAUDE.md`.
- `AGENTS.override.md` holds the text of `AGENTS.md` followed by the facts. A plain symlink is
  not possible: measured 2026-11-13 on Codex 0.167.1, a root with both `AGENTS.md` and
  `AGENTS.override.md` loads only the override. The override replaces `AGENTS.md`.
- A script (`scripts/gen-local-instructions.sh`) writes both files. A test fails when
  `AGENTS.override.md` is older than `AGENTS.md` or the facts file. `release.sh` calls the script.
- Not measured: whether Codex also loads a nested `AGENTS.md` below the root when an override
  exists at the root.

Public docs keep
the generic mechanics (hook load path versus skill load path, cache seeding, the parity gate,
Codex hook approval). They drop "this machine", measured home paths, profile inventories and the
Windows-box section.

**D4. Boundary B.** Profile names, machine facts, and client, employer and project names.

**D5. The `version-bump-checklist` tracker is archived as history, then a local tracker starts.**
The 2000-line file moves to `docs/trackers/archive/` through `doc(move)`. A fresh tracker lives at
a gitignored path and keeps the current augmentation prompt. `release.sh`, `CLAUDE.md`,
`AGENTS.md`, the memory file and `INDEX.md` say "if you keep a release tracker, refresh it" and
carry no id, because catalog ids are machine-local.

**D6. A regression guard with two modes.** Both read strings from an untracked, gitignored
deny-list file, a second local file next to the profile config: `.codescout/private-denylist.txt`.
When the file is absent, as on any clone, both modes skip and say so.
- *Range mode* (in `pre-push-guard.sh`): scans only the lines ADDED in the pushed range, in any
  path, including new specs, plans and session logs. It needs no exemption list and leaves old
  content alone. An intended mention is overridden with an environment variable, as the other
  guards allow.
- *Tree mode* (a test): scans the tracked tree except the history paths (`docs/superpowers/specs`,
  `docs/superpowers/plans`, `docs/issues/archive`, `docs/trackers/archive` and the experiment
  spikes under `effort-steering/spikes`). It is the acceptance check of the sweep.
- The guard exists only in checkouts that hold the deny-list. A second machine has no guard
  unless the maintainer copies the file there. This is accepted and stated in the guard's output.
*Designer's call: range mode replaces a path-based history exemption, which a new session-log
entry could bypass.*

**D7. Definitions (designer's call).** A private name is a client or employer project or
organisation. Public repositories of the maintainer are not private. The deny-list holds only
strings that are unambiguous: the extra-profile directory names and the client and employer
names. It does not hold the short profile labels as plain words, because one of them equals a
public plugin name. The sweep handles labels by hand in live files. The home path is not in
the deny-list (boundary B).

**D8. Order and fallback for `CLAUDE.local.md` (designer's call).** No public fact moves until a
cold restart proves that the file loads. If it does not load, the facts go to the user-level
`CLAUDE.md` files instead.

**D9. Scope additions found by review (designer's call).**
- `docs/augmentations/docs-trackers-version-bump-checklist.yaml` is the sidecar of the tracker.
  It moves with the archive and counts as history. The local tracker has no committed sidecar.
- `harnesses/opencode/tests/test-codescout-companion.mjs`: layer 3 fixture rename.
- `effort-steering/spikes/*`: one-off experiment scripts. They count as dated history and are
  exempt from tree mode.
- `codescout-companion/scripts/rollout-inventory.py` also lists Codex directory variants. A glob on
  `installed_plugins.json` cannot find them. The builder decides how that script finds them.

## Design by layer

### 1. Live instructions
`CLAUDE.md`, `AGENTS.md`, `buddy/CLAUDE.md`, `buddy/README.md`, `.codescout/memories/*`,
`.codescout/system-prompt.md`. Rewrite without machine facts. Move the three machine sections of
`CLAUDE.md` and the one of `AGENTS.md` to `.codescout/private-facts.md`. Keep the Codex behaviour
measurements that hold for any user; move the paths and the install inventory.

### 2. Code with built-in names
The seven files above. Add the config reader for maintainer scripts and the directory-name derivation for shipped code. Replace the badge branches. Tests:
`tests/test-profile-list-single-source.sh` must keep pinning one source in shell. A new test
covers the run-time default of the Python scripts.

### 3. Tests and fixtures
`buddy/tests/test_migrate_global.py`, `buddy/tests/test_hook_helpers.py`,
`tests/test-release-installed-profiles.sh`, `tests/test-pre-push-guard.sh` and
`codescout-companion/hooks/pre-tool-guard.test.sh` use the real names as fixtures. Use generic
fixture names (for example `.claude-alpha`) and add a test with a profile name the code has never
seen.

### 4. Client and project names
- Shipped skill text (`buddy/skills/data-leakage-snow-pheasant/SKILL.md` and `_llm.md`): replace
  the project name with a neutral descriptor. Keep every number and every lesson.
- The hook comment in `codescout-companion/hooks/git-worktree-guard.mjs` and the matching test
  in `tests/test-git-worktree-guard.sh`.
- Fixtures: `codescout-companion/hooks/explore-inject.fixtures.jsonl`,
  `buddy/tests/create-buddy-eval/**`. Rewrite the path segment that names a client.
- Live trackers and memories that name a client project.

### 5. The tracker
Steps: stop the refresh, archive with `doc(move)`, repoint citations of the old path and id in
the same commit, create the local tracker, change the five live files.

### 6. The guard (built first)
As in D6. The deny-list holds exact strings, one per line. The maintainer approves it; the
designer drafts it from the measured hits. The tree-mode test and the range-mode check are written
before any sweep step and fail on the current tree.

## Constraints

- `scripts/pre-push-guard.sh` refuses a push that changes plugin content without a version bump.
  Layers 2 and 4 change shipped content, so the sweep needs releases through `release.sh` for
  each touched plugin. Each release runs the parity gate.
- `cs-hint-codex` keeps a root of five files. Two of them are byte copies of buddy scripts. If
  the sweep touches either copy, run `scripts/sync-cs-hint-codex.sh`, bump, and expect Codex
  users to approve again. The builder must check this before editing buddy scripts.
- Trackers and managed docs change only through the `doc` tool. A move mints a new id.
- Project rule: write the failing test before the fix.

## To verify before relying on it

1. `CLAUDE.local.md` loads in a fresh session in this checkout. Test with one harmless marker
   line and a cold restart. Fallback in D8. The Codex side is measured (D3).
2. The catalog indexes a gitignored tracker path. If it does not, D5 needs a fallback: a local
   file outside the catalog.
3. (Settled; kept as a rule.) A shipped plugin, running from the install cache, must find `.codescout/private.env` of the
   repo. It cannot. So shipped code (statusline, session-bridge, buddy migration) must not need
   the list: derive from the directory name or from `$CLAUDE_CONFIG_DIR`. Only maintainer scripts
   in `scripts/` read the file.
4. How `.codescout/private-memories/` (already gitignored) works, and whether it is a better
   home than `CLAUDE.local.md` for some machine facts.
5. The statusline badge text changes for the maintainer's profiles. Confirm that is acceptable.
6. What `migrate_global` should do when its run-time default finds no profile.

## Left to the builder

The exact neutral wording in the skill examples and comments. The name and location of the
local tracker (the deny-list is fixed by D6). The order of releases. Whether the Python config reader
is one shared module per plugin or inline.
