#!/bin/bash
# codescout-companion/hooks/explore-inject.sh
# PreToolUse hook on Agent — explore/foreign-project bootstrap injector.
#
# When a subagent dispatch's prompt names an absolute path that resolves into a
# DIFFERENT git repo than the session cwd, prepend a compact bootstrap directive
# (foreign CLAUDE.md + memories + codescout-pinned tools) to the dispatch prompt
# via hookSpecificOutput.updatedInput.prompt. Otherwise: no-op (exit 0, no output).
#
# Contract, eval (199/2501 = 7%), and the two known imperfections live in
# docs/plans/2026-06-13-explore-bootstrap-injector-design.md.
# Detector: foreign iff repo_id(path) exists and != repo_id(cwd); repo_id uses
# git-common-dir so worktrees of the same repo fold to one identity.
#
# Sourced by explore-inject.test.sh as a black box (functions only — main() runs
# only on direct execution). Set CS_EXPLORE_INJECT_FORCE=1 to bypass the
# codescout gate (test seam).

MARKER="[[cs-explore-bootstrap]]"

# repo_id <path> -> absolute git-common-dir of the repo containing <path>, else empty.
repo_id() {
  local p="$1" d g
  case "$p" in "~/"*) p="$HOME/${p#\~/}";; "~") p="$HOME";; esac
  if [ -d "$p" ]; then d="$p"; else d="${p%/*}"; fi
  while [ -n "$d" ] && [ "$d" != "/" ] && [ ! -d "$d" ]; do d="${d%/*}"; done
  [ -d "$d" ] || return 0
  g=$(git -C "$d" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)
  [ -n "$g" ] || return 0
  realpath "$g" 2>/dev/null || printf '%s' "$g"
}

# is_foreign <cwd> <path> -> exit 0 if <path> is a git repo different from cwd's.
is_foreign() {
  local cr pr
  cr=$(repo_id "$1")
  pr=$(repo_id "$2")
  [ -n "$pr" ] && [ "$pr" != "$cr" ]
}

# extract_paths <prompt> -> absolute-ish paths, one per line, deduped.
extract_paths() {
  printf '%s' "$1" \
    | grep -oE '(~|/(home|tmp|etc|data|mnt|opt|usr|var|root))(/[A-Za-z0-9._-]+)+/?' 2>/dev/null \
    | sort -u
}

# first_foreign_root <cwd> <prompt> -> prints the worktree root of the first
# foreign repo named in the prompt; exit 1 if none.
first_foreign_root() {
  local cwd="$1" prompt="$2" p crid d exp
  crid=$(repo_id "$cwd")
  while IFS= read -r p; do
    [ -z "$p" ] && continue
    case "$p" in "$cwd"|"$cwd"/*) continue;; esac   # short-circuit: under cwd
    exp="$p"; case "$exp" in "~/"*) exp="$HOME/${exp#\~/}";; esac
    if [ -d "$exp" ]; then d="$exp"; else d="${exp%/*}"; fi
    while [ -n "$d" ] && [ "$d" != "/" ] && [ ! -d "$d" ]; do d="${d%/*}"; done
    [ -d "$d" ] || continue
    if is_foreign "$cwd" "$exp"; then
      git -C "$d" rev-parse --show-toplevel 2>/dev/null && return 0
    fi
  done <<EOF
$(extract_paths "$prompt")
EOF
  return 1
}

build_directive() {  # <foreign-root>
  local root="$1"
  cat <<EOF
$MARKER This task targets a FOREIGN project at $root (a different git repo than the session cwd). Before the task below, load its context: read_markdown("$root/CLAUDE.md") if present, and memory(action="list", workspace="$root") then read the relevant topics. Pin every codescout call to it with workspace="$root". Use codescout tools (symbols/semantic_search/grep/read_markdown/edit_code) — not native Read/Grep/Bash on source.

--- original task ---
EOF
}

main() {
  command -v jq >/dev/null 2>&1 || exit 0
  local INPUT TOOL CWD PROMPT
  INPUT=$(cat)
  [ -z "$INPUT" ] && exit 0
  TOOL=$(printf '%s' "$INPUT" | jq -r '.tool_name // empty')
  [ "$TOOL" = "Agent" ] || exit 0
  CWD=$(printf '%s' "$INPUT" | jq -r '.cwd // empty')
  PROMPT=$(printf '%s' "$INPUT" | jq -r '.tool_input.prompt // empty')
  [ -n "$CWD" ] && [ -n "$PROMPT" ] || exit 0

  # codescout gate (the injected directive only helps codescout-active sessions).
  if [ "${CS_EXPLORE_INJECT_FORCE:-}" != "1" ]; then
    source "$(dirname "$0")/detect-tools.sh"
    [ "$HAS_CODESCOUT" = "false" ] && exit 0
  fi

  # Idempotency: already bootstrapped (our marker), or the dispatcher already
  # set up a workspace activation by hand.
  case "$PROMPT" in
    *"$MARKER"*) exit 0;;
    *'workspace(action="activate"'*) exit 0;;
  esac

  local ROOT DIRECTIVE NEWPROMPT UPDATED
  ROOT=$(first_foreign_root "$CWD" "$PROMPT") || exit 0
  [ -n "$ROOT" ] || exit 0

  DIRECTIVE=$(build_directive "$ROOT")
  NEWPROMPT="$DIRECTIVE
$PROMPT"
  UPDATED=$(printf '%s' "$INPUT" | jq -c --arg p "$NEWPROMPT" '.tool_input | .prompt=$p')
  jq -nc --argjson ui "$UPDATED" \
    '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"allow",updatedInput:$ui}}'
  exit 0
}

if [ "${BASH_SOURCE[0]}" = "${0}" ]; then main; fi
