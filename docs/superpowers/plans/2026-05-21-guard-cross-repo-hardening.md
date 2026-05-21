# Guard Cross-Repo Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `codescout-companion/hooks/pre-tool-guard.sh` path-agnostic — block native Read/Edit/Write/Grep/Glob/Bash everywhere (incl. cross-repo), routing to codescout, exempting only binary images/PDF from native Read.

**Architecture:** Remove every path-based escape (the `is_in_workspace` helper + 6 call sites, the Read-markdown `!=CWD*` exit + skill exemptions, the Bash `cd`-escape, and the per-branch `SOURCE_EXT`-only gates). The guard then decides purely on tool + file type. Add one helper, `is_binary_image`, as the sole native-Read exemption. `enforce` messages already quote the path and name the replacement tool; cross-repo just means the quoted path is absolute (codescout tools accept absolute paths).

**Tech Stack:** Bash (POSIX-ish, `jq` for JSON), the existing `pre-tool-guard.test.sh` harness (sources the hook as a black box, asserts `permissionDecision`).

**Spec:** `docs/superpowers/specs/2026-05-21-guard-cross-repo-hardening-design.md`
**Session log:** `docs/trackers/guard-hardening-session-log.md` (F-1 — the recon correction)

**Working dir:** `/home/marius/work/claude/claude-plugins`. codescout MCP blocks native Bash/Read/Edit on source — implementers use codescout `read_file`/`edit_file`/`run_command` (add `acknowledge_risk=true` when a shell command is gated; never pipe run_command output — query the `@cmd_*` buffer).

**Verified shapes (2026-05-21):**
- The hook is `case "$TOOL_NAME"` with six branches: `Bash` (L57+), `Grep`, `Glob`, `Read` (L180+), `Edit`, `Write`. Every file branch starts with `is_in_workspace "$FILE_PATH" || exit 0`.
- `is_in_workspace()` (L15-22) returns 0 when `WORKSPACE_ROOT` is empty (fail-closed → guard proceeds). So cross-repo *source* reads are already denied by default; the live cross-repo holes are the Read-md `!=CWD*` exit and the Bash `cd`-escape.
- `enforce()` emits `{hookSpecificOutput:{permissionDecision:"deny",permissionDecisionReason:...}}` and `exit 0`; a 3-second dedup file under `/tmp/cs-block-*` suppresses duplicate reasons.
- The test harness `assert` hardcodes `tool_name:"Bash"`. A general helper is needed for other tools. `ACTIVE_CWD=/home/marius/work/claude/code-explorer` (no routing config → `WORKSPACE_ROOT` empty), `SIBLING_CWD=/home/marius/work/claude/claude-plugins`.
- The existing `cd-sibling-*` and `cd-tmp` asserts expect `allow` — they MUST flip to `deny`.

---

### Task 1: Extend the test harness + add failing cases

**Files:**
- Modify: `codescout-companion/hooks/pre-tool-guard.test.sh`

- [ ] **Step 1: Add a general per-tool assert helper**

After the existing `assert()` function (just before the `# --- Cross-repo cd` comment block), insert:

```bash
# General assert: arbitrary tool_name + tool_input JSON.
# Usage: assert_tool <label> <tool_name> <tool_input_json> <expected>
assert_tool() {
    local label="$1" tool="$2" tinput="$3" expected="$4"
    clean
    local input
    input=$(jq -n --arg t "$tool" --arg cwd "$ACTIVE_CWD" --argjson ti "$tinput" \
        '{tool_name:$t, cwd:$cwd, tool_input:$ti}')
    local got
    got=$(verdict "$(echo "$input" | "$HOOK")")
    if [[ "$got" == "$expected" ]]; then
        echo "PASS [$label]"; PASS=$((PASS+1))
    else
        echo "FAIL [$label]: expected=$expected got=$got"
        echo "  tool=$tool input=$tinput"
        FAIL=$((FAIL+1))
    fi
}

# Read/Edit/Write file_path helper.
assert_file() {  # <label> <tool_name> <file_path> <expected>
    assert_tool "$1" "$2" "$(jq -nc --arg p "$3" '{file_path:$p}')" "$4"
}
```

- [ ] **Step 2: Flip the existing Bash cross-repo asserts from allow → deny**

Replace this block:

```bash
# --- Cross-repo cd: should pass through ---
assert "cd-sibling-abs"      "cd $SIBLING_CWD && git status"                        "allow"
assert "cd-sibling-quoted"   "cd \"/home/marius/work/mirela/backend-kotlin\" && git status" "allow"
assert "cd-sibling-tilde"    "cd ~/work/claude/claude-plugins && git log -1"        "allow"
assert "cd-sibling-relative" "cd ../claude-plugins && git status"                   "allow"
assert "cd-tmp"              "cd /tmp && ls"                                        "allow"
```

with:

```bash
# --- Cross-repo cd: hardened — no longer an escape (all Bash → run_command) ---
assert "cd-sibling-abs"      "cd $SIBLING_CWD && git status"                        "deny"
assert "cd-sibling-quoted"   "cd \"/home/marius/work/mirela/backend-kotlin\" && git status" "deny"
assert "cd-sibling-tilde"    "cd ~/work/claude/claude-plugins && git log -1"        "deny"
assert "cd-sibling-relative" "cd ../claude-plugins && git status"                   "deny"
assert "cd-tmp"              "cd /tmp && ls"                                        "deny"
```

- [ ] **Step 3: Add the new hardening cases**

Immediately after the `# --- In-workspace bash` block (after the `grep-on-source` assert), insert:

```bash
# --- Read: path-agnostic, type-gated ---
assert_file "read-xrepo-md"     "Read" "$SIBLING_CWD/buddy/data/gates.md"        "deny"
assert_file "read-skill-md"     "Read" "$ACTIVE_CWD/skills/foo/SKILL.md"         "deny"
assert_file "read-skills-dir"   "Read" "$ACTIVE_CWD/skills/foo/notes.md"         "deny"
assert_file "read-inrepo-md"    "Read" "$ACTIVE_CWD/docs/x.md"                   "deny"
assert_file "read-xrepo-source" "Read" "$SIBLING_CWD/buddy/scripts/statusline.py" "deny"
assert_file "read-json"         "Read" "$ACTIVE_CWD/package.json"               "deny"
assert_file "read-env"          "Read" "$ACTIVE_CWD/.env"                       "deny"
assert_file "read-txt"          "Read" "$ACTIVE_CWD/notes.txt"                  "deny"
assert_file "read-png-allow"    "Read" "$ACTIVE_CWD/diagram.png"               "allow"
assert_file "read-pdf-allow"    "Read" "$ACTIVE_CWD/spec.pdf"                  "allow"

# --- Edit / Write: path-agnostic, all text ---
assert_file "edit-xrepo-source" "Edit"  "$SIBLING_CWD/buddy/scripts/statusline.py" "deny"
assert_file "edit-inrepo-json"  "Edit"  "$ACTIVE_CWD/tsconfig.json"            "deny"
assert_file "write-xrepo-src"   "Write" "$SIBLING_CWD/new_module.py"          "deny"
assert_file "write-inrepo-yaml" "Write" "$ACTIVE_CWD/config.yaml"            "deny"

# --- Grep / Glob: always routed ---
assert_tool "grep-any"  "Grep" '{"pattern":"foo","path":"src","output_mode":"content"}' "deny"
assert_tool "glob-any"  "Glob" '{"pattern":"**/*.py"}'                                  "deny"
```

- [ ] **Step 4: Run the suite to verify the new/flipped cases fail**

Run: `run_command("bash codescout-companion/hooks/pre-tool-guard.test.sh 2>&1", acknowledge_risk=true)`
Expected: FAIL — the flipped `cd-*` cases currently return `allow`; `read-xrepo-md`, `read-skill-md`, `read-json`, `glob-any` etc. currently return `allow`; binary cases already pass. Non-zero exit. (Some new `deny` cases for in-repo source already pass — that's fine; the harness still exits non-zero overall.)

- [ ] **Step 5: Commit**

```bash
git add codescout-companion/hooks/pre-tool-guard.test.sh
git commit -m "$(cat <<'EOF'
test(guard): cross-repo + path-agnostic hardening cases (failing)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Swap the helper + remove the Bash cd-escape

**Files:**
- Modify: `codescout-companion/hooks/pre-tool-guard.sh`

- [ ] **Step 1: Replace `is_in_workspace` with `is_binary_image`**

Read the current helper first (`read_file` lines 14-23, `force=true`) so the `old_string` matches exactly, then `edit_file` to replace:

old_string:
```bash
# --- Helper: check if path is under workspace ---
is_in_workspace() {
  local file_path="$1"
  [ -z "$WORKSPACE_ROOT" ] && return 0
  if [[ "$file_path" != /* ]]; then
    file_path="${CWD}/${file_path}"
  fi
  [[ "$file_path" == "${WORKSPACE_ROOT}"* ]]
}
```

new_string:
```bash
# --- Helper: binary images/PDF are the ONLY native-Read exemption ---
# codescout has no renderer for these, so native Read must pass through.
is_binary_image() {
  echo "$1" | grep -qiE '\.(png|jpg|jpeg|gif|webp|bmp|ico|pdf)$'
}
```

- [ ] **Step 2: Remove the Bash `cd`-escape block**

In the `Bash)` branch, delete the entire effective-cwd computation and its early exit. `read_file` lines 60-87 (`force=true`) to get the exact text, then `edit_file` to remove it.

old_string (the block from the `EFFECTIVE_CWD="$CWD"` line through the prefix-compare exit):
```bash
    EFFECTIVE_CWD="$CWD"
    if [[ "$CMD" =~ ^[[:space:]]*cd[[:space:]]+\"([^\"]+)\" ]] || \
       [[ "$CMD" =~ ^[[:space:]]*cd[[:space:]]+\'([^\']+)\' ]] || \
       [[ "$CMD" =~ ^[[:space:]]*cd[[:space:]]+([^[:space:]\;\&]+) ]]; then
      EFFECTIVE_CWD="${BASH_REMATCH[1]}"
      EFFECTIVE_CWD="${EFFECTIVE_CWD/#\~/$HOME}"
      if [[ "$EFFECTIVE_CWD" != /* ]]; then
        EFFECTIVE_CWD="${CWD}/${EFFECTIVE_CWD}"
      fi
      # Canonicalize so `..` and `.` segments don't string-prefix-match $CWD.
      # `realpath -m` resolves without requiring the path to exist.
      EFFECTIVE_CWD=$(realpath -m "$EFFECTIVE_CWD" 2>/dev/null || echo "$EFFECTIVE_CWD")
    fi
    [[ "$EFFECTIVE_CWD" != "${CWD}"* ]] && exit 0

```

new_string (leave a one-line note; the comment block above it referencing the bug doc can stay or be trimmed — keep it minimal):
```bash
    # Hardened 2026-05-21: no cross-repo cd-escape. All Bash routes to
    # run_command (which sandboxes cwd to the project). Sibling-repo git
    # uses `git -C /abs/path` from the project root — no cd needed.

```

- [ ] **Step 3: Add the cross-repo git note to the Bash enforce message**

In the same `Bash)` branch, the final `enforce "..."` ends with a block about `run_command`. Append one line. `read_file` the enforce reason (around lines 105-119) to get the exact closing text, then `edit_file`:

old_string:
```bash
For any other shell command: run_command(\"COMMAND\") — same execution, with:
- Large output stored in @cmd_* buffers (saves context tokens)
- Buffers queryable: grep PATTERN @cmd_id, tail -20 @cmd_id
- Smart summaries returned inline"
```

new_string:
```bash
For any other shell command: run_command(\"COMMAND\") — same execution, with:
- Large output stored in @cmd_* buffers (saves context tokens)
- Buffers queryable: grep PATTERN @cmd_id, tail -20 @cmd_id
- Smart summaries returned inline

Cross-repo: run_command sandboxes cwd to the project. For a sibling repo's git,
use run_command(\"git -C /abs/path <subcommand>\") from here — no cd needed."
```

- [ ] **Step 4: Run the suite — Bash cases should now pass**

Run: `run_command("bash codescout-companion/hooks/pre-tool-guard.test.sh 2>&1", acknowledge_risk=true)`
Expected: the `cd-*` cases now `deny` (pass). Read/Edit/Write/Grep/Glob cases still FAIL (their branches not yet hardened, and `is_in_workspace` removal will currently break the file — see note). Suite still non-zero. **Do not commit yet** — the file references the now-deleted `is_in_workspace` in the other branches, so they must be fixed in Tasks 3-4 before the suite is green.

> **Note:** Steps 1-2 delete `is_in_workspace`, but Grep/Glob/Read/Edit/Write still call it. Until Tasks 3-4 remove those calls, those branches will error (call to undefined function → non-zero inside `enforce` path or a bash error). This is expected mid-refactor; Tasks 3-4 complete it. Run the full green suite only at Task 4 Step 5.

---

### Task 3: Rewrite the Read branch (path-agnostic, type-dispatched)

**Files:**
- Modify: `codescout-companion/hooks/pre-tool-guard.sh`

- [ ] **Step 1: Replace the Read branch body**

`read_file` the `Read)` branch (lines ~180-247, `force=true`) to capture the exact current text, then `edit_file` to replace from the `is_in_workspace "$FILE_PATH" || exit 0` line through the end of the source-file `enforce "..."` (the line ending `...line ranges only as last resort."`).

Replace the Read branch's logic with:

```bash
    is_binary_image "$FILE_PATH" && exit 0

    # Relative path when under CWD; absolute (cross-repo) otherwise — both work for codescout.
    REL_PATH="$FILE_PATH"
    if [[ "$FILE_PATH" == "$CWD"* ]]; then
      REL_PATH="${FILE_PATH#$CWD/}"
    fi

    if echo "$FILE_PATH" | grep -qiE '\.md$'; then
      enforce "This call is blocked because codescout has heading-aware markdown reading.

File: ${FILE_PATH}

Reading a full markdown file dumps everything into context. read_markdown is size-adaptive (full content for small files, heading map + slice recipe for large):

  read_markdown(\"${REL_PATH}\")                            — adaptive output (start here)
  read_markdown(\"${REL_PATH}\", heading=\"## Section\")      — one section
  read_markdown(\"${REL_PATH}\", headings=[\"## A\", \"## B\"]) — multiple sections
  grep(\"pattern\", path=\"${REL_PATH}\")                     — content search

read_markdown works on absolute cross-repo paths too. Native Read of markdown is blocked regardless of which repo the file lives in."
    fi

    if echo "$FILE_PATH" | grep -qiE "$SOURCE_EXT_PATTERN"; then
      CARGO_HINT=""
      if echo "$FILE_PATH" | grep -q "\.cargo/registry"; then
        CRATE_DIR=$(echo "$FILE_PATH" | grep -oE '.*\.cargo/registry/src/[^/]+/[^/]+' | head -1)
        CRATE_NAME=$(basename "$CRATE_DIR" | sed 's/-[0-9][0-9.]*$//')
        if [ -n "$CRATE_NAME" ] && [ -n "$CRATE_DIR" ]; then
          CARGO_HINT="
NOTE: This file is from crate '${CRATE_NAME}' in ~/.cargo/registry.
Register the crate once, then use symbol tools for all future lookups:

  library(\"${CRATE_DIR}\", name=\"${CRATE_NAME}\")   — register crate (do this once)
  symbols(scope=\"lib:${CRATE_NAME}\")                — browse all symbols
  symbols(\"SYMBOL\", scope=\"lib:${CRATE_NAME}\")   — find a specific symbol
  symbol_at(path, line)                              — jump to definition from usage site
"
        fi
      fi
      enforce "This call is blocked because codescout has a faster path for source files.

File: ${FILE_PATH}
${CARGO_HINT}
Reading a full source file costs thousands of tokens. codescout returns just what you need:

  symbols(\"${REL_PATH}\")                      — overview + line numbers (~50 tokens)
  symbols(name, include_body=true)             — one symbol body, targeted
  read_file(\"${REL_PATH}\", start_line, end_line) — only when symbol tools cannot reach it

Suggested flow: symbols first → symbols(name, include_body=true) for specific code → read_file with an explicit range only as last resort."
    fi

    # Any other text file → read_file (tracked, buffer-aware). Structured hint for json/toml/yaml.
    STRUCT_HINT=""
    if echo "$FILE_PATH" | grep -qiE '\.json$'; then
      STRUCT_HINT="
  read_file(\"${REL_PATH}\", json_path=\"\$.key\")    — extract a JSON subtree"
    elif echo "$FILE_PATH" | grep -qiE '\.(toml|ya?ml)$'; then
      STRUCT_HINT="
  read_file(\"${REL_PATH}\", toml_key=\"section\")     — extract a TOML/YAML section"
    fi
    enforce "This call is blocked because codescout reads files through its tracked, buffer-aware reader.

File: ${FILE_PATH}

  read_file(\"${REL_PATH}\")                      — full content; large output stored as an @file_* buffer${STRUCT_HINT}

read_file works on absolute cross-repo paths. Only binary images/PDF are exempt from this block (codescout has no renderer)."
    ;;
```

- [ ] **Step 2: Run the suite — Read cases should pass**

Run: `run_command("bash codescout-companion/hooks/pre-tool-guard.test.sh 2>&1 | grep -E 'read-' ", acknowledge_risk=true)`

> NOTE: the `| grep` here runs in a real shell via run_command and IS an IL3 concern. Instead run bare and query the buffer:
> `run_command("bash codescout-companion/hooks/pre-tool-guard.test.sh 2>&1", acknowledge_risk=true)` then `grep "read-" @cmd_xxx`.

Expected: all `read-*` cases PASS (`read-png-allow`/`read-pdf-allow` → allow; the rest → deny). Edit/Write/Grep/Glob still fail (Task 4). Do not commit yet.

---

### Task 4: Harden Edit / Write / Grep / Glob branches

**Files:**
- Modify: `codescout-companion/hooks/pre-tool-guard.sh`

- [ ] **Step 1: Edit branch — drop the workspace + source-ext gates, add binary exempt**

The two gate lines are identical in `Edit)` and `Write)`, so `edit_file` needs extra context to target ONE. `read_file` the `Edit)` branch first. Replace including the distinguishing comment + REL_PATH lines that follow (present in both branches) is NOT enough — anchor on the gate lines plus the unique `enforce` opening that follows further down. Simplest reliable approach: do a single `edit_file` whose `old_string` spans from the gate lines through the `Edit)` branch's unique enforce header.

old_string:
```bash
    is_in_workspace "$FILE_PATH" || exit 0
    echo "$FILE_PATH" | grep -qiE "$SOURCE_EXT_PATTERN" || exit 0

    # Extract relative path for the suggestion
    REL_PATH="$FILE_PATH"
    if [[ "$FILE_PATH" == "$CWD"* ]]; then
      REL_PATH="${FILE_PATH#$CWD/}"
    fi

    enforce "This call is blocked because codescout's edit_code is the safer path for structural source edits.
```

new_string:
```bash
    is_binary_image "$FILE_PATH" && exit 0

    # Extract relative path for the suggestion
    REL_PATH="$FILE_PATH"
    if [[ "$FILE_PATH" == "$CWD"* ]]; then
      REL_PATH="${FILE_PATH#$CWD/}"
    fi

    enforce "This call is blocked because codescout's edit_code is the safer path for structural source edits.
```

If the `read_file` shows the comment/REL_PATH block differs from the above, adjust the spanned text to match the actual `Edit)` branch exactly — the point is one unambiguous match ending at the `edit_code` enforce header.

- [ ] **Step 2: Write branch — same, anchored on the create_file header**

Apply the analogous replacement to the `Write)` branch, anchored on its unique `create_file` enforce header:

old_string:
```bash
    is_in_workspace "$FILE_PATH" || exit 0
    echo "$FILE_PATH" | grep -qiE "$SOURCE_EXT_PATTERN" || exit 0

    # Extract relative path for the suggestion
    REL_PATH="$FILE_PATH"
    if [[ "$FILE_PATH" == "$CWD"* ]]; then
      REL_PATH="${FILE_PATH#$CWD/}"
    fi

    enforce "This call is blocked because codescout's create_file is the tracked path for new source files.
```

new_string:
```bash
    is_binary_image "$FILE_PATH" && exit 0

    # Extract relative path for the suggestion
    REL_PATH="$FILE_PATH"
    if [[ "$FILE_PATH" == "$CWD"* ]]; then
      REL_PATH="${FILE_PATH#$CWD/}"
    fi

    enforce "This call is blocked because codescout's create_file is the tracked path for new source files.
```

- [ ] **Step 3: Grep branch — always route**

`read_file` the `Grep)` branch (lines ~120-135). Replace the source-detection gate and workspace check:

old_string:
```bash
    [ "$IS_SOURCE" = "false" ] && exit 0
    is_in_workspace "${PATH_VAL:-$CWD}" || exit 0
```

new_string:
```bash
    : # path-agnostic: every Grep routes to codescout grep/symbols/semantic_search
```

(The `IS_SOURCE` computation lines above can remain — harmless dead vars — or be removed for tidiness. Removing is optional; leaving them is fine. Do NOT remove the `PATTERN`/`GLOB`/`PATH_VAL` extraction lines: the enforce message uses `${PATTERN}`.)

- [ ] **Step 4: Glob branch — always route**

`read_file` the `Glob)` branch (lines ~163-180). Replace its gate:

old_string:
```bash
    echo "$PATTERN" | grep -qiE "$SOURCE_EXT_PATTERN" || exit 0

    BASENAME="${PATTERN##*/}"

    is_in_workspace "${PATTERN}" || exit 0
```

new_string:
```bash
    BASENAME="${PATTERN##*/}"
    # path-agnostic: every Glob routes to codescout tree
```

- [ ] **Step 5: Run the full suite — all green**

Run: `run_command("bash codescout-companion/hooks/pre-tool-guard.test.sh 2>&1", acknowledge_risk=true)`
Expected: `Total: N. Pass: N. Fail: 0.`, exit 0. Confirm no `is_in_workspace` references remain: `run_command("grep -n is_in_workspace codescout-companion/hooks/pre-tool-guard.sh", acknowledge_risk=true)` → no output (the bounded `grep <pat> <file>` LHS is allowed).

- [ ] **Step 6: Commit**

```bash
git add codescout-companion/hooks/pre-tool-guard.sh
git commit -m "$(cat <<'EOF'
feat(guard): path-agnostic block — kill cross-repo Read/Edit/Bash escapes

Remove is_in_workspace + the markdown !=CWD escape, skill-file exemptions,
and the Bash cd-escape. Block native Read/Edit/Write/Grep/Glob/Bash on any
path; Read covers all text (source/md/json/etc), exempting only binary
images/PDF that codescout cannot render. workspace_root no longer relaxes
the guard. Closes the cross-repo holes recorded as F-1.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Full verification + release prep

**Files:** none (verification), then release per root `CLAUDE.md`.

- [ ] **Step 1: Run the whole repo suite**

Run: `run_command("bash tests/run-all.sh 2>&1", acknowledge_risk=true)` → expect all suites green (including the il3 and pre-tool-guard suites). Query the `@cmd_*` buffer for the final summary line rather than piping.

- [ ] **Step 2: Manual cross-repo spot check**

Run (asserts a cross-repo md Read is now denied):

```
run_command("printf '%s' '{\"tool_name\":\"Read\",\"cwd\":\"/home/marius/work/claude/code-explorer\",\"tool_input\":{\"file_path\":\"/home/marius/work/claude/claude-plugins/README.md\"}}' | bash codescout-companion/hooks/pre-tool-guard.sh", acknowledge_risk=true)
```
Expected: JSON with `permissionDecision":"deny"` and a `read_markdown(...)` reason. (Before this change it returned empty = allow.)

- [ ] **Step 3: Update F-1 status in the session log**

`edit_markdown` `docs/trackers/guard-hardening-session-log.md`: set F-1 `**Status:**` to `fixed-verified` and the Index row status to `fixed-verified`. Add a one-line `**Fix idea / Pointer:**` update citing the implementing commit SHA.

- [ ] **Step 4: Release (separate from code tasks)**

Per root `CLAUDE.md`: bump `codescout-companion` (plugin.json + README table), `scripts/check-versions.sh`, `scripts/bump-cache.sh codescout-companion <version>`, update install records in all three profiles, refresh the version-bump-checklist tracker, commit `chore: bump codescout-companion to <version>`, then **cold-restart all three CC instances** (resume reuses the cached hook). This is a release step — do it after Tasks 1-4 are green and reviewed.

- [ ] **Step 5: Report**

Confirm: cross-repo md/source/text Read denied; binary images/PDF allowed; Bash cd-escape closed; Grep/Glob always routed; `workspace_root` no longer relaxes the guard; full suite green.

---

## Notes & Risks

- **Buddy summon follow-on (out of scope).** Once md is blocked path-agnostically, the buddy summon command's instruction to load `SKILL.md` via native `Read` breaks — it must use `read_markdown`. Same for the memory-protocol/gates injection reads. Tracked as a separate buddy-plugin change; do NOT fold it into this codescout-companion plan.
- **Mid-refactor breakage is expected.** Task 2 deletes `is_in_workspace` while Tasks 3-4 still reference it. The suite is only green at Task 4 Step 5. Subagent reviewers should not flag the intermediate red state as a failure.
- **Non-image binaries** (`.zip`, `.so`, `.wasm`) are NOT exempt — they route to `read_file` like any text, which returns bytes/garbage. This matches the approved scope ("exempt images/PDF only"); revisit only if it bites.
- **`workspace_root` parse stays in `detect.py`.** This plan only stops the *guard* from honoring it; `detect.py` may still emit `WORKSPACE_ROOT` for other consumers. No `detect.py` edit is required.
