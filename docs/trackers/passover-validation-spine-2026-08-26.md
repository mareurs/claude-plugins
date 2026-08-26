---
id: e39560f84d888091
kind: tracker
status: active
title: Passover — validation-spine measurement — 2026-08-26
tags:
- passover
- validation
- prompt-tdd
- eval
topic: validation-spine-measurement
time_scope: dated:2026-08-26
branch: main
sibling_repo_branch: prompt-engineering@master
---

## State

An AI-eng/DS **validation domain-coverage audit** shipped as `validation-domain-coverage.md`
(`VG-1`..`VG-10`, committed by another session as `08029a7`). Its prompt spine was rewritten
from numbered choreography to outcome framing on first-party evidence, and then an ablation
was **built and run to measure whether that rewrite helped — verdict UNRESOLVED.** The spine
remains a better-argued hypothesis, not a measured one; `VG-9` is `mitigated`, not `fixed`.

Building the eval turned up four defects in `prompt-tdd` itself, filed as
`prompt-engineering:prompt-tdd-operating-guide` `OP-13`..`OP-16`. One of them (`OP-15`) would
have silently corrupted the planned measurement, so the design changed before the money was
spent. Roughly **$5.30** of real API spend so far (4 generator invocations at ~$1.32, two of
them wasted on an accidental `report` re-execution).

## Next actions

1. Read this doc, then **VERIFY** the working state below still holds (`git status` in both
   repos, `wc -l` on the Pheasant skill files) BEFORE acting — a peer session was committing
   into `claude-plugins` while this was written, and had uncommitted edits in
   `buddy/skills/data-leakage-snow-pheasant/`.
2. **Decide the stimulus question first, before spending anything.** The n=1 smoke passed
   *both* spine variants on Claude Opus 5, which the harness's own paired predicates would
   classify `tautological`. That points at the fixture being too easy — a frontier model
   catches a crisp docstring-vs-code contradiction unaided. Running n>=10 on the same
   stimulus likely buys a confident null. Consider a subtler discriminator: an
   *under-specified* edge the model must notice is unspecified, rather than a flat
   contradiction; or move the spec to a separate file so the test is whether the model seeks
   it at all.
3. Only then run the arms: `--ablate` per variant, **never `--paired`** (see Anti-goals),
   n>=10, `defaults.timeout` raised above 300s, `max_cost_per_scenario` halved because it is
   enforced per arm. Budget ~$1.32 × (scenarios × 2 × runs) plus judge calls, sequential.
4. Owed and not written: an `F-N` friction entry for the method failure described under Open
   threads. It has no session-log ledger yet in either repo for this work stream.

## Working state

- **`claude-plugins`** — branch `main`. Uncommitted: `docs/trackers/validation-domain-coverage.md`
  (**KEEP** — the `VG-9` measurement append, live-state counters and History entry from this
  session, +58 lines) and `buddy/skills/data-leakage-snow-pheasant/SKILL.md` (**NOT MINE** —
  a peer session's WIP, +7/-2; do not commit it as part of this work).
- **`prompt-engineering`** — branch `master`. All **KEEP**, all uncommitted:
  `scenarios/validation-spine/` (two scenario.yaml, verified by `diff` to differ in exactly
  three lines), `prompts/skills/spine-variants/{old,new}/validation-spine/SKILL.md`,
  `validation_spine_opus5.yaml`, `validation_spine_sonnet5.yaml`,
  `docs/trackers/prompt-tdd-operating-guide.md` (`OP-13`..`OP-16` + Index rows),
  `docs/trackers/skill-eval-log.md` (the eval's registration entry). Also present and **not
  mine**: `.codescout/memories/conclude-last-eval.md`, `scenarios/conclude-last/`,
  `results/conclude-last/`, `.codescout/constitution-seen/`, `M .codescout/memories/conventions.md`.
- **Processes:** none must be running. `ANTHROPIC_API_KEY` lives in
  `prompt-engineering/.env`; source it (`set -a; . ./.env; set +a`) before any run — it is
  not in the ambient env.
- **Known stale:** `VG-7` records the Pheasant at 136/59/129 = 324 lines. The working tree
  now reads 141/59/125 = 325 (`SKILL.md` committed at 136). The **ratio** the entry actually
  rests on is unmoved (81.8% for the `:llm` arm either way), so `VG-7` is still valid by its
  own declared condition — but re-measure before quoting its raw numbers, and do not edit
  that file while the peer session's WIP is in it.

## Anti-goals

- **Do not use `--paired`.** It discards both arms' per-run results (`OP-14`), a partly-errored
  arm silently depresses its own rate while the delta prints clean (`OP-15`), `power_margin` is
  hard-wired at 0.5 and unconfigurable, and it always exits 0. `skill-eval-playbook:L-15`
  prescribes it; that recommendation predates these findings.
- **Do not run `prompt-tdd report`.** It re-executes the whole suite at full cost with no
  output until finished, despite a docstring saying "from the last run" (`OP-13`). To re-read a
  finished run, read the Claude Code transcripts at
  `~/.claude-test/projects/-tmp-prompt-test-*/*.jsonl` — they survive, correlatable by mtime
  only.
- **Do not re-file the "no per-run record is persisted" issue.** Already open as
  `prompt-tdd-operating-guide:OP-4` since 2026-08; a rediscovery cites it. Same for `OP-6`
  (cost cap short-circuits mid-arm).
- **Do not trust `max_cost_per_run`.** Dead key (`OP-16`). A config that sets it is unguarded.
- **Do not re-run the existing stimulus at scale hoping for discrimination** without first
  addressing action 2 — that is the walked dead end this passover exists to prevent.

## Open threads

- **`VG-9` open** — the spine rewrite is unmeasured. Closing condition is a per-model ablation
  with per-requirement effect sizes, not another argument.
- **`VG-10` open** — prompt artifacts should re-audit on model release, not on `active-plan`'s
  90-day `D-6` clock. Fix lands in `active-plan.md`, routed through `T-37`'s existing
  stale-detector rather than a second mechanism.
- **`VG-1`..`VG-6`, `VG-8` open** — the coverage gaps proper, untouched by this session.
- **Lost result** — the `--ablate` control ran and its summary was lost to a buffer handle that
  expired on an MCP reconnect. Transcript recovery attempted and **inconclusive**: eight
  transcripts cluster ~90s apart across three invocations, attributable only by mtime, and the
  probe's literal `== 51` pattern cannot match a `parametrize` table, so its zeros were
  evidence about the pattern rather than the models. Re-run rather than mine it further.
- **Method lesson — FILED, no longer owed.** Landed as
  `reconnaissance-patterns:R-6` in **claude-plugins**, not as an `F-N`: the `F-N`/`W-N`
  namespaces are per-work-stream and this stream never opened a session log in either repo,
  so there was no counter to append to. `R-N` was the right home anyway — the lesson is
  about the reconnaissance skill itself, and `R-1`..`R-5` are all this same family.
  Summary: the claim "runs are not auditable" was asserted from four observations, not one
  of them positive, and was **wrong** — transcripts are persisted, by Claude Code rather
  than by prompt-tdd, at `~/.claude-test/projects/-tmp-prompt-test-*/*.jsonl`. Verdict
  `miss`; proposal **HELD** behind the `R-4` eval baseline (`n=0`) on `R-4`'s own reasoning,
  rather than promoted on argument.
  Mechanism worth carrying forward: unlike `R-4`, the law was **never loaded** — the
  reconnaissance skill was invoked later in the session. The `When NOT to Use` carve-out at
  `SKILL.md:20` already says "asserting a specific, checkable fact is not Q&A", but all
  three of its exemplars and its remedy are **source-shape** ("read the symbol this
  session"), and a claim about whether a tool persists anything has no symbol that settles
  it — so the situation resolved to read-only Q&A and the gate never asked for a scout.

## Pointers

- Audit and entries: `docs/trackers/validation-domain-coverage.md` (`VG-1`..`VG-10`, here).
- Load-cost consumer: `buddy/docs/trackers/headroom-optimization.md` backlog item 2b, which
  `VG-7` feeds with measured lens-split line ratios.
- Harness defects: `prompt-engineering:docs/trackers/prompt-tdd-operating-guide.md`
  (`OP-13`..`OP-16`; read `OP-4`, `OP-6` first as pre-existing).
- Eval registration: `prompt-engineering:docs/trackers/skill-eval-log.md` under
  *validation-spine (VG-9 spine ablation)*.
- Method the eval must satisfy: `prompt-engineering:docs/trackers/skill-eval-playbook.md`
  (`L-13`, `L-15`) and codescout memory `prompt-tdd-skill-eval-confounds` (three A/B traps,
  n>=10 floor).
- Adjacent initiative, different axis: `docs/trackers/buddy-introspection.md` audits how
  specialists are *written*; this one audits what the roster does not *cover*. `active-plan.md`
  owns the `T-N` namespace — file work there, not here.
