# legible

Make Claude's output easier for a person to read and check.

## Contents

| Component | Name | What it does |
|---|---|---|
| Output style | `legible:Explanatory STE` | The built-in Explanatory style (★ Insight blocks) plus 8 structure rules from ASD-STE100 Issue 9 at about 80% strength. It keeps the precise modals (*must*, *should*, *may*, *might*) and does not use the STE dictionary. |
| Skill | `/legible:explain [ste\|page]` | Re-explains the previous answer. `ste` (the default) rewrites it in chat with strict STE structure. `page` writes one self-contained HTML file with an inline SVG diagram to `/tmp/legible/` and opens it. |
| Script | `scripts/style_probe.py` | Measures whether the style shortens sentences, fades in long sessions, or drops hedge words. |

Select the style with `/output-style legible:Explanatory STE`, or set `"outputStyle": "legible:Explanatory STE"` in a profile's `settings.json`. The short name does not resolve. A project's `.claude/settings.local.json` that sets `outputStyle` overrides the profile value.

A running session loads plugins only when it starts or when you run `/reload-plugins`.

## Measuring the style

```sh
python3 legible/scripts/style_probe.py --self-test
python3 legible/scripts/style_probe.py --since 2026-09-20 --model claude-sonnet-5-5
```

Run `--self-test` first. It checks the sentence splitter against two texts with known counts, and it exits non-zero if either check fails.

Always pass `--model`. Sentence length differs by model, so a pooled comparison measures the model mix as much as the style. On 2026-10-11 the pooled figures were 13.6 vs 11.0 words, and the comparison within Sonnet 5.5 was 12.7 vs 11.0.

The script assigns each message to the style that was active for it, from the transcript's `output_style` attachments. It resamples whole sessions for its intervals, because sentences in one session are not independent.

### Baseline, 2026-10-11, Sonnet 5.5, since 2026-09-20

| | Explanatory (22 sessions) | legible (40 sessions) | Difference, 95% CI |
|---|---|---|---|
| Mean words per sentence | 12.69 | 10.98 | −1.7 [−2.07, −1.37] |
| Share of sentences over 25 words | 3.72% | 1.53% | −2.2 pp [−3.20, −1.33] |
| Hedges per 1000 words | 2.68 | 2.32 | −0.36 [−0.97, +0.26] |

Within-session drift (late blocks minus early blocks): +0.51 words in the legible arm (rises in 14 of 24 sessions), −0.34 in the Explanatory arm (8 sessions).

How to read it:

- The style shortens sentences. Both intervals stay clear of zero.
- The drift is small and weakly supported. It does not justify a reminder hook.
- The hedge interval includes zero, so the data shows no clear hedge loss. It does not exclude a loss of up to about 1 hedge per 1000 words. Check this number first on the next run.

What the numbers do not show:

- The comparison is observational. Most Explanatory messages are from before 2026-10-04 and all legible messages are from after it, so the tasks differ.
- Sentence length is a stand-in for readability. Nothing here measures comprehension or fact retention.
- Opus 5.5 had only 2 legible sessions on 2026-10-11, too few for a comparison. The script prints no comparison when an arm has fewer than 5 sessions.
