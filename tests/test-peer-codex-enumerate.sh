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
# The home codex-a is a WAL database with a PENDING -wal, as the live one is: a block
# opened read-write checkpoints that into the main file and deletes the -wal, which a
# rollback-journal fixture cannot show. The home codex-e is held under an exclusive
# lock for the whole run, to bound the cost of a locked database.
#
# NOT VACUOUS: each control mutates a COPY of the extracted block, proves the mutation
# changed it, and requires check_all to FAIL with the NAMED reason (so a control cannot be
# "caught" by an unrelated breakage).
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SKILL_DIR="${PEER_SKILL_DIR:-$ROOT/codescout-companion/skills/reaching-peer-sessions}"
CORE="$SKILL_DIR/SKILL.md"
REF="$SKILL_DIR/references/codex.md"
PASS=0; FAIL=0
ok()  { echo "  PASS: $1"; PASS=$((PASS+1)); }
bad() { echo "  FAIL: $1 -- $2"; FAIL=$((FAIL+1)); }
T=$(mktemp -d); LOCKPID=""
trap '[ -n "$LOCKPID" ] && kill "$LOCKPID" 2>/dev/null; rm -rf "$T"' EXIT
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
FX="$T/fx"; TABHOME="$FX/co${TAB}dex-t"
mkdir -p "$FX/proc" "$FX/home/.codex/sessions" "$FX/codex-a" "$FX/codex-b" "$FX/codex-c" "$FX/codex-e" "$TABHOME" "$T/stage"
U_A3=33333333-3333-4333-8333-333333333333
U_C1=cccccccc-cccc-4ccc-8ccc-cccccccccccc
U_T1=77777777-7777-4777-8777-777777777777
LOCKED_N=12
LONGCWD="/w/$(printf 'x%.0s' $(seq 1 100))/a${TAB}b"
LONGCWD_WANT="/w/$(printf 'x%.0s' $(seq 1 100))/a b"
ro() { echo "$FX/$1/sessions/rollout-2026-10-29T10-00-00-$2.jsonl"; }
python3 - "$FX" "$T/stage" "$LONGCWD" <<'PY'
import os, shutil, sqlite3, sys
fx, stage, longcwd = sys.argv[1:4]
SCHEMA = "create table threads (id text primary key, rollout_path text, title text, name text, cwd text, archived integer)"
def r(home, tag):
    return os.path.join(fx, home, "sessions", "rollout-2026-10-29T10-00-00-%s.jsonl" % tag)
# codex-a: WAL with a pending -wal. The staging connection stays open (autocheckpoint
# off) while both files are copied, so the copied -wal is NOT checkpointed.
st = os.path.join(stage, "state_5.sqlite")
db = sqlite3.connect(st)
db.execute("pragma journal_mode=wal"); db.execute("pragma wal_autocheckpoint=0")
db.execute(SCHEMA)
db.executemany("insert into threads values (?,?,?,?,?,?)", [
    ("thr-a1", r("codex-a", "a1"), "Alpha task", None, "/w/alpha", 0),
    ("thr-a2", r("codex-a", "a2"), "Archived one", None, "/w/arch", 1),
    ("thr-a4", r("codex-a", "a4"), "a very long first user message", "Named one", "/w/named", 0),
    ("thr-a5", r("codex-a", "a5"), "has\ttab and\nnewline", "", "/w/messy", 0),
    ("thr-a6", r("codex-a", "a6"), "Long cwd", None, longcwd, 0),
    ("thr-a7", r("codex-a", "a7"), "", None, "/w/untitled", 0),
])
db.commit()
for suffix in ("", "-wal"):
    shutil.copy(st + suffix, os.path.join(fx, "codex-a", "state_5.sqlite" + suffix))
db.close()
def plain(path, rows):
    c = sqlite3.connect(path); c.execute(SCHEMA)
    c.executemany("insert into threads values (?,?,?,?,?,?)", rows); c.commit(); c.close()
plain(os.path.join(fx, "codex-b", "state_5.sqlite"), [("thr-b1", r("codex-b", "b1"), "Alpha task", None, "/w/beta", 0)])
plain(os.path.join(fx, "home", ".codex", "state_5.sqlite"),
      [("thr-d1", os.path.join(fx, "home", ".codex", "sessions", "rollout-2026-10-29T10-00-00-d1.jsonl"), "Default home", None, "/w/default", 0)])
plain(os.path.join(fx, "codex-e", "state_5.sqlite"), [("thr-e1", r("codex-e", "e00"), "Locked", None, "/w/locked", 0)])
PY
if [ ! -s "$FX/codex-a/state_5.sqlite-wal" ]; then bad "fixture" "codex-a has no pending -wal; the write check would be blind"; echo "-- $PASS passed, $FAIL failed"; exit 1; fi
touch_ro() { mkdir -p "$(dirname "$1")"; : > "$1"; }
mk_proc() { # mk_proc <pid> <cmdline words...>
  local p=$1; shift; mkdir -p "$FX/proc/$p/fd"
  local IFS=$'\0'; printf '%s\0' "$@" > "$FX/proc/$p/cmdline"
}
mk_env() { printf 'PATH=/usr/bin\0CODEX_HOME=%s\0' "$2" > "$FX/proc/$1/environ"; }
fd() { touch_ro "$2"; ln -s "$2" "$FX/proc/$1/fd/$3"; }
# 5001: app-server on home codex-a: live, archived, named, messy title, long cwd, and one
#       rollout with no threads row (uuid in the file name)
mk_proc 5001 /opt/codex/bin/codex app-server --listen unix://; mk_env 5001 "$FX/codex-a"
fd 5001 "$(ro codex-a a1)" 3; fd 5001 "$(ro codex-a a2)" 4; fd 5001 "$(ro codex-a "$U_A3")" 5
fd 5001 "$(ro codex-a a4)" 6; fd 5001 "$(ro codex-a a5)" 7; fd 5001 "$(ro codex-a a6)" 10; fd 5001 "$(ro codex-a a7)" 11
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
# 5007: app-server on the LOCKED home, LOCKED_N open rollouts
mk_proc 5007 /opt/codex/bin/codex app-server; mk_env 5007 "$FX/codex-e"
for i in $(seq 1 "$LOCKED_N"); do fd 5007 "$(ro codex-e "e$(printf '%02d' "$i")")" $((i + 2)); done
# 5008: app-server whose CODEX_HOME contains a TAB
mk_proc 5008 /opt/codex/bin/codex app-server; mk_env 5008 "$TABHOME"
fd 5008 "$TABHOME/sessions/rollout-2026-10-29T10-00-00-$U_T1.jsonl" 3
EXPECT_ROWS=$((10 + LOCKED_N + 1))   # a1 a3 a4 a5 a6 a7 | b1 | c1 | d1 weird | 12 locked | tab home

# Hold an exclusive lock on codex-e for the whole run.
python3 -c 'import sqlite3,sys,time
c=sqlite3.connect(sys.argv[1],isolation_level=None); c.execute("begin exclusive"); open(sys.argv[2],"w").close(); time.sleep(600)' \
  "$FX/codex-e/state_5.sqlite" "$T/lockflag" & LOCKPID=$!
for _ in $(seq 1 50); do [ -e "$T/lockflag" ] && break; sleep 0.1; done
[ -e "$T/lockflag" ] || { bad "fixture" "could not lock codex-e"; echo "-- $PASS passed, $FAIL failed"; exit 1; }

# Pristine copies of the databases a faulty block might change; restored before every run.
DBHOMES="codex-a codex-b home/.codex"
for h in $DBHOMES; do mkdir -p "$T/pristine/$h"; cp -a "$FX/$h"/state_5.sqlite* "$T/pristine/$h/"; done
restore_dbs() {
  local h
  for h in $DBHOMES; do rm -f "$FX/$h"/state_5.sqlite*; cp -a "$T/pristine/$h"/state_5.sqlite* "$FX/$h/"; done
  rm -f "$FX/codex-c"/state_5.sqlite*
}
# The write check covers the main file and the -wal, NOT the -shm (a read-only open
# legitimately touches the -shm index).
sum_db() {
  local h f
  for h in $DBHOMES codex-e; do for f in state_5.sqlite state_5.sqlite-wal; do [ -e "$FX/$h/$f" ] && sha256sum "$FX/$h/$f"; done; done
  return 0
}
run_block() { CS_PEERS_PROC="$FX/proc" HOME="$FX/home" bash -c "$1" 2>"$T/stderr"; }
row() { awk -F'\t' -v s="$2" '$4==s' <<<"$1"; }
field() { cut -f"$2" <<<"$1"; }

# check_all <block>: every property; echoes each failing reason on stderr, returns 1 if any.
check_all() {
  local blk=$1 out failed=0 r t0 t1 before after
  restore_dbs
  before=$(sum_db)
  t0=$(date +%s%N); out=$(run_block "$blk"); t1=$(date +%s%N)
  after=$(sum_db)
  # 1. row count: 5001 gives 5, 5002 1, 5003 1, 5006 2, 5007 12, 5008 1
  [ "$(grep -c . <<<"$out")" = "$EXPECT_ROWS" ] || { echo "rows!=$EXPECT_ROWS" >&2; failed=1; }
  # 1b. every row has seven fields
  [ -z "$(awk -F'\t' 'NF!=7' <<<"$out")" ] || { echo "a row does not have 7 fields" >&2; failed=1; }
  # 2. R10 values on a plain row
  r=$(row "$out" thr-a1)
  [ "$(field "$r" 1)" = codex ] && [ "$(field "$r" 2)" = codex-a ] \
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
  # 12. the block never writes a database (main file and -wal unchanged; WAL fixture)
  [ "$before" = "$after" ] || { echo "database changed" >&2; failed=1; }
  # 13. the missing database was not created by the block
  [ ! -e "$FX/codex-c/state_5.sqlite" ] || { echo "state_5.sqlite created" >&2; failed=1; }
  # 14. LAUNCH-CWD is never cut (over 80 characters kept whole), a tab becomes a space
  [ "$(field "$(row "$out" thr-a6)" 7)" = "$LONGCWD_WANT" ] || { echo "cwd wrong: $(field "$(row "$out" thr-a6)" 7)" >&2; failed=1; }
  # 15. a tab in CODEX_HOME does not split ACCOUNT
  [ "$(field "$(row "$out" "$U_T1")" 2)" = "co dex-t" ] || { echo "account wrong: $(field "$(row "$out" "$U_T1")" 2)" >&2; failed=1; }
  # 17. a matched thread with an empty title and no name is (untitled); ? stays "unknown"
  [ "$(field "$(row "$out" thr-a7)" 5)" = "(untitled)" ] || { echo "untitled wrong: $(field "$(row "$out" thr-a7)" 5)" >&2; failed=1; }
  # 16. a locked database: every row of that home survives with NAME ?, and the run is fast
  [ "$(awk -F'\t' '$2=="codex-e" && $5=="?"' <<<"$out" | wc -l)" = "$LOCKED_N" ] || { echo "locked-home rows wrong" >&2; failed=1; }
  [ $(( (t1 - t0) / 1000000 )) -lt 4000 ] || { echo "slow: $(( (t1 - t0) / 1000000 )) ms for a locked home" >&2; failed=1; }
  return $failed
}

if check_all "$BLOCK" 2>"$T/why"; then ok "Enumerate block: all fixture properties hold"; else bad "Enumerate block" "$(cat "$T/why")"; fi

# the merge block turns an unmarked Codex-caller run into the loud warning
restore_dbs
m=$(run_block "$BLOCK" | CS_PEERS_NOW=2026-10-29T12:00:00Z bash -c "$MERGE" 2>&1)
if grep -qF 'WARNING: your own row was NOT identified' <<<"$m" && ! grep -qF 'peers' <<<"$m"; then ok "merge prints the loud warning for the unidentified Codex caller"; else bad "merge warning" "$m"; fi
if grep -qxF -- "-- 0 Claude Code sessions and $EXPECT_ROWS loaded Codex threads, across 6 account(s), at 2026-10-29T12:00:00Z" <<<"$m"; then ok "merge summary counts the $EXPECT_ROWS Codex rows under their own unit"; else bad "merge summary" "$m"; fi

# ---- controls: mutate a copy of the block; it must change, and check_all must FAIL with
# the named reason ----
control() { # control <label> <expected reason substring> <python-mutation: t -> t>
  local mut why
  mut=$(python3 -c 'import sys;t=sys.stdin.read();exec(sys.argv[1]);sys.stdout.write(t)' "$3" <<<"$BLOCK")
  if [ "$mut" = "$BLOCK" ]; then bad "control $1" "mutation did not change the block"; return; fi
  if why=$(check_all "$mut" 2>&1 >/dev/null); then bad "control $1" "mutated block still passed"
  elif grep -qF -- "$2" <<<"$why"; then ok "control $1 is caught ($2)"
  else bad "control $1" "failed, but not for '$2': $why"; fi
}
control drop_join       "plain row wrong"    't = t.replace("rollout_path = ?", "rollout_path = ? and 0")'
control keep_archived   "archived row"       't = t.replace("if found[4] == 1:", "if False:")'
control substring_match "non-app-server"     't = t.replace("\"app-server\" not in argv", "\"app-server\" not in \" \".join(argv)")'
control mark_you        "a row is marked"    't = t.replace(r"""print("\t".join(r))""", r"""print("\t".join(r) + "  <-- you")""")'
control write_rw        "database changed"   't = t.replace("mode=ro", "mode=rw")'
control write_rwc       "database changed"   't = t.replace("mode=ro", "mode=rwc")'
control title_first     "name/title rule"    't = t.replace("found[2] or found[1]", "found[1] or found[2]")'
control cwd_cut         "cwd wrong"          't = t.replace("one_line(found[3] or \"\")", "clean(found[3] or \"\")")'
control account_raw     "account wrong"      't = t.replace("account = one_line(", "account = (")'
control untitled_q      "untitled wrong"     't = t.replace("clean(found[2] or found[1] or \"\", \"(untitled)\")", "clean(found[2] or found[1] or \"\")")'
control slow_lock       "slow:"              't = t.replace("timeout=0.5", "timeout=5")'
control ask_again       "slow:"              't = t.replace("except sqlite3.Error:\n        dbs[codex_home] = None", "except sqlite3.Error:\n        pass")'

# ---- Deliver: structural pins. `codex queue` is never run for real (it talks to a real
# thread): the snippet is run below against a STUB `codex` on PATH. These assert the SHAPE
# of the section the agent will follow, each with a control that deletes exactly one thing
# from a scratch copy. The section is flattened (backticks and emphasis stripped, one
# line) because the prose is hard-wrapped.
deliver_flat() { awk '/^## Deliver/{s=1; next} s && /^## /{exit} s{print}' "$1" | tr '\n' ' ' | tr -d '*`' | tr -s ' '; }
has() { grep -qiE -- "$2" <<<"$1"; }
deliver_pins() {
  local s; s=$(deliver_flat "$1")
  has "$s" 'subprocess\.run\(\["codex", "queue", "--thread", sid, "--message", text\]' \
    && has "$s" "cat > \"[$]msg\" <<'MSG'" && has "$s" "python3 - <PID> <SID> \"[$]msg\" <<'PY'" \
    && has "$s" 'Send only to a row Enumerate listed as loaded; for a target that is not loaded, do not send and tell the operator why' \
    && has "$s" "The home is the row.s own, read from its process, never your own by default" \
    && has "$s" 'checks the size of the thread.s rollout file before the send and once after a bounded wait; pass its one line to the operator: the target, the time, and whether the file grew' \
    && has "$s" 'attached to a TUI: a turn starts' \
    && has "$s" 'loaded with nobody attached: a turn runs unwatched\. One measured case used about 17,700 tokens' \
    && has "$s" 'not loaded: the command exits 0 and prints Queued, nothing runs, and the message waits in queue_1.sqlite' \
    && has "$s" 'A loaded row can be the first outcome or the second, and Enumerate cannot tell them apart' \
    && has "$s" 'A send to a loaded row may start an unwatched, costly turn, and the operator has accepted that cost' \
    && has "$s" 'A Codex caller whose own row is not identified writes \? for the name and for any pid it cannot learn, and says in the message text that it cannot be answered by address'
}
if deliver_pins "$REF"; then ok "Deliver pins the argv-list send, the quoted heredoc, the guards, the outcomes, the cost and the caller fill rule"; else bad "Deliver pins" "a pinned sentence is missing from ## Deliver in $REF"; fi
dcontrol() { # dcontrol <label> <old> <new>
  local dst="$T/d-$1.md"
  python3 -c 'import sys;t=open(sys.argv[1]).read();open(sys.argv[2],"w").write(t.replace(sys.argv[3],sys.argv[4]))' "$REF" "$dst" "$2" "$3"
  if cmp -s "$REF" "$dst"; then bad "deliver control $1" "mutation did not change the copy"; return; fi
  if deliver_pins "$dst"; then bad "deliver control $1" "mutated copy still passed"; else ok "deliver control $1 is caught"; fi
}
dcontrol queue_form     '"codex", "queue", "--thread"' '"codex", "send", "--thread"'
dcontrol msg_heredoc    "<<'MSG'" '<<MSG'
dcontrol loaded_only    'Send only to a row Enumerate listed as `loaded`;' 'Send to any row;'
dcontrol not_loaded_why  'tell the operator why' 'stay quiet'
dcontrol home_guard     "2. The home is the row's own, read from its process, never your own by default." ''
dcontrol size_check     'rollout file before the send' 'rollout file'
dcontrol report_deleted 'pass its one line to the operator' 'say nothing'
dcontrol outcome_attach 'a turn starts there' 'it depends'
dcontrol outcome_tokens '17,700' 'many'
dcontrol outcome_queued '`queue_1.sqlite`' 'disk'
dcontrol outcome_exit0  'exits 0 and prints' 'prints'
dcontrol cannot_tell    'Enumerate cannot tell them apart' 'Enumerate can tell them apart'
dcontrol cost_accepted  'and the operator has accepted that cost' 'and nobody minds'
dcontrol fill_rule      'cannot be answered by address' 'can be answered by address'

# ---- the Deliver snippet, run for real against a fixture /proc tree and a STUB codex ----
# The stub records its argv (NUL-separated) and CODEX_HOME to files and exits 0; with
# STUB_GROW=1 it also appends to the rollout, as a delivered message would. The real
# `codex` is never started: the stub directory is the only thing put on PATH, first.
DBLOCK=$(awk '/^## Deliver/{s=1} s && /^```bash/{b=1; next} b && /^```/{exit} b{print}' "$REF")
DPROG=$(awk '/<<.PY.$/{b=1; next} b && /^PY$/{exit} b{print}' <<<"$DBLOCK")
if [ -z "$DPROG" ]; then bad "extract Deliver snippet" "no python program between <<'PY' and PY under ## Deliver"; DPROG='raise SystemExit("no snippet")'; fi
DX="$T/dx"; mkdir -p "$DX/proc" "$DX/bin" "$DX/work/codex-work/sessions"
SID_L=0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b0b; SID_X=1c1c1c1c-1c1c-4c1c-8c1c-1c1c1c1c1c1c
DROLL="$DX/work/codex-work/sessions/rollout-2026-10-29T10-00-00-$SID_L.jsonl"
DOTHER="$DX/work/codex-work/sessions/rollout-2026-10-29T10-00-00-$SID_X.jsonl"
: > "$DROLL"; : > "$DOTHER"; echo '{"seed":1}' > "$DROLL"
mkdir -p "$DX/proc/6001/fd" "$DX/proc/6002/fd" "$DX/proc/6003/fd"
printf '/opt/codex/bin/codex\0app-server\0' > "$DX/proc/6001/cmdline"; printf 'CODEX_HOME=%s\0' "$DX/work/codex-work" > "$DX/proc/6001/environ"
ln -s "$DROLL" "$DX/proc/6001/fd/3"
printf '/opt/codex/bin/codex\0app-server\0' > "$DX/proc/6002/cmdline"; printf 'CODEX_HOME=%s\0' "$DX/work/codex-work" > "$DX/proc/6002/environ"
ln -s "$DOTHER" "$DX/proc/6002/fd/3"      # holds a DIFFERENT thread: SID_L is not loaded here
printf 'codex\0resume\0x\0' > "$DX/proc/6003/cmdline"; ln -s "$DROLL" "$DX/proc/6003/fd/3"
cat > "$DX/bin/codex" <<'STUB'
#!/usr/bin/env bash
printf '%s\0' "$@" > "$STUB_OUT/argv"
printf '%s' "$CODEX_HOME" > "$STUB_OUT/home"
[ "${STUB_GROW:-}" = 1 ] && echo '{"queued":1}' >> "$STUB_ROLLOUT"
exit 0
STUB
chmod +x "$DX/bin/codex"
cat > "$DX/msg" <<'EOF'
[from codex/? "Codex effort steering experiment branch" pid ?, 2026-10-29T12:00:00Z] cost $1 and `id` and $(echo hi) with "quotes", 'single' and a  double  space; cannot be answered by address
EOF
run_deliver() { # run_deliver <program> <pid> <sid> <grow 0|1>: sets D_RC, D_OUT, D_ERR
  rm -f "$DX/out/argv" "$DX/out/home"; mkdir -p "$DX/out"
  D_OUT=$(CS_PEERS_PROC="$DX/proc" CS_PEERS_WAIT=0.2 PATH="$DX/bin:$PATH" STUB_OUT="$DX/out" STUB_GROW="$4" STUB_ROLLOUT="$DROLL" \
    python3 -I - "$2" "$3" "$DX/msg" <<<"$1" 2>"$DX/err"); D_RC=$?; D_ERR=$(cat "$DX/err")
}
deliver_checks() { # deliver_checks <program>: echoes each failing reason on stderr
  local prog=$1 failed=0 want got
  want=$(python3 -c 'import sys;print(open(sys.argv[1]).read().rstrip("\n"),end="")' "$DX/msg")
  run_deliver "$prog" 6001 "$SID_L" 1
  got=$(python3 -c 'import sys;print(repr(open(sys.argv[1],"rb").read().decode().split("\0")[:-1]))' "$DX/out/argv" 2>/dev/null)
  [ "$D_RC" = 0 ] || { echo "send failed rc=$D_RC: $D_ERR" >&2; failed=1; }
  [ "$got" = "$(python3 -c 'import sys;print(repr(["queue","--thread",sys.argv[1],"--message",sys.argv[2]]))' "$SID_L" "$want")" ] || { echo "argv wrong: $got" >&2; failed=1; }
  [ "$(cat "$DX/out/home" 2>/dev/null)" = "$DX/work/codex-work" ] || { echo "home wrong: $(cat "$DX/out/home" 2>/dev/null)" >&2; failed=1; }
  grep -q 'rollout grew' <<<"$D_OUT" && grep -qF "$SID_L" <<<"$D_OUT" || { echo "report wrong (grew): $D_OUT" >&2; failed=1; }
  run_deliver "$prog" 6001 "$SID_L" 0
  grep -q 'rollout did not grow' <<<"$D_OUT" || { echo "report wrong (no growth): $D_OUT" >&2; failed=1; }
  run_deliver "$prog" 6002 "$SID_L" 0
  { [ "$D_RC" != 0 ] && [ ! -e "$DX/out/argv" ] && grep -q 'Tell the operator why' <<<"$D_ERR"; } || { echo "sent to a thread that is not loaded (rc=$D_RC)" >&2; failed=1; }
  run_deliver "$prog" 6003 "$SID_L" 0
  { [ "$D_RC" != 0 ] && [ ! -e "$DX/out/argv" ]; } || { echo "sent via a non-app-server process" >&2; failed=1; }
  run_deliver "$prog" 6001 '?' 0
  { [ "$D_RC" != 0 ] && [ ! -e "$DX/out/argv" ]; } || { echo "sent to SID ?" >&2; failed=1; }
  return $failed
}
if why=$(deliver_checks "$DPROG" 2>&1 >/dev/null); then ok "Deliver snippet: argv list intact, row's own home, loaded guard, size report (stub codex)"; else bad "Deliver snippet" "$why"; fi
dprog_control() { # dprog_control <label> <expected reason> <python-mutation: t -> t>
  local mut why
  mut=$(python3 -c 'import sys;t=sys.stdin.read();exec(sys.argv[1]);sys.stdout.write(t)' "$3" <<<"$DPROG")
  if [ "$mut" = "$DPROG" ]; then bad "snippet control $1" "mutation did not change the snippet"; return; fi
  if why=$(deliver_checks "$mut" 2>&1 >/dev/null); then bad "snippet control $1" "mutated snippet still passed"
  elif grep -qF -- "$2" <<<"$why"; then ok "snippet control $1 is caught ($2)"
  else bad "snippet control $1" "failed, but not for '$2': $why"; fi
}
dprog_control any_rollout   "sent to a thread that is not loaded" 't = t.replace("and sid in base", "")'
dprog_control shell_string  "argv wrong"                          't = t.replace("subprocess.run([\"codex\", \"queue\", \"--thread\", sid, \"--message\", text],", "subprocess.run(\"codex queue --thread %s --message \\\"%s\\\"\" % (sid, text), shell=True,")'
dprog_control home_basename "home wrong"                          't = t.replace("CODEX_HOME=codex_home", "CODEX_HOME=os.path.join(os.environ.get(\"HOME\", \"\"), \".codex\", os.path.basename(codex_home))")'
dprog_control always_grew   "report wrong (no growth)"            't = t.replace("\"grew\" if after > before else \"did not grow\"", "\"grew\"")'
dprog_control no_app_check  "sent via a non-app-server"           't = t.replace("\"app-server\" not in", "False and \"app-server\" not in")'

echo "-- peer-codex-enumerate: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
