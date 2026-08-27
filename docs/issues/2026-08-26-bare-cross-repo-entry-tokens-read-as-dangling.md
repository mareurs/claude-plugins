---
id: '65b3320219a8e9c1'
kind: bug
status: open
title: '76 dangling + 93 ambiguous citations are one remediable class, not a baseline — and the biggest concentration is shipped prompt surface'
tags:
- link-graph
- librarian
- citations
- prompt-surface
- tracker-drift
topic: citation grammar and the link graph
opened: 2026-08-26
severity: med
unverified: The per-file referent for version-bump-checklist.md's 15 dangling tokens is INFERRED from subject matter (they read as codescout R-N release notes), not confirmed entry-by-entry against codescout's ledger. Two of its tokens (R-1, R-3 at line 215, 'as R-1 and R-3 have since May') are genuinely ambiguous between the two repos' ledgers by date and need a human call. No fix is applied to any prompt-surface file.
---

## Summary

`librarian(action="link_scan")` on `claude-plugins` reports **76 dangling** and **93
ambiguous** citations (2026-08-26, after the fixes below). Those numbers have been read as
this repo's baseline. They are not: the large majority is **one remediable class with a
one-line remedy**, and leaving it in place has a real cost — a high floor of known-benign
dangling is what makes a *new*, genuine dangling citation invisible.

Demonstrated on two smaller surfaces the same day:

| Surface | dangling before | after |
|---|---:|---:|
| `prompt-engineering` (whole repo) | 2 dangling, 12 ambiguous | **0 / 0** |
| `docs/trackers/reconnaissance-patterns.md` | 6 | **0** |

Both took one pass of the remedy and no semantic change to any sentence.

## The class

Prose in this repo cites **codescout's** `docs/trackers/reconnaissance-patterns.md` R-N/W-N
namespace using **bare tokens** (fenced here, so this paragraph does not become three more
of them):

```text
R-89    W-36    R-113
```

The qualifier is what tells the
resolver to stop looking locally, so without it a cross-repo reference is
**indistinguishable from a typo**: it is reported as `dangling`, no edge is created, and
`librarian(action="context", anchor_id=...)` cannot reach the evidence the prose points at.

The fix is `codescout:R-89` — same meaning, one token, correctly reported as `cross_repo`.

## Where it is concentrated

| File | dangling | ambiguous | Kind |
|---|---:|---:|---|
| `codescout-companion/skills/reconnaissance/SKILL.md` | **21** | 3 | **shipped prompt surface** |
| `docs/trackers/version-bump-checklist.md` | **15** | 6 | historical release log |
| `docs/trackers/roster-audit-session-log.md` | 7 | — | session log |
| `docs/issues/archive/2026-08-26-active-plan-t-n-row-only-uncitable.md` | 6 | — | self-referential (see below) |
| `docs/issues/archive/2026-08-21-zero-law-does-not-cover-wrong-answer-instruments.md` | 5 | — | self-referential |
| `docs/trackers/INDEX.md` | — | 6 | `F-N`/`W-N` across many session logs |
| `docs/trackers/passover-roster-audit-release-integrity-2026-08-26.md` | — | 7 | `F-N`/`W-N` |
| 20 further files | 1–3 each | 1–5 each | mixed |

`SKILL.md`'s 21, in order of appearance — **fenced, because an unfenced catalogue of broken
citations is itself 21 broken citations** (this file's first revision made exactly that
mistake and added 22 dangling to the count it was reporting):

```text
R-19  R-113  R-77  R-79  R-104  R-7  R-41  R-42  R-9  R-89  R-49
W-36  R-95   R-92  R-51  R-50   W-3  R-87  R-8   R-10 R-23
```

Every one is a codescout entry — the file's own prose says so (*"in codescout's
`docs/trackers/reconnaissance-patterns.md`"*). Spot-confirmed by reading the target:
`codescout:R-19` at `codescout/docs/trackers/reconnaissance-patterns.md:849`, `codescout:R-104` at `:3249`.

## Why this is not a drive-by fix

**The biggest concentration is a skill file.** Editing
`codescout-companion/skills/reconnaissance/SKILL.md` changes what every agent loads, and
shipping it means a version bump plus a cache reseed and install-record repoint across all
three profiles (`~/.claude`, `~/.claude-sdd`, `~/.claude-kat`) — the freshness law in the
file's own Phase 1 and the whole procedure in `version-bump-checklist.md`. That is a real
release for **zero behavioural change**: the guidance text is identical, only the citation
grammar moves. It needs a human's call on whether to ride along with the next content bump
rather than justify a release of its own.

Recommendation: **do not bump for this alone.** Fold the 21 edits into the next
`codescout-companion` content change, where the bump is already being paid for.

## Two subclasses that must NOT be "fixed" the same way

**1. Self-referential documents.** Files that *discuss* citation resolution necessarily
contain tokens that are intentionally unresolvable. `reconnaissance-patterns` `R-4` names an
intentionally-undefined token as one of three probe subjects — *known undefined → expect
dangling* — i.e. as the worked example of a dangling citation. Qualifying it would destroy
the meaning, and naming it here unfenced would re-create it; `R-4` now carries that probe
table in a fenced block for exactly this reason. The remedy there is a **fenced
block**, which exempts the token; this was measured, and **inline backticks do not exempt**
(`cross_repo` 12 → 11 on the fence, unchanged on backticks alone). The two `docs/issues/`
files above and much of `buddy/tests/*/README.md` are likely this subclass — each needs
reading, not a sweep.

**2. `F-N`/`W-N` ambiguity is expected but still costs the edge.** Those namespaces are
per-work-stream by design, so several session logs each define the same low-numbered token.
That is the intended shape and no rename is wanted. But an ambiguous token still resolves to
**nothing** — the resolver refuses to guess — so the qualifier is owed anyway:

```text
F-1                             →  ambiguous, no edge
roster-audit-session-log:F-1    →  resolves
```
This is the same conclusion `prompt-engineering:tracker-hygiene-log` `HY-2` reached after its
sweep had recorded the collisions as "expected shape, not drift".

**3. The stem qualifier can point at the WRONG REPO's file of the same name — and this one
the naive fix CREATES.** Measured: `docs/issues/archive/2026-08-21-zero-law-does-not-cover-wrong-answer-instruments.md`
carries a stem-qualified citation of the zero-law entry, and it is reported **dangling**, not
`cross_repo`:

```text
reconnaissance-patterns:R-104   →  dangling
codescout:R-104                 →  cross_repo (correct)
```

Both repos have a `docs/trackers/reconnaissance-patterns.md`. This one's namespace stops at
`R-6`, so a stem qualifier binds **locally** and then fails to find the entry — which the
resolver correctly calls dangling, per its own rule that *"a qualifier that does name a file
which lacks that entry is dangling, not ambiguous."*

This is worse than the bare form it replaced, because it **looks** precisely cited. So the
remedy is narrower than "add the qualifier":

- **Same-named file in both repos** → qualify by **repo** (`codescout:R-104`). That is every
  R-N/W-N citation in this repo, because the ledger filename is shared.
- **Stem unique to one repo** → stem is fine (`prompt-surface-measurement-session-log:F-7`
  works, since no local file shares it — which is why the stem convention reads as correct in
  `prompt-engineering` and would be wrong here).

Check before qualifying: does a file of that stem exist locally, and does it define the token?
If a local file exists and does not, only the repo qualifier is safe. This also means the
`title` of this issue undercounts — the header numbers are the *reported* counts, and this
sub-form is reported under `dangling` while the malformed-`.md` form is reported under
`cross_repo`, so neither is separable from a genuine one without reading each token.
## Reproduction

```
librarian(action="link_scan", scope="project")   # write=false; read dangling_by_source
```

## Fix

> **The four judgement-call files, 2026-08-27 — ambiguous 65 → 54, dangling 59 → 55,
> cross_repo 46 → 61, and ONE WRONG EDGE PRUNED.** `version-bump-checklist` 6 → 0,
> `buddy-introspection` 2 → 0, `prompt-hamsa-audit-log` 1 → 0,
> `repo-hygiene-session-log` 4 → 2 (residue is deliberate, below). Suite green.
>
> **`cross_repo` going UP is the result, not a regression.** These files cite codescout,
> `prompt-engineering` and two codescout-only session logs. Those citations were being
> counted as local ambiguity or local dangle; they are now *declared* cross-repo, which
> earns no edge by design but stops them masquerading as local debt.
>
> **A bare token that RESOLVES can be wrong, and neither count can see it.** This is the
> find worth keeping. `repo-hygiene-session-log` cited the search-zero law as
> `(R-3 → ... → R-104 family)`. `R-104` cannot be local — this repo's `R-N` stops at
> `R-6` — so the family is codescout's and `R-3` means codescout's `R-3`. But bare `R-3`
> **bound to this repo's `R-3`**, which is *"Re-measuring a drift finding's quoted number
> is not auditing it"* — a different law entirely — and produced a real
> `repo-hygiene-session-log → reconnaissance-patterns` edge. `link_scan` reported it as
> neither ambiguous nor dangling, because it resolved. Fixing it shows up as
> `edges_pruned: 1`, and that pruned edge is the proof.
>
> **The `R-1`/`R-3` call this issue flagged as unsettleable IS settleable — just not by
> dates.** § *Fix* item 1 said *"the sentence does not say and the dates do not settle
> it"*. The company the tokens keep does: the same sentence's three sibling citations are
> already written `codescout:R-89` / `codescout:R-49` / `codescout:W-36`, and the claim is
> that these bullets now back-cite *"as `R-1` and `R-3` have since May"* — while this
> repo's `R-1` dates from 2026-07-28 and so cannot have been doing anything in May. Both
> are codescout's. Two independent lines, no judgement left over.
>
> **What was left, and why it should stay.** The 2 remaining in `repo-hygiene-session-log`
> are **subclass 1**, and they are the purest instance of it in the repo: the entry is a
> bug report about the allocator counting *example* `PREFIX-N` text as claimed ids, so its
> prose necessarily contains `W-1`/`F-1` as **subject matter, not citations** — one of
> them inside a literal `| W-1 | YYYY-MM-DD | … |` template row. Qualifying them would
> assert a citation the author never made, and the entry's own `Severity` is *"low — no
> data loss, no broken citation"*. They need the fenced-block remedy or nothing, and
> nothing is the better trade here.

> **Item 2 done for four files, 2026-08-27 — ambiguous 84 → 65.** `INDEX.md` (6 → 0),
> `passover-roster-audit-release-integrity-2026-08-26` (7 → 0),
> `passover-session-passover-tracker-2026-06-18` (4 → 0),
> `passover-research-skills-refactor-2026-07-04` (2 → 0). Two edges added, none stale,
> none pruned; `run-all.sh` green.
>
> **The floor effect is larger than the § mechanics note suggests, and grepping first
> beat it in one pass.** `link_scan` reported 6 tokens for `INDEX.md` and 7 for the
> roster-audit passover; the greps found **15** and **30**. Fixing only what the scan
> named would have taken four more scan-fix rounds per file. `INDEX.md` went to zero in
> a single pass and did not reappear on the next scan — the grep is not just faster
> sizing, it is what makes one pass sufficient.
>
> **`INDEX.md` was the easy shape and is worth naming as such:** every row already links
> the tracker its tokens belong to, so the qualifier is derivable from the row with no
> judgement at all. The passovers were nearly as clean — each names its work-stream log
> outright ("Work-stream log: `…`"), and in all four cases the named ledger was checked
> to define every token before anything was written, per § *Two subclasses* item 3.
>
> **What is left is NOT mechanical, which is why it stopped here:**
>
> | File | ambig | why it needs a human |
> |---|---|---|
> | `version-bump-checklist` | 6 | the `R-1`/`R-3` call this issue already flags — dates do not settle whose ledger |
> | `repo-hygiene-session-log` | 4 | cites four tokens it does not define, plus `R-104` — the exact subclass-3 landmine |
> | `buddy-introspection` | 2 | unread |
> | `prompt-hamsa-audit-log` | 1 | cites `A-N`/`P-N`/`G-N`/`L-N` across repos |
>
> The `docs/superpowers/plans/` + `specs/` entries (~26) are finished design documents
> — historical snapshots, and arguably out of scope by the same reasoning that exempts
> `archive/`.

> **Baseline moved, 2026-08-27 — not by working this issue.** An archive sweep moved ten
> terminal bug files into `docs/issues/archive/` and re-pointed their 22 citations (paths
> and 16-hex ids) across 14 files. A `link_scan(write=true)` after it reads **dangling 59,
> ambiguous 84**, 246 artifacts scanned, 14 edges added, 0 stale, 0 pruned. Both counts are
> **floors** — the per-`(source, token)` reporting described below still applies, and both
> arrays came back `truncated: true` at the 50-item cap. Item 3 below ("the self-referential
> `docs/issues/` files") is now partly moot: seven of those eleven files are archived, so
> their example tokens sit in historical snapshots that `archive_drop` already exempts.

> **Progress, 2026-08-26.** Items 1 and the durable-ledger half of 2 are done. Repo totals
> moved **dangling 82 → 66**, **ambiguous 93 → 86**, edges 101 → 106. Per file:
>
> | File | dangling | ambiguous | state |
> |---|---|---|---|
> | `docs/trackers/reconnaissance-patterns.md` | 6 → **0** | 7 → **0** | done — zero bare `F-N`/`W-N` remain |
> | `docs/trackers/version-bump-checklist.md` | 15 → **5** | 6 | 14 tokens qualified `codescout:R-N`; the 5 left are the R-1/R-3 judgement call plus one stale `ArtifactId` |
>
> The R-N ledger was done first deliberately: it is the promotion pipeline into `SKILL.md`,
> and `get_guide("tracker-conventions")`'s own measurement is that **durable ledgers are the
> worst-affected citers** (R-N alone was 27 of 50 sampled ambiguous citations) — i.e. the
> permanent record losing the links to its own evidence.
>
> **One trap found while doing it, worth more than the count.** The obvious shorthand for a
> list of sibling ids does **not** work — a colon prefix still leaves a bare token:
>
> ```text
> subagent-bootstrap-session-log:F-1 + :F-2 + :F-3    →  F-1 resolves, F-2/F-3 stay ambiguous
> subagent-bootstrap-session-log:F-1  subagent-bootstrap-session-log:F-2   →  both resolve
> ```
>
> Every token carries its own full qualifier or it is not qualified. This is verbose in a
> table cell and there is no shorthand; accept the width.

Ordered by cost-to-benefit, none of it urgent:

1. **`version-bump-checklist.md` (15)** — a tracker, editable now, no release needed. Qualify
   each token `codescout:R-N`. Two need a human call: line 215's *"as `R-1` and `R-3` have
   since May"* predates this repo's own `R-1` (2026-07-28), so it probably means codescout's,
   but the sentence does not say and the dates do not settle it.
2. **Session logs and passovers (~20, mostly ambiguous `F-N`/`W-N`)** — qualify by file stem.
   Mechanical.
3. **The self-referential `docs/issues/` files (11)** — read each; fence the example tokens.
4. **`SKILL.md` (21) + `tracker-hygiene/SKILL.md` (3) + `codescout-pika/SKILL.md` (1)** —
   prepare the diff, hold it, land it with the next content bump.

**Two mechanics to know before starting**, both measured 2026-08-26:

- **`link_scan` reports one occurrence per (source, token).** Fixing the reported one
  uncovers the next. Clearing `prompt-engineering` took **four** scans: 12 → 4 → 2 → 1 → 0.
  A single scan's count is a **floor, not a total**. Size the work with a grep instead —
  `grep -nE '(^|[^:[:alnum:]_-])R-[0-9]+' <file>` — which found the last five in one call
  after three scans had surfaced them one at a time.
- **The qualifier is the file *stem*, never the filename.** The bad form splits on its last
  dot-segment and is reported as a repo named `md`:

  ```text
  foo-bar.md:VG-9    →  reported as  md:VG-9   (cross_repo, no edge)
  foo-bar:VG-9       →  resolves
  ```

  It is a `cross_repo` token producing **no edge, no dangle, no ambiguity**. Both counts a
  reviewer would check stay flat, so this form is
  invisible in every existing signal.

## Upstream

The generalising half is a **codescout** concern and is already named as unfixed in
`docs/issues/archive/2026-08-26-active-plan-t-n-row-only-uncitable.md`'s `unverified:` field: the
`doctor` check `cited_prefix_with_no_definer`. A prefix with zero definers in the repo is
currently **inert** — neither resolved nor reported — so a bare `OP-13` or `VG-9` written here
is silent rather than dangling, and no count moves at all. That state is invisible to this
issue's own reproduction, which is why it is called out separately rather than folded in.
