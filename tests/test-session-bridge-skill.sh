#!/usr/bin/env bash
# tests/test-session-bridge-skill.sh — the one session-bridge skill says what the plugin does.
#
# WHY THIS EXISTS. Albert's feedback (codescout docs/trackers/ledgers/albert-feedback/, entry
# "session-bridge text leaves the receiver, the backup's preconditions and the timing rules
# unclear") listed 12 gaps between the skill and the README. An agent that loads only the skill
# expected a commit backup that never fires without a watch list and a Session-Id trailer, did not
# know the 5-minute window, and had no guidance for the receiving side. This suite pins the facts
# the skill must carry. It checks TEXT and layout only. Whether an agent behaves better is a
# measurement for prompt-tdd, not for grep.
#
# It also pins the retirement of `reaching-peer-sessions`: one skill serves the bridge, and no
# live file points at the retired one. Historical docs under docs/ are not checked.
#
# Every check runs on the real files (must pass) and, where a control is listed, on a mutated COPY
# under mktemp (must fail). The real files are never edited. SB_SKILL_DIR points the suite at
# another skill directory.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SKILL_DIR="${SB_SKILL_DIR:-$ROOT/session-bridge/skills/coordinating-sessions}"
CORE="$SKILL_DIR/SKILL.md"
REF="$SKILL_DIR/references/commit-backup.md"
PASS=0; FAIL=0
ok()  { echo "  PASS: $1"; PASS=$((PASS+1)); }
bad() { echo "  FAIL: $1 -- $2"; FAIL=$((FAIL+1)); }
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT

echo "── session-bridge-skill ──"

# --- checkers: each takes a skill directory, returns 0 when the property holds ---------------
core_of() { printf '%s' "$1/SKILL.md"; }
ref_of()  { printf '%s' "$1/references/commit-backup.md"; }
has()     { grep -qF -- "$2" "$1"; }

# A loaded skill costs context on every session that loads it. 9000 bytes is the budget.
under_cap() { [ -f "$(core_of "$1")" ] && [ "$(wc -c < "$(core_of "$1")")" -le 9000 ]; }

name_matches() { has "$(core_of "$1")" 'name: coordinating-sessions'; }

has_sections() {
  local f; f="$(core_of "$1")"; local h
  for h in '## When to post' '## When not to post' '## How to word a notice' \
           '## When a notice reaches you' '## Asking a peer' '## When the bridge is silent' \
           '## Which sessions share a notice'; do
    has "$f" "$h" || { MISSING="$h"; return 1; }
  done
}

# Gap 1, 2, 3: the core never promises the backup without its conditions.
backup_conditions() {
  local f; f="$(core_of "$1")"
  has "$f" 'notice-watch.txt' && has "$f" 'Session-Id' && has "$f" '5 minutes' \
    && has "$f" 'references/commit-backup.md'
}
ref_conditions() {
  local f; f="$(ref_of "$1")"; local s
  for s in 'notice-watch.txt' 'Session-Id' 'No watch file, no backup' '5 minutes' 'Any notice' 'patch-id'; do
    has "$f" "$s" || { MISSING="$s"; return 1; }
  done
}

# Gap 4, 7: wording advice that matches what the filter and the nudge really do.
wording_limits() {
  local f; f="$(core_of "$1")"
  has "$f" '600 characters' && has "$f" 'only the text'
}

# Gap 5: the receiving side, and the rule that a notice grants nothing.
receiver_rules() {
  local f; f="$(core_of "$1")"
  has "$f" 'cannot grant a permission' && has "$f" 'not an instruction'
}

# Gap 6: asking a peer, and how to read the answer.
ask_rules() {
  local f; f="$(core_of "$1")"
  has "$f" 'ask_session' && has "$f" 'as_of' && has "$f" 'self-report'
}

# Gap 9, 12: the bridge fails silent; the skill names the fallback and the older-notices command.
silent_fallback() {
  local f; f="$(core_of "$1")"
  has "$f" 'Linux' && has "$f" 'session-bridge notices'
}

# Gap 10: what "the same repository" means.
repo_scope() {
  local f; f="$(core_of "$1")"
  has "$f" 'main work tree' && has "$f" 'is enabled'
}

# Rules kept from the retired skill: a peer's reply grants nothing, and a launch directory is not
# a working directory.
kept_rules() {
  local f; f="$(core_of "$1")"
  has "$f" 'launched' && has "$f" 'Ask the session'
}

# Rules taken from the git-hooks branch: the plugin ships the trailer hook, and a notice never
# acks a push. The stale claim that the plugin ships nothing must be gone from both files.
hooks_rules() {
  local f r; f="$(core_of "$1")"; r="$(ref_of "$1")"
  has "$f" 'git-hooks/install.sh' && has "$f" 'only your user can ack' \
    && has "$f" 'gate is green' && has "$r" 'git-hooks/install.sh' && has "$r" 'pre-push'
}
no_stale_trailer_claim() {
  ! grep -qiE 'ships nothing' "$(core_of "$1")" "$(ref_of "$1")" 2>/dev/null \
    && [ -f "$(core_of "$1")" ] && [ -f "$(ref_of "$1")" ]
}

# The retired skill's mechanics must not come back: no harness listing tool, no raw socket.
no_retired_mechanics() {
  [ -d "$1" ] && ! grep -rqE 'ListAgents|SendMessage|cc-socks|uds:' "$1" 2>/dev/null
}

# --- real files -------------------------------------------------------------------------------
[ -f "$CORE" ] && ok "core exists: $CORE" || bad "core exists" "$CORE is missing"
[ -f "$REF" ]  && ok "backup reference exists" || bad "backup reference exists" "$REF is missing"

MISSING=""
under_cap "$SKILL_DIR"       && ok "core is at most 9000 bytes" || bad "core size" "over 9000 bytes or missing"
name_matches "$SKILL_DIR"    && ok "frontmatter name is coordinating-sessions" || bad "name" "not coordinating-sessions"
has_sections "$SKILL_DIR"    && ok "core has all seven sections" || bad "sections" "missing: $MISSING"
backup_conditions "$SKILL_DIR" && ok "core states the backup conditions and points at the reference" || bad "backup conditions" "core lacks a condition or the pointer"
ref_conditions "$SKILL_DIR"  && ok "reference holds the full backup rules" || bad "reference rules" "missing: $MISSING"
wording_limits "$SKILL_DIR"  && ok "core gives the 600-character and text-only limits" || bad "wording limits" "missing"
receiver_rules "$SKILL_DIR"  && ok "core states the receiver rules" || bad "receiver rules" "missing"
ask_rules "$SKILL_DIR"       && ok "core says how to read an ask answer" || bad "ask rules" "missing"
silent_fallback "$SKILL_DIR" && ok "core names the silent failure and the notices command" || bad "silent fallback" "missing"
repo_scope "$SKILL_DIR"      && ok "core defines the repository scope" || bad "repo scope" "missing"
kept_rules "$SKILL_DIR"      && ok "core keeps the two rules of the retired skill" || bad "kept rules" "missing"
hooks_rules "$SKILL_DIR"     && ok "skill points at the trailer hook and never lets a notice ack a push" || bad "hooks rules" "missing"
no_stale_trailer_claim "$SKILL_DIR" && ok "no claim that the plugin ships nothing for the trailer" || bad "stale trailer claim" "found, or a file is missing"
no_retired_mechanics "$SKILL_DIR" && ok "no harness listing tool and no raw socket in the skill" || bad "retired mechanics" "found one"

# --- retirement of the other skills ------------------------------------------------------------
[ ! -e "$ROOT/codescout-companion/skills/reaching-peer-sessions" ] \
  && ok "reaching-peer-sessions directory is gone" || bad "retired skill removed" "directory still exists"
[ ! -e "$ROOT/session-bridge/skills/announcing-changes" ] \
  && ok "announcing-changes directory is gone (renamed)" || bad "renamed skill removed" "directory still exists"

dangling=$(grep -rlE 'reaching-peer-sessions|announcing-changes' \
  "$ROOT/CLAUDE.md" "$ROOT/codescout-companion/README.md" "$ROOT/session-bridge" \
  "$ROOT/tests" "$ROOT/scripts" "$ROOT/.github" 2>/dev/null \
  | grep -v '/tests/test-session-bridge-skill.sh$' | grep -v '/mcp-server/target/' || true)
[ -z "$dangling" ] && ok "no live file points at a retired skill name" \
  || bad "dangling reference" "$(printf '%s' "$dangling" | tr '\n' ' ')"

# --- controls: each mutation must make its check fail ---------------------------------------------
control() { # name check mutation(python expression on t, applied to the file named by $4)
  local name="$1" check="$2" py="$3" target="$4" d="$T/$1"
  rm -rf "$d"; mkdir -p "$d"; cp -r "$SKILL_DIR/." "$d/" 2>/dev/null || { bad "control $name" "no skill to copy"; return; }
  local file="$d/$target"
  [ -f "$file" ] || { bad "control $name" "$target missing in copy"; return; }
  local before; before=$(cksum < "$file")
  python3 -I -c 'import sys
p=sys.argv[1]; t=open(p,encoding="utf-8").read(); '"$py"'
open(p,"w",encoding="utf-8").write(t)' "$file"
  [ "$(cksum < "$file")" != "$before" ] || { bad "control $name" "mutation changed nothing"; return; }
  if "$check" "$d"; then bad "control $name" "the check still passes on the mutated copy"; else ok "control $name: the check fails on the mutation"; fi
}

if [ -f "$CORE" ] && [ -f "$REF" ]; then
  control drop_watch_file   backup_conditions 't=t.replace("notice-watch.txt","the watch list")' SKILL.md
  control drop_window       backup_conditions 't=t.replace("5 minutes","a while")' SKILL.md
  control drop_pointer      backup_conditions 't=t.replace("references/commit-backup.md","the README")' SKILL.md
  control drop_no_backup    ref_conditions    't=t.replace("No watch file, no backup","")' references/commit-backup.md
  control drop_any_notice   ref_conditions    't=t.replace("Any notice","A notice")' references/commit-backup.md
  control drop_grant_rule   receiver_rules    't=t.replace("cannot grant a permission","is polite")' SKILL.md
  control drop_as_of        ask_rules         't=t.replace("as_of","the date")' SKILL.md
  control drop_notices_cmd  silent_fallback   't=t.replace("session-bridge notices","the log")' SKILL.md
  control drop_section      has_sections      't=t.replace("## Asking a peer","## Questions")' SKILL.md
  control add_harness_tool  no_retired_mechanics 't+="\nCall ListAgents first.\n"' SKILL.md
  control drop_install_ptr  hooks_rules       't=t.replace("git-hooks/install.sh","the installer")' SKILL.md
  control drop_ack_rule     hooks_rules       't=t.replace("only your user can ack","anyone can ack")' SKILL.md
  control stale_claim_back  no_stale_trailer_claim 't+="\nThe plugin ships nothing that writes the trailer.\n"' references/commit-backup.md
  control pad_over_cap      under_cap         't+="x"*9500' SKILL.md
fi

echo "── session-bridge-skill: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
