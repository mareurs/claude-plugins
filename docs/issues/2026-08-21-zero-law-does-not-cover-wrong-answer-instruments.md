---
id: '5e6f46db24cdcae9'
kind: bug
status: fixed
title: reconnaissance Phase 1's search-zero law does not reach an instrument that returns a WRONG answer rather than no answer
tags:
- codescout-companion
- reconnaissance
- skill
- skill-sync
- measurement
closed: 2026-08-21
---

> **Skill-sync request, not a defect in the shipped text.** The Phase 1 bullet is correct
> for everything it claims. This is the *Outgrown* case from the skill's own
> "Every promotion audits the promoted set" section: still true, too narrow, and the
> downstream ledger is now recording instances the promoted wording does not cover.
> Upstream entry: `codescout:reconnaissance-patterns:R-104`, whose Promote-when fired
> 2026-08-21 at eight instances and which names this file as its cross-repo half.

## Summary

`SKILL.md` Phase 1 carries the project's most-repeated law — *"A search that finds nothing
is evidence about the search, not about the world"* — with three arms (scope, shape,
encoding) and a hard rule about deletion. Every arm presupposes a **zero**: something was
missing, and the question is why. An instrument that returns a **complete, plausible,
wrong** answer trips none of it, because nothing is absent to notice.

## Symptom (Effect)

Three instances in one codescout session on 2026-08-21. The first two are the promoted
bullet's existing arms in new clothes. The third is the gap.

| # | Instrument | What it returned | Why the promoted text misses it |
|---|---|---|---|
| 1 | `grep -c … "$cache/skills/reconnaissance/SKILL.md"` across three plugin profiles | **empty output** — not `0` | *scope* arm, but note the tell: the cache is version-keyed (`…/codescout-companion/<version>/skills/…`) and the path was guessed flat, so `grep` read no file at all. Empty is not zero, and it was nearly reported as one |
| 2 | `for s in '…`**Valid:**`…'; do grep -c "$s" <binary>` | `0` for a string present exactly once | *encoding* arm — the backtick did not survive the shell |
| 3 | `for p in …; do echo "$(ps -o lstart= -p $p)…"; done \| sort -r \| head -4` | four **two-day-old** processes reported as the newest, on a machine whose newest was 17 seconds old | **Not covered.** No zero, no absence, no empty set. `ps lstart` renders `Wed Aug 20 …`, and a lexical sort orders by **weekday name** — `Wed` > `Tue` > `Thu` > `Mon` |

Instance 3 was published to a user as a finding before it was caught.

## Reproduction

```bash
for p in $(pgrep -x some-daemon); do echo "$(ps -o lstart= -p $p)|$p"; done | sort -r | head
```

Compare against the correct form, which sorts numerically on elapsed seconds:

```bash
for p in $(pgrep -x some-daemon); do echo "$(ps -o etimes= -p $p | tr -d ' ')|$p"; done | sort -n | head
```

## Root cause

The promoted bullet is organised around **absence**: it teaches you to interrogate a zero.
The failure class is wider than that, and the common factor is not the zero — it is **who
supplied the predicate**.

In all three instances a component of the instrument came from memory rather than from the
data: a path, a pattern, a sort key. An instrument answers in its own terms without
complaint, so the output is well-formed either way. A zero at least *prompts* the question;
a wrong ranking does not, which makes instance 3 the more dangerous shape and the one with
no guard.

Also worth recording because it bears on the remedy: **knowing the law did not prevent any
of the three.** They were committed in a session that had read `R-104` in full, quoted it to
the user, and cited it in an unrelated commit message. That is the same self-referential
shape the Measurement iron rule already documents about itself, and it is evidence for
*placement and mechanism* over better wording.

## Evidence

Upstream entry, widened and with the fired criterion recorded:
`codescout:docs/trackers/reconnaissance-patterns.md` § `R-104`.

- codescout SHA (`experiments`): `df0a0338`
- codescout patch-id: `8ff01f5b3fcbbca9f552e5d3e476ea981211962c`

That commit also lands the downstream half in codescout: a fourth rule in
`docs/PROBES.md` § *Before you trust any probe on this page*, and
`scripts/stale-servers.sh`, whose sort carries the instance-3 trap as a comment beside the
sort key.

Note the prediction that **held**, since it constrains the fix: `R-104` forecast that
self-describing output would retire the report-shaped failures, and it is doing so —
`link_scan`'s `counts.entry_edges` read cleanly on sight the same day, no legend needed. The
failures migrated to hand-rolled shell, where there is no publisher who *can* add a legend.
So a legend/`severity_legend`-style remedy does not address this; nothing can annotate a
sort you wrote yourself.

## Fix

Implemented 2026-08-21 against
`codescout-companion/skills/reconnaissance/SKILL.md` Phase 1.

Widen the existing bullet rather than adding a sibling, so the law stays one law. Two
edits:

1. **Re-frame the opening** from absence to predicate authorship. Current text opens *"A
   search that finds nothing is evidence about the search, not about the world."* Keep it,
   then add: *and an instrument that returns a full answer is evidence about the predicate
   you supplied. A path, a pattern, a sort key, a field name — whichever you wrote from
   memory is the one that fails silently, and only the absence-shaped failures announce
   themselves.*

2. **Add the remedy, which is not "be careful."** *Run a positive control: make the
   instrument find or rank one case whose answer you already know, before believing the
   case you do not.* All three instances above were caught by that and by nothing else —
   not by re-reading, which is the same reader consulting the same belief.

Keep the three existing arms and the never-authorise-a-deletion rule unchanged; they are
the absence half and they are correct.

**Shipping:** a skill edit does not reach any profile until the version in
`codescout-companion/.claude-plugin/plugin.json` is bumped and each cache's served copy is
probed. Current version at filing: `1.16.15`; shipped as `1.16.16`, probed against the
served copy in all three profile caches (`.claude`, `.claude-sdd`, `.claude-kat`).

## Tests added

None — not implemented. The behavioural eval at
`codescout:docs/evals/reconnaissance-output.md` is the surface that would score this; its
baseline is still unrun (n=0), so any claim about whether the widened wording changes scout
behaviour would be unfounded either way.

## Workarounds

Run a positive control by hand. For a grep, confirm the pattern matches a known-present
case in the same invocation; for a sort, confirm the extreme element is where you expect.

## Resume

Closed 2026-08-21. Widened the existing Phase 1 bullet in place (kept the three
absence arms — scope/shape/encoding — and the never-authorise-a-deletion rule
unchanged): the opening now names the wrong-answer case alongside the
zero case, and the remedy adds a positive control — verify the instrument
against one known-answer case before trusting it on the unknown one. Citation
chain extended `R-3 → R-73b → R-77 → R-79 → R-104`, per the skill's own
"Every promotion audits the promoted set" § *Outgrown* handling (re-promote
the evolved form rather than filing a sibling law).
`codescout-companion/.claude-plugin/plugin.json` bumped to `1.16.16` and
profile caches verified — see the version-bump-checklist tracker.
## References

- `codescout:reconnaissance-patterns:R-104` — upstream entry, Status `promote-when` (fired)
- `codescout:docs/PROBES.md` § *Before you trust any probe on this page*, rule 4
- `codescout:scripts/stale-servers.sh` — the instance-3 trap, documented at the sort key
- `codescout-companion/skills/reconnaissance/SKILL.md` Phase 1 — the bullet to widen
