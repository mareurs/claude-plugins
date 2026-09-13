#!/usr/bin/env bash
# Test for pre-edit-dirty-check.mjs's path resolution.
#
# docs/issues/2026-09-13-pre-edit-dirty-check-prints-a-path-resolved-against-the-wrong-root.md:
# the hook took the tool's path argument VERBATIM and used it three ways, only one of which
# tolerates a relative path. `path.relative(from, to)` resolves a relative `to` against
# `process.cwd()` -- the session's cwd -- not against `projectRoot`, so a session working from
# a subdirectory (this plugin's own `.buddy`, in the reported instance) printed an advisory
# naming a path that does not exist, and hashed a different marker key per spelling of the
# same file. `git()` was unaffected because it is called with `-C projectRoot` explicitly,
# which is why the underlying check stayed correct while only the rendering broke.
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK="$SCRIPT_DIR/pre-edit-dirty-check.mjs"
PASS=0; FAIL=0
pass() { echo "PASS: $1"; PASS=$((PASS+1)); }
fail() { echo "FAIL: $1 -- $2"; FAIL=$((FAIL+1)); }

TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
git -C "$TMP" init -q
git -C "$TMP" config user.email t@t
git -C "$TMP" config user.name t
mkdir -p "$TMP/.buddy" "$TMP/tests"
echo v1 > "$TMP/tests/example.rs"
git -C "$TMP" add tests/example.rs
git -C "$TMP" commit -q -m seed
# Now dirty it, untracked-and-uncommitted is not required -- a tracked modification is
# enough to make `git status --porcelain` non-empty, which is all the check needs.
echo v2 > "$TMP/tests/example.rs"

run_hook() { # run_hook <actual-os-cwd> <session-id> [<file-path-in-payload>]
  local file="${3:-tests/example.rs}"
  ( cd "$1" && \
    echo '{"session_id":"'"$2"'","tool_name":"Edit","tool_input":{"file_path":"'"$file"'"},"cwd":"'"$1"'"}' \
      | node "$HOOK" )
}

# 1. Run from the PROJECT ROOT itself -- the case that was always correct, kept as a
#    control so a fix that breaks the ordinary case is caught here first.
out_root=$(run_hook "$TMP" "sess-root")
ctx_root=$(python3 -c "import json,sys; print(json.load(sys.stdin).get('hookSpecificOutput',{}).get('additionalContext',''))" <<<"$out_root" 2>/dev/null)
case "$ctx_root" in
  *'`tests/example.rs`'*)
    pass "from project root: the advisory names the real path" ;;
  *)
    fail "from project root: the advisory names the real path" "got: $ctx_root" ;;
esac
case "$ctx_root" in
  *'.buddy'*)
    fail "from project root: no spurious .buddy prefix" "got: $ctx_root" ;;
  *)
    pass "from project root: no spurious .buddy prefix" ;;
esac

# 2. Run from a SUBDIRECTORY of the project root -- the reported reproduction. Before the
#    fix this printed `.buddy/tests/example.rs`, a path that does not exist, because
#    path.relative() resolved the relative tool_input path against this actual cwd.
out_sub=$(run_hook "$TMP/.buddy" "sess-sub")
ctx_sub=$(python3 -c "import json,sys; print(json.load(sys.stdin).get('hookSpecificOutput',{}).get('additionalContext',''))" <<<"$out_sub" 2>/dev/null)
case "$ctx_sub" in
  *'`tests/example.rs`'*)
    pass "from a subdirectory: the advisory names the real path, not a cwd-relative one" ;;
  *)
    fail "from a subdirectory: the advisory names the real path, not a cwd-relative one" "got: $ctx_sub" ;;
esac
case "$ctx_sub" in
  *'.buddy'*)
    fail "from a subdirectory: no spurious .buddy prefix (the reported symptom)" "got: $ctx_sub" ;;
  *)
    pass "from a subdirectory: no spurious .buddy prefix (the reported symptom)" ;;
esac

# 3. The marker key must be the SAME regardless of which SPELLING of the path the tool
#    call used -- proving the fix's other half: the marker now hashes the resolved
#    absolute path, not the raw (spelling-dependent) string. Same session, same file,
#    two different-but-equivalent path forms (project-relative, then absolute): the
#    second invocation must be suppressed as already-seen. Before the fix these hashed
#    to two different markers, so a rename (or an absolute-path re-address of the same
#    file) re-warned as if the file were untouched.
SESS="sess-marker-check"
run_hook "$TMP" "$SESS" "tests/example.rs" >/dev/null
out_second=$(run_hook "$TMP" "$SESS" "$TMP/tests/example.rs")
if [ -z "$out_second" ]; then
  pass "marker keys on the resolved path: an absolute-path re-address of the same file is suppressed"
else
  fail "marker keys on the resolved path: an absolute-path re-address of the same file is suppressed" \
    "got non-empty output: $out_second"
fi

echo; echo "pre-edit-dirty-check: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
