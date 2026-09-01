---
id: '3f3f739030789f54'
kind: bug
status: fixed
title: The reload block inlines 45 KB of skill bodies into hook stdout, so CC truncates 96% of it away behind a marker that says it reloaded
tags:
- buddy
- compaction
- reload
- hook-output-cap
- silent-degradation
closed: 2026-09-01
opened: 2026-09-01
owner: marius
related:
- cde98724a366d2a2
severity: high
unverified: 'The 12,000-byte inline cap is derived from a measured bound of (14,056 … 21,327], not from the constant itself: `maxResultSizeChars`/`persistenceThresholdCeiling` were located in the 2.1.252 bundle but their numeric values were not read. Whether JSON `additionalContext` escapes the cap is UNKNOWN and must not be assumed — no JSON sample above the cap exists in 130,958 observations, so shape and size are confounded. (Discharged 2026-09-01: this field used to open with ''Not fixed — filed only'', which contradicted `status: fixed`. The fix shipped in `584d804` + `8c6711c` and is now verified live end-to-end — see `## Verified live 2026-09-01`. The two clauses above still stand, which is why the field is narrowed rather than cleared.)'
---


## Summary

`buddy/scripts/hook_helpers.py:437` emits the reload block with
`_sys.stdout.write(block + "\n")`. The block inlines every reloaded skill's SKILL.md
verbatim; `codescout-companion/skills/reconnaissance/SKILL.md` alone is **44,673 bytes**.

CC's tool-result persistence path truncates hook stdout over its inline cap to a ~2 KB
preview plus a file path. So the block announces `buddy:reloaded` and then delivers 4% of
what it claims to have reloaded.

**Measured 2026-09-01**, from the session transcript's own attachment record for the hook:

| field | value |
|---|---|
| `stdout` | **44,702** bytes emitted |
| `content` | **2,080** bytes entered the model's context |
| body after stripping CC's wrapper | **1,789** bytes, a strict prefix of `stdout` |
| never delivered | **42,913** bytes = **96.0%** |

The preview stops mid-`## When NOT to Use`. Phases 1–4, Stop Conditions, the worked
exemplars and the entire recon-patterns tracker protocol never arrive. The model is told
reconnaissance is loaded and gets its title, its seam definition, and its two "when to
use" bullets.

**Valid:** invariant — holds for any payload over the cap, and the payload only grows.

**Rests on:** the transcript attachment record; the 2.1.252 bundle; the F-4 precedent.

## Mechanism, read from the bundle

Not hook-specific — it is the **tool-result** persistence path, which SessionStart hook
stdout is routed through (the attachment carries a `toolUseID`):

```js
var O0e = 2000;                          // preview chars
var Gte = "<persisted-output>", Qfn = "</persisted-output>";
function Qce(t) {
  let e = `${Gte}\n`;
  e += `Output too large (${Nt(t.originalSize)}). Full output saved to: ${t.filepath}\n\n`;
  e += `Preview (first ${Nt(O0e)}):\n` + t.preview + (t.hasMore ? `\n...\n` : `\n`) + Qfn;
  return e;
}
function N9e(t, e, r = T9) { … return Math.min(e, r) }   // maxResultSizeChars ⊓ ceiling
```

There is **no `@ref` handle** — the pointer is a plain filesystem path, so nothing in the
model's context invites it to fetch the rest.

## Where the cap actually sits

Measured across **2,369 transcripts / 130,958 hook-output samples** on this machine:

| hook output shape | n | truncated | max bytes seen | min truncated |
|---|---|---|---|---|
| JSON (`hookSpecificOutput.additionalContext`) | 122,640 | **0** | 14,056 | — |
| plain stdout, SessionStart | 213 | **212** | 44,702 | 21,327 |
| plain stdout, UserPromptSubmit | 105 | 0 | 687 | — |

So the cap is bounded to **(14,056 … 21,327]**.

**Do not read this table as "switch to JSON and it is fixed."** The two populations do not
overlap in size, so shape and size are confounded: there is no JSON sample above the cap
anywhere in 130,958 observations, and therefore no evidence that `additionalContext`
escapes it. What the table *does* establish is that shape alone is not the trigger — a
444-byte plain-stdout sample passed through untouched.

## The fix already exists on the sibling path

F-4, measured 2026-06-14, shipped in buddy 0.7.24: `summon_bootstrap.py::spill_payload()`
writes an over-cap payload to guard-exempt `.buddy/<sid>/summon-payload-<dir>.md` and the
hook emits a compact `payload-file=` pointer. `summon.md` Step 0 reads that one file with
native `Read`. This mirrors codescout's own *always buffer, return a compact pointer*
principle (`2026-03-29-onboarding-buffered-output-design.md`).

`docs/superpowers/specs/2026-06-12-skill-loading-bootstrap-design.md` records the fix and,
in the same paragraph, notes that `reload.py` took only the **frontmatter-hygiene** half of
that work:

> `reload.py` strips frontmatter when rendering reload blocks (same payload hygiene as the
> bootstrap).

`spill_payload` has exactly **one** call site — `summon_bootstrap.py:469`. The reload path
never got it.

## Proposed fix

Port the mitigation rather than inventing one — but **`spill_payload` is not drop-in, and this section said otherwise until it was scouted.**

`spill_payload(payload, directory, project_root, sid)` hardcodes its filename as
`summon-payload-{directory}.md` and takes a single specialist `directory`.
`render_reload_block` takes a **list** of specialists, so there is no single `directory`
to key a reload payload on. Reusing it verbatim is not possible; either generalise it to
accept a filename, or write a sibling in `reload.py` and keep the two paths' naming
distinct. (Corrected 2026-09-01 by a pre-implementation scout — the original wording,
"port the mitigation", would have sent an implementer at a signature that does not fit.)

The call site does have everything else it needs, verified at `hook_helpers.py:426-437`:
`incoming_sid`, `project_root` (via `buddy_paths.resolve_project_root`) and `plugin_root`
are all in scope where the block is written.

1. If `len(block)` exceeds a conservative inline cap (**12,000** — under the measured
   lower bound of 14,056, with headroom), spill to
   `.buddy/<sid>/reload-payload-<source>.md` and emit only the marker plus
   `payload-file=<rel>`.
2. Keep the arrival-line instruction inline — it is what makes the reload observable, and
   it must survive even when the body spills.
3. Fall back to inline emission when there is no session id or the write fails, exactly as
   `summon_bootstrap.py` does.
4. Instruct the read with native `Read`, not `read_markdown` — `.buddy/` is guard-exempt
   and a heading map would fragment a skill body.

Regression test: assert that a block over the cap yields stdout under the cap and a
`payload-file=` pointer whose target holds the full body. The natural home is
`buddy/tests/test_reload.py`, alongside the five existing `render_reload_block` tests.

**Still required after the 2026-09-01 recon split.** Splitting `reconnaissance/SKILL.md`
44,375 → 13,680 B does not remove the need for this. Measured with the real
`render_reload_block`: recon alone now yields 13,844 B — only **212 B** under the measured
floor — while `codescout-pika` alone is 16,816 B, `prompt-hamsa` alone is 22,122 B, and
recon + `debugging-yeti` is 23,684 B. Any two specialists, and two individual ones, still
exceed the cap.

## Why it stayed invisible

Every instrument reports success. The hook exits 0. `render_reload_block` returns the full
string and its five unit tests assert on that return value, never on what CC delivers. The
marker in the surviving 2 KB says `buddy:reloaded`. The model dutifully prints the arrival
line it was asked for — from an instruction that lands in the first 2 KB — and so
*announces* a reload it did not receive.

The one honest signal, `Output too large (43.7KB)`, sits in the model's context and reads
as routine harness plumbing rather than as a 96% content loss.


## Fix provenance

- **SHA:** `8c6711c` — the commit that completed the fix
- **patch-id:** `491dbf64684d3a420b04d1ab8e47a30e1b10b41c`

Two commits, because the first was scoped to one message and the cap applies to the hook's
whole stdout. `8c6711c` is the anchor above because it is the one that makes the fix true;
`584d804` alone was a half-fix.

| SHA | patch-id | what |
|---|---|---|
| `584d804` | `7a6daae386fd335c59aace1613cd13d16643b35d` | spill over-cap reload payloads to a file instead of losing 96% |
| `8c6711c` | `491dbf64684d3a420b04d1ab8e47a30e1b10b41c` | bound the hook's **TOTAL** stdout, not one message; audit the rest |

`584d804` alone was insufficient and its own author said so on re-reading: it checked one
block's size against the cap, while `handle_session_start` has five writers. `8c6711c` added
the `reserved` parameter and made the caller render the dismissal notice first so its length
could be reserved. Recording only the first would anchor to a half-fix.

Both single-parent, so both patch-ids are real. They are recorded because a SHA orphans on a
rebase and keyword recovery from a subject line measured 2–153 ambiguous candidates.

## Fixed 2026-09-01

`reload.py` gained `INLINE_CAP = 12000` and an over-cap spill; the mechanism was
extracted from `summon_bootstrap.spill_payload` into
`buddy_paths.spill_to_session_dir(payload, name, project_root, sid)`, which both paths
now share. `spill_payload` survives as a thin wrapper because it owns the summon
*filename* — the two must not write to the same file — and because its signature is what
its caller and tests use.

The marker and the arrival-line instruction always stay inline; only the bodies spill.
That split is deliberate and pinned by a test: if the instruction spilled with the bodies,
a truncated payload would take the arrival line with it and the reload would become
invisible again — the exact silent failure this closes.

Measured after the fix, via the real `render_reload_block`:

| reloaded | stdout | |
|---|---|---|
| reconnaissance | 1,046 B | spilled |
| prompt-hamsa | 1,044 B | spilled |
| codescout-pika | 1,046 B | spilled |
| reconnaissance + debugging-yeti | 1,062 B | spilled |
| debugging-yeti | 10,339 B | inline |

End-to-end check: 23,297 B written to `.buddy/<sid>/reload-payload-compact.md` while
stdout carried 1,062 B.

**Cap rationale, and why it is 12,000 rather than 14,056.** The earlier figure came from
a JSON `additionalContext` PreToolUse hook — a different event and output shape. On *this*
channel (plain stdout, SessionStart) the only datapoints are 444 B delivered and 21,327 B
truncated; everything between is unmeasured. 12,000 sits below every observed truncation
and below the largest observed delivery on any channel. Raising it needs a measurement of
this channel, not an argument — and `test_inline_cap_stays_within_the_measured_bounds`
asserts `444 < INLINE_CAP < 21327` so the value cannot drift on reasoning alone.

**Tests: 8 new in `buddy/tests/test_reload.py`** (33 in that file, 524 pytest total,
`run-all.sh` green). One of them was wrong when written and is worth recording: the spill
fixtures were sized `INLINE_CAP * 2`, so they scaled with the constant and **all four
spill tests passed at a cap of 99,999,999**. Fixed by making the fixture size absolute
(30,000) and adding the cap-bounds test; re-running the same probe now fails three tests,
which is the discrimination the suite needed. A green test whose fixture is derived from
the thing it judges is the `R-5` self-validating-gate shape, reproduced here by accident.


## Verified live 2026-09-01

The fix is now confirmed **end-to-end in production**, on a real main-session `/compact` —
not a fixture, not a unit test.

Observed in the receiving session's own context:

```
SessionStart:compact hook success: <!-- buddy:reloaded sid=8232b1a0-… from=unknown
  source=compact payload-file=.buddy/8232b1a0-…/reload-payload-compact.md -->
```

followed by the pointer text instructing a native `Read`, and then a successful read of
**13,335 bytes** of reconnaissance skill body out of that file.

Why this is the observation the record was missing, and not just another green test:

- **It exercised the spill branch, not the inline branch.** 13,335 B exceeds the 12,000 B
  `INLINE_CAP`, so `render_reload_block` took the path that writes a file and emits a
  pointer. Pre-fix, a payload this size was truncated to a ~2 KB preview with **no handle to
  fetch the rest** — roughly 96% dropped behind a marker that claimed a successful reload.
- **The whole chain ran in a real profile**: hook fired on a genuine `/compact`, wrote to
  `.buddy/<sid>/`, the pointer survived into the model's context, and the guard-exempt path
  let the file be read back. Each link had failed at least once during development.
- **The total-stdout bound held.** The reload block plus the arrival-line instruction plus
  whatever else `handle_session_start` wrote all fit under the cap together, which is
  precisely what `8c6711c` added `reserved` for and what `584d804` alone did not do.

**What this does NOT establish**, kept explicit so the record is not read as broader than it
is: the two caveats in `unverified:` are untouched. The cap is still an empirically bounded
value rather than a constant read from the bundle, and whether JSON `additionalContext`
escapes the cap is still unknown and still must not be assumed.
