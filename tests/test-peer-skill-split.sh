#!/usr/bin/env bash
# tests/test-peer-skill-split.sh — reaching-peer-sessions core/reference split invariants.
#
# The skill serves two harnesses (Claude Code, Codex). Its core SKILL.md holds the
# harness-neutral rules, steps and ONE merge-and-summary block; each harness's mechanics
# live in references/<harness>.md (repo CLAUDE.md, "Skill layout"). These are STRUCTURAL
# assertions: they guard the shape (size, pointers, no harness tool names in the core, the
# merge block's behaviour on row fixtures) and claim nothing about agent behaviour.
#
# Modeled on tests/test-recon-skill-split.sh. NOT VACUOUS BY CONSTRUCTION: every check is a
# function of one file, run on the real file (must pass) and on a mutated COPY under mktemp
# (must fail); each control also proves its mutation changed the copy. The real files are
# never edited. PEER_SKILL_DIR points the suite at another skill dir.
#
# Task 3 creates references/codex.md; this suite asserts the Claude reference fully and the
# Codex POINTER text only. The Codex reference's own existence belongs to Task 3's test.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SKILL_DIR="${PEER_SKILL_DIR:-$ROOT/codescout-companion/skills/reaching-peer-sessions}"
CORE="$SKILL_DIR/SKILL.md"
REF="$SKILL_DIR/references/claude-code.md"
PASS=0; FAIL=0
ok()  { echo "  PASS: $1"; PASS=$((PASS+1)); }
bad() { echo "  FAIL: $1 — $2"; FAIL=$((FAIL+1)); }
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
TAB=$(printf '\t')

echo "── peer-skill-split ──"

# Same measured floor as the recon skill: the largest hook payload seen delivered intact.
# A failure means move text to references/, never raise the number.
CAP=14056

# ---- checks (each takes the file to judge) ----
under_cap()      { [ "$(wc -c <"$1")" -lt "$CAP" ]; }
has_headings()   { local h; for h in '## Enumerate' '## Identify me' '## Deliver'; do grep -qxF "$h" "$1" || return 1; done; }
cites_claude()   { grep -qF 'references/claude-code.md' "$1"; }
cites_codex()    { grep -qF 'on Codex, read `references/codex.md`' "$1"; }
no_at_link()     { ! grep -qE '@[A-Za-z0-9_./-]*references/' "$1"; }
# Harness tool names may appear only on the two pointer lines (matched by shape) and on the
# frontmatter `description:` line (activation metadata, not a rule). Every other line of the
# file, frontmatter keys included, must stay harness-neutral. The whole file is scanned, so
# deleting the frontmatter cannot exempt the body.
POINTER_RE='^- on (Claude Code|Codex), read `references/[a-z-]+\.md`$'
no_harness_names() {
  # Captured, not `! a | b | grep -q`: under pipefail a quiet grep -q closes the pipe early
  # and the upstream SIGPIPE flips the verdict.
  local hits
  hits=$(grep -vE "$POINTER_RE|^description:" "$1" \
      | grep -E 'ListAgents|SendMessage|codex queue|cc-socks|state_5\.sqlite')
  [ -z "$hits" ]
}
has_everywhere_rules() {
  grep -qF 'Take the sessionId, not the name' "$1" && grep -qF 'Never route by adjacency' "$1" \
    && grep -qF 'Address a' "$1" && grep -qF 'by its `SID`' "$1"
}
single_account_keeps_label() {
  local sec; sec=$(awk '/^## Step 2/{s=1; next} s && /^## /{exit} s{print}' "$1" | tr '\n' ' ')
  grep -qF 'every message carries the' <<<"$sec" && grep -qF 'addressed by its `SID`' <<<"$sec" \
    && ! grep -qF 'ignore the rest of this skill' <<<"$sec"
}
step4_survives() {
  grep -qF '## Step 4 — before acting on where a peer is WORKING, ask' "$1" \
    && grep -qF 'are you working in <path> right now?' "$1"
}
one_block() { [ "$(grep -c '^```bash' "$1")" -eq 1 ]; }
merge_block() { awk '/^```bash/{b=1; next} b && /^```/{exit} b{print}' "$1"; }

# run <core-file> <rows-text>: run the merge block extracted from the file on the rows.
run_merge() {
  local blk; blk=$(merge_block "$1")
  printf '%s' "$2" | CS_PEERS_NOW=2026-10-29T12:00:00Z bash -c "$blk" 2>&1
}
ROWS_YOU=$(printf '%s\n' \
  "codex${TAB}acctA${TAB}201${TAB}thr1${TAB}codex one${TAB}loaded${TAB}/w/c" \
  "claude${TAB}acctB${TAB}102${TAB}sid2${TAB}peer${TAB}idle${TAB}/w/b" \
  "claude${TAB}acctA z${TAB}103${TAB}sid3${TAB}spaced account${TAB}idle${TAB}/w/d" \
  "claude${TAB}acctA${TAB}101${TAB}sid1${TAB}name with space${TAB}busy${TAB}/w/a  <-- you")
ROWS_NOYOU=${ROWS_YOU//  <-- you/}
ROWS_NOYOU=$ROWS_NOYOU$'\n'
ROWS_YOU=$ROWS_YOU$'\n'
HEADER="HARNESS${TAB}ACCOUNT${TAB}PID${TAB}SID${TAB}NAME${TAB}STATUS${TAB}LAUNCH-CWD"
SUMMARY='-- 3 Claude Code sessions (2 peers plus you) and 1 loaded Codex threads, across 3 account(s), at 2026-10-29T12:00:00Z'

merge_prints_summary() {
  local o; o=$(run_merge "$1" "$ROWS_YOU")
  [ "$(head -1 <<<"$o")" = "$HEADER" ] && grep -qxF -- "$SUMMARY" <<<"$o"
}
# Sorted by ACCOUNT then HARNESS; a NAME with a space stays on its own row (7 tab fields); an ACCOUNT with a space proves the explicit tab separator.
merge_sorts_rows() {
  local o; o=$(run_merge "$1" "$ROWS_YOU")
  [ "$(sed -n '2,5p' <<<"$o" | cut -f3 | tr '\n' ' ')" = "101 201 103 102 " ] \
    && [ "$(sed -n 2p <<<"$o" | cut -f5)" = "name with space" ] \
    && [ "$(sed -n 2p <<<"$o" | cut -f1-7 | tr -cd '\t' | wc -c)" -eq 6 ]
}
merge_warns_unmarked() {
  local o; o=$(run_merge "$1" "$ROWS_NOYOU")
  grep -qF 'WARNING: your own row was NOT identified' <<<"$o" \
    && grep -qF 'Do NOT report a peer count from this run' <<<"$o" \
    && ! grep -qF 'peers plus you' <<<"$o" \
    && grep -qF -- '-- 3 Claude Code sessions and 1 loaded Codex threads, across 3 account(s), at 2026-10-29T12:00:00Z' <<<"$o"
}

# ---- real file: every check must pass ----
declare -A CHECKS=(
  [core_under_cap]="under_cap"
  [core_cites_claude_reference]="cites_claude"
  [core_names_codex_pointer]="cites_codex"
  [core_has_no_at_links]="no_at_link"
  [core_names_no_harness_tool_outside_pointers]="no_harness_names"
  [step4_heading_and_question_survive]="step4_survives"
  [core_states_sessionid_and_no_adjacency_rules]="has_everywhere_rules"
  [step2_single_account_keeps_label_and_sid]="single_account_keeps_label"
  [core_has_exactly_one_bash_block_the_merge]="one_block"
  [merge_prints_header_and_two_unit_summary]="merge_prints_summary"
  [merge_sorts_by_account_then_harness_keeping_spaced_names]="merge_sorts_rows"
  [merge_warns_and_drops_peer_figure_when_unmarked]="merge_warns_unmarked"
)
if [ -f "$CORE" ]; then ok "core SKILL.md exists"; else bad "core SKILL.md" "missing $CORE"; echo "── $PASS passed, $FAIL failed"; exit 1; fi
for name in "${!CHECKS[@]}"; do
  if "${CHECKS[$name]}" "$CORE"; then ok "$name"; else bad "$name" "check ${CHECKS[$name]} failed on $CORE"; fi
done
if [ -f "$REF" ]; then ok "references/claude-code.md exists"; else bad "references/claude-code.md" "missing"; fi
if has_headings "$REF"; then ok "claude reference has Enumerate, Identify me, Deliver"; else bad "claude reference headings" "one of ## Enumerate / ## Identify me / ## Deliver missing"; fi
[ -d "$SKILL_DIR/references" ] && ok "references/ dir name preserved" || bad "references/ dir" "missing or renamed"

# ---- controls: each mutates a copy, must change it, and the check must then FAIL ----
# control <label> <check-fn> <file> <python-mutation: t -> t>
control() {
  local label=$1 fn=$2 src=$3 mut=$4 dst="$T/ctl-$1.md"
  python3 -c 'import sys;t=open(sys.argv[1]).read();exec(sys.argv[3]);open(sys.argv[2],"w").write(t)' "$src" "$dst" "$mut"
  if cmp -s "$src" "$dst"; then bad "control $label" "mutation did not change the copy"; return; fi
  if "$fn" "$dst"; then bad "control $label" "mutated copy still passed $fn"; else ok "control $label is caught"; fi
}
control oversize        under_cap          "$CORE" 't += "x" * 15000'
control no_claude_ptr   cites_claude       "$CORE" 't = t.replace("references/claude-code.md", "claude-code.md")'
control no_codex_ptr    cites_codex        "$CORE" 't = t.replace("on Codex, read", "on Codex, see")'
control at_link         no_at_link         "$CORE" 't += "\n@references/claude-code.md\n"'
control tool_name       no_harness_names   "$CORE" 't += "\nPost with SendMessage to the peer.\n"'
control cc_socks_path   no_harness_names   "$CORE" 't += "\nSocket at /run/user/1000/cc-socks/1.sock\n"'
control step4_heading   step4_survives     "$CORE" 't = t.replace("## Step 4 — before acting", "## Step 4 — acting")'
control step4_question  step4_survives     "$CORE" 't = t.replace("are you working in <path> right now?", "")'
control second_block    one_block          "$CORE" 't += "\n```bash\necho hi\n```\n"'
control header_gone     merge_prints_summary "$CORE" 't = t.replace("LAUNCH-CWD", "CWD")'
control summary_old     merge_prints_summary "$CORE" 't = t.replace("loaded Codex threads", "Codex threads")'
control sort_by_pid     merge_sorts_rows   "$CORE" 't = t.replace("-k2,2 -k1,1", "-k3,3")'
control sort_no_tab     merge_sorts_rows   "$CORE" 't = t.replace("sort -t \"$tab\"", "sort")'
control warning_gone    merge_warns_unmarked "$CORE" 't = t.replace("WARNING: your own row was NOT identified", "note")'
control warn_keeps_peer merge_warns_unmarked "$CORE" 't = t.replace("Claude Code sessions and %s loaded", "Claude Code sessions (0 peers plus you) and %s loaded")'
control ref_no_deliver  has_headings       "$REF"  't = t.replace("## Deliver", "## Send")'
control ref_no_enum     has_headings       "$REF"  't = t.replace("## Enumerate", "## List")'

control rule_sessionid  has_everywhere_rules "$CORE" 't = t.replace("Take the sessionId, not the name", "Take the name")'
control rule_adjacency  has_everywhere_rules "$CORE" 't = t.replace("Never route by adjacency", "Route freely")'
control step2_ignore    single_account_keeps_label "$CORE" 't = t.replace("every message carries the", "ignore the rest of this skill; every message carries the")'
control step2_no_sid    single_account_keeps_label "$CORE" 't = t.replace("addressed by its `SID`", "addressed by name")'
# Lint controls beyond appending a plain body line: the exemption must be the pointer SHAPE
# and the description line only.
control lint_ref_mention no_harness_names "$CORE" 't += "\nReply with SendMessage; the address forms are in references/claude-code.md.\n"'
control lint_no_frontmatter no_harness_names "$CORE" 't = t.split("---\n", 2)[2] + "\nAlways call ListAgents first.\n"'
control lint_other_key  no_harness_names "$CORE" 't = t.replace("name: reaching-peer-sessions", "name: reaching-peer-sessions\nsee: cc-socks state_5.sqlite", 1)'
# Allowances are real, not a blanket pass.
printf -- '---\nname: x\ndescription: use SendMessage or ListAgents\n---\n- on Claude Code, read `references/claude-code.md`\n' > "$T/allow.md"
if no_harness_names "$T/allow.md"; then ok "description line and pointer-shaped line are allowed"; else bad "lint allowance" "flagged an allowed line"; fi

echo "── peer-skill-split: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
