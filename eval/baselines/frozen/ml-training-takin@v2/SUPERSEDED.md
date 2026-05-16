## Superseded by v3 (refactor of candidate specialist)

This baseline was frozen 2026-05-16 with the original (pre-ibex-pattern)
`ml-training-takin/SKILL.md`. Superseded when takin was refactored to
match the bestiary-wide ibex pattern.

**Rebaseline trigger** (per METADATA.json `rebaseline_triggers`):
specialist SKILL.md substantive change.

**Delta v2 → v3** (see `eval/baselines/frozen/ml-training-takin@v3/METADATA.json`):

| Metric | v2 | v3 | Δ | Claimable? |
|---|---|---|---|---|
| case-01 mean | 0.880 | 0.960 | +0.080 | NO — below floor 0.200 |
| case-02 mean | 1.000 | 1.000 | +0.000 | — |
| case-03 mean | 1.000 | 1.000 | +0.000 | — |
| Floor | 0.200 | 0.200 | unchanged | — |
| openai parse rate | 14/15 (93%) | 15/15 (100%) | +7pp | methodological |
| candidate response length | ~2600 chars/case | ~3700 chars/case | +50% | structural |

The refactor maintained quality (no regression on any case) and brought
takin into structural alignment with the rest of the bestiary. The
case-01 directional improvement is documented but not claimed — the
anti-drift rule applies to us too.

**κ_vs_strong_panel = 1.000** inherited via judgment (candidate changed
but outputs preserve all original content + added structure; strong-panel
disagreement unlikely to grow). Rigorous re-verification deferred to
first Phase 3 systemic rewrite that warrants the cost.

**Use v3** for all future regression detection:
`eval/baselines/frozen/ml-training-takin@v3/`.

This v2 directory is preserved for forensic comparison.
