# Buddy Specialists — Token Efficiency, Live Tracking & Model-Drift Sweep

> **Relationship:** follow-on to [buddy-introspection.md](buddy-introspection.md) (token-efficiency audit,
> S-1..S-6) and [active-plan.md](active-plan.md) (the 38-task rewrite plan, Phase 4/4 still open). This
> tracker scopes work those two do **not** cover: a recon-style live tracking/promotion system for
> specialists, and a versioned re-sweep discipline explicitly triggered by model changes (not just
> calendar/lit-drift) — including differential testing across model tiers.

## Done-condition

This tracker is done when:

1. Buddy specialists have a friction/win tracking mechanism analogous to
   `codescout-companion:reconnaissance`'s F-N/W-N ledgers, with a promotion path to project- and
   system-level memory (mirroring the `reconnaissance` memory topic's R-N pattern) — so a pattern a
   specialist learns in one session becomes durable guidance in future sessions instead of being
   re-discovered every summon.
2. The specialist prompt set carries a version marker recording which model(s) and which literature
   snapshot it was last swept/tested against.
3. A prompt-tdd style eval suite (building on `eval-bringup.md`'s harness) runs each specialist under
   **at least `claude-opus-5` and `claude-sonnet-5`**, and records any behavioral divergence between the
   two tiers.
4. `active-plan.md`'s Self-Inspection Grounds § Triggers table includes "underlying Claude model version
   changed" as an explicit re-sweep trigger, distinct from the existing calendar/lit-drift triggers.

## Live state

```yaml
status: draft
depends_on:
  - buddy-introspection.md      # S-1..S-6 findings this generalizes from
  - active-plan.md              # Phase 4/4 still open; do not duplicate its task list
  - eval-bringup.md             # harness this reuses for cross-model runs
scope:
  - token_efficiency_resweep          # confirm/extend S-1..S-4 fixes are still holding
  - live_tracking_and_promotion       # new: recon-style F-N/W-N + project/system promotion for specialists
  - versioned_staleness_tracking      # new: stamp the specialist set with last-swept model + date
  - cross_model_differential_testing  # new: run eval harness on opus-5 AND sonnet-5, diff results
last_updated: 2026-08-24
```

## Why now

`active-plan.md`'s own Self-Inspection Grounds trigger table already fires on the calendar alone: **100
days** have elapsed between that tracker's `last_updated: 2026-05-16` and today (2026-08-24), past its own
D-6 90-day threshold. A resweep is already due independent of the new scope below — this tracker's items
should ride the same pass rather than becoming a second, separate sweep.

## New scope (not covered by buddy-introspection.md / active-plan.md)

1. **Live tracking + promotion system for specialists.** `codescout-companion:reconnaissance` gives
   sessions a durable friction/win ledger (F-N/W-N) with a promotion path into project (and system)
   memory — e.g. the `reconnaissance` memory topic's R-1, distilled from a logged friction. Buddy
   specialists have no equivalent today: whatever a specialist learns mid-session is not captured
   anywhere durable. Proposed: give specialists a comparable ledger + promotion criteria so recurring
   lessons become project- or system-level memory instead of being re-learned every summon. Needs a
   design decision (brainstorm first) on whether this reuses codescout's `memory()` / reconnaissance
   machinery directly or lives in the buddy plugin's own mirrored memory system (see root CLAUDE.md's
   "buddy" section).
2. **Versioned, model-aware staleness tracking.** `active-plan.md` D-6 tracks a 90-day calendar
   threshold and a 12-month lit-drift threshold, but nothing keys a resweep to the **underlying model
   changing** — a new Claude generation can unlock or change capabilities the current prompts don't
   exploit (or actively conflict with), independent of elapsed time. Add "model version changed" as its
   own trigger row, and stamp the specialist set with the model(s) + date it was last validated against
   so staleness after a model upgrade is visible without doing the math by hand.
3. **Cross-model differential testing (opus-5 vs sonnet-5).** The existing eval design (D-5, D-7)
   diversifies the **judge** panel across vendors, but always runs the **specialist itself** under a
   single acting model. Extend the harness to run each specialist's eval cases under both
   `claude-opus-5` and `claude-sonnet-5` and diff the two score sets — surfacing cases where a
   specialist's prompt only works (or only fails) on one tier. Cost note: D-5's ~$3–10/full-run becomes
   roughly 2x if every case runs on both tiers — worth costing out before committing.
4. **Token-efficiency resweep.** Re-validate S-1..S-4's fixes are still holding
   (`all_specialists_refactored: true` per active-plan.md, but unaudited since 2026-05-16) as part of the
   same pass rather than a separate effort.

## Open questions

- Tracking/promotion mechanism: reuse codescout's `memory()`/reconnaissance machinery directly, or a
  buddy-native equivalent? Affects both plugins' coupling.
- Where does cross-model differential testing plug into `eval-bringup.md`'s runtime sequence (Steps 1–7)
  — a new step, or a parameter on the existing ones?
- Does "model version changed" need to be sensed automatically (e.g. from session metadata) or is a
  manually-updated marker in Live state sufficient for now?

## History

### 2026-08-24 — Tracker created

Logged per user request: refactor buddy specialists for token efficiency, add recon-style tracking +
promotion so specialists learn new patterns durably, version the specialist set with model-aware
staleness tracking and prompt-tdd testing, and cross-test `claude-opus-5` vs `claude-sonnet-5` for
behavioral divergence. Cross-linked to the existing buddy-introspection/active-plan/eval-bringup
initiative rather than duplicating it — see § Why now for the already-overdue resweep this surfaced.
