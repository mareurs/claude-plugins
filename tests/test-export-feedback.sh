#!/usr/bin/env bash
# Tests scripts/export-feedback.py: privacy on redacts, privacy off exports raw,
# the flag defaults to on, and the pika query never selects the raw tool input.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
EXPORT="$REPO_ROOT/scripts/export-feedback.py"

PASS=0
FAIL=0
ok()   { PASS=$((PASS + 1)); echo "  ok  $1"; }
bad()  { FAIL=$((FAIL + 1)); echo "  FAIL $1"; }

TMP="$(mktemp -d "${TMPDIR:-/tmp}/export-feedback-test.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT

# --- fixture repository -------------------------------------------------------
REPO="$TMP/repo"
mkdir -p "$REPO/docs/trackers/streams/recon" "$REPO/docs/trackers/ledgers/frictions" "$REPO/.codescout"
echo "# readme" > "$REPO/docs/trackers/streams/recon/readme.md"
cat > "$REPO/docs/trackers/streams/recon/2026-11-24-plan-drift.md" <<EOF
---
kind: entry
title: 'plan drift in $REPO/src'
---

**What happened:** reported by jane.doe@example.org (login tester-kx), session codescout:0f1e2d3c-4b5a-4968-8777-665544332211.
Path $REPO/src/guard.mjs and /home/tester-kx/notes.txt were read.

\`\`\`js
const SECRET_CODE_MARKER = 1;
\`\`\`

Inline \`symbols\` stays. Token sk-abcdefghijklmnop1234 must go.
EOF
cat > "$REPO/docs/trackers/ledgers/frictions/2026-11-24-friction.md" <<'EOF'
---
kind: entry
title: 'a friction'
---

**What happened:** plain text only.
EOF

# A minimal usage database with the two tables the export reads.
DB="$REPO/.codescout/usage.db"
sqlite3 "$DB" <<'SQL'
CREATE TABLE tool_calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tool_name TEXT NOT NULL, called_at TEXT NOT NULL, outcome TEXT NOT NULL,
  err_family TEXT, friction_target TEXT, input_json TEXT, cc_session_id TEXT);
CREATE TABLE pika_observations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tool_call_id INTEGER NOT NULL REFERENCES tool_calls(id),
  kind TEXT NOT NULL, subkind TEXT, predicate TEXT, verdict TEXT,
  severity TEXT NOT NULL DEFAULT 'low', recurrence INTEGER NOT NULL DEFAULT 1,
  notes TEXT);
INSERT INTO tool_calls (tool_name, called_at, outcome, err_family, friction_target, input_json, cc_session_id)
  VALUES ('Read', '2026-11-24 10:00:00', 'error', 'native', '$REPO/src/x.mjs',
          '{"path":"SECRET-INPUT-MARKER"}', 'cc-session-uuid-123');
INSERT INTO pika_observations (tool_call_id, kind, subkind, predicate, verdict, notes)
  VALUES (1, 'iron_law', 'read_source', 'native read', 'slip', 'seen at $REPO/src/x.mjs by jane.doe@example.org');
SQL

run_export() {  # $1 = CS_PRIVACY value ("" means unset), $2 = output file
  if [ -z "$1" ]; then
    env -u CS_PRIVACY USER=tester-kx "$EXPORT" --repo "$REPO" --out "$2" 2>/dev/null
  else
    env CS_PRIVACY="$1" USER=tester-kx "$EXPORT" --repo "$REPO" --out "$2" 2>/dev/null
  fi
}

assert_has()  { if grep -qF -- "$2" "$1"; then ok "$3"; else bad "$3 (missing: $2)"; fi; }
assert_lacks(){ if grep -qF -- "$2" "$1"; then bad "$3 (leaked: $2)"; else ok "$3"; fi; }

echo "== privacy on (CS_PRIVACY=on)"
ON="$TMP/on.md"
run_export on "$ON" && ok "export runs" || bad "export runs"
assert_has  "$ON" "Privacy: on" "header says privacy on"
assert_lacks "$ON" "$REPO" "repository path redacted"
assert_has  "$ON" "<repo>/src/guard.mjs" "repository path replaced by <repo>"
assert_lacks "$ON" "/home/tester-kx" "home path redacted"
assert_lacks "$ON" "jane.doe@example.org" "e-mail redacted"
assert_lacks "$ON" "0f1e2d3c-4b5a-4968-8777-665544332211" "uuid redacted"
assert_lacks "$ON" "sk-abcdefghijklmnop1234" "token-like string redacted"
assert_lacks "$ON" "SECRET_CODE_MARKER" "fenced code body omitted"
assert_has  "$ON" "[code block omitted]" "fenced code replaced by marker"
assert_has  "$ON" "Inline \`symbols\` stays" "inline code kept"
assert_has  "$ON" "plan drift" "entry title kept"
assert_has  "$ON" "a friction" "friction entry exported"
assert_has  "$ON" "| iron_law |" "pika row exported"
assert_lacks "$ON" "SECRET-INPUT-MARKER" "raw tool input never exported"
assert_lacks "$ON" "cc-session-uuid-123" "claude code session id never exported"
assert_lacks "$ON" "tester-kx" "login name redacted"
assert_has  "$ON" "<user>" "login replaced by <user> placeholder"

echo "== privacy off (CS_PRIVACY=off)"
OFF="$TMP/off.md"
run_export off "$OFF" && ok "export runs" || bad "export runs"
assert_has  "$OFF" "Privacy: off" "header says privacy off"
assert_has  "$OFF" "jane.doe@example.org" "raw e-mail kept when off"
assert_has  "$OFF" "SECRET_CODE_MARKER" "raw code kept when off"
assert_lacks "$OFF" "SECRET-INPUT-MARKER" "raw tool input still never selected"

echo "== default and unknown values (fail safe to on)"
UNSET="$TMP/unset.md"
run_export "" "$UNSET"
assert_has  "$UNSET" "Privacy: on" "unset CS_PRIVACY means on"
UNKNOWN="$TMP/unknown.md"
run_export "maybe" "$UNKNOWN"
assert_has  "$UNKNOWN" "Privacy: on" "unknown CS_PRIVACY value means on"
assert_lacks "$UNKNOWN" "jane.doe@example.org" "unknown value still redacts"

echo "== missing usage database does not fail the export"
NODB="$TMP/nodb"
mkdir -p "$NODB/docs/trackers/streams/recon"
echo "---" > "$NODB/docs/trackers/streams/recon/a.md"
if env CS_PRIVACY=on "$EXPORT" --repo "$NODB" --out "$TMP/nodb.md" 2>/dev/null; then ok "export exits 0 without a database"; else bad "export exits 0 without a database"; fi
assert_has "$TMP/nodb.md" "No usage database" "missing database is reported"

echo
echo "export-feedback: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
