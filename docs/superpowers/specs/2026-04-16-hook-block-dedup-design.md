# Design: Hook Block Message Deduplication

**Date:** 2026-04-16  
**Status:** Approved  
**Scope:** `codescout-companion` plugin — `hooks/pre-tool-guard.sh`

## Problem

When Claude makes multiple parallel tool calls that are all blocked by `pre-tool-guard.sh`,
each blocked call runs an independent hook process. Each emits the full block message via
`permissionDecisionReason`. Claude receives N identical messages — one per blocked call —
creating noise and wasting context tokens.

## Solution

Deduplicate inside the `enforce()` helper using `noclobber`-based atomic file creation.
The first blocked call in a window owns the full message. Subsequent calls within the
same window emit a short `"BLOCKED (see previous message)"` reason instead.

## Design

### Mechanism: `noclobber` atomic first-writer

```bash
( set -o noclobber; : > "$dedup_file" ) 2>/dev/null
```

`noclobber` maps to `O_EXCL | O_CREAT` at the OS level — atomic on Linux. Exactly one
concurrent writer succeeds. No race condition.

### Dedup key

`TOOL_NAME + CWD`, hashed to 8 hex chars:

```bash
dedup_key=$(printf '%s\t%s' "$TOOL_NAME" "$CWD" | md5sum | cut -c1-8)
dedup_file="/tmp/cs-block-$dedup_key"
```

Scoped per tool type per project — parallel `Read` + `Bash` blocks each show their own
full message once (different messages, worth showing). Multiple parallel `Read` blocks
show one full + N short.

### Window: 3 seconds

After the first block, cleanup runs in background:

```bash
( sleep 3; rm -f "$dedup_file" ) &
```

3s covers any realistic parallel batch. After expiry, the next violation shows the full
message again.

### Suppressed reason

```
"BLOCKED (see previous message)"
```

Still a hard `deny` — tool does not execute. Claude knows it was blocked but receives
no repeated guidance noise.

## Change

Single function modification in `hooks/pre-tool-guard.sh`. New `enforce()`:

```bash
enforce() {
  local reason="$1"
  local dedup_key
  dedup_key=$(printf '%s\t%s' "$TOOL_NAME" "$CWD" | md5sum | cut -c1-8)
  local dedup_file="/tmp/cs-block-$dedup_key"
  if ! ( set -o noclobber; : > "$dedup_file" ) 2>/dev/null; then
    jq -n '{hookSpecificOutput:{hookEventName:"PreToolUse",
      permissionDecision:"deny",
      permissionDecisionReason:"BLOCKED (see previous message)"}}'
    exit 0
  fi
  ( sleep 3; rm -f "$dedup_file" ) &
  jq -n --arg reason "$reason" '{
    hookSpecificOutput:{
      hookEventName:"PreToolUse",
      permissionDecision:"deny",
      permissionDecisionReason:$reason
    }
  }'
  exit 0
}
```

All existing `enforce "..."` call sites are unchanged — dedup is transparent.

## Properties

| Property | Value |
|----------|-------|
| Atomic | Yes (`O_EXCL`) |
| New deps | None |
| Lines changed | ~12 (inside `enforce()` only) |
| Dedup scope | Per tool type per project |
| Window | 3 seconds |
| Suppressed output | `"BLOCKED (see previous message)"` |
| Files created | `/tmp/cs-block-<8hex>` (auto-cleaned) |

## Out of Scope

- Fix #2 (deferred)
- Dedup across different tool types in same batch (intentionally not deduplicated)
- Persisting dedup state across sessions
