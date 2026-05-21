#!/usr/bin/env bash
# tests/test-recon-count.sh — recon_count.py CLI behavior
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$ROOT/codescout-companion/skills/reconnaissance/recon_count.py"
PASS=0; FAIL=0
ok()   { echo "  PASS: $1"; PASS=$((PASS+1)); }
bad()  { echo "  FAIL: $1 — $2"; FAIL=$((FAIL+1)); }

echo "── recon-count ──"

# 1. bump F creates file with F=1 W=0
T="$(mktemp -d)"; mkdir -p "$T/.buddy"; echo "sid1" > "$T/.buddy/.current_session_id"
python3 "$SCRIPT" bump F --root "$T" 2>/dev/null
CF="$T/.buddy/sid1/recon-counts.json"
if [ -f "$CF" ] && [ "$(python3 -c "import json;d=json.load(open('$CF'));print(d['F'],d['W'])")" = "1 0" ]; then
  ok "bump F → F=1 W=0"; else bad "bump F" "got $(cat "$CF" 2>/dev/null)"; fi

# 2. second bump F → F=2
python3 "$SCRIPT" bump F --root "$T" 2>/dev/null
if [ "$(python3 -c "import json;print(json.load(open('$CF'))['F'])")" = "2" ]; then
  ok "bump F twice → F=2"; else bad "bump F twice" "got $(cat "$CF")"; fi

# 3. bump W → W=1, F preserved
python3 "$SCRIPT" bump W --root "$T" 2>/dev/null
if [ "$(python3 -c "import json;d=json.load(open('$CF'));print(d['F'],d['W'])")" = "2 1" ]; then
  ok "bump W → F=2 W=1"; else bad "bump W" "got $(cat "$CF")"; fi

# 4. read prints current counts as JSON
OUT="$(python3 "$SCRIPT" read --root "$T" 2>/dev/null)"
if [ "$(echo "$OUT" | python3 -c "import json,sys;d=json.load(sys.stdin);print(d['F'],d['W'])")" = "2 1" ]; then
  ok "read → {F:2,W:1}"; else bad "read" "got $OUT"; fi

# 5. missing .current_session_id → no-op, exit 0, no file written
T2="$(mktemp -d)"; mkdir -p "$T2/.buddy"
python3 "$SCRIPT" bump F --root "$T2" 2>/dev/null; RC=$?
if [ "$RC" = "0" ] && [ -z "$(find "$T2/.buddy" -name recon-counts.json)" ]; then
  ok "missing SID → exit 0, no file"; else bad "missing SID" "rc=$RC files=$(find "$T2/.buddy")"; fi

# 6. corrupt counts JSON → treated as zero, bump still succeeds → F=1
T3="$(mktemp -d)"; mkdir -p "$T3/.buddy/sid3"; echo "sid3" > "$T3/.buddy/.current_session_id"
echo "{ not json" > "$T3/.buddy/sid3/recon-counts.json"
python3 "$SCRIPT" bump F --root "$T3" 2>/dev/null
if [ "$(python3 -c "import json;print(json.load(open('$T3/.buddy/sid3/recon-counts.json'))['F'])")" = "1" ]; then
  ok "corrupt JSON → reset, bump F=1"; else bad "corrupt JSON" "got $(cat "$T3/.buddy/sid3/recon-counts.json")"; fi

rm -rf "$T" "$T2" "$T3"
echo "── recon-count: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
