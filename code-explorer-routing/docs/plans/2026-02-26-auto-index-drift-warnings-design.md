# Auto-Reindex + Documentation Drift Warnings

**Date:** 2026-02-26
**Status:** Approved
**Scope:** code-explorer-routing plugin (companion to code-explorer MCP server)

## Problem

1. **Stale semantic index** — Sessions start with an outdated index. `semantic_search`
   returns old results and only warns *after* the search. The agent wastes a tool call
   before learning the index is stale.

2. **Documentation drift** — Code changes significantly but docs, README, CLAUDE.md,
   and code-explorer memories don't get updated. Nobody notices until the docs mislead.

## Design Decisions

### Approach: Hybrid (sqlite3 staleness + guidance-driven drift)

- **Staleness check**: bash hook queries sqlite3 directly (one meta row + git compare).
  Tight coupling to code-explorer's schema is intentional — this plugin is a companion.
- **Auto-reindex**: calls `code-explorer index` CLI binary when stale.
- **Drift warnings**: for users with `drift_detection_enabled`, hook queries `drift_report`
  table and injects warnings into session context.
- **Doc/memory staleness**: hook cross-references high-drift files with known doc locations
  and code-explorer memory topics.

### Why not MCP tools from bash?

SessionStart hooks are bash scripts. They cannot call MCP tools (`index_status`,
`check_drift`). The alternatives were:

- **Guidance-only** (tell agent to call tools) — unreliable, agent might skip it
- **CLI with --json** — clean but requires code-explorer changes
- **sqlite3 direct** — tight coupling, but this plugin IS a companion. Ships now.

### Why not agent-driven reindexing?

Reindexing before the agent starts thinking ensures every tool call in the session
uses fresh data. Agent-driven reindexing would mean the first `semantic_search` or
`find_symbol` call might use stale data.

### Concurrency (multiple sessions)

- sqlite3 reads are safe under WAL mode (concurrent readers OK)
- If two sessions both detect stale and both call `code-explorer index`:
  that's fine — `build_index` is idempotent, second run finds nothing changed
- After index completes, `last_indexed_commit` is updated, so late-starting
  sessions see fresh state and skip

## Architecture

### SessionStart hook flow (extended)

```
session-start.sh:
  1. detect-tools.sh               (existing — find code-explorer)
  2. Onboarding check              (existing)
  3. Memory hints                   (existing)
  4. Guidance injection             (existing)
  ─── NEW ───
  5. STALENESS CHECK
     a. DB_PATH = $CWD/.code-explorer/embeddings.db
     b. If DB doesn't exist → skip (not indexed yet)
     c. sqlite3: SELECT value FROM meta WHERE key='last_indexed_commit'
     d. git -C $CWD rev-parse HEAD
     e. Compare → if same, skip (index is fresh)

  6. AUTO-REINDEX (if stale)
     a. Resolve CE binary from MCP config (command field)
     b. Run: $CE_BINARY index --project $CWD
     c. On success: inject "Index refreshed (was behind HEAD)"
     d. On failure: inject "Index refresh failed, results may be stale"

  7. DRIFT WARNINGS (if drift_detection_enabled in project.toml)
     a. sqlite3: SELECT file_path, max_drift, avg_drift
                 FROM drift_report
                 WHERE max_drift > 0.1
                 ORDER BY max_drift DESC LIMIT 10
     b. If results: inject "High-drift files since last index: [list]"
     c. Cross-reference with docs:
        - docs/, README.md, CLAUDE.md → "Check if docs still match"
        - .code-explorer/memories/ → "Memory 'X' may be outdated"

  8. Append to session context message
```

### Finding the code-explorer binary

detect-tools.sh already parses `.mcp.json` / `.claude.json` / `settings.json` to find
the server name. Extend it to also extract the `command` field:

```bash
# From .mcp.json or .claude.json:
CE_BINARY=$(jq -r ".mcpServers[\"$CE_SERVER_NAME\"].command" "$_cfg")
```

This gives us the full path to the binary (e.g., `/home/user/.cargo/bin/code-explorer`
or a debug build path).

### Drift-to-docs mapping

Simple heuristic — no fancy analysis needed:

1. If any file under `src/tools/` drifted → flag `docs/manual/src/tools/`
2. If any file under `src/` drifted → flag `CLAUDE.md`, `README.md`
3. If `project.toml` or config files drifted → flag memory files
4. Always list the top-N high-drift files for the agent to reason about

The agent is better at nuanced doc mapping. The hook just surfaces the signal.

### Config

In `.claude/code-explorer-routing.json`:

```json
{
  "server_name": "code-explorer",
  "workspace_root": "~/work",
  "block_reads": true,
  "auto_index": true,
  "drift_warnings": true
}
```

- `auto_index` (default: true) — check staleness and reindex at session start
- `drift_warnings` (default: true) — query drift_report and inject warnings
  (no-op if drift_detection_enabled is false in project.toml)

### Schema dependencies (code-explorer internals)

| Table/Column | Used for | Stability |
|---|---|---|
| `meta` WHERE key='last_indexed_commit' | Staleness check | Stable — fundamental to incremental indexing |
| `meta` WHERE key='embed_model' | (not used by hook) | — |
| `drift_report.file_path, max_drift, avg_drift` | Drift warnings | Stable — dedicated table for this purpose |
| `.code-explorer/project.toml` [embeddings] drift_detection_enabled | Gate drift queries | Stable — config flag |

### SubagentStart hook

No changes needed. Subagents inherit the session context from the main agent,
which already includes staleness/drift warnings.

### PreToolUse hook

No changes needed. The existing tool router already handles Read/Grep/Glob blocking.

## Example session context output

### Fresh index, no drift:
```
CODE-EXPLORER MEMORIES: architecture conventions
→ Read relevant memories before exploring code

[guidance.txt content]

NEVER USE BASH AGENTS FOR CODE WORK.
```

### Stale index, reindexed with drift:
```
CODE-EXPLORER MEMORIES: architecture conventions
→ Read relevant memories before exploring code

[guidance.txt content]

INDEX: Refreshed (was 7 commits behind HEAD).

DRIFT WARNING: These files changed significantly since last index:
  src/server.rs          (drift: 0.82)
  src/tools/semantic.rs  (drift: 0.65)
  src/embed/index.rs     (drift: 0.41)
→ Check if docs/ and CLAUDE.md still match these changes.
→ Memory 'architecture' may need updating.

NEVER USE BASH AGENTS FOR CODE WORK.
```

### Stale index, no drift detection:
```
INDEX: Refreshed (was 3 commits behind HEAD).
```

## Implementation tasks

1. **Extend detect-tools.sh** — extract CE_BINARY path from MCP config
2. **Add staleness check to session-start.sh** — sqlite3 + git compare
3. **Add auto-reindex to session-start.sh** — call CE_BINARY index
4. **Add drift query to session-start.sh** — sqlite3 drift_report + project.toml check
5. **Add drift-to-docs heuristic** — cross-reference drift files with doc locations
6. **Add config fields** — auto_index, drift_warnings in routing config
7. **Update guidance.txt** — mention that index freshness is handled automatically
8. **Test** — verify hook behavior with fresh/stale/no-index scenarios

## Future considerations

- **PostToolUse hook on Edit/Write** — trigger incremental reindex mid-session
  after the agent edits source files. Deferred: adds latency after every edit.
- **`code-explorer status --json`** — if code-explorer adds structured CLI output,
  switch from sqlite3 to that. Cleaner, but not blocking.
- **Layer 1 auto-index via git post-commit hook** — code-explorer's roadmap includes
  this. Once available, the SessionStart hook rarely finds a stale index.
