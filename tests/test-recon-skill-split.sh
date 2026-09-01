#!/usr/bin/env bash
# tests/test-recon-skill-split.sh — recon skill core/reference split invariants
#
# WHY THIS EXISTS
#
# `reconnaissance/SKILL.md` reached 44,375 B (6,849 words — 13.7x the
# writing-skills <500-word target, and the largest skill in this repo by 57%).
# buddy's reload block inlines skill bodies into hook stdout, and CC's
# tool-result persistence path truncates hook stdout over its inline cap to a
# ~2 KB preview: measured 2026-09-01, 44,702 B emitted and 1,789 B delivered
# (4.0%). See docs/issues/2026-09-01-reload-block-inlines-45kb-over-the-hook-stdout-cap.md.
#
# The fix was to split the case law out to references/ and keep the METHOD in
# the core, per the injection-budget design's principle: "inject pointers, not
# content; load content on demand via tool-call results."
#
# These are STRUCTURAL assertions only. They deliberately do NOT claim the split
# makes an agent behave correctly — the reconnaissance-eval harness cannot
# attribute an effect to skill content (its own README: "READ FIRST — the
# activation confound", and "What it cannot do: attribute an effect to skill
# content"). Recurrence counting on the recon-patterns ledger is the longitudinal
# instrument; this file only guards the shape.
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SKILL_DIR="$ROOT/codescout-companion/skills/reconnaissance"
CORE="$SKILL_DIR/SKILL.md"
REFS="$SKILL_DIR/references"
PASS=0; FAIL=0
ok()  { echo "  PASS: $1"; PASS=$((PASS+1)); }
bad() { echo "  FAIL: $1 — $2"; FAIL=$((FAIL+1)); }

echo "── recon-skill-split ──"

# 1. core exists
if [ -f "$CORE" ]; then ok "core SKILL.md exists"; else bad "core SKILL.md" "missing $CORE"; fi

# 2. Core stays under the MEASURED truncation floor.
#    14,056 B is not a guess: it is the largest hook payload observed delivered
#    intact across 130,958 hook-output samples in 2,369 transcripts. The true cap
#    is somewhere in (14,056 … 21,327]; 14,056 is the only end of that interval
#    we have evidence for, so it is the one to hold.
#    A failure here does NOT mean "raise the limit" — it means the new content
#    belongs in references/, which is the whole point of the split.
CAP=14056
size=$(wc -c <"$CORE" 2>/dev/null || echo 999999)
if [ "$size" -lt "$CAP" ]; then
  ok "core is ${size} B, under the measured ${CAP} B floor"
else
  bad "core size" "${size} B >= ${CAP} B — move new case law into references/, do not raise CAP"
fi

# 3. each reference file exists and is non-trivial
for f in seam-classes.md worked-examples.md patterns-tracker.md \
         reconnaissance-patterns-template.md; do
  if [ -f "$REFS/$f" ]; then ok "references/$f exists"; else bad "references/$f" "missing"; fi
  n=$(wc -c <"$REFS/$f" 2>/dev/null || echo 0)
  if [ "$n" -gt 3000 ]; then
    ok "references/$f is ${n} B"
  else
    bad "references/$f size" "only ${n} B — truncated or emptied?"
  fi
done

# 3b. No ORPHANS. A reference must be reachable, but not necessarily from the core
#     directly: reconnaissance-patterns-template.md is cited by patterns-tracker.md,
#     the workflow that actually copies it, which is correct colocation rather than a
#     missing pointer. So: cited by the core, or by a reference the core cites.
#     One level of transitivity — deepen this only if the structure ever needs it.
core_cited=()
for f in "$REFS"/*.md; do
  b=$(basename "$f")
  grep -qF "references/$b" "$CORE" && core_cited+=("$b")
done
for f in "$REFS"/*.md; do
  b=$(basename "$f")
  reach=""
  grep -qF "references/$b" "$CORE" && reach="core"
  if [ -z "$reach" ]; then
    for c in ${core_cited+"${core_cited[@]}"}; do
      [ "$c" = "$b" ] && continue
      if grep -qF "$b" "$REFS/$c"; then reach="references/$c"; break; fi
    done
  fi
  if [ -n "$reach" ]; then
    ok "references/$b reachable (via $reach)"
  else
    bad "references/$b reachable" "orphaned — cited by neither SKILL.md nor any core-cited reference"
  fi
done

# 4. Pointers must NOT be @-links. `@` force-loads the file immediately, which
#    re-inlines exactly the bytes the split removed (writing-skills: "@ syntax
#    force-loads files immediately, consuming 200k+ context before you need them").
if grep -qE '@[A-Za-z0-9_./-]*references/' "$CORE"; then
  bad "no @-linked references" "found an @-link — it force-loads and undoes the split"
else
  ok "references are plain paths, not @-links"
fi

# 5. The METHOD stayed in the core. All four phases, and Phase 3's operational
#    core (the one call that must be right), must be in-hand — never behind a pointer.
for h in "### Phase 1 — Scout" "### Phase 2 — Compare" \
         "### Phase 3 — Externalize" "### Phase 4 — Resume + Announce"; do
  if grep -qF "$h" "$CORE"; then ok "core keeps '$h'"; else bad "core keeps '$h'" "not found"; fi
done
for marker in 'append_entry' 'Severity rubric' 'Status vocabulary' 'recon_count.py'; do
  if grep -qF "$marker" "$CORE"; then
    ok "Phase 3 keeps '$marker' in-hand"
  else
    bad "Phase 3 '$marker'" "moved out — the externalize call must not sit behind a pointer"
  fi
done

# 6. Anchors other documents depend on for edit_markdown must survive as pointer
#    stubs. docs/superpowers/plans/2026-05-21-recon-badge-counters.md and
#    2026-06-11-recon-findings-as-project-memory.md both name these headings.
for h in "#### Worked exemplars" "## The recon-patterns tracker (per project)"; do
  if grep -qF "$h" "$CORE"; then
    ok "edit_markdown anchor '$h' survives"
  else
    bad "anchor '$h'" "removed — two plans use it as a stable edit_markdown anchor"
  fi
done

# 7. Moved content must not creep back into the core. These strings are
#    distinctive to the reference files; a hit in the core means someone
#    re-inlined the case law.
if grep -qF "from a downstream project's R-N ledger" "$CORE"; then
  bad "seam-class case law stays out of core" "promoted-law text found in SKILL.md"
else
  ok "seam-class case law stays in references/seam-classes.md"
fi
if grep -qF "Promotion routing" "$CORE"; then
  bad "promotion routing stays out of core" "found in SKILL.md"
else
  ok "promotion routing stays in references/patterns-tracker.md"
fi

# 8. The references/ directory name is load-bearing: pre-tool-guard exempts
#    skills/.../references/ from the source-read block (see
#    codescout-companion/hooks/pre-tool-guard.test.sh, read-skill-refs-allow).
#    Renaming the dir would silently make every pointer unreadable.
if [ -d "$REFS" ]; then
  ok "references/ dir name preserved (guard-exempt path)"
else
  bad "references/ dir" "missing or renamed — pre-tool-guard exempts this exact path shape"
fi

echo "── recon-skill-split: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
