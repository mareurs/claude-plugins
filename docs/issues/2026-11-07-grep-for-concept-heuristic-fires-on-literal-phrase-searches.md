---
kind: bug
status: mitigated
title: the buddy grep-for-concept heuristic fires on literal phrase searches, and none of 17 recorded firings was a concept query
tags:
- buddy
- hooks
- cs-hint
owner: marius
severity: low
opened: 2026-11-07
unverified: "Mitigated against 14 of the 17 recorded firings (labels are one reader's judgement from the pattern and the next three calls). Not checked: the share of grep calls that do NOT fire, whether a real concept query phrased with a function word is now missed, and whether any firing ever led to a better search."
closed: 2026-11-09
---

## Summary

`_check_grep_for_concept` in `buddy/scripts/cs_heuristics.py` (lines 240-279) emits `[cs-hint] grep("<pattern>") matches text literally. For concept queries, semantic_search finds related code by meaning...` when a `grep` pattern looks like a natural-language phrase. Its test is only the shape of the pattern, so it also fires when the agent searches for an exact message, a document phrase or a definition fragment on purpose.

## Verified

Read from the source on 2026-11-07, no run needed:

- The function returns `None` unless the tool is `mcp__codescout__grep`.
- It fires when ALL of these hold: the pattern has at least 12 characters; it contains no regex metacharacter (`\ ^ $ . * + ? ( ) | [ ] { }`); it contains none of `::`, `->`, `=>`, `__`; and it has two or more space-separated words that are all letters.
- It does not look at `path`, `glob`, `mode`, the preceding calls, or whether the phrase was copied from a tool result.

## Evidence

A scan of the codescout project's transcripts in the four profiles, modified after 2026-11-05 (19 files including subagents), found 17 genuine deliveries of this hint (`attachment` type `hook_additional_context`). Details: codescout memory `research/cs-hint-transcript-mining-20261107`.

By my reading, all 17 were literal searches, not concept queries:

| Kind | Patterns |
|---|---|
| message or log text | `another session wrote` (2), `another mux instance holds the lock`, `reference index is not ready` |
| phrase from a document | `Filed the silent partial result as`, `about a minute`, `a gate started while the command runs gets another slot`, `baselined against that layer`, `ledger is shared parent`, `substrate fact`, `only moves down`, `verify callers`, `matches text literally` |
| definition fragment | `function emitSkillHint`, `export function contextPostToolUse`, `class CrashSignalTests` (2) |

What the agents did in the next three calls: 1 of 17 switched to `symbols` (the `matches text literally` search), 6 searched again with `grep`, 10 did something else. Ignoring the hint looks correct in the cases read.

## Effect

- The hint costs context on each firing and teaches the opposite of the right action: for a message or a definition fragment, `grep` is the correct tool, and for `class X` or `function f` the better tool is `symbols(name=...)`, not `semantic_search`.
- It competes with hints that are accurate. Over the same transcripts the parallel-write hint fired correctly 18 of 18 times.

## Options (not decided)

1. Remove the heuristic.
2. Narrow it: fire only when the pattern has no code-like token (`function `, `class `, `fn `, `def `) and `path` is not a single file, or when the phrase is not already present in the previous tool result.
3. Keep it but measure first: label a larger set of grep patterns (concept versus literal) and report precision before choosing.

I recommend 3 before 2. The 17 cases show the heuristic never helped here, but they do not show how often a real concept query is missed.

## Tests to add with any change

A case per row group in the table above must NOT fire; one genuine concept phrase (for example `how are retries scheduled`) must fire. Today no test pins the negative side.

## Resolution (2026-11-09)

Status `mitigated`, not `fixed`. I took option 2 (narrow), with the 17 recorded patterns as the negative tests, instead of option 3 (measure first) that this file recommends. Reason: the shape test alone cannot separate a quoted message from a concept, but quoted prose carries function words and identifiers carry camelCase or a definition keyword, and those two signals are cheap and one-way (they only silence the hint).

`_check_grep_for_concept` in `buddy/scripts/cs_heuristics.py` now returns `None` when the all-alpha pattern:

- has a camelCase or PascalCase word, or starts with a definition keyword (`function`, `class`, `export`, `struct`, ...);
- or contains a function word (`the`, `is`, `not`, `another`, ...), unless it opens with a question word (`how`, `where`, `what`, ...).

Measured against the 17 recorded firings: 14 are silenced, by 12 distinct patterns (`another session wrote` and `class CrashSignalTests` each fired twice), one test case per distinct pattern in `test_grep_for_concept_literal_phrase_ok`. The three that still fire (one firing each) have no function word and no identifier: `substrate fact`, `verify callers`, `matches text literally`. No shape test separates them from a concept, so they are not pinned.

Positive side pinned by `test_grep_for_concept_genuine_concept_still_fires`: `retry logic backoff`, `authentication middleware`, `error handling retries`, `how are retries scheduled`, `where is the session state stored`.

Mutation check: emptying `_FUNCTION_WORDS` fails 9 tests, `_QUESTION_WORDS` 2, `_DEFINITION_KEYWORDS` 1, and removing the camelCase rule 1. The recorded definition fragments trip both identifier rules, so removing either one would pass the list alone (inferred from the rules, not run); `test_grep_for_concept_each_identifier_rule_stands_alone` adds one case per rule, and the two mutations above that fail exactly one test are those cases.

buddy pytest: 569 passed.

Not done, and still open: the share of real concept queries this now misses. A concept phrased with a function word (`error handling for retries`) no longer gets the hint. Option 3's labelled sample is what would show whether that cost is real. The `path` and previous-result checks from option 2 were not added.
