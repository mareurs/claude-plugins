#!/usr/bin/env bash
# Tests for explore-inject.sh — the foreign-project bootstrap injector.
#
# Two layers:
#  1. Portable unit tests of the detector against a temp git sandbox (two repos
#     + a worktree) — deterministic, runs anywhere.
#  2. E2E output-shape tests driving the whole hook with synthetic Agent payloads
#     (CS_EXPLORE_INJECT_FORCE=1 bypasses the codescout gate).
#  3. Replay of the real-world eval corpus (explore-inject.fixtures.jsonl),
#     guarded — rows whose cwd isn't present on this machine are skipped.

set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
HOOK="$HERE/explore-inject.mjs"

PASS=0; FAIL=0; SKIP=0
ok()   { if [ "$2" = "$3" ]; then echo "PASS [$1]"; PASS=$((PASS+1)); else echo "FAIL [$1]: exp=$3 got=$2"; FAIL=$((FAIL+1)); fi; }
fclass(){ node "$HOOK" --is-foreign "$1" "$2"; }
run()  { printf '%s' "$1" | CS_EXPLORE_INJECT_FORCE=1 node "$HOOK"; }

# ---------- 1. Portable detector unit tests ----------
SB=$(mktemp -d)
mkdir -p "$SB/repoA/sub" "$SB/repoB"
for r in repoA repoB; do
  git -C "$SB/$r" init -q
  git -C "$SB/$r" -c user.email=t@t -c user.name=t commit -q --allow-empty -m init
done
git -C "$SB/repoA" worktree add -q "$SB/wtA" -b wt >/dev/null 2>&1
echo x > "$SB/plain.txt"

ok "detect: different repo"        "$(fclass "$SB/repoA" "$SB/repoB")"          "inject"
ok "detect: own subdir"            "$(fclass "$SB/repoA" "$SB/repoA/sub")"      "skip"
ok "detect: non-repo path"         "$(fclass "$SB/repoA" "$SB/plain.txt")"      "skip"
ok "detect: own worktree (fold)"   "$(fclass "$SB/repoA" "$SB/wtA")"            "skip"
ok "detect: foreign file->root"    "$(fclass "$SB/repoA" "$SB/repoB/x/y.txt")"  "inject"

# ---------- 2. E2E output shape ----------
IN_F=$(jq -nc --arg cwd "$SB/repoA" --arg p "Implement the feature in $SB/repoB per the spec." \
  '{tool_name:"Agent",cwd:$cwd,tool_input:{subagent_type:"general-purpose",description:"d",prompt:$p}}')
OUT=$(run "$IN_F")
echo "$OUT" | jq -e '.hookSpecificOutput.updatedInput.prompt | contains("[[cs-explore-bootstrap]]")' >/dev/null 2>&1 \
  && ok "e2e: injects on foreign" inject inject || ok "e2e: injects on foreign" skip inject
echo "$OUT" | jq -e --arg r "$SB/repoB" '.hookSpecificOutput.updatedInput.prompt | contains($r)' >/dev/null 2>&1 \
  && ok "e2e: directive names foreign root" yes yes || ok "e2e: directive names foreign root" no yes
echo "$OUT" | jq -e '.hookSpecificOutput.updatedInput.prompt | contains("Implement the feature")' >/dev/null 2>&1 \
  && ok "e2e: preserves original task" yes yes || ok "e2e: preserves original task" no yes
echo "$OUT" | jq -e '.hookSpecificOutput.updatedInput.subagent_type=="general-purpose"' >/dev/null 2>&1 \
  && ok "e2e: preserves subagent_type" yes yes || ok "e2e: preserves subagent_type" no yes

IN_L=$(jq -nc --arg cwd "$SB/repoA" --arg p "Fix bug in $SB/repoA/sub/main.rs; shebang /usr/bin/env bash." \
  '{tool_name:"Agent",cwd:$cwd,tool_input:{subagent_type:"Explore",prompt:$p}}')
[ -z "$(run "$IN_L")" ] && ok "e2e: skip local-only + shebang" skip skip || ok "e2e: skip local-only + shebang" inject skip

IN_M=$(jq -nc --arg cwd "$SB/repoA" --arg p "[[cs-explore-bootstrap]] already done. Work in $SB/repoB." \
  '{tool_name:"Agent",cwd:$cwd,tool_input:{prompt:$p}}')
[ -z "$(run "$IN_M")" ] && ok "e2e: idempotent (marker present)" skip skip || ok "e2e: idempotent (marker present)" inject skip

IN_W=$(jq -nc --arg cwd "$SB/repoA" --arg p "workspace(action=\"activate\", path=\"$SB/repoB\"); explore." \
  '{tool_name:"Agent",cwd:$cwd,tool_input:{prompt:$p}}')
[ -z "$(run "$IN_W")" ] && ok "e2e: idempotent (hand-written activate)" skip skip || ok "e2e: idempotent (hand-written activate)" inject skip

IN_O=$(jq -nc '{tool_name:"Bash",cwd:"/x",tool_input:{command:"ls"}}')
[ -z "$(printf '%s' "$IN_O" | CS_EXPLORE_INJECT_FORCE=1 node "$HOOK")" ] \
  && ok "e2e: non-Agent ignored" skip skip || ok "e2e: non-Agent ignored" inject skip

# ---------- 3. Real-world corpus replay (guarded) ----------
FIX="$HERE/explore-inject.fixtures.jsonl"
if [ -f "$FIX" ]; then
  while IFS= read -r line; do
    case "$line" in ''|\#*) continue;; esac
    cwd=$(printf '%s' "$line" | jq -r '.cwd')
    path=$(printf '%s' "$line" | jq -r '.path')
    exp=$(printf '%s'  "$line" | jq -r '.expect')
    if [ ! -d "$cwd" ]; then SKIP=$((SKIP+1)); continue; fi
    ok "fixture: ${cwd##*/} :: ${path##*/}" "$(fclass "$cwd" "$path")" "$exp"
  done < "$FIX"
fi

rm -rf "$SB"
echo "---"
echo "Total: $((PASS+FAIL)). Pass: $PASS. Fail: $FAIL. Skipped(env): $SKIP."
[ "$FAIL" -gt 0 ] && exit 1
exit 0
