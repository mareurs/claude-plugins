#!/bin/bash
# tests/test-suspicious-zero-hint.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/fixtures.sh"

echo "── suspicious-zero-hint ──"
HOOK="$HOOK_DIR/suspicious-zero-hint.mjs"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
mkdir -p "$T/proj"

# tool_response arrives as an object for Bash; some harness versions hand back a
# bare string. Both shapes are exercised (tests 1 and 2 differ in shape).
hook_obj() {
  local sid="$1" cmd="$2" out="$3"
  jq -nc --arg c "$T/proj" --arg s "$sid" --arg cmd "$cmd" --arg o "$out" \
    '{cwd:$c, session_id:$s, tool_name:"Bash", tool_input:{command:$cmd}, tool_response:{stdout:$o}}'
}
hook_str() {
  local sid="$1" cmd="$2" out="$3"
  jq -nc --arg c "$T/proj" --arg s "$sid" --arg cmd "$cmd" --arg o "$out" \
    '{cwd:$c, session_id:$s, tool_name:"Bash", tool_input:{command:$cmd}, tool_response:$o}'
}
run_hook() { HOME="$T/_home" CLAUDE_CONFIG_DIR="" node "$HOOK" 2>/dev/null; }
ctx_of() { echo "$1" | jq -r '.hookSpecificOutput.additionalContext // empty'; }

# --- 1. A MULTI-WORD pattern returning nothing. `grep` is line-oriented, so a
#        phrase spanning a newline cannot match however present the text is.
#        This is the peer's measured case, 2026-09-09.
OUT=$(hook_obj "s1" "grep 'after being named in this instance' docs/x.md" "" | run_hook)
if [ -n "$(ctx_of "$OUT")" ]; then
  pass "multi-word pattern + empty output: speaks"
else
  fail "multi-word pattern + empty output: speaks" "$OUT"
fi

# --- 2. An awk/sed RANGE returning nothing: both endpoints are assumptions
#        about line structure, and either may not exist. This session's own
#        measured case, same evening. Also exercises the string tool_response.
OUT=$(hook_str "s2" "awk '/^## IC-18/,/^## IC-19/' docs/trackers/issue-clusters.md" "" | run_hook)
if [ -n "$(ctx_of "$OUT")" ]; then
  pass "range expression + empty output: speaks (string tool_response)"
else
  fail "range expression + empty output: speaks" "$OUT"
fi

# --- 3. The advisory must name a runnable control, not just describe the class.
if assert_context_contains "$OUT" "control"; then
  pass "advisory names a control probe"
else
  fail "advisory names a control probe" "$OUT"
fi

# --- 4. DISCRIMINATOR, and the one that keeps this honest. A single-token
#        pattern encodes no line-structure assumption, so its zero is ordinary.
#        ADR-2026-08-27 clause 2: a warning on every zero is equivalent to no
#        warning. If this ever fails, the hook has become noise.
OUT=$(hook_obj "s3" "grep 'singletoken' docs/x.md" "" | run_hook)
if [ -z "$(ctx_of "$OUT")" ]; then
  pass "single-token pattern: silent (clause 2)"
else
  fail "single-token pattern: silent (clause 2)" "$(ctx_of "$OUT")"
fi

# --- 5. DISCRIMINATOR. A phrase that MATCHED is not a suspicious zero.
OUT=$(hook_obj "s4" "grep 'a long phrase here' docs/x.md" "docs/x.md:12:a long phrase here" | run_hook)
if [ -z "$(ctx_of "$OUT")" ]; then
  pass "non-empty output: silent"
else
  fail "non-empty output: silent" "$(ctx_of "$OUT")"
fi

# --- 6. DISCRIMINATOR for the SEARCH-TOOL gate specifically. The argument is a
#        quoted multi-word string and the output is empty, so every other
#        predicate is satisfied -- only "echo is not a searcher" can produce the
#        silence. The first version of this test used `ls -la /some/empty/dir`,
#        which has no quoted argument: it passed at the PATTERN gate and left the
#        tool gate untested, surviving a mutation that removed it entirely.
OUT=$(hook_obj "s5" "echo 'a long phrase here'" "" | run_hook)
if [ -z "$(ctx_of "$OUT")" ]; then
  pass "non-search command: silent"
else
  fail "non-search command: silent" "$(ctx_of "$OUT")"
fi

# --- 7. Bounded noise: the same selector twice in a session says it once.
OUT=$(hook_obj "s1" "grep 'after being named in this instance' docs/x.md" "" | run_hook)
if [ -z "$(ctx_of "$OUT")" ]; then
  pass "same selector twice: silent"
else
  fail "same selector twice: silent" "$(ctx_of "$OUT")"
fi

# --- 8. A DIFFERENT suspicious selector in the same session still speaks --
#        dedup is per selector, not a one-shot session mute.
OUT=$(hook_obj "s1" "grep 'some other wrapped phrase' docs/y.md" "" | run_hook)
if [ -n "$(ctx_of "$OUT")" ]; then
  pass "different selector same session: still speaks"
else
  fail "different selector same session: still speaks" "$OUT"
fi

# --- 9. No quoted pattern to reason about -> stay silent. Parsing a shell
#        command is the parsers-over-a-namespace hazard; silence on ambiguity
#        is the safe direction and costs nothing.
OUT=$(hook_obj "s6" "grep -r IC-18" "" | run_hook)
if [ -z "$(ctx_of "$OUT")" ]; then
  pass "unquoted/ambiguous pattern: silent"
else
  fail "unquoted/ambiguous pattern: silent" "$(ctx_of "$OUT")"
fi

# --- 10. Fail-open, and it is advisory only: PostToolUse must never carry a
#         permission decision.
OUT=$(printf 'not json' | run_hook)
RC=$?
if check_rc "$RC"; then pass "garbage stdin: exit 0"; else fail "garbage stdin: exit 0" "rc=$RC"; fi

OUT=$(hook_obj "s7" "grep 'a wrapped phrase somewhere' docs/x.md" "" | run_hook)
if echo "$OUT" | jq -e '.hookSpecificOutput.permissionDecision' >/dev/null 2>&1; then
  fail "never carries a permission decision" "$OUT"
else
  pass "never carries a permission decision"
fi

print_summary "suspicious-zero-hint"
