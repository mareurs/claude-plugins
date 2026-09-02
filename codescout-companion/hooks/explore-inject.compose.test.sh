#!/usr/bin/env bash
# Regression tests for the COMPOSITION of explore-inject.mjs + the explore-project
# skill's prompt template.
#
# Why this file exists: on a main-agent skill dispatch BOTH texts reach the
# subagent — the hook does not treat the skill's template as already-bootstrapped
# — and they used to contradict each other. The hook named `edit_code` while the
# skill said "READ-ONLY. Do not write or modify any file."
# (subagent-bootstrap-session-log:F-6). Nothing tested the composed prompt, so the
# conflict was invisible to the whole suite.
#
# These tests assert the invariants that keep the two texts consistent, and guard
# the skill's duplication of the bootstrap — which is DELIBERATE, because
# PreToolUse:Agent does not fire for subagent-issued dispatches, making the
# skill's own copy the only bootstrap on that path
# (subagent-bootstrap-session-log:F-8).

set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
HOOK="$HERE/explore-inject.mjs"
SKILL="$HERE/../skills/explore-project/SKILL.md"

PASS=0; FAIL=0
ok() { if [ "$2" = "$3" ]; then echo "PASS [$1]"; PASS=$((PASS+1)); else echo "FAIL [$1]: exp=$3 got=$2"; FAIL=$((FAIL+1)); fi; }

# ---------- fixture: two repos, so the detector calls the target foreign ----------
SB=$(mktemp -d)
trap 'rm -rf "$SB"' EXIT
mkdir -p "$SB/repoA" "$SB/repoB"
for r in repoA repoB; do
  git -C "$SB/$r" init -q
  git -C "$SB/$r" -c user.email=t@t -c user.name=t commit -q --allow-empty -m init
done

# ---------- extract the skill's prompt template from SKILL.md ----------
# Fails loudly rather than silently testing an empty string: an empty template
# would make every assertion below vacuously pass.
TPL=$(awk '
  /^## Subagent Prompt Template/ {inSec=1; next}
  inSec && /^```/ {fence++; if (fence==1) next; if (fence==2) exit}
  inSec && fence==1 {print}
' "$SKILL")

if [ -n "$TPL" ]; then ok "extract: template found in SKILL.md" yes yes
else ok "extract: template found in SKILL.md" no yes; fi

TPL_SUB=${TPL//<path>/$SB/repoB}
TPL_SUB=${TPL_SUB//<topic>/test topic}

# ---------- compose: run the hook on the skill's own template ----------
IN=$(jq -nc --arg cwd "$SB/repoA" --arg p "$TPL_SUB" \
  '{tool_name:"Agent",cwd:$cwd,tool_input:{subagent_type:"general-purpose",description:"d",prompt:$p}}')
OUT=$(printf '%s' "$IN" | CS_EXPLORE_INJECT_FORCE=1 node "$HOOK")
COMPOSED=$(printf '%s' "$OUT" | jq -r '.hookSpecificOutput.updatedInput.prompt // ""')

# The composition is real — this is the premise the rest of the file rests on.
case "$COMPOSED" in
  *"[[cs-explore-bootstrap]]"*) ok "compose: hook injects over skill template" yes yes ;;
  *)                            ok "compose: hook injects over skill template" no  yes ;;
esac

# F-6 INVARIANT: if the composed prompt names an editing tool, it MUST also carry
# the precedence clause retiring it for this task. Both, or neither — never one.
HAS_EDIT=no; HAS_PREC=no
case "$COMPOSED" in *edit_code*) HAS_EDIT=yes ;; esac
case "$COMPOSED" in *"does not apply to this task"*) HAS_PREC=yes ;; esac
if [ "$HAS_EDIT" = no ] || [ "$HAS_PREC" = yes ]; then
  ok "F-6: edit_code mention is qualified by a precedence clause" yes yes
else
  ok "F-6: edit_code mention is qualified by a precedence clause" no yes
fi

# The READ-ONLY rule itself survives composition.
case "$COMPOSED" in
  *READ-ONLY*) ok "F-6: READ-ONLY rule present in composed prompt" yes yes ;;
  *)           ok "F-6: READ-ONLY rule present in composed prompt" no  yes ;;
esac

# F-8 GUARD: the skill keeps its standalone bootstrap fallback. Deleting it as
# "duplication" would leave the subagent path with no bootstrap and no error.
if grep -q 'not already prepended above this line' "$SKILL"; then
  ok "F-8: skill retains standalone bootstrap fallback" yes yes
else
  ok "F-8: skill retains standalone bootstrap fallback" no yes
fi

# F-7 GUARD: no stale .sh pointer to a hook that is .mjs.
if grep -q 'explore-inject\.sh' "$SKILL"; then
  ok "F-7: SKILL.md names the hook as .mjs" no yes
else
  ok "F-7: SKILL.md names the hook as .mjs" yes yes
fi

echo "---- explore-inject.compose: $PASS passed, $FAIL failed ----"
[ "$FAIL" -eq 0 ]
