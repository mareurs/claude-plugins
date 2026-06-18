# Session-Passover Tracker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a manual, selective session-passover tracker pattern (template + discovery convention + tests) so a fresh session can resume a prior session's thread.

**Architecture:** A passover is a reflective `kind=tracker, tags:[passover]` markdown artifact under `docs/trackers/`. Authoring is manual and selective; discovery is a documented `artifact(find …)` convention (no hook). A template establishes the pinned body contract; bash tests guard the template schema and the convention against drift. The "trackers-are-like-skills" guide section (idea A) is an external codescout-repo change, gated and separable.

**Tech Stack:** Markdown + YAML frontmatter; bash test scripts (repo idiom, no framework); codescout `artifact`/`create_file`/`edit_markdown` tools.

## Global Constraints

- Test idiom: plain bash, `pass()`/`fail()` counters, no framework; model on `tests/test-recon-count.sh`. Each test self-cleans temp dirs. (CLAUDE.md "Testing".)
- Full suite: `./tests/run-all.sh` from repo root; single test: `bash tests/test-<name>.sh`. run-all loops `tests/test-*.sh` and `codescout-companion/hooks/*.test.sh`, exits 0 iff all pass.
- New markdown files: create via codescout `create_file` (native Write is guard-blocked). Markdown edits via `edit_markdown`.
- Frontmatter discovery key is **`tags` (a list)**, never `tag`. The canonical discovery query, used verbatim everywhere, is:
  `artifact(action="find", kind="tracker", filter={"and":[{"tags":{"in":["passover"]}}, {"status":{"eq":"active"}}]})`
  Stable grep marker for drift tests: `{"tags":{"in":["passover"]}}`
- We are on `main` (default branch) — branch before any commit (Task 0).
- Authoring source for `origin_session_id`: the hook-written file `.codescout/cc_session_id` (preferred) or `.buddy/.current_session_id`. May be absent → omit the field, degrade to `topic`/`branch`.

---

### Task 0: Feature branch

**Files:** none (git only)

- [ ] **Step 1: Create and switch to the feature branch**

```bash
git checkout -b feat/session-passover-tracker
```

- [ ] **Step 2: Verify**

Run: `git branch --show-current`
Expected: `feat/session-passover-tracker`

---

### Task 1: Passover template + schema tests

**Files:**
- Create: `tests/test-passover-template.sh`
- Create: `docs/templates/passover-template.md`

**Interfaces:**
- Produces: the template file path `docs/templates/passover-template.md` and the required frontmatter keys (`kind: tracker`, `tags: [passover]`, `topic:`, `origin_session_id:`, `branch:`, `time_scope:`) and section headings (`## State`, `## Next actions`, `## Working state`, `## Anti-goals`, `## Pointers`) that Task 2's convention references.

- [ ] **Step 1: Write the failing test**

Create `tests/test-passover-template.sh`:

```bash
#!/usr/bin/env bash
# tests/test-passover-template.sh — passover template presence + schema
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TPL="$ROOT/docs/templates/passover-template.md"
PASS=0; FAIL=0
ok()  { echo "  PASS: $1"; PASS=$((PASS+1)); }
bad() { echo "  FAIL: $1 — $2"; FAIL=$((FAIL+1)); }

echo "── passover-template ──"

# 1. template file exists
if [ -f "$TPL" ]; then ok "template exists"; else bad "template exists" "missing $TPL"; fi

# 2. required frontmatter keys present (tags is a LIST; passover is literal)
for key in "kind: tracker" "tags: [passover]" "topic:" "origin_session_id:" "branch:" "time_scope:"; do
  if grep -qF "$key" "$TPL"; then ok "frontmatter has '$key'"; else bad "frontmatter '$key'" "not found"; fi
done

# 3. required body headings present
for h in "## State" "## Next actions" "## Working state" "## Anti-goals" "## Pointers"; do
  if grep -qF "$h" "$TPL"; then ok "section '$h'"; else bad "section '$h'" "not found"; fi
done

# 4. verify-before-trust escape hatch baked into the resume script
if grep -qi "VERIFY" "$TPL"; then ok "verify-before-trust gate present"; else bad "verify gate" "missing VERIFY step in Next actions"; fi

echo "── passover-template: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bash tests/test-passover-template.sh`
Expected: FAIL — "template exists — missing …/docs/templates/passover-template.md" and subsequent checks fail.

- [ ] **Step 3: Create the template**

Create `docs/templates/passover-template.md` (via codescout `create_file`):

```markdown
---
id: <librarian-assigned>
kind: tracker
status: active
tags: [passover]
topic: <thread-name>           # PRIMARY human disambiguator across parallel threads
branch: <git-branch>           # often the sharpest parallel disambiguator
origin_session_id: <cc-session-id-or-omit>   # cat .codescout/cc_session_id (or .buddy/.current_session_id)
time_scope: "dated:<YYYY-MM-DD>"
title: "Passover — <thread-name> — <YYYY-MM-DD>"
owners: []
---

# Passover — <thread-name> — <YYYY-MM-DD>

## State

<One paragraph: where things stand and the status, e.g. "Diagnosis done; fix proposed, NOT implemented.">

## Next actions

1. Read this doc, then **VERIFY** the working state below still holds
   (`git status`, run the suite) BEFORE acting — the handoff may be stale.
2. <concrete next step>
3. <…>

## Working state

- Branch / commit / clean-or-dirty:
- Files changed, uncommitted — each tagged KEEP / DELETE / WIP with intent:
- Processes / servers that must be running:

## Anti-goals

- <dead end already walked; do NOT re-attempt>

## Open threads

<optional — loose ends; carry-forward Status:open items. Delete this section if none.>

## Pointers

- Specs / plans / related trackers:
- Back-link: `.buddy/<origin_session_id>/` and the session transcript
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bash tests/test-passover-template.sh`
Expected: PASS — "passover-template: 13 passed, 0 failed" (1 existence + 6 frontmatter + 5 headings + 1 verify-gate; adjust count if you add keys).

- [ ] **Step 5: Commit**

```bash
git add tests/test-passover-template.sh docs/templates/passover-template.md
git commit -m "feat(passover): add session-passover tracker template + schema test"
```

---

### Task 2: Discovery convention in CLAUDE.md + drift-lint test

**Files:**
- Modify: `tests/test-passover-template.sh` (append convention-lint assertions)
- Modify: `CLAUDE.md` (new `## Session Passover` section, after `## Testing`)

**Interfaces:**
- Consumes: the canonical discovery query and the template path from Task 1 / Global Constraints.
- Produces: a documented convention an incoming session follows; the grep marker `{"tags":{"in":["passover"]}}` present in `CLAUDE.md`.

- [ ] **Step 1: Add the failing convention-lint assertions**

In `tests/test-passover-template.sh`, insert before the `echo "── passover-template: …"` summary line:

```bash
CLAUDEMD="$ROOT/CLAUDE.md"
# 5. discovery query documented verbatim in CLAUDE.md (drift guard)
if grep -qF '{"tags":{"in":["passover"]}}' "$CLAUDEMD"; then
  ok "CLAUDE.md documents the discovery query"
else
  bad "CLAUDE.md discovery query" "marker {\"tags\":{\"in\":[\"passover\"]}} not found"
fi
# 6. CLAUDE.md points at the template path
if grep -qF 'docs/templates/passover-template.md' "$CLAUDEMD"; then
  ok "CLAUDE.md points at template"
else
  bad "CLAUDE.md template pointer" "docs/templates/passover-template.md not referenced"
fi
```

- [ ] **Step 2: Run test to verify the new assertions fail**

Run: `bash tests/test-passover-template.sh`
Expected: prior checks PASS; new checks FAIL — "CLAUDE.md discovery query — marker … not found" and "CLAUDE.md template pointer — … not referenced".

- [ ] **Step 3: Add the `## Session Passover` section to CLAUDE.md**

Via `edit_markdown` (`action="insert_after"`, `heading="## Testing"`), insert this new sibling section:

```markdown
## Session Passover

Hand a live work thread to a fresh session (e.g. after compaction, or one of several
parallel threads on this repo). **Manual and selective** — write one only when a session is
worth resuming; a finished session needs none.

**Author (outgoing session):** copy `docs/templates/passover-template.md` to
`docs/trackers/passover-<topic>-YYYY-MM-DD.md`, fill State / Next actions / Working state /
Anti-goals. Get `origin_session_id` from `cat .codescout/cc_session_id` (or
`.buddy/.current_session_id`); omit if absent.

**Discover (incoming session):** run, early in the session —

    artifact(action="find", kind="tracker",
             filter={"and":[{"tags":{"in":["passover"]}}, {"status":{"eq":"active"}}]})

Zero results → proceed normally. One → resume it (auto-confirm if your own session id equals
`origin_session_id`, which holds on `--resume`). Multiple → pick by `topic`/`branch`.
Always run Next-actions step 1 (verify state) before acting.

**Consume:** when done, flip `status: archived`, append `## Consumed — YYYY-MM-DD`, and
`artifact(action="move", …)` into `docs/trackers/archive/` (never bare `git mv`).
```

- [ ] **Step 4: Run test to verify all pass**

Run: `bash tests/test-passover-template.sh`
Expected: PASS — "passover-template: 15 passed, 0 failed".

- [ ] **Step 5: Run the full suite (no regressions)**

Run: `./tests/run-all.sh`
Expected: all suites pass, exit 0.

- [ ] **Step 6: Commit**

```bash
git add tests/test-passover-template.sh CLAUDE.md
git commit -m "feat(passover): document discovery convention + drift-lint test"
```

---

### Task 3: Work-stream session-log + recon capture

**Files:**
- Create: `docs/trackers/session-passover-impl-session-log.md`

**Interfaces:**
- Consumes: the F-N/W-N structure of `docs/trackers/injection-budget-session-log.md` (the canonical template in this repo).
- Produces: a durable ledger carrying this session's recon findings so they compound.

No automated test — this is a tracker artifact (doc-only). Right-sized as one task: the deliverable is the ledger with its three seed entries.

- [ ] **Step 1: Create the session-log**

Create `docs/trackers/session-passover-impl-session-log.md`, mirroring the header / Index / Wins-Index / Status-vocabulary structure of `docs/trackers/injection-budget-session-log.md`, seeded with:

- **F-1 — "MCPs support agent sessionId" assumption is false for codescout.** Observed 2026-06-18, pre-design recon. Expected: codescout exposes the agent's CC session id. Got: no agent-facing session id (codescout's MCP-session ledger is a different id, no read tool); CC has no `CLAUDE_SESSION_ID` env var / slash command (both feature requests closed not-planned); the id lives only on hook stdin. Workaround: read the hook-written file `.codescout/cc_session_id` / `.buddy/.current_session_id`. Severity: med (would have built the design on a non-existent channel). Status: fixed-verified (design §6 reasons from the file). Pointer: spec §6/§11.
- **F-2 — Template-placement convention contradicted the spec.** Spec §10 placed the template "in codescout-companion"; reality: tracker templates live in a `docs/templates/` dir (recon skill references `<codescout-repo>/docs/templates/session-log.md`) and none existed here. Workaround: established `docs/templates/passover-template.md` in this repo; may migrate beside the codescout repo's `session-log.md`. Severity: low. Status: mitigated. Pointer: Task 1.
- **W-1 — Pre-plan scout caught test-idiom + template placement before fictional tasks shipped.** Pattern: before writing a plan that names test assertions/paths, scout the harness + placement conventions. Counterfactual: without it, the plan would have specified a framework test (none exists) and a companion-dir template path that fights the `docs/templates/` convention — ≥2 task rewrites at execution time. Confirming points: F-2 (placement), the bash-counter idiom discovery. Impact: med. Promote-when: a second pre-plan scout catches a similar mismatch. Status: validated.

- [ ] **Step 2: Commit**

```bash
git add docs/trackers/session-passover-impl-session-log.md
git commit -m "docs(passover): seed work-stream session-log with recon F-1/F-2/W-1"
```

---

### Task 4 (EXTERNAL, GATED): "Trackers are like skills" guide section

**Repo:** codescout (external) — NOT this repo. **Gated** on access to the codescout source repo (resolve its path via `claude mcp list`). If unavailable, idea (B) above ships complete without this; do not block the branch on it.

**Files (in the codescout repo):**
- Modify: the `librarian-runtime` guide source (primary home)
- Modify: the `tracker-conventions` guide source (one cross-ref line)

No test runs in *this* repo for this task (the guide is served by the codescout binary). Verification is reading back the rendered `get_guide("librarian-runtime")` output after the codescout build.

- [ ] **Step 1: Resolve the codescout repo path**

Run: `claude mcp list`
Expected: a codescout server entry whose command/source reveals the repo path. If none, STOP — mark this task deferred in the session-log and finish the branch with Tasks 0–3.

- [ ] **Step 2: Add the guide section** (content to insert into `librarian-runtime`):

```markdown
### Trackers carry behavior across sessions — like skills

A skill tells an agent how to *act*. An augmented tracker — one with a standing
`prompt` + `params` that travel with the artifact — tells an agent how to *maintain
durable state*. A **reflective** tracker (body-is-the-tracker) goes further: its body is
a behavioral script the next session executes.

The **session-passover** tracker (`tags:[passover]`) is the worked example: a fresh
session finds it via `artifact(find, kind="tracker", filter=… passover … active)`, reads
its `## Next actions`, verifies state, and resumes the prior thread. The tracker *is* the
cross-session behavior.
```

- [ ] **Step 3: Cross-ref from `tracker-conventions`** — one line pointing at the section above.

- [ ] **Step 4: Rebuild codescout and verify**

Run `get_guide("librarian-runtime")` and confirm the new section renders.

- [ ] **Step 5: Commit (in the codescout repo)**

```bash
git -C <codescout-repo> add <guide-source-files>
git -C <codescout-repo> commit -m "docs(guide): trackers carry cross-session behavior like skills; passover example"
```

---

## Self-Review

**Spec coverage:**
- §4 artifact design (frontmatter + body contract) → Task 1 (template). ✅
- §5 discovery → Task 2 (CLAUDE.md convention + lint). ✅
- §6 session-id sourcing → encoded in template frontmatter comment + CLAUDE.md author step + F-1. ✅
- §7 guide surfacing (idea A) → Task 4 (gated). ✅
- §9 testing (template presence/schema + convention lint; behavior not unit-testable) → Tasks 1–2 tests; behavior gap acknowledged. ✅
- §11 recon note → Task 3 (F-1). ✅
- §4.3 consume/archive lifecycle → documented in CLAUDE.md Task 2 Step 3. ✅

**Placeholder scan:** Template uses intentional `<…>` author-fill placeholders (it is a template); these are not plan placeholders. No TBD/TODO in tasks. ✅

**Type/identifier consistency:** `tags:[passover]` (list) used in template, query, and tests; grep marker `{"tags":{"in":["passover"]}}` identical in Global Constraints, Task 2 Step 1 test, and CLAUDE.md section. Template path `docs/templates/passover-template.md` identical across Tasks 1, 2, and CLAUDE.md. ✅

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-18-session-passover-tracker.md`.
