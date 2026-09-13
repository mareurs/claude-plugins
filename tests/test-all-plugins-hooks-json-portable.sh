#!/bin/bash
# tests/test-all-plugins-hooks-json-portable.sh
#
# Codex (and other non-Claude-Code hosts) invoke a hook's `command` field but
# ignore Claude Code's separate `args` array — a manifest split across the two
# runs a bare `node` with no script path, which reads the hook-event JSON off
# stdin as JavaScript and fails. Every plugin's hooks.json must therefore fold
# any args into one command string. See
# docs/issues/archive/2026-09-12-codex-plugin-runner-drops-buddy-hook-args.md.
#
# codescout-companion/hooks/hooks.json has its own dedicated registration test
# (tests/test-hooks-json-registration.sh) with matcher-specific assertions;
# this one is the project-wide sweep so a NEW plugin, or a regression in an
# EXISTING one, is caught without needing its own copy of this check.
source "$(dirname "${BASH_SOURCE[0]}")/lib/fixtures.sh"

echo "── all-plugins hooks.json portable command strings ──"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

FOUND=0
while IFS= read -r -d '' f; do
  FOUND=$((FOUND + 1))
  rel="${f#"$REPO_ROOT"/}"

  if ! jq empty "$f" 2>/dev/null; then
    fail "$rel is valid JSON"
    continue
  fi
  pass "$rel is valid JSON"

  ARGS_HOOKS=$(jq -c '[.hooks[][]?.hooks[] | select(.type == "command" and .args != null)]' "$f")
  if [ "$ARGS_HOOKS" = "[]" ]; then
    pass "$rel: no hook uses a separate args array"
  else
    fail "$rel: no hook uses a separate args array" "$ARGS_HOOKS"
  fi
done < <(find "$REPO_ROOT" -path '*/hooks/hooks.json' -not -path '*/node_modules/*' -print0 | sort -z)

# LOAD-BEARING, same reasoning as run-all.sh's own nullglob guard: a `find`
# that silently matched nothing would report "0 passed, 0 failed" as if every
# plugin were clean.
if [ "$FOUND" -eq 0 ]; then
  fail "at least one plugin hooks.json was discovered" "found none"
fi

# Buddy-specific: all five hooks route through the same run.mjs dispatcher,
# distinguished only by the event-name argument folded into the command
# string — a copy-paste error there (wrong or missing event name) would not
# be caught by the generic "no args array" check above, since the string
# would still have no args key. Assert the mapping directly.
BUDDY_HOOKS="$REPO_ROOT/buddy/hooks/hooks.json"
if [ -f "$BUDDY_HOOKS" ]; then
  for pair in "PreToolUse:pre-tool-use" "SessionStart:session-start" "SessionEnd:session-end" \
              "PostToolUse:post-tool-use" "UserPromptSubmit:user-prompt-submit"; do
    event="${pair%%:*}"
    arg="${pair##*:}"
    cmd=$(jq -r --arg e "$event" '.hooks[$e][0].hooks[0].command // empty' "$BUDDY_HOOKS")
    if [[ "$cmd" == *"run.mjs"* && "$cmd" == *"$arg"* ]]; then
      pass "buddy $event: command names run.mjs $arg"
    else
      fail "buddy $event: command names run.mjs $arg" "got: $cmd"
    fi
  done
fi

print_summary "all-plugins hooks.json portable"
