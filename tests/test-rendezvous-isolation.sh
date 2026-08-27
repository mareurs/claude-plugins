#!/bin/bash
# tests/test-rendezvous-isolation.sh
#
# The suite must never be able to reach the user's REAL codescout state dir.
#
# Why this exists: session-start.mjs stamps codescout rendezvous slots whose
# ppid is in its own process ancestry, and several tests pipe a synthetic
# session_id into it. A suite launched through codescout's run_command — the
# way this repo's Iron Law 3 mandates — is a genuine DESCENDANT of the live
# codescout server, so the ancestry guard passes and the fixture's session id is
# written into the live server's slot. codescout then rekeys its guide-hints
# ledger onto that fixture id: the developer's own session silently starts
# recording guide deliveries under `sid-recon-marker-test.json`, and every guide
# topic re-arms and re-injects.
# docs/issues/2026-08-27-test-suite-rekeys-live-codescout-server.md
source "$(dirname "${BASH_SOURCE[0]}")/lib/fixtures.sh"

echo "── rendezvous isolation ──"
HOOK="$HOOK_DIR/session-start.mjs"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT

REAL_STATE="$HOME/.local/state"
REAL_RV="$REAL_STATE/codescout/servers"
FIXTURE_SID="sid-isolation-probe-$$"

# Session value of every real rendezvous slot, order-independent. Compared
# before/after, this detects a stamp landing in the user's real state dir.
rv_fingerprint() {
  [ -d "$REAL_RV" ] || { echo "ABSENT"; return; }
  local f
  for f in "$REAL_RV"/*.json; do
    [ -e "$f" ] || continue
    echo "$(basename "$f") $(jq -r '.session // ""' "$f" 2>/dev/null)"
  done | sort | md5sum | cut -d' ' -f1
}

BEFORE=$(rv_fingerprint)

# --- Test 1: the sandbox is in effect at all. ---
# lib/fixtures.sh repoints XDG_STATE_HOME; without it every hook in the suite
# resolves the real ~/.local/state.
if [ -n "${XDG_STATE_HOME:-}" ] && [ "$XDG_STATE_HOME" != "$REAL_STATE" ]; then
  pass "XDG_STATE_HOME is sandboxed away from the real state dir"
else
  fail "XDG_STATE_HOME is sandboxed away from the real state dir" \
    "got '${XDG_STATE_HOME:-<unset>}'"
fi

# --- Test 2: the hook actually honours XDG_STATE_HOME. ---
# Test 1 alone would pass against a hook that ignored the variable, and
# sandboxing only helps if the hook follows it. This sets XDG_STATE_HOME
# EXPLICITLY rather than relying on the suite's, so it discriminates whether or
# not the sandbox exists — the first draft read the ambient value, fell back to
# the real dir when it was unset, and passed green against the unfixed suite
# (claude-plugins:roster-audit-session-log:W-4, caught by running it red).
# The planted slot carries THIS script's pid as `ppid`, so the node child's
# ancestry contains it and the stamp is expected to land.
ISO="$T/iso-state"
mkdir -p "$ISO/codescout/servers"
printf '{"pid":999999,"ppid":%s,"cwd":"%s"}' "$$" "$T" > "$ISO/codescout/servers/999999.json"
make_git_repo "$T/p"
write_mcp_json "$T/p"
make_ce_dir "$T/p"
printf '{"session_id":"%s","cwd":"%s"}' "$FIXTURE_SID" "$T/p" \
  | XDG_STATE_HOME="$ISO" node "$HOOK" >/dev/null 2>&1
STAMPED=$(jq -r '.session // ""' "$ISO/codescout/servers/999999.json" 2>/dev/null)
if [ "$STAMPED" = "$FIXTURE_SID" ]; then
  pass "session-start.mjs stamps rendezvous slots under XDG_STATE_HOME"
else
  fail "session-start.mjs stamps rendezvous slots under XDG_STATE_HOME" \
    "slot session='$STAMPED', expected '$FIXTURE_SID'"
fi

# --- The leak probe: one hook invocation under the suite's AMBIENT env. ---
# Deliberately plants nothing in the real dir — the original bug did not need a
# planted slot, it stamped the LIVE server's own existing one. So this just runs
# the hook the way a test does and lets Tests 3 and 4 look for the damage.
printf '{"session_id":"%s","cwd":"%s"}' "$FIXTURE_SID" "$T/p" | node "$HOOK" >/dev/null 2>&1

# --- Test 3: the real rendezvous dir is untouched. ---
# THE LEAK GATE, and the one assertion that would have caught the original bug.
#
# Read its limits honestly (claude-plugins:roster-audit-session-log:W-4): this
# check only DISCRIMINATES when the suite runs with a live codescout server in
# its process ancestry — i.e. through run_command, the mandated path, which is
# exactly where the bug fires. From a plain terminal or CI there is no such
# ancestor, so the hook would not stamp a real slot even with the sandbox
# removed, and this passes green either way. Tests 1 and 2 are what hold the
# line in those environments; keep all three.
#
# Measured, not assumed: mutation-tested 2026-08-27 by deleting the sandbox and
# running under a throwaway HOME. Test 1 failed; Tests 3 and 4 both stayed
# GREEN against the broken suite. They are corroboration, never the gate.
AFTER=$(rv_fingerprint)
if [ "$BEFORE" = "$AFTER" ]; then
  pass "the real rendezvous dir is untouched by the suite"
else
  fail "the real rendezvous dir is untouched by the suite" \
    "fingerprint changed $BEFORE -> $AFTER"
fi

# --- Test 4: no fixture session id anywhere in the real state dir. ---
# Direct and environment-independent: a grep for this run's own marker. Catches
# a leak that happened to leave the fingerprint unchanged (a slot re-stamped
# with the value it already had).
LEAKED=$(grep -rl "$FIXTURE_SID" "$REAL_STATE/codescout" 2>/dev/null | wc -l)
if [ "$LEAKED" -eq 0 ]; then
  pass "no fixture session id reached the real codescout state dir"
else
  fail "no fixture session id reached the real codescout state dir" \
    "$LEAKED file(s) contain '$FIXTURE_SID'"
fi

print_summary "rendezvous-isolation"
