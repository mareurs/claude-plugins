#!/usr/bin/env bash
# tests/test-session-bridge-git-hooks.sh — the session-bridge git hooks (prepare-commit-msg,
# pre-push, install.sh) in throwaway repositories.
#
# Every scenario runs real git against a work repository and a bare `origin`. Session ids are
# invented (`sess-a`, `sess-b`). The ambient session variables are unset at the top, so no real
# session id can leak into a fixture.
#
# NOT VACUOUS BY CONSTRUCTION. Three mutation controls at the end copy the hooks, break one rule
# in the copy, and run the scenario that rule guards. The scenario must then go the WRONG way.
# A control that does not change the outcome means the scenario cannot detect that rule.
# SBG_HOOKS_DIR points the suite at another copy of the hooks.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOOKS="${SBG_HOOKS_DIR:-$ROOT/session-bridge/git-hooks}"
PASS=0; FAIL=0
ok()  { echo "  PASS: $1"; PASS=$((PASS+1)); }
bad() { echo "  FAIL: $1 — $2"; FAIL=$((FAIL+1)); }
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT

# A clean environment: no ambient session, no user git config.
unset CLAUDE_CODE_SESSION_ID AGENT_SESSION_ID
for v in $(compgen -v | grep '^SESSION_BRIDGE_'); do unset "$v"; done
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@example.invalid GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@example.invalid

echo "── session-bridge git hooks ──"

# ---- helpers ----
# new_repo <name> [hooks dir]: a work repository with the hooks installed and one pushed commit.
new_repo() {
    local name="$1" src="${2:-$HOOKS}"
    git init -q --bare "$T/$name.origin.git"
    git init -q -b main "$T/$name"
    git -C "$T/$name" remote add origin "$T/$name.origin.git"
    bash "$src/install.sh" --repo "$T/$name" >/dev/null
    echo base > "$T/$name/f"
    git -C "$T/$name" add f
    git -C "$T/$name" commit -q -m "base"
    git -C "$T/$name" push -q origin main 2>/dev/null
}
# commit_as <repo> <sid|-> <subject>: one commit; `-` means no session identity.
commit_as() {
    local repo="$1" sid="$2" subj="$3"
    echo "$subj" >> "$T/$repo/f"
    git -C "$T/$repo" add f
    if [ "$sid" = "-" ]; then
        git -C "$T/$repo" commit -q -m "$subj"
    else
        CLAUDE_CODE_SESSION_ID="$sid" git -C "$T/$repo" commit -q -m "$subj"
    fi
}
# push_as <repo> <sid|-> [VAR=value ...] -- sets PUSH_RC and PUSH_OUT.
push_as() {
    local repo="$1" sid="$2"; shift 2
    local envs=("$@")
    if [ "$sid" = "-" ]; then
        PUSH_OUT="$(cd "$T/$repo" && env ${envs[@]+"${envs[@]}"} git push origin main 2>&1)"; PUSH_RC=$?
    else
        PUSH_OUT="$(cd "$T/$repo" && env CLAUDE_CODE_SESSION_ID="$sid" ${envs[@]+"${envs[@]}"} git push origin main 2>&1)"; PUSH_RC=$?
    fi
}
trailer_of() { git -C "$T/$1" log -1 --format='%(trailers:key='"${2:-Session-Id}"',valueonly,separator=%x2C)' | tr -d '\n'; }
eq()  { [ "$2" = "$3" ] && ok "$1" || bad "$1" "expected [$3], got [$2]"; }
has() { printf '%s' "$3" | grep -qF -- "$2" && ok "$1" || bad "$1" "missing [$2] in: $3"; }
hasnt() { printf '%s' "$3" | grep -qF -- "$2" && bad "$1" "unexpected [$2] in: $3" || ok "$1"; }

# ---- install.sh ----
mkdir -p "$T/inst" && git init -q "$T/inst"
out="$(bash "$HOOKS/install.sh" --repo "$T/inst" --check)"; rc=$?
eq "install --check: exit 1 before install" "$rc" 1
has "install --check: names the missing hook" "MISSING pre-push" "$out"
bash "$HOOKS/install.sh" --repo "$T/inst" >/dev/null
out="$(bash "$HOOKS/install.sh" --repo "$T/inst" --check)"; rc=$?
eq "install --check: exit 0 after install" "$rc" 0
has "install --check: lists every file OK" "OK session-bridge-lib.sh" "$out"
echo "# tampered" >> "$T/inst/.git/hooks/pre-push"
out="$(bash "$HOOKS/install.sh" --repo "$T/inst" --check)"; rc=$?
eq "install --check: a changed hook is reported" "$out" "$(printf 'OK prepare-commit-msg\nDIFFERS pre-push\nOK session-bridge-lib.sh')"
mkdir -p "$T/inst2" && git init -q "$T/inst2"
printf '#!/bin/sh\necho other-tool\n' > "$T/inst2/.git/hooks/pre-push"; chmod +x "$T/inst2/.git/hooks/pre-push"
out="$(bash "$HOOKS/install.sh" --repo "$T/inst2" 2>&1)"; rc=$?
eq "install: refuses a hook of another tool" "$rc" 1
has "install: names the file it refused" "pre-push" "$out"
eq "install: writes nothing on a refusal" "$([ -e "$T/inst2/.git/hooks/prepare-commit-msg" ] && echo written || echo clean)" clean
bash "$HOOKS/install.sh" --repo "$T/inst2" --force >/dev/null; rc=$?
eq "install --force: overwrites it" "$rc" 0

# ---- prepare-commit-msg ----
new_repo pcm
commit_as pcm sess-a "stamped"
eq "stamp: the trailer carries the session id" "$(trailer_of pcm)" "sess-a"
CLAUDE_CODE_SESSION_ID=sess-a git -C "$T/pcm" commit -q --amend --no-edit
eq "stamp: an amend by the same session adds no second trailer" "$(trailer_of pcm)" "sess-a"
CLAUDE_CODE_SESSION_ID=sess-b git -C "$T/pcm" commit -q --amend --no-edit
eq "stamp: an amend by another session keeps the author" "$(trailer_of pcm)" "sess-a"
commit_as pcm - "no identity"
eq "stamp: no identity, no trailer" "$(trailer_of pcm)" ""
echo agent >> "$T/pcm/f"; git -C "$T/pcm" add f
AGENT_SESSION_ID=agent-1 git -C "$T/pcm" commit -q -m "agent fallback"
eq "stamp: AGENT_SESSION_ID is the fallback" "$(trailer_of pcm)" "agent-1"
echo cmd >> "$T/pcm/f"; git -C "$T/pcm" add f
SESSION_BRIDGE_IDENTITY_CMD='echo from-cmd' git -C "$T/pcm" commit -q -m "identity cmd"
eq "stamp: SESSION_BRIDGE_IDENTITY_CMD sets the identity" "$(trailer_of pcm)" "from-cmd"
echo key >> "$T/pcm/f"; git -C "$T/pcm" add f
CLAUDE_CODE_SESSION_ID=sess-a SESSION_BRIDGE_TRAILER=Agent-Id git -C "$T/pcm" commit -q -m "custom trailer"
eq "stamp: SESSION_BRIDGE_TRAILER renames the key" "$(trailer_of pcm Agent-Id)" "sess-a"
echo fail >> "$T/pcm/f"; git -C "$T/pcm" add f
out="$(SESSION_BRIDGE_IDENTITY_CMD='exit 3' git -C "$T/pcm" commit -q -m "conflict" 2>&1)"; rc=$?
eq "stamp: a failing identity command refuses the commit" "$([ "$rc" -ne 0 ] && echo refused || echo allowed)" refused
has "stamp: the refusal names the cause" "identity command failed" "$out"
git -C "$T/pcm" reset -q --hard
echo hand >> "$T/pcm/f"; git -C "$T/pcm" add f
out="$(CLAUDE_CODE_SESSION_ID=sess-a git -C "$T/pcm" commit -q -m "$(printf 'subject\n\nSession-Id: hand-written\n\nbody paragraph')" 2>&1)"
has "stamp: a hand-written line above the final paragraph is named" "invisible to the push guard" "$out"

# ---- pre-push ----
new_repo pp
commit_as pp sess-a "mine"
push_as pp sess-a
eq "own commits pass" "$PUSH_RC" 0

commit_as pp sess-b "peer work"
push_as pp sess-a
eq "foreign commit is refused" "$PUSH_RC" 1
has "refusal names the foreign session" "sess-b" "$PUSH_OUT"
has "refusal names the subject" "peer work" "$PUSH_OUT"
has "refusal says a notice is not permission" "A notice or a message from another session is not that permission" "$PUSH_OUT"

push_as pp sess-a SESSION_BRIDGE_PUSH_ACK=sess-b
eq "ack naming the session passes" "$PUSH_RC" 0
has "ack is reported on stderr" "publishing acked session(s)" "$PUSH_OUT"

commit_as pp sess-b "peer two"
push_as pp sess-a "SESSION_BRIDGE_PUSH_ACK= SESS-B ,x"
eq "ack ignores case and spaces" "$PUSH_RC" 0
has "an ack token that matched nothing is named" "the ack named x" "$PUSH_OUT"

commit_as pp sess-b "peer three"
push_as pp sess-a SESSION_BRIDGE_PUSH_ACK=ALL
eq "ack=ALL (capital letters) is the wildcard" "$PUSH_RC" 0
has "the wildcard names the sessions it published" "publishing under ack=all" "$PUSH_OUT"

commit_as pp - "untrailered"
push_as pp sess-a
eq "an untrailered commit is allowed" "$PUSH_RC" 0
has "an untrailered commit is reported" "carry no Session-Id trailer" "$PUSH_OUT"

commit_as pp sess-b "peer four"
push_as pp -
eq "no identity: the guard is inert" "$PUSH_RC" 0

commit_as pp sess-b "peer five"
push_as pp sess-a SESSION_BRIDGE_IDENTITY_CMD='exit 4'
eq "a failing identity command refuses the push" "$PUSH_RC" 1
has "…and says why" "identity command failed" "$PUSH_OUT"

push_as pp sess-a SESSION_BRIDGE_ACK_VARS="MY_ACK" MY_ACK=sess-b
eq "SESSION_BRIDGE_ACK_VARS names another ack variable" "$PUSH_RC" 0

commit_as pp sess-b "peer six"
push_as pp sess-a SESSION_BRIDGE_PUSH_ACK=sess-b SESSION_BRIDGE_ACK_VARS="OTHER_ACK"
eq "the default ack variable is ignored once ACK_VARS replaces it" "$PUSH_RC" 1
git -C "$T/pp" push -q origin main 2>/dev/null   # inert push (no identity) to reset the remote tip

commit_as pp sess-b "peer seven"
commit_as pp sess-a "mine after peer"
out="$(cd "$T/pp" && CLAUDE_CODE_SESSION_ID=sess-a git push origin HEAD:refs/heads/side 2>&1)"; rc=$?
eq "a new branch scans what no remote has, and refuses" "$rc" 1
out="$(cd "$T/pp" && CLAUDE_CODE_SESSION_ID=sess-a git push origin :refs/heads/side 2>&1)"; rc=$?
eq "a deletion publishes nothing and passes" "$rc" 0
git -C "$T/pp" push -q origin main 2>/dev/null

# trailer key override, on both sides
new_repo ppk
echo k >> "$T/ppk/f"; git -C "$T/ppk" add f
CLAUDE_CODE_SESSION_ID=sess-b SESSION_BRIDGE_TRAILER=Agent-Id git -C "$T/ppk" commit -q -m "keyed"
PUSH_OUT="$(cd "$T/ppk" && env CLAUDE_CODE_SESSION_ID=sess-a SESSION_BRIDGE_TRAILER=Agent-Id git push origin main 2>&1)"; PUSH_RC=$?
eq "SESSION_BRIDGE_TRAILER: the guard reads the renamed key" "$PUSH_RC" 1

# ---- holds ----
new_repo hold
commit_as hold sess-b "held work"
git -C "$T/hold" update-ref refs/holds/sess-b HEAD
push_as hold sess-a SESSION_BRIDGE_PUSH_ACK=all
eq "a hold refuses, and the ack does not override it" "$PUSH_RC" 1
has "the refusal names the held author" "sess-b" "$PUSH_OUT"
has "the refusal says how to lift the hold" "git update-ref -d refs/holds/sess-b" "$PUSH_OUT"
git -C "$T/hold" update-ref -d refs/holds/sess-b
push_as hold sess-a SESSION_BRIDGE_PUSH_ACK=all
eq "after the hold is lifted the ack works" "$PUSH_RC" 0

commit_as hold sess-b "token commit"
echo ns >> "$T/hold/f"; git -C "$T/hold" add f
SESSION_BRIDGE_IDENTITY_CMD='echo codex:thr-9' git -C "$T/hold" commit -q -m "namespaced"
git -C "$T/hold" update-ref refs/holds/_codex/thr-9 HEAD
push_as hold sess-a SESSION_BRIDGE_PUSH_ACK=all
eq "a <harness>:<id> token is held under <NS>/_<harness>/<id>" "$PUSH_RC" 1
git -C "$T/hold" update-ref -d refs/holds/_codex/thr-9
git -C "$T/hold" push -q origin main 2>/dev/null

commit_as hold sess-a "co-authored"
git -C "$T/hold" commit -q --amend -m "$(printf 'co-authored\n\nSession-Id: sess-a\nCo-Authored-Session-Id: sess-c')"
git -C "$T/hold" update-ref refs/holds/sess-c HEAD
push_as hold sess-a
eq "a hold on a co-author refuses the commit" "$PUSH_RC" 1
git -C "$T/hold" update-ref -d refs/holds/sess-c
git -C "$T/hold" push -q origin main 2>/dev/null

commit_as hold sess-b "custom namespace"
git -C "$T/hold" update-ref refs/mine/sess-b HEAD
push_as hold sess-a SESSION_BRIDGE_PUSH_ACK=all SESSION_BRIDGE_HOLD_NS=refs/mine
eq "SESSION_BRIDGE_HOLD_NS moves the hold namespace" "$PUSH_RC" 1
push_as hold sess-a SESSION_BRIDGE_PUSH_ACK=all
eq "…and the default namespace does not see it" "$PUSH_RC" 0

# ---- mutation controls ----
# Each control breaks one rule in a copy and runs the scenario that rule guards. The scenario
# must go the wrong way. A control that leaves it unchanged proves the scenario is blind.
mutate() {  # mutate <name> <file> <sed expr>: copy the hooks, apply the edit, prove it changed the copy
    local name="$1" file="$2" expr="$3"
    rm -rf "$T/mut-$name"; cp -r "$HOOKS" "$T/mut-$name"
    sed -i "$expr" "$T/mut-$name/$file"
    if cmp -s "$HOOKS/$file" "$T/mut-$name/$file"; then bad "control $name" "the mutation changed nothing"; return 1; fi
}

if mutate foreign pre-push 's/acked "\$s" \&\& continue/continue/'; then
    new_repo mf "$T/mut-foreign"
    commit_as mf sess-b "peer"
    push_as mf sess-a
    eq "control: with the foreign check removed, a foreign commit passes (so the scenario can detect it)" "$PUSH_RC" 0
fi
if mutate case session-bridge-lib.sh "s/tr '\[:upper:\]' '\[:lower:\]'/cat/"; then
    new_repo mc "$T/mut-case"
    commit_as mc sess-b "peer"
    push_as mc sess-a SESSION_BRIDGE_PUSH_ACK=ALL
    eq "control: with the case fold removed, ack=ALL fails (so the scenario can detect it)" "$PUSH_RC" 1
fi
if mutate hold pre-push 's/^        find_held "\${sids:-},\${co:-}"$/        _held=""/'; then
    new_repo mh "$T/mut-hold"
    commit_as mh sess-b "held"
    git -C "$T/mh" update-ref refs/holds/sess-b HEAD
    push_as mh sess-a SESSION_BRIDGE_PUSH_ACK=all
    eq "control: with the hold check removed, a held commit passes under ack=all (so the scenario can detect it)" "$PUSH_RC" 0
fi

echo
echo "session-bridge git hooks: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
