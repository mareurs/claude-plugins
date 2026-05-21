# Guard Cross-Repo Hardening — Design

**Date:** 2026-05-21
**Component:** `codescout-companion/hooks/pre-tool-guard.sh` (+ `pre-tool-guard.test.sh`)
**Status:** approved, pending implementation
**Session log:** `docs/trackers/guard-hardening-session-log.md` (F-1)

## Problem

`pre-tool-guard.sh` is meant to route native file/shell tools through codescout
equivalents. But it has out-of-project escape hatches: native `Read`/`Edit`/etc.
on files in a *different* repo (or, for markdown, any path outside the session
CWD) pass through unguarded. Since codescout tools accept absolute paths and
reach cross-repo files (verified: `read_markdown` on an out-of-project absolute
path returns content while the active project is elsewhere), the escape buys
nothing but lost discipline — token-bloated raw reads, LSP-unaware edits.

The goal: make the guard **path-agnostic** and adopt a **most-restrictive
baseline** (relax later if friction surfaces). Block native Read/Edit/Write/
Grep/Glob/Bash everywhere, routing to codescout, with a *smart* message that
quotes a working codescout call for the exact (absolute or relative) path.

## Reconnaissance correction (F-1)

The naive plan was "remove `is_in_workspace` and the escape closes." The scout
of the actual code found this is wrong:

- `is_in_workspace()` **fails closed** when `WORKSPACE_ROOT` is empty (the
  default — no `.claude/codescout-companion.json` sets `workspace_root`).
  Empty `WORKSPACE_ROOT` → returns 0 (treated in-workspace) → guard proceeds.
  So cross-repo *source* Read/Edit/Grep/Glob/Write is **already blocked** by
  default.
- The real cross-repo escapes are two narrow, separate code paths:
  1. The Read **markdown** branch: `[[ "$FILE_PATH" != "${CWD}"* ]] && exit 0`
     (plus `skills/` and `SKILL.md` exemptions).
  2. The Bash branch: the EFFECTIVE_CWD `cd`-escape
     `[[ "$EFFECTIVE_CWD" != "${CWD}"* ]] && exit 0`.
- There are **six** guarded branches, not five — `Write` mirrors `Edit`.
- `is_in_workspace` only *opens* an escape when a project explicitly sets
  `workspace_root` to a sub-tree (deliberate scoping knob).

Implementing from the naive model would have left the md + Bash holes open
while over-blocking `workspace_root`-configured projects.

## Design

### Core model: path-agnostic, type-gated

Remove every path-based escape:

| Removed | Effect |
|---|---|
| `is_in_workspace()` helper + all 6 call sites | `workspace_root` no longer relaxes the guard; every path is in scope |
| Read-md `[[ "$FILE_PATH" != "${CWD}"* ]] && exit 0` | cross-repo markdown now blocked |
| Read-md `skills/` + `SKILL.md` exemptions | even `SKILL.md` routes to `read_markdown` |
| Bash EFFECTIVE_CWD `cd`-escape | cross-repo `cd` no longer escapes; all Bash → `run_command` |
| per-branch `grep SOURCE_EXT \|\| exit 0` gates (Read/Edit/Write) | now cover **all text files**, not just source ext |

The guard now decides purely on **tool + file type**, never on path.

`workspace_root` config key is no longer read for guard relaxation. (It may
remain parsed by `detect.py` for other consumers; this design only stops the
guard from honoring it. Leaving the parse in place avoids touching `detect.py`.)

### New helper: binary exemption

```bash
# The ONLY native-Read exemption: codescout cannot render binaries.
is_binary_image() {
  echo "$1" | grep -qiE '\.(png|jpg|jpeg|gif|webp|bmp|ico|pdf)$'
}
```

### Read branch — dispatch by extension

1. `is_binary_image "$FILE_PATH"` → `exit 0` (allow native; codescout has no renderer).
2. `.md` → `read_markdown("<path>")` message (+ `heading=`/`headings=` hints).
3. source ext (`SOURCE_EXT_PATTERN`) → `symbols("<path>")` → `symbols(name, include_body=true)` → `read_file(force, range)` (keep the existing `~/.cargo/registry` library hint).
4. any other text → `read_file("<path>")`, plus a `json_path=`/`toml_key=` hint when the extension is `json`/`toml`/`yaml`/`yml`.

`<path>` is **absolute when cross-repo, relative when under CWD** — the existing
`REL_PATH` relativization (only when `$FILE_PATH == $CWD*`) already produces this;
keep it. The point is the quoted call always works for the real path.

### Edit / Write branches

Drop `is_in_workspace` and the `SOURCE_EXT`-only gate. Now any text file:

- Edit → `edit_code` (structural) / `edit_file` (text/imports/config) message.
- Write → `create_file` message.
- `is_binary_image` → `exit 0` (harmless; editing/writing binaries via these tools is not a real flow, but keeps the exemption uniform).

### Grep / Glob branches

Drop `is_in_workspace` and the source-type gate — route **always**:

- Grep → codescout `grep(pattern, path)` / `symbols` / `semantic_search`.
- Glob → codescout `tree(glob=...)`.

### Bash branch

Remove the EFFECTIVE_CWD `cd`-escape block entirely. All Bash → `run_command`
(existing per-pattern hints retained). For cross-repo work, the message gains
one line: sibling-repo git uses `run_command("git -C /abs/path …")` from the
project root — `run_command` sandboxes cwd to the project, but `git -C` needs
no `cd`.

## Smart message principle

Every `enforce` reason already (a) names the exact replacement tool and
(b) quotes the path. The only change is that the path is now correct for
cross-repo (absolute) targets, so the redirect is copy-pasteable regardless of
which repo the file lives in. No new message infrastructure.

## Downstream consequence (out of scope for this change)

The buddy **summon** command (`buddy/commands` / skill instructions) tells the
model to load a specialist's `SKILL.md` via the native `Read` tool. Once md is
blocked path-agnostically, that instruction must change to `read_markdown`.
This is a buddy-plugin edit, tracked separately — flagged here so it is not
forgotten. Same applies to the memory-protocol/gates injection reads in the
summon flow.

## Testing

`pre-tool-guard.test.sh` exists; extend it (TDD — add failing cases first):

- cross-repo `.md` Read → **deny** (was allow)
- `SKILL.md` and `skills/*.md` Read → **deny** (exemption gone)
- cross-repo source Read → deny (regression guard — already denied today)
- in-repo `package.json`, `.env`, `.txt` Read → **deny** (new text coverage)
- `*.png`, `*.pdf` Read → **allow** (binary exemption)
- cross-repo Bash `cd /other && cmd` → **deny** (cd-escape gone)
- `workspace_root`-configured project, path outside the subtree → **deny** (knob no longer relaxes)
- Edit and Write on cross-repo + non-source text → **deny**

All existing passing cases (in-repo source Read deny, run_command buffer
allows, etc.) must stay green.

## Rollout

Code-only change to one plugin. After tests pass: bump `codescout-companion`
per the root `CLAUDE.md` release procedure (plugin.json + README + check-versions
+ bump-cache + install records ×3 + tracker refresh + cold restart). The buddy
summon-command follow-on is a separate change/version.
