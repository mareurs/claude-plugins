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

# The hooks of one manifest that carry a separate args array, as a JSON array.
# A jq failure leaves the output empty, which is never "[]", so a manifest the
# predicate cannot read fails the sweep instead of passing it.
args_hooks() {
  jq -c '[(.hooks // {})[][]?.hooks[] | select(.type == "command" and .args != null)]' "$1"
}

echo "── args_hooks: the sweep's own predicate, on fixtures ──"
FIX="$(mktemp -d)"
printf '%s' '{ "modules": ["./register.ts"] }' > "$FIX/mod-manifest.json"
printf '%s' '{"hooks":{"PreToolUse":[{"hooks":[{"type":"command","command":"node","args":["x.js"]}]}]}}' > "$FIX/with-args.json"
printf '%s' '{"hooks":{"PreToolUse":[{"hooks":[{"type":"command","command":"node x.js"}]}]}}' > "$FIX/folded.json"
printf '%s' '{"hooks":5}' > "$FIX/unreadable.json"

# A mod manifest has no `hooks` key, so no hook of it can carry an args array. It is not a failure.
[ "$(args_hooks "$FIX/mod-manifest.json" 2>/dev/null)" = "[]" ] \
  && pass "a mod manifest with no hooks key has no args hook" \
  || fail "a mod manifest with no hooks key has no args hook" "got: $(args_hooks "$FIX/mod-manifest.json" 2>&1)"
# The check must still catch what it exists to catch.
[ "$(args_hooks "$FIX/with-args.json" 2>/dev/null)" != "[]" ] \
  && pass "a hook with a separate args array is reported" \
  || fail "a hook with a separate args array is reported" "the predicate returned []"
[ "$(args_hooks "$FIX/folded.json" 2>/dev/null)" = "[]" ] \
  && pass "a hook with its args folded into the command string is clean" \
  || fail "a hook with its args folded into the command string is clean" "got: $(args_hooks "$FIX/folded.json" 2>&1)"
# A hooks key of the wrong shape is a defect in the manifest, not an absent key: it must not read as clean.
[ "$(args_hooks "$FIX/unreadable.json" 2>/dev/null)" != "[]" ] \
  && pass "a hooks key of the wrong shape does not read as clean" \
  || fail "a hooks key of the wrong shape does not read as clean" "the predicate returned []"
rm -rf "$FIX"

echo "── every hooks.json in the repo ──"
FOUND=0
while IFS= read -r -d '' f; do
  FOUND=$((FOUND + 1))
  rel="${f#"$REPO_ROOT"/}"

  if ! jq empty "$f" 2>/dev/null; then
    fail "$rel is valid JSON"
    continue
  fi
  pass "$rel is valid JSON"

  ARGS_HOOKS=$(args_hooks "$f")
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
