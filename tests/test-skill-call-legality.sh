#!/usr/bin/env bash
# tests/test-skill-call-legality.sh — the tool calls a skill prescribes are legal against a real codescout
#
# WHY THIS EXISTS
#
# Skills in this repo show tool calls, and until this file nothing ran them. The suite only
# checked that marker strings were present (tests/test-recon-skill-split.sh greps for
# 'append_entry' and never runs, parses or validates a call). Two archived bugs came from that gap:
#   docs/issues/archive/2026-08-20-reconnaissance-skill-prescribes-hand-allocated-edit-markdown-appends.md
#   docs/issues/archive/2026-08-26-recon-skill-valid-exemplar-rejected-by-append-entry.md
# Skills are served from a versioned cache, so a bad prescription reaches every profile at release
# and is found only when an agent follows it. Bug: docs/issues/2026-10-27-no-check-that-a-skills-prescribed-tool-calls-stay-legal.md
#
# HOW: tests/lib/skill_call_legality.py extracts the call from the skill text (so the test cannot
# drift from the skill), starts a codescout in a sandbox that shares no state with the live server
# (tests/lib/cs_isolated.py), runs it, and runs a known-bad control that must be REFUSED.
#
# LIMITS: this checks one call (reconnaissance's append_entry). A static check of names against a tool
# schema would not catch the second archived bug, which used legal names and an illegal value; a run does.
#
# A missing codescout binary SKIPS loudly and passes. CI has no binary, so a skip there reads as
# "not checked", never as "legal" — the SKIP line says so.
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PASS=0; FAIL=0; SKIP=0

echo "── skill-call-legality ──"

if ! command -v python3 >/dev/null 2>&1; then
  echo "  SKIP: python3 not found — skill-call legality NOT checked"; exit 0
fi
if ! command -v git >/dev/null 2>&1; then
  echo "  SKIP: git not found — skill-call legality NOT checked"; exit 0
fi

out="$(python3 -I "$ROOT/tests/lib/skill_call_legality.py" 2>&1)"; rc=$?
printf '%s\n' "$out"
PASS=$(printf '%s\n' "$out" | grep -c '^  PASS:')
FAIL=$(printf '%s\n' "$out" | grep -c '^  FAIL:')
SKIP=$(printf '%s\n' "$out" | grep -c '^  SKIP:')

# The exit code and the FAIL lines must agree. A crash (traceback, rc != 0, no FAIL line) is a failure.
if [ "$rc" -ne 0 ] && [ "$FAIL" -eq 0 ]; then
  echo "  FAIL: skill_call_legality.py exited $rc with no FAIL line — it crashed"; FAIL=1
fi
# Zero PASS and zero SKIP means the runner printed nothing it can be judged on.
if [ "$PASS" -eq 0 ] && [ "$SKIP" -eq 0 ] && [ "$FAIL" -eq 0 ]; then
  echo "  FAIL: no PASS, FAIL or SKIP line — the runner produced no result"; FAIL=1
fi

echo ""
echo "Results: $PASS passed, $FAIL failed, $SKIP skipped"
[ "$FAIL" -eq 0 ]
