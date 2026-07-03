---
id: '720408ecd2391251'
kind: tracker
status: active
title: Prompt Hamsa — Audit & Self-Reflection Log
owners:
- prompt-hamsa
tags:
- prompt-hamsa
- buddy
- audit-log
- self-reflection
- eval
topic: null
time_scope: null
---

# Prompt Hamsa — Audit & Self-Reflection Log

Every prompt-audit the Prompt Hamsa performs appends one row to `params.audits`.
The point is **measurement**: each row carries a falsifiable `prediction` and a
later-filled `outcome`, so the Hamsa's recommendations can be scored over time.
This is how *"unverified, N=0"* stops being a permanent flag and becomes a hold-rate.

## Scope

- **Project rows** — audits of prompts living in a specific repo → that repo's own
  `prompt-hamsa-audit-log` tracker.
- **Craft / global rows** — reflections about the craft of prompting itself, not tied
  to one repo → this tracker (`claude-plugins` is the Hamsa's home repo). Ambiguous → project.

## Row schema

| field | meaning |
|---|---|
| `date` | YYYY-MM-DD of the audit |
| `artifact` | the prompt audited — path, paste id, or `"drafting"` |
| `symptom` | observable failure, or the requested behavior |
| `gap` | the read-as-stranger gap the audit named |
| `move` | the one recommended next move |
| `prediction` | what the move should change — **the falsifiable core** |
| `eval_status` | `present(n=N)` / `drafted` / `absent` |
| `confidence` | `high` / `medium` / `low` |
| `outcome` | filled later: `held` / `partial` / `failed` / `unobserved` — **the measurement** |

## How to maintain

- **Record** (after every audit): read the current `audits` array, append the new row,
  write the full array back — `artifact_augment(id=<this>, merge=true, params={audits:[…all…]})`.
  Append only; never delete a row.
- **Fill an outcome later:** when evidence arrives, re-write the array with that row's
  `outcome` set (match on `date` + `artifact`).
- **Measure:** `artifact(action="get", id=<this>, entry_filter={"confidence":{"eq":"high"}})`;
  hold-rate = `held` ÷ (high-confidence rows with a non-empty `outcome`).

## History

### 2026-06-13 — created

Bootstrapped during the Hamsa self-improvement work (done-state + measurement loop).
Zero rows at birth; the first real audit seeds row 1.

### 2026-06-14 — full-fleet buddy audit + Snow Leopard A/B pilot

**Audit (7 rows added).** All 13 buddy specialists reviewed as prompts. Dominant finding: Phase-3 "Self-Critique" ↔ "Self-Traps" are 55–90% isomorphic across 11/13 (the cohort row) — named, but NOT called a defect: it is an A/B hypothesis, not an inspection verdict. One *measured* bug: codescout-pika Phase 2b SQL path was `$HOME/.claude/buddy/skills/codescout-pika/sql/` (filesystem-verified absent — bare `$HOME/.claude` resolves the wrong profile for `-sdd`/`-kat`, and the subpath is wrong: installed skills live under the plugin cache, not `~/.claude/buddy/`). Fixed in source to `${CLAUDE_PLUGIN_ROOT}/skills/codescout-pika/sql/` (the plugin-wide convention; verified by grep). Source-fixed only — the runtime prediction (Phase 2b reaches the SQL instead of file-open error) stays `outcome: null` until the next buddy version bump makes it live, then an actual scan confirms. Structural exemplar to imitate: **security-ibex** (genuinely distinct Self-Traps + the `INFO/QUESTION` escape-hatch tier). Distill candidate: **data-leakage `_llm.md`** tail (methods/heuristics over-fit to one project, MRV-poc).

**Snow Leopard redundancy A/B (negative control).**
- *Hypothesis:* cutting the mutation-survival framing 4×→1× — kept OP3 verbatim; removed the Phase-3 bullet, the Format `Mutation-survival` field + its not-ready gate, and Heuristic 1 — DEGRADES mutation-awareness. (I bet the cut fails.)
- *Design:* 5 tasks (clamp, parse_iso_date, final_price, merge_intervals, is_valid) × 2 arms; n=1/cell; blind generators; 1 blind judge scoring MUT (0–3) + QUAL (0–5). Treatment is reproducible: the shipped SKILL.md minus those three echoes, OP3 retained.
- *Result (de-blinded):* MUT control **2.6** vs treatment **2.4** (Δ −0.2/3); QUAL **4.8** vs **4.8**. Per-task MUT — clamp A2/B3, date A2/B1, price A3/B2, merge 3/3, token 3/3 (mixed direction; ±1 per-task swing ≫ the 0.2 arm gap).
- *Verdict:* prediction NOT supported → `outcome: failed`. The cut did not measurably degrade; OP3 alone sustained mutation-awareness in 4/5 tasks (lone drop = parse_iso_date, where operator-mutation framing is least natural — likely task noise). Mildly supports the cross-cutting "redundancy is cuttable" hypothesis, but only regarding *frequency past the first strong statement* (OP3 was kept).
- *To settle conclusively:* n≥5/cell at temp=0, cross-family judge, plus a second treatment that also cuts OP3 (to locate where degradation begins). The cohort A/B (other buddies) is still untested — this pilot informs only the Snow Leopard row.


### 2026-07-03 — tracker-hygiene skill audit + prompt-tdd eval

**Artifact:** `claude-plugins/codescout-companion/skills/tracker-hygiene/SKILL.md` (shipped, plugin v1.12.0).

**Symptom:** pre-ship validation ("validate the skill; test it properly").

**Gap (read-as-stranger):** Phase 2 inventories `docs/trackers/*.md` and D1 fires on "live file absent from the index" — but the index (`README.md`), conventions/policy docs, and the ledger itself live in `docs/trackers/` and are NOT trackers. The SKILL.md never says to exclude these meta-files, so a literal execution could flag `README.md` as index-drift.

**Move (recommended):** one sentence in Phase 2/D1 — exclude the index file, conventions/policy docs, and the hygiene-log from the tracker candidate set.

**Prediction:** an unfixed sweep on a `docs/trackers/` containing a `README.md` index would emit `README.md`/`CONVENTIONS.md` as false D1 findings.

**Eval:** prompt-tdd scenario `prompt-engineering/scenarios/skills/tracker-hygiene` (planted README index + CONVENTIONS + 3 trackers, gamma unmapped). Generator pinned **sonnet**; negative control via `--ablate`.

**Eval-environment finding (load-bearing):** first `--ablate` reported **NO POWER** — scenario passed with the skill "removed." Root cause: `tracker-hygiene` is a *globally-installed plugin skill*, and `claude -p` inherits the operator's profile, so it loads through the plugin channel regardless of `setup.skills`; `--ablate` only strips the temp-local copy, not the global plugin. Fixed by pointing `session.config_dir` at an isolated plugin-free profile (auth copied, no codescout-companion) → negative control went **RED, power confirmed**. This confounds every prompt-tdd eval of a globally-installed plugin skill; `docs/integrations/claude-code-skills.md` does not warn about it.

**Outcome (measured, n=5 across two model tiers): `failed`** — the predicted false-positive did NOT reproduce on sonnet 5 (n=2) OR haiku 4.5 (n=3). Every run's D1 finding was `gamma` only; even Haiku correctly inventoried exactly 3 trackers and named README as the index / CONVENTIONS as a convention doc — never as findings (Haiku was in fact cleaner than sonnet's lone "CONVENTIONS inventoried" phrasing). The skill also PASSed the eval on both tiers (fires + D1 taxonomy; negative control RED on sonnet). Verdict: the exclusion fix is NOT warranted — the gap is real in the prompt (exclusion unpinned) but does not bite either tier, so pinning it would add a rule that provably changes nothing. Left unpinned; re-open only if a future weaker generator flags a meta-file.

**Confidence:** medium-high — two model tiers, n=5, crisp 5/5 exclusion, power-confirmed negative control.

_(Note: `params.audits` has no read-back path and merge replaces arrays wholesale, so this row is recorded as History prose per the 2026-06-14 precedent rather than risk clobbering the array.)_


### 2026-07-03 — tracker-hygiene FIRST LIVE SWEEP (backend-kotlin)

**Artifact:** `codescout-companion/skills/tracker-hygiene/SKILL.md` run live (not a fixture) on `/home/marius/work/mirela/backend-kotlin` (41 live trackers, 38 archived).

**Detector results:** D1 index-drift **9** (live trackers absent from README cluster map: chat-eval-session-log, innovaplan-reconciliation-session-log, solver-trace-persistence-session-log, bulk-delete-lessons-session-log, personalizzazione-subject-teacher-remodel, iel-prod-solver-config = real; reconnaissance-patterns, prompt-hamsa-audit-log, issue-triage-session-log = likely intentional meta-exclusions). D2 **3** (archived-status `*_TRACKER.md` in `ktor-server/docs/`, OUTSIDE docs/trackers/). D3 **0** (oldest live 43d < 45d default). D4 **0** (backend-kotlin catalog clean). D5 **0**. D9 **1** (solver-invariants.md augmented, never refreshed). Nothing applied — foreign activation was read-only + gating pending.

**Four skill-design issues the live run exposed (bare-fixture prompt-tdd eval could NOT — all are skill↔real-infra seams) — HY-N `miss` candidates:**
1. **pin-vs-activate is self-contradictory.** D4/D9 run via `artifact()`/`artifact_refresh()`, which have no `workspace` param (query the ACTIVE project only). The SKILL.md's degradation rule says "pin workspace=, never activate a foreign project" — but that mode structurally cannot run half the detectors. Had to activate. **Fix candidate:** drop/rewrite the "never activate" line — a foreign-project sweep MUST activate (and restore home after) to reach the catalog; pinning only serves the file-based detectors.
2. **`librarian(doctor)` is not project-scoped.** Returned 161 `missing_file` violations, ALL from other projects (stefanini/PMO), none backend-kotlin. Skill implies catalog checks are project-local. **Fix candidate:** name doctor's global scope in the SKILL.md and require path-filtering, or use a project-scoped orphan check.
3. **File-inventory scope ≠ catalog scope.** Phase 2 inventories `docs/trackers/*.md`; `artifact find kind=tracker` returns trackers ANYWHERE (the 3 D2 hits are in `ktor-server/docs/`). The two halves of Phase 2 disagree on "what is a tracker." **Fix candidate:** reconcile — either restrict the catalog query to docs/trackers/ or widen the file inventory + say which is authoritative.
4. **Read-only foreign activation blocks Phase 5 + ledger bootstrap.** `workspace(activate, foreign)` defaulted to read_only=true; no apply possible without re-activating writable. **Fix candidate:** SKILL.md Phase 1 should note the writable-activation requirement for a foreign-project sweep.

**Also:** 1 `docs/issues/` bug file classified `kind: tracker` (status `fixed`) — D8/issues bleeding into the tracker catalog (v2 territory).

**Verdict:** the skill's *detection method works on real data* (found 9 genuine index-drift + 1 real stale augmentation), but its *cross-workspace + catalog-integration guidance is wrong in four ways* that only a live run surfaces. These are the first real HY-N misses; they should be fixed in SKILL.md before the skill is trusted for unattended cross-workspace sweeps. Confidence: high (mechanically observed, n=1 live run).
### 2026-07-03 — tracker-hygiene precision: one-time measurement → standing eval gate (follow-up)

**Follow-up to the row above.** That audit *measured* precision (n=5, two tiers) by
inspection — every run flagged `gamma` only — and correctly declined to add an
exclusion RULE to the skill (the skill is already precise; a rule would change
nothing). But the eval itself still asserted only **recall** (`contains "gamma"` +
`contains "D1"`). Recall-only passes a skill that over-flags *everything*: the fixture
plants mapped `alpha`/`beta` + meta-files `README`/`CONVENTIONS` as false-positive
bait, yet no assertion checked the bait was refused. An n=5 inspection is not a
regression gate — a later skill edit or a weaker generator could silently start
over-flagging and every recall assertion would still pass green.

**Move:** add a tier-3 precision rubric to
`prompt-engineering/scenarios/skills/tracker-hygiene/scenario.yaml` — score 1.0 iff
the ONLY file reported as a D1 finding is `gamma`; 0.0 if any mapped tracker or
meta-file is flagged; *mentioning* those files as context does not count. Tier-1
recall checks retained; precision added as a standing gate.

**Prediction:** the rubric distinguishes a precise sweep from an over-flagging one, so
it catches a future precision regression the recall assertions cannot.

**Eval (Heuristic 9 — mutate the graded OUTPUT, not the prompt; judge
`claude-haiku-4-5`):** real precise transcript → **1.00 PASS**; blatant 4-row
over-flag → **0.00**; subtle single meta-file FP (`README`) → **0.00**; subtle single
mapped-tracker FP (`beta`) → **0.00** (4/4). End-to-end `prompt-tdd run` on a fresh
sonnet generation: **1/1 PASS** (recall + precision), shipped-string confirmed, F-2
preflight now guards this scenario.

**Outcome: `held`** — the gate is proven to have power (fails on over-flagging) AND the
current skill passes it, so precision is checked on every run rather than by one-time
inspection. This operationalizes the prior row's "re-open only if a future weaker
generator flags a meta-file." Shipped in `prompt-engineering` (scenario.yaml + README);
plugins-repo audit rows left uncommitted per concurrent-session state.

**Confidence:** high — rubric power mutation-verified (4/4), shipped string end-to-end
confirmed (1/1), score not transferred from a pre-trim variant.

**Honest note (reconnaissance miss):** the prior row's n=5 precision measurement already
existed; this follow-up should have read the audit log before re-deriving the precision
concern. Net-new contribution = the standing eval gate + rubric-power validation, NOT
the discovery that precision matters here.

### 2026-07-03 — tracker-hygiene activation `description` audit (trigger coverage)

**Artifact:** `codescout-companion/skills/tracker-hygiene/SKILL.md` frontmatter `description:`
— the skill-selection surface that decides whether the skill fires.

**Symptom:** requested audit ("audit the activation description as a prompt surface").

**Read-as-stranger:** a five-trigger list + a descriptive tail. Triggers 1–3 ("run a tracker
hygiene sweep", "audit tracker staleness or drift", "clean up docs/trackers") are literal and
unambiguous. **Trigger 4 — "before backlog triage or any 'what's open?' report" — is the
PROACTIVE, differentiated trigger**: it should fire the skill when the user asks "what's open?"
*without* naming the skill. Trigger 5 (SessionStart-overdue banner) reduces to banner-prompted
explicit invoke. The tail ("Interactive — every finding is human-gated; …librarian; …tracker-
hygiene-log") is descriptive, not trigger-matching.

**Alignment:** the description's triggers fully cover all three `## When to Use` bullets; no
When-to-Use case is missing. **The description is sound — this is NOT a defect finding**
(Self-Trap 1/3 avoided: no manufactured defect).

**Gap (eval coverage, not prompt defect):** the activation eval `scenarios/skills/tracker-hygiene`
sends "Run a tracker hygiene sweep on docs/trackers/…" — a near-verbatim match to trigger 1. It
proves the skill fires on EXPLICIT invocation. It does NOT test the PROACTIVE trigger 4. Proactive
firing is the skill's differentiated value AND the least-certain behavior (a bare "what's open?"
may be answered directly, skill un-invoked).

**Recommended move (one):** add a trigger-coverage scenario whose message is an oblique proactive
trigger — e.g. "What's currently open across our trackers?" over a drift-y fixture — asserting the
skill fires (emits sweep/D1 behavior). Keep the explicit-invoke scenario.

**Prediction (falsifiable):** an oblique "What's currently open across our trackers?" message (no
"sweep"/"hygiene"/"drift" keyword) fires the skill LESS reliably than the literal-invoke message.
If it fails, strengthen the proactive-trigger phrasing or accept explicit-invoke-only.

**Eval status:** explicit-invoke activation — present (D1 scenario, sonnet+haiku). Proactive-trigger
activation — **absent (N=0), unverified.**

**Secondary (low confidence):** the descriptive tail does not aid trigger-matching (Heuristic 2).
NOT recommended for cut — it may curb mis-invocation in non-interactive contexts; only a selection
A/B would settle it. Left as-is.

**Confidence:** medium → **high** (directional). **Outcome: `held`** — prediction confirmed.

**Measured (2026-07-03; n=5/arm; generator sonnet; plugin-free profile; marker = response
contains `D1`, bound to actual responses — not tally-only):** literal-invoke **5/5 fired**;
oblique *"What's currently open across our trackers?"* **1/5 fired**. The directional prediction
holds unambiguously (5/5 vs 1/5, well outside the n=5 ambiguous band); the oblique *rate* itself is
coarse at n=5. **Marker validated by spot-read:** the 4 oblique no-fires were genuine — the base
model answered "what's open?" directly (listed the 3 active trackers), emitted no D1/phase taxonomy,
and one explicitly said "a plain read of the three files, not a full sweep." The no-fire path is also
**degraded, not merely unstructured**: one no-fire *hallucinated that no README index exists* (it
does), whereas every fired sweep read the README correctly — so reliable proactive firing is worth
fixing (it buys accuracy, not just format).

**Recommended fix (one; NOT applied — skill edit, defer to Marius):** raise the salience of the
proactive trigger in the `description`. It is currently buried mid-sentence ("…clean up
docs/trackers, before backlog triage or any 'what's open?' report, or when…"). Foreground the
"what's open? / backlog triage / status report" trigger. **Fix-verification prediction:**
foregrounding raises oblique firing above 1/5 — but verifying it is an A/B needing **n≥10/arm**
(a 1/5→3/5 move is inside n=5 noise). Persist the oblique message as a prompt-tdd regression scenario
only *after* a fix makes firing reliable (a flaky "contains D1" assertion now would just add a red
scenario). Companion repo is under concurrent edit — coordinate before touching the skill.

### 2026-07-03 — tracker-hygiene activation fix A/B: premise REFUTED, fix NOT shipped

**Follows:** the trigger-coverage audit directly above, which predicted that foregrounding
the proactive trigger would raise oblique firing above 1/5, and flagged that verifying it
needs n≥10/arm (a 1/5→3/5 move is inside n=5 noise). This entry executes that A/B.

**Method:** prompt-tdd A/B, plugin-free profile, generator sonnet, **n=10/arm**. Arm A =
live description; Arm B = revised (proactive trigger moved to first position + a causal
because-clause "a trustworthy answer needs a sweep first…" + scoped to "the project's
trackers"). Oblique message *"What's currently open across our trackers?"* over the drift-y
D1 fixture. Automated marker recorded = response contains `D1`; **decision made on spot-read**
(fired = the skill demonstrably loaded), not on the marker.

**Marker-validity correction (load-bearing, overturns the prior baseline):** `contains "D1"`
measures P(fired AND rendered the full detector-labeled sweep), **not** P(fired). In headless
`claude -p` a fired skill frequently renders a *condensed prose* sweep, or is cut off
mid-Phase-4 gating, emitting no literal "D1". Spot-read of arm A's two D1-marker "no-fires":
run 1 referenced the hygiene log + librarian tooling (skill-aware); run 7 had already
**bootstrapped the ledger** (Phase 1). Both were fires. So the earlier *"oblique fires 1/5"*
was a **compound artifact** of (a) n=5 noise and (b) this label-undercount — activation was
near-saturated all along.

**Result — spot-read firing rate:**

| Arm | D1-marker | Spot-read firing |
|---|---|---|
| A (current description) | 6/10 | **10/10** |
| B (revised description) | 9/10 | **10/10** |

Both saturate activation on the oblique prompt. The revised description captures **no**
activation headroom because there is none.

**Secondary observation (NOT a shipping rationale):** B's full-labeled-render rate (d1 9/10)
> A's (6/10). Mechanistically weak — the skill *body* is identical across arms; the
`description` drives selection, not execution — and borderline at n=10 (Fisher's exact
p≈0.3). Chasing this to justify shipping, when the stated rationale (activation) is dead,
would be exactly the manufactured-justification the creed cuts. Left for future investigation
only if a body/priming hypothesis is formed first.

**Confound caught + corrected (my measurement defect, not the harness's):** prompt-tdd's
`_install_skill` names the install dir from `basename(source)`. The first B run pointed at a
copy dir named `skill-B` → installed at `.claude/skills/skill-B/`, so Claude Code never
registered it as `tracker-hygiene` → the runs were **base-model prose** (tell: B_oblique
4/10, B_literal **0/10** despite a verbatim trigger). Re-ran with the copy dir renamed
`tracker-hygiene` (identical install path to arm A, varying only SKILL.md) — B then fired
9–10/10, which by itself re-confirms the corrected install loads, so the B_literal/B_negative
load-check arms were not re-run. **Reusable lesson:** a skill A/B via prompt-tdd must hold the
install-dir name constant across arms and vary only the SKILL.md contents.

**Outcome: `refuted` — description left UNCHANGED; live SKILL.md never edited.** No regression
scenario persisted: activation is already reliable, and a `contains "D1"` firing gate would be
invalid (it measures render, not activation). Companion repo remained untouched by this work.

**Confidence:** high — n=10/arm, both arms spot-read to the activation ceiling, marker
undercount diagnosed and bypassed.
