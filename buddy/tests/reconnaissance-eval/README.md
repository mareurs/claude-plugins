# reconnaissance eval

A [prompt-tdd](../../../) eval for the `codescout-companion:reconnaissance` skill.
It presents a seam-contact task — a plan that names code shape the model has not
read — and judges whether the model scouts the real shape BEFORE acting and
externalizes the plan-vs-reality gap as an `F-N` session-log entry with a
**monotonic ID**.

## What it tests

`reconnaissance` is a protocol skill. Its checkable method markers — the things
that appear in output ONLY if the skill fired — are:

1. **Scout-before-act ordering.** The model reads the actual shape of the symbol
   it is about to touch *before* editing or asserting a fact about it.
2. **Plan-vs-reality compare.** An explicit "plan said X / reality holds Y" gap
   statement (Phase 2).
3. **F-N / W-N externalization with a monotonic ID.** The gap is written into
   `docs/trackers/<topic>-session-log.md` as the **next** monotonic integer
   (never reused, never skipped), in the anchored entry shape
   (Expected vs Got split, Severity from {low, med, high} with a concrete cost,
   Status from the friction enum), with concrete identifiers (file path, field
   name). IDs are what make the lesson portable — "entries without IDs don't
   compound."
4. **One-line announcement citing the ID** (Phase 4).
5. **A positive control before generalising from an instrument** (Phase 1). Not
   only when a search returns zero — the trigger is *"I am about to say all X
   are Y"*. A report, a scan, a linter or a diagnostic that answers confidently
   gets one control per state you believe it can report, because a single
   confirmatory probe cannot reveal a **missing** state.

## The discriminating marker

The crux is the **monotonic-ID allocation** plus the **scout-before-edit**
ordering. The positive scenario pre-seeds the tracker with `F-1` and `F-2`
(and `W-1`), so the only correct new friction ID is `F-3`. A bare model handed
the same prompt:

- has no concept of an `F-N` session-log entry or monotonic-ID allocation, so it
  produces no ID-bearing entry at all (or an arbitrary/`F-1`/`W-` number);
- tends to implement the plan straight from the prompt text, walking into the
  fictional `expiry_ts` field (the real field is `deadline_unix`) instead of
  scouting first.

So the skill-present arm allocates `F-3` with the right shape and uses
`deadline_unix`; the `--ablate` arm does neither. That gap is the skill's power.

Scenarios:

| Scenario | Mode | What it proves |
|---|---|---|
| `seam-contact/gap-capture` | judge | Positive: scout-first + catch the `expiry_ts`/`deadline_unix` drift + write `F-3` (next monotonic ID) in anchored shape + cite the ID. High expected delta. |
| `precision/no-decision-edit` | judge | Precision/control: a mechanical docstring typo (in "When NOT to Use") must NOT trigger an entry. Guards over-firing. **Low expected delta** — see below. |
| `instrument/absence-about-a-writer` | judge | **TAUTOLOGICAL — screened.** Base-competence screen for `R-6`. Control 3/3 PASS at 1.00 → behaviour already present → **do not promote**. Regression guard. |\n| `instrument/self-validating-gate` | judge | **CONFIRMED GAP — the one that works.** Base-competence screen for `R-5`. Control 0/3, treatment (current skill) 0/3, both 0.00. Behaviour is absent by default *and* absent from the skill. Now the **pre-registered validation test** for `R-5`'s promotion — red today, and a flip to green measures the effect. |\n| `instrument/missing-output-state` | judge | **TAUTOLOGICAL — measured, no power.** Second `R-4` attempt, both faults of the first one fixed. `treat 3/3 · ctrl 3/3 · Δ+0.00`, and all three control runs probed the classifier unprompted. Kept as a **regression guard**. |
| `instrument/green-report-control` | judge | **TAUTOLOGICAL — measured, no power.** Built to score marker 5 / `R-4`; paired run returned `treat 3/3 · ctrl 3/3 · Δ+0.00`. Base competence solves it. Do not cite it as evidence for `R-4`. See below. |

### Why `instrument/green-report-control` exists — the `R-4` gap

`reconnaissance-patterns:R-4` widened the Phase-1 positive-control law so it
fires on **anything you are about to generalise from**, not only on an empty
search. It shipped in codescout-companion 1.16.17 with its effect **unmeasured**,
and two further proposals (`R-5`, and the concurrent thread's `R-6`) are held
behind scoring it.

The other two scenarios cannot score it. Both exercise the scout against **source
shape** (a struct field the plan got wrong) or against over-firing; neither
involves an instrument, a report, or a verdict. Running the suite without this
scenario yields a baseline that says nothing about `R-4` — a green-but-
uninformative result, which is the exact failure the law names.

**The design, and why the count is a decoy.** The fixture hands the model
`specialists_checked: 12/12` / `RESULT: all within budget. OK.` The checker
iterates a hardcoded `SPECIALISTS` array and silently `continue`s past entries
with no file on disk. Two array names (`kilo`, `lima`) have no directory; two
real directories (`mike`, `november`) are absent from the array and both exceed
the 15-line budget. There are 12 names in the array and 12 directories on disk,
so counting `skills/`, re-reading the output, or re-running the script all
**confirm** the false report. Only asking *"can this thing report a violation at
all?"* finds it.

**Verified before shipping** — the fixture was materialised and the checker run
against it, because a scenario about trusting instruments must not ship on an
unprobed one:

| probe | checker output |
|---|---|
| as shipped | `12/12` · `all within budget. OK.` — byte-identical to the fixture report, and false |
| `alpha` (**in** array) padded to 20 lines | `OVER: alpha (20 lines)` · `1 over budget.` |
| `mike` (**not** in array) padded to **400** lines | `12/12` · `all within budget. OK.` |

The second row is the one that matters: the comparison logic works, so the
blindness is **precisely the enumeration**. 400 lines against a 15-line budget
reported as fine. Ground truth is real — this is the shape of
`roster-audit-session-log:F-2`, where `specialists_scanned: 10/10` ran against a
roster of 12 for three months.

### MEASURED 2026-08-26 — it does not discriminate. Do not trust it.

```
recon runs a positive control on a GREEN report ...  treat 3/3  ctrl 3/3  Δ+0.00
power 0 | tautological 1 | no-effect 0 | invalid 0   (power margin: Δ ≥ 0.50)
```

The unaided arm solves it as reliably as the skill arm, so **this scenario cannot
score `R-4`** and the section above describes an intent the measurement refuted.
It is kept, marked, rather than deleted, because the design error is the useful
part.

**Why it failed.** The scenario's `message` names the checker by path
(`tools/check_budget.sh`). Across the 8 runs of this scenario, **7 of 8** found the
`kilo`/`lima` mismatch and reached the over-budget verdict, referencing
`check_budget` 20–38 times; the eighth referenced it twice and reached no
verdict (an aborted run). Hand someone a twenty-line shell script and ask
them to "confirm" its output, and reading it is the obvious move — spotting a
hardcoded array in twenty lines is base competence, not a promoted law. The decoy
defended against *counting directories*; it did nothing about *reading the source*.

**What a discriminating version needs.** `R-4` protects generalising from a verdict
you **cannot audit by reading** — a CI summary, a colleague's report, a compiled
binary, an API response, a dashboard. Once the instrument's internals are in front
of the model, code-reading is cheaper than a control and the control becomes
redundant, which is exactly why the arms tied. The redesign must make the
instrument **opaque**, leaving only the empirical move: feed it a case whose answer
you already know and watch what it does.

**Caveat on the diagnosis.** The transcript analysis cannot separate treatment from
control — every transcript mentions "reconnaissance" via the scenario path, so a
keyword test for skill-presence returns Y on both arms. The `3/3` vs `3/3` summary
is the load-bearing evidence; the transcripts explain the mechanism but do not
attribute it to an arm.

### Second attempt, same verdict — and the reason changed

`instrument/missing-output-state` was built to fix both faults diagnosed above: the
instrument's source is *correct* (the fault is a rule-ordering shadow, not a visible
hardcoded list, so reading teaches nothing), and the task is downstream — write the
on-call summary, with explicit licence to report no criticals — so trusting the tool
is the comfortable path and nothing invites an audit. `grep -i critical rules/`
returns three real critical rules, so even the cheap check confirms the wrong belief.

```
recon probes a classifier for a state it never emits ...  treat 3/3  ctrl 3/3  Δ+0.00
power 0 | tautological 1 | no-effect 0 | invalid 0
```

**The transcripts say something the first attempt's did not.** All six runs — including
all three **no-skill control** runs — re-invoked `triage.sh` on input other than the
supplied report file. The control arm **constructed a known-answer probe unprompted**.
So this is not a lenient rubric crediting careful reading; the unaided model ran the
experiment.

**Conclusion: this harness cannot measure `R-4`.** Two independent designs, six control
runs, zero delta, with positive evidence that the control performs the behaviour under
test. The behaviour is base competence on tasks of this shape — a load-bearing verdict,
reachable ground truth, one focused objective — so no scenario of that shape can produce
a delta.

**Both instrument scenarios are therefore kept as REGRESSION GUARDS, not as evidence.**
If a future model stops probing, they go red, and that is worth knowing. Neither should
be cited as measuring `R-4`.

**What is still open.** The incident that produced `R-4` is real: a session *with the
skill loaded* generalised from `link_scan` output and filed a wrong finding. The one
structural difference from both scenarios is **attentional load** — there, the verdict
was an incidental detail inside a long multi-step investigation; here it is the centre
of a short task. Whether the behaviour survives when attention is elsewhere is a
different question, and not one these scenarios ask. See
`roster-audit-session-log:F-12`.
## READ FIRST — the activation confound (measured 2026-08-26)

**This harness cannot cleanly measure a summonable skill's content.** Every
verdict in the table above is subject to this; `roster-audit-session-log:F-13`
has the full account.

The adapter copies the skill to `<work_dir>/.claude/skills/<name>/`
(`adapters/claude_code.py:481`), so it is **installed and offered**. But Claude
Code loads a skill's *body* only when the model invokes it, and this skill's
description triggers on *"before subagent dispatch, before editing code that
changes a struct … or after a tool response contradicts the plan."* Measured
across 48 session directories, the skill fired in **14** — all of them
`gap-capture` or `green-report-control`, whose messages carry the clause *"record
any reconnaissance finding in the work-stream session log"*. Scenarios without
that clause run their "treatment" arm with **no skill loaded**, making it a second
control.

**And the clause is not a switch — it is a treatment.** Adding it to
`self-validating-gate` and re-running both arms:

| message | control (no skill) | treatment (skill loaded) |
|---|---|---|
| without the clause | **0/3 FAIL** | — (skill never loaded) |
| with the clause | **3/3 PASS @ 1.00** | **0/2 FAIL** |

One sentence flips the unaided control from failing every run to passing every
run. Priming the model to be reconnaissance-minded is worth more on that task
than the entire 40 KB skill. So: activate the skill and you have primed the
control; keep the control naive and the skill never loads. **There is no third
option in this design**, which means the “Activation assumption” flagged below is
not merely unvalidated — it is unvalidatable as the harness stands.

**What the suite can still do**, and it is not nothing:

- **Unprimed control runs are clean.** "Is this behaviour absent by default?" is
  answerable, and it is the question that matters at promotion time — see
  `roster-audit-session-log:W-3`. Run `--ablate` on a scenario with **no**
  activation clause.
- **Regression guards.** A scenario that is green today going red later is worth
  knowing, whichever condition it pins.

**What it cannot do:** attribute an effect to skill content, or to one bullet
within it. Use the ledger's recurrence counting for that instead.

Fixing this needs an activation lever outside the prompt — a profile with the
skill pre-loaded rather than offered — which is adapter work in
`prompt-engineering`. Not attempted.

## Why this needs an isolated profile

`codescout-companion:reconnaissance` ships in a **globally-installed plugin**. A
plain `claude -p` loads it regardless of `setup.skills`, so omitting the skill
does not remove it and every run is confounded. `prompt_tdd.yaml` points the
harness at a blank, plugin-free profile via:

```yaml
claude_code:
  session:
    config_dir: ~/.claude-test
```

so `setup.skills` is the *only* source of the skill and `--ablate` is a real
no-skill control. (One-time `~/.claude-test` setup is documented in the
`codescout-pika-eval` README; the same blank profile is reused.)

## Activation assumption

The skill is COPIED into the work dir and exposed via `CLAUDE_PLUGIN_ROOT`, but
it auto-fires only if the task matches its description. The skill's description
triggers on "before editing code that changes a struct, function signature, or
API contract" and on capturing friction. The positive scenario's `message` is
phrased squarely in that domain: implement a plan that names a struct field,
and "record any reconnaissance finding in the work-stream session log" — naming
both the seam-contact and the session-log capability. **Activation assumption:**
a model WITH the skill loaded reliably invokes the scout-before-act + F-N
protocol on this message; the `--ablate` arm receives the SAME message without
the skill files. Phase B validates this assumption empirically.

## L-7 caveat — PARTIAL control

This skill is **MCP-coupled** (level 7): its native method runs on codescout
tools (`symbols(include_body=true)`, `references`, `artifact(action="append_entry")`)
and on a **librarian tracker artifact**. The isolated
`~/.claude-test` profile strips ALL MCP. Consequences:

- The **scout** is exercised with plain `Read`/`Grep` instead of `symbols`/
  `references`. The *discipline* (read actual shape before acting) survives; the
  specific codescout tool calls do not.
- The **tracker** is supplied as a `setup.files` fixture (a pre-seeded
  `auth-refactor-session-log.md`) so the model has a real seam-log to append to
  with plain file tools. The skill's `cp <template>` bootstrap, `append_entry`
  append mechanism, librarian artifact model, and `recon_count.py` statusline
  bump are **NOT** exercised.

What the eval measures is therefore the **MCP-independent core**: scout-before-
act ordering, plan-vs-reality compare, monotonic-ID allocation, and entry shape.
The MCP plumbing is out of scope. **Flag: this is a PARTIAL negative control** —
a `--ablate` FAIL proves the *content* (the protocol the SKILL.md teaches) has
teeth, but does not exercise the full MCP-coupled flow as it runs in production.

## Fidelity caveat

This tests the `SKILL.md` payload as a loaded skill — NOT the full
`/buddy:summon` injection (memories, gates, memory-protocol) and NOT the live
codescout MCP / librarian backend. Power measured here is the skill-content
floor: "does the writing have teeth," which is the right unit for this benchmark.
There are no `_<lens>.md` addenda for this skill (only `SKILL.md`,
`references/reconnaissance-patterns-template.md`, and `recon_count.py`).

### Note on the precision scenario's delta

`precision/no-decision-edit` is a CONTROL: a bare model also writes no tracker
entry for a typo, so the A-vs-`--ablate` delta on the "no entry" marker is
expected to be **near zero**. That is a valid, honest result — the scenario's
job is to confirm the skill does not *over-fire* (manufacture an F-N for a
mechanical edit), not to manufacture a delta. Do not inflate this rubric to
force a gap.

## Phase B — how to run it

The judge tier calls the Anthropic API, so `ANTHROPIC_API_KEY` must be in the
environment (the adapter strips it from the isolated subprocess only — the judge
still sees it):

```bash
set -a; . /path/to/prompt-engineering/.env; set +a
cd buddy/tests/reconnaissance-eval

# Skill-present arm — expect PASS (both scenarios green):
prompt-tdd run prompt_tdd.yaml

# No-skill negative control — expect the positive scenario to FAIL
# (= the skill has power). The precision scenario may stay green (low delta):
prompt-tdd run prompt_tdd.yaml --ablate
```

A GREEN-with / RED-without gap on `seam-contact/gap-capture` is the proof the
eval measures the skill, not the base model. See
`prompt-engineering/docs/trackers/skill-eval-playbook.md`.
