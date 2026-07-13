#!/bin/bash
# tests/test-skill-hints-lib.sh
# Unit tests for lib.mjs `emitSkillHint` (the JS port of the former
# skill-hints.sh `emit_skill_hint` bash function): session-scoped marker dedup,
# empty-guard, and graceful degradation on an unwritable marker dir.
source "$(dirname "${BASH_SOURCE[0]}")/lib/fixtures.sh"

echo "── skill-hints lib (emitSkillHint) ──"
LIB="$HOOK_DIR/lib.mjs"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT

emit_hint() { # cwd sid topic hint
  node --input-type=module -e '
    const { emitSkillHint } = await import(process.argv[1]);
    emitSkillHint(process.argv[2] || "", process.argv[3] || "", process.argv[4] || "", process.argv[5] || "");
  ' "$LIB" "$1" "$2" "$3" "$4"
}

ctx_of() { echo "$1" | jq -r '.hookSpecificOutput.additionalContext // empty'; }

mkdir -p "$T/proj"

# Test 1: first call emits hint + writes marker
OUT=$(emit_hint "$T/proj" "sid-1" "recon" "test hint message")
if [ "$(ctx_of "$OUT")" = "test hint message" ] && [ -f "$T/proj/.buddy/sid-1/hint-emitted-recon" ]; then
  pass "first call: emits + marker written"
else
  fail "first call: emits + marker written" "ctx=$(ctx_of "$OUT")"
fi

# Test 2: second call same topic → silent {}
OUT=$(emit_hint "$T/proj" "sid-1" "recon" "second")
if [ -z "$(ctx_of "$OUT")" ]; then pass "second call same topic: silent"; else fail "second call same topic: silent" "$OUT"; fi

# Test 3: different topic still emits
OUT=$(emit_hint "$T/proj" "sid-1" "verify" "verify hint")
if [ "$(ctx_of "$OUT")" = "verify hint" ]; then pass "different topic: emits"; else fail "different topic: emits" "$OUT"; fi

# Test 4: new session re-emits same topic
OUT=$(emit_hint "$T/proj" "sid-2" "recon" "fresh session")
if [ "$(ctx_of "$OUT")" = "fresh session" ] && [ -f "$T/proj/.buddy/sid-2/hint-emitted-recon" ]; then
  pass "new session: re-emits"
else
  fail "new session: re-emits" "$OUT"
fi

# Test 5: empty session → silent
OUT=$(emit_hint "$T/proj" "" "recon" "msg")
if [ -z "$(ctx_of "$OUT")" ]; then pass "empty session: silent"; else fail "empty session: silent" "$OUT"; fi

# Test 6: empty cwd → silent
OUT=$(emit_hint "" "sid-1" "recon" "msg")
if [ -z "$(ctx_of "$OUT")" ]; then pass "empty cwd: silent"; else fail "empty cwd: silent" "$OUT"; fi

# Test 7: unwritable marker dir → still emits (marker is best-effort)
mkdir -p "$T/ro/.buddy"
chmod 555 "$T/ro/.buddy"
OUT=$(emit_hint "$T/ro" "sid-1" "recon" "ro test")
chmod 755 "$T/ro/.buddy"
if [ "$(ctx_of "$OUT")" = "ro test" ]; then pass "unwritable marker dir: emits"; else fail "unwritable marker dir: emits" "$OUT"; fi

print_summary "skill-hints lib"
