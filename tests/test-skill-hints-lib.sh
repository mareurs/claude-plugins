#!/bin/bash
# tests/test-skill-hints-lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/fixtures.sh"

echo "── skill-hints lib ──"
LIB="$HOOK_DIR/skill-hints.sh"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT

# Test 1: first call emits hint and writes marker
(
  export CWD="$T/proj" SESSION_ID="sid-1"
  mkdir -p "$CWD"
  source "$LIB"
  OUT=$(emit_skill_hint "recon" "test hint message")
  CTX=$(echo "$OUT" | jq -r '.hookSpecificOutput.additionalContext // empty')
  if [ "$CTX" = "test hint message" ] && [ -f "$CWD/.buddy/sid-1/hint-emitted-recon" ]; then
    pass "first call: emits + marker written"
  else
    fail "first call: emits + marker written" "ctx=$CTX marker=$(ls -1 $CWD/.buddy/sid-1/ 2>/dev/null)"
  fi
)

# Test 2: second call with same marker → silent {}
(
  export CWD="$T/proj" SESSION_ID="sid-1"
  source "$LIB"
  emit_skill_hint "recon" "first" >/dev/null
  OUT=$(emit_skill_hint "recon" "second")
  CTX=$(echo "$OUT" | jq -r '.hookSpecificOutput.additionalContext // empty')
  if [ -z "$CTX" ]; then
    pass "second call same topic: silent"
  else
    fail "second call same topic: silent" "got ctx=$CTX"
  fi
)

# Test 3: different topic still emits
(
  export CWD="$T/proj" SESSION_ID="sid-1"
  source "$LIB"
  emit_skill_hint "recon" "first" >/dev/null
  OUT=$(emit_skill_hint "verify" "verify hint")
  CTX=$(echo "$OUT" | jq -r '.hookSpecificOutput.additionalContext // empty')
  if [ "$CTX" = "verify hint" ]; then
    pass "different topic: emits"
  else
    fail "different topic: emits" "ctx=$CTX"
  fi
)

# Test 4: new SESSION_ID re-emits same topic
(
  export CWD="$T/proj" SESSION_ID="sid-2"
  source "$LIB"
  OUT=$(emit_skill_hint "recon" "fresh session")
  CTX=$(echo "$OUT" | jq -r '.hookSpecificOutput.additionalContext // empty')
  if [ "$CTX" = "fresh session" ] && [ -f "$CWD/.buddy/sid-2/hint-emitted-recon" ]; then
    pass "new SESSION_ID: re-emits"
  else
    fail "new SESSION_ID: re-emits" "ctx=$CTX"
  fi
)

# Test 5: empty SESSION_ID → silent
(
  export CWD="$T/proj" SESSION_ID=""
  source "$LIB"
  OUT=$(emit_skill_hint "recon" "msg")
  CTX=$(echo "$OUT" | jq -r '.hookSpecificOutput.additionalContext // empty')
  if [ -z "$CTX" ]; then
    pass "empty SESSION_ID: silent"
  else
    fail "empty SESSION_ID: silent" "ctx=$CTX"
  fi
)

# Test 6: empty CWD → silent
(
  export CWD="" SESSION_ID="sid-1"
  source "$LIB"
  OUT=$(emit_skill_hint "recon" "msg")
  CTX=$(echo "$OUT" | jq -r '.hookSpecificOutput.additionalContext // empty')
  if [ -z "$CTX" ]; then
    pass "empty CWD: silent"
  else
    fail "empty CWD: silent" "ctx=$CTX"
  fi
)

# Test 7: read-only marker dir → emits but no crash
(
  export CWD="$T/ro" SESSION_ID="sid-1"
  mkdir -p "$CWD/.buddy"
  chmod 555 "$CWD/.buddy"
  source "$LIB"
  OUT=$(emit_skill_hint "recon" "ro test" 2>/dev/null)
  CTX=$(echo "$OUT" | jq -r '.hookSpecificOutput.additionalContext // empty')
  chmod 755 "$CWD/.buddy"  # cleanup permission
  if [ "$CTX" = "ro test" ]; then
    pass "read-only marker dir: emits"
  else
    fail "read-only marker dir: emits" "ctx=$CTX"
  fi
)

print_summary "skill-hints lib"
