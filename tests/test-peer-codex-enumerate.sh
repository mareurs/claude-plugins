#!/usr/bin/env bash
# tests/test-peer-codex-enumerate.sh — the Codex Enumerate block of
# references/codex.md, run for real against a fixture /proc tree and fixture
# state_5.sqlite files (python3 sqlite3, only the columns the block reads).
#
# The block is EXTRACTED from the reference (the first ```bash fence under
# `## Enumerate`), never re-typed: a copy would pass forever against a skill edited
# into something else. The fixture uses invented ids, titles and paths only; no real
# Codex thread, daemon or database is touched, and `codex queue` is never run.
#
# NOT VACUOUS: each control mutates a COPY of the extracted block, proves the
# mutation changed it, and requires the checks to FAIL on it.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SKILL_DIR="${PEER_SKILL_DIR:-$ROOT/codescout-companion/skills/reaching-peer-sessions}"
CORE="$SKILL_DIR/SKILL.md"
REF="$SKILL_DIR/references/codex.md"
PASS=0; FAIL=0
ok()  { echo "  PASS: $1"; PASS=$((PASS+1)); }
bad() { echo "  FAIL: $1 -- $2"; FAIL=$((FAIL+1)); }
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
TAB=$(printf '\t')

echo "-- peer-codex-enumerate --"
[ -f "$REF" ] || { bad "references/codex.md" "missing $REF"; echo "-- $PASS passed, $FAIL failed"; exit 1; }
BLOCK=$(awk '/^## Enumerate/{s=1} s && /^```bash/{b=1; next} b && /^```/{exit} b{print}' "$REF")
if [ -z "$BLOCK" ] || ! grep -q 'CS_PEERS_PROC' <<<"$BLOCK"; then
  bad "extract" "no bash fence holding CS_PEERS_PROC under '## Enumerate' in $REF"
  echo "-- $PASS passed, $FAIL failed"; exit 1
fi
MERGE=$(awk '/^```bash/{b=1; next} b && /^```/{exit} b{print}' "$CORE")

# ---- fixture ----
FX="$T/fx"; mkdir -p "$FX/proc" "$FX/home/.codex" "$FX/codex-a" "$FX/codex-b" "$FX/codex-c"
U_A3=33333333-3333-4333-8333-333333333333
U_C1=cccccccc-cccc-4ccc-8ccc-cccccccccccc
ro() { echo "$FX/$1/sessions/rollout-2026-10-29T10-00-00-$2.jsonl"; }
python3 - "$FX" <<'PY'
import os, sqlite3, sys
fx = sys.argv[1]
def mkdb(home, rows):
    db = sqlite3.connect(os.path.join(fx, home, "state_5.sqlite"))
    db.execute("create table threads (id text primary key, rollout_path text, title text, name text, cwd text, archived integer)")
    db.executemany("insert into threads values (?,?,?,?,?,?)", rows)
    db.commit(); db.close()
def r(home, tag):
    return os.path.join(fx, home, "sessions", "rollout-2026-10-29T10-00-00-%s.jsonl" % tag)
mkdb("codex-a", [
    ("thr-a1", r("codex-a", "a1"), "Alpha task", None, "/w/alpha", 0),
    ("thr-a2", r("codex-a", "a2"), "Archived one", None, "/w/arch", 1),
    ("thr-a4", r("codex-a", "a4"), "a very long first user message", "Named one", "/w/named", 0),
    ("thr-a5", r("codex-a", "a5"), "has\ttab and\nnewline", "", "/w/messy", 0),
])
mkdb("codex-b", [("thr-b1", r("codex-b", "b1"), "Alpha task", None, "/w/beta", 0)])
os.makedirs(os.path.join(fx, "home", ".codex", "sessions"), exist_ok=True)
db = sqlite3.connect(os.path.join(fx, "home", ".codex", "state_5.sqlite"))
db.execute("create table threads (id text primary key, rollout_path text, title text, name text, cwd text, archived integer)")
db.execute("insert into threads values (?,?,?,?,?,?)", ("thr-d1", os.path.join(fx, "home", ".codex", "sessions", "rollout-2026-10-29T10-00-00-d1.jsonl"), "Default home", None, "/w/default", 0))
db.commit(); db.close()
PY
touch_ro() { mkdir -p "$(dirname "$1")"; : > "$1"; }
mk_proc() { # mk_proc <pid> <cmdline words...>
  local p=$1; shift; mkdir -p "$FX/proc/$p/fd"
  local IFS=$'\0'; printf '%s\0' "$@" > "$FX/proc/$p/cmdline"
}
mk_env() { printf 'PATH=/usr/bin\0CODEX_HOME=%s\0' "$2" > "$FX/proc/$1/environ"; }
fd() { touch_ro "$2"; ln -s "$2" "$FX/proc/$1/fd/$3"; }
# 5001: app-server on home codex-a: one live, one archived, one named, one messy title,
#       and one rollout with no threads row (uuid in the file name)
mk_proc 5001 /opt/codex/bin/codex app-server --listen unix://; mk_env 5001 "$FX/codex-a"
fd 5001 "$(ro codex-a a1)" 3; fd 5001 "$(ro codex-a a2)" 4; fd 5001 "$(ro codex-a "$U_A3")" 5
fd 5001 "$(ro codex-a a4)" 6; fd 5001 "$(ro codex-a a5)" 7
ln -s 'socket:[12345]' "$FX/proc/5001/fd/8"; ln -s /dev/null "$FX/proc/5001/fd/9"
# 5002: second app-server on another home, SAME title as thr-a1
mk_proc 5002 /usr/lib/chatgpt/resources/codex -c x=y app-server --analytics-default-enabled; mk_env 5002 "$FX/codex-b"
fd 5002 "$(ro codex-b b1)" 3
# 5003: app-server whose home has NO state_5.sqlite
mk_proc 5003 /opt/codex/bin/codex app-server; mk_env 5003 "$FX/codex-c"
fd 5003 "$(ro codex-c "$U_C1")" 3
# 5004: a TUI (no app-server) holding a rollout that HAS a threads row -- must not produce a row
mk_proc 5004 codex resume 01a15ca9-f939-7603-acb5-01c6b02f68e2; mk_env 5004 "$FX/codex-a"
fd 5004 "$(ro codex-a a1)" 3
# 5005: path contains app-server as a SUBSTRING only (a daemon release dir), not an argument
mk_proc 5005 /h/.codex/packages/app-server-daemon/bin/codex-code-mode-host; mk_env 5005 "$FX/codex-a"
fd 5005 "$(ro codex-a a4)" 3
# 5006: app-server with NO environ file -> default $HOME/.codex; plus an unmatched rollout with no uuid
mk_proc 5006 /opt/codex/bin/codex app-server
fd 5006 "$FX/home/.codex/sessions/rollout-2026-10-29T10-00-00-d1.jsonl" 3
fd 5006 "$FX/home/.codex/sessions/rollout-weird.jsonl" 4

sum_db() { sha256sum "$FX"/codex-*/state_5.sqlite* "$FX"/home/.codex/state_5.sqlite* 2>/dev/null; }
run_block() { CS_PEERS_PROC="$FX/proc" HOME="$FX/home" bash -c "$1" 2>"$T/stderr"; }
row() { awk -F'\t' -v s="$2" '$4==s' <<<"$1"; }
field() { cut -f"$2" <<<"$1"; }

# check_all <block>: every property; echoes the failing names, returns 1 if any.
check_all() {
  local blk=$1 out failed=0 r n
  out=$(run_block "$blk")
  chk() { if ! "$@"; then echo "  [failed] $CHK_NAME" >&2; failed=1; fi; }
  # 1. one row per open rollout of an app-server, minus the archived one: 5001 gives 4,
  #    5002 1, 5003 1, 5006 2  => 8 rows
  [ "$(grep -c . <<<"$out")" = 8 ] || { echo "rows!=8" >&2; failed=1; }
  # 2. R10 values on a plain row
  r=$(row "$out" thr-a1)
  [ "$(printf '%s' "$r" | tr -cd '\t' | wc -c)" = 6 ] && [ "$(field "$r" 1)" = codex ] && [ "$(field "$r" 2)" = codex-a ] \
    && [ "$(field "$r" 3)" = 5001 ] && [ "$(field "$r" 5)" = "Alpha task" ] && [ "$(field "$r" 6)" = loaded ] \
    && [ "$(field "$r" 7)" = /w/alpha ] || { echo "plain row wrong: $r" >&2; failed=1; }
  # 3. archived thread gives no row
  [ -z "$(row "$out" thr-a2)" ] || { echo "archived row present" >&2; failed=1; }
  # 4. open rollout with no threads row: NAME ?, SID from the file name uuid
  r=$(row "$out" "$U_A3"); [ -n "$r" ] && [ "$(field "$r" 5)" = '?' ] && [ "$(field "$r" 2)" = codex-a ] || { echo "unmatched rollout wrong: $r" >&2; failed=1; }
  # 5. two homes, same title: two rows, told apart by ACCOUNT and SID
  [ "$(awk -F'\t' '$5=="Alpha task"' <<<"$out" | wc -l)" = 2 ] && [ "$(field "$(row "$out" thr-b1)" 2)" = codex-b ] || { echo "same-title rows wrong" >&2; failed=1; }
  # 6. missing sqlite: row survives with NAME ?
  r=$(row "$out" "$U_C1"); [ -n "$r" ] && [ "$(field "$r" 5)" = '?' ] && [ "$(field "$r" 2)" = codex-c ] || { echo "missing-db row wrong: $r" >&2; failed=1; }
  # 7. non-app-server holder (5004) and substring-only decoy (5005) give no row
  [ -z "$(awk -F'\t' '$3==5004 || $3==5005' <<<"$out")" ] || { echo "non-app-server row present" >&2; failed=1; }
  # 8. name wins over title; a tab and newline in a title cannot split the row
  [ "$(field "$(row "$out" thr-a4)" 5)" = "Named one" ] && [ "$(field "$(row "$out" thr-a5)" 5)" = "has tab and newline" ] || { echo "name/title rule wrong" >&2; failed=1; }
  # 9. no environ: default HOME/.codex, ACCOUNT .codex
  r=$(row "$out" thr-d1); [ "$(field "$r" 2)" = .codex ] && [ "$(field "$r" 5)" = "Default home" ] || { echo "default home wrong: $r" >&2; failed=1; }
  # 10. unmatched rollout with no uuid in its name: SID ?
  [ "$(awk -F'\t' '$3==5006 && $4=="?" && $5=="?"' <<<"$out" | wc -l)" = 1 ] || { echo "no-uuid row wrong" >&2; failed=1; }
  # 11. nothing marked
  ! grep -q '<-- you' <<<"$out" || { echo "a row is marked" >&2; failed=1; }
  # 12. the block never writes a database
  local before after; before=$(sum_db); run_block "$blk" >/dev/null; after=$(sum_db)
  [ "$before" = "$after" ] || { echo "database changed" >&2; failed=1; }
  # 13. the missing database was not created by the block
  [ ! -e "$FX/codex-c/state_5.sqlite" ] || { echo "state_5.sqlite created" >&2; failed=1; }
  return $failed
}

if check_all "$BLOCK" 2>"$T/why"; then ok "Enumerate block: all fixture properties hold"; else bad "Enumerate block" "$(cat "$T/why")"; fi

# 14. the merge block turns an unmarked Codex-caller run into the loud warning
m=$(run_block "$BLOCK" | CS_PEERS_NOW=2026-10-29T12:00:00Z bash -c "$MERGE" 2>&1)
if grep -qF 'WARNING: your own row was NOT identified' <<<"$m" && ! grep -qF 'peers' <<<"$m"; then ok "merge prints the loud warning for the unidentified Codex caller"; else bad "merge warning" "$m"; fi
if grep -qxF -- '-- 0 Claude Code sessions and 8 loaded Codex threads, across 4 account(s), at 2026-10-29T12:00:00Z' <<<"$m"; then ok "merge summary counts the 8 Codex rows under their own unit"; else bad "merge summary" "$m"; fi

# ---- controls: mutate a copy of the block; it must change, and check_all must FAIL ----
control() { # control <label> <python-mutation: t -> t>
  local mut
  mut=$(python3 -c 'import sys;t=sys.stdin.read();exec(sys.argv[1]);sys.stdout.write(t)' "$2" <<<"$BLOCK")
  if [ "$mut" = "$BLOCK" ]; then bad "control $1" "mutation did not change the block"; return; fi
  if check_all "$mut" 2>/dev/null; then bad "control $1" "mutated block still passed"; else ok "control $1 is caught"; fi
}
control drop_join       't = t.replace("rollout_path = ?", "rollout_path = ? and 0")'
control keep_archived   't = t.replace("if found[4] == 1:", "if False:")'
control substring_match 't = t.replace("\"app-server\" not in argv", "\"app-server\" not in \" \".join(argv)")'
control mark_you        't = t.replace(r"""print("\t".join(r))""", r"""print("\t".join(r) + "  <-- you")""")'
control writable_open   't = t.replace("mode=ro", "mode=rwc")'
control title_first     't = t.replace("found[2] or found[1]", "found[1] or found[2]")'

# ---- Deliver: structural pins. `codex queue` is never run (it talks to a real thread);
# these assert the SHAPE of the section the agent will follow, each with a control that
# deletes exactly one thing from a scratch copy. The section is flattened (backticks and
# emphasis stripped, one line) because the prose is hard-wrapped.
deliver_flat() { awk '/^## Deliver/{s=1; next} s && /^## /{exit} s{print}' "$1" | tr '\n' ' ' | tr -d '*`' | tr -s ' '; }
has() { grep -qiE -- "$2" <<<"$1"; }
deliver_pins() {
  local s; s=$(deliver_flat "$1")
  has "$s" 'CODEX_HOME=<that row.s home> codex queue --thread <SID> --message' \
    && has "$s" 'Send only to a row Enumerate listed as loaded' \
    && has "$s" 'One send per target per request, and no retry on silence' \
    && has "$s" 'check the size of the thread.s rollout file once, after a bounded wait' \
    && has "$s" 'attached to a TUI: a turn starts' \
    && has "$s" 'loaded with nobody attached: a turn runs unwatched\. One measured case used about 17,700 tokens' \
    && has "$s" 'not loaded: the command exits 0 and prints Queued, nothing runs, and the message waits in queue_1.sqlite'
}
if deliver_pins "$REF"; then ok "Deliver pins the queue form, the guards and the three outcomes"; else bad "Deliver pins" "a pinned sentence is missing from ## Deliver in $REF"; fi
dcontrol() { # dcontrol <label> <old> <new>
  local dst="$T/d-$1.md"
  python3 -c 'import sys;t=open(sys.argv[1]).read();open(sys.argv[2],"w").write(t.replace(sys.argv[3],sys.argv[4]))' "$REF" "$dst" "$2" "$3"
  if cmp -s "$REF" "$dst"; then bad "deliver control $1" "mutation did not change the copy"; return; fi
  if deliver_pins "$dst"; then bad "deliver control $1" "mutated copy still passed"; else ok "deliver control $1 is caught"; fi
}
dcontrol queue_form     'codex queue --thread' 'codex send --thread'
dcontrol loaded_only    'Send only to a row Enumerate listed as `loaded`.' 'Send to any row.'
dcontrol one_send       'no retry on silence' 'retry on silence'
dcontrol size_check     'rollout file once' 'rollout file'
dcontrol outcome_attach 'a turn starts there' 'it depends'
dcontrol outcome_tokens '17,700' 'many'
dcontrol outcome_queued '`queue_1.sqlite`' 'disk'
dcontrol outcome_exit0  'exits 0 and prints' 'prints'

echo "-- peer-codex-enumerate: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
