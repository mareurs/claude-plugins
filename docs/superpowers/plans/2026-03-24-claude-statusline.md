# claude-statusline Plugin Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a Claude Code plugin that ships an opinionated, color-coded terminal status line.

**Architecture:** Plugin ships `bin/statusline.sh` (source of truth) and a `/setup-statusline` slash command that copies it to `~/.claude/statusline.sh` and configures `settings.json`. No hooks, no skills.

**Tech Stack:** Bash, jq

**Spec:** `docs/superpowers/specs/2026-03-24-claude-statusline-plugin-design.md`

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `claude-statusline/.claude-plugin/plugin.json` | Plugin metadata |
| Create | `claude-statusline/bin/statusline.sh` | Status line script (from `~/.claude/statusline.sh`) |
| Create | `claude-statusline/commands/setup-statusline.md` | Slash command: copy script + configure settings |
| Create | `claude-statusline/README.md` | Install instructions, field reference |
| Modify | `.claude-plugin/marketplace.json` | Add `claude-statusline` entry |
| Modify | `README.md` | Add version table row |
| Create | `tests/test-statusline.sh` | Smoke test |

---

## Chunk 1: Plugin scaffold + script

### Task 1: Create plugin.json

**Files:** Create: `claude-statusline/.claude-plugin/plugin.json`

- [ ] **Step 1: Create directory and plugin.json**

```json
{
  "name": "claude-statusline",
  "description": "Rich, color-coded terminal status line showing model, context %, rate limits, git info, cost, and more.",
  "version": "1.0.0",
  "author": { "name": "Marius" },
  "license": "MIT",
  "keywords": ["statusline", "status", "terminal", "ui"]
}
```

### Task 2: Copy and stamp statusline.sh

**Files:** Create: `claude-statusline/bin/statusline.sh`

- [ ] **Step 1: Copy existing script**

Copy `~/.claude/statusline.sh` to `claude-statusline/bin/statusline.sh`.

- [ ] **Step 2: Add version stamp**

Insert `# claude-statusline v1.0.0` as line 2 (after the shebang).

- [ ] **Step 3: Make executable**

```bash
chmod +x claude-statusline/bin/statusline.sh
```

- [ ] **Step 4: Verify script works**

```bash
echo '{"model":{"display_name":"test-model"},"context_window":{"used_percentage":42},"rate_limits":{"five_hour":{"used_percentage":10},"seven_day":{"used_percentage":5}},"cost":{"total_cost_usd":0.15,"total_duration_ms":30000,"total_lines_added":10,"total_lines_removed":3},"context_window":{"current_usage":{"cache_creation_input_tokens":1500,"cache_read_input_tokens":3000}},"agent":{},"worktree":{}}' | bash claude-statusline/bin/statusline.sh
echo $?
```

Expected: exit 0, non-empty ANSI output.

- [ ] **Step 5: Commit**

```bash
git add claude-statusline/.claude-plugin/plugin.json claude-statusline/bin/statusline.sh
git commit -m "feat: add claude-statusline plugin scaffold and script"
```

---

## Chunk 2: Slash command + README

### Task 3: Create setup-statusline.md

**Files:** Create: `claude-statusline/commands/setup-statusline.md`

- [ ] **Step 1: Write the slash command**

The command is an LLM instruction file. It must tell the agent to:

1. Read `~/.claude/plugins/installed_plugins.json` and extract the `installPath` for `claude-statusline@claude-plugins`
2. Check if `~/.claude/statusline.sh` exists — if yes, warn user and ask before overwriting
3. Copy `<installPath>/bin/statusline.sh` to `~/.claude/statusline.sh` and `chmod +x`
4. Read `~/.claude/settings.json` — if no `statusLine` key, add `"statusLine": { "type": "command", "command": "~/.claude/statusline.sh" }` and write back
5. Tell user to restart Claude Code

### Task 4: Create README.md

**Files:** Create: `claude-statusline/README.md`

- [ ] **Step 1: Write README**

Sections:
- **claude-statusline** — one-line description
- **What it shows** — brief table of all 9 fields
- **Requirements** — `jq` (required), `git` (optional)
- **Installation** — 3 steps: install plugin, run `/setup-statusline`, restart
- **Updating** — run `/setup-statusline` again after plugin updates

- [ ] **Step 2: Commit**

```bash
git add claude-statusline/commands/setup-statusline.md claude-statusline/README.md
git commit -m "feat(claude-statusline): add setup command and README"
```

---

## Chunk 3: Marketplace, repo README, tests

### Task 5: Update marketplace.json

**Files:** Modify: `.claude-plugin/marketplace.json`

- [ ] **Step 1: Add claude-statusline entry**

Add to the `plugins` array (no version field):

```json
{
  "name": "claude-statusline",
  "source": "./claude-statusline",
  "description": "Rich, color-coded terminal status line showing model, context %, rate limits, git info, cost, and more.",
  "author": { "name": "Marius" },
  "license": "MIT",
  "keywords": ["statusline", "status", "terminal", "ui"],
  "category": "ui"
}
```

### Task 6: Update repo README.md version table

**Files:** Modify: `README.md`

- [ ] **Step 1: Add row to Available Plugins table**

Add after the codescout-companion row:

```markdown
| **[claude-statusline](./claude-statusline/)** | 1.0.0 | Rich, color-coded terminal status line: model, context %, rate limits, git info, cost, duration |
```

### Task 7: Add smoke test

**Files:** Create: `tests/test-statusline.sh`

- [ ] **Step 1: Write test**

```bash
#!/bin/bash
source "$(dirname "$0")/lib/fixtures.sh"
begin_suite "statusline"

STATUSLINE="$(dirname "$0")/../claude-statusline/bin/statusline.sh"

# --- Test 1: valid JSON produces output ---
SAMPLE='{"model":{"display_name":"test-model"},"context_window":{"used_percentage":42,"current_usage":{"cache_creation_input_tokens":1500,"cache_read_input_tokens":3000}},"rate_limits":{"five_hour":{"used_percentage":10},"seven_day":{"used_percentage":5}},"cost":{"total_cost_usd":0.15,"total_duration_ms":30000,"total_lines_added":10,"total_lines_removed":3},"agent":{},"worktree":{}}'

OUTPUT=$(echo "$SAMPLE" | bash "$STATUSLINE" 2>/dev/null)
RC=$?
assert_eq "$RC" "0" "valid JSON: exit 0"
[ -n "$OUTPUT" ] && pass "valid JSON: non-empty output" || fail "valid JSON: non-empty output"

# --- Test 2: empty input exits 0 ---
OUTPUT=$(echo '{}' | bash "$STATUSLINE" 2>/dev/null)
RC=$?
assert_eq "$RC" "0" "empty JSON: exit 0"

# --- Test 3: malformed input exits 0 ---
OUTPUT=$(echo 'not json' | bash "$STATUSLINE" 2>/dev/null)
RC=$?
assert_eq "$RC" "0" "malformed input: exit 0"

end_suite
```

- [ ] **Step 2: Make executable**

```bash
chmod +x tests/test-statusline.sh
```

- [ ] **Step 3: Run all tests**

```bash
./tests/run-all.sh
```

Expected: all suites pass including the new statusline suite.

- [ ] **Step 4: Run version check**

```bash
./scripts/check-versions.sh
```

Expected: all versions consistent.

- [ ] **Step 5: Commit**

```bash
git add .claude-plugin/marketplace.json README.md tests/test-statusline.sh
git commit -m "feat(claude-statusline): marketplace, README entry, smoke test"
```

- [ ] **Step 6: Push**

```bash
git push
```
