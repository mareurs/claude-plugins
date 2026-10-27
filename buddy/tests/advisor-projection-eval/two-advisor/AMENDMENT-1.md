# Two-advisor eval — amendment 1: the RETAIN marker list undercounted

**Made 2026-10-27, after the instrument control (B1) was run and scored, and before any
treatment arm (B2, B3) was run.** No B2 or B3 data existed when this was written. Filed
as a separate amendment so the original rule and its defect stay legible.

## What happened

`PRE-REGISTRATION.md` defines RETAIN as the response containing any of
`**Contract:**`, `**Mutation-survival:**`, `**Boundaries covered:**`.

B1 scored RETAIN **4/5**. Reading the one miss (`results/B1-primary-alone/run-5.txt`)
shows it did not drop the primary's output contract. It carries the primary's Test
Format fields `**Properties:**`, `**Isolation:**`, `**Pyramid level:**`,
`**Confidence:**` and `**Open gaps:**`, a `## Contract` heading, and
`**Boundaries covered today:**`. None of the three registered strings occurs
literally, so the scorer read a response that retained the contract as one that had
not. This is the same defect `../AMENDMENT-1.md` caught in the one-advisor eval: a
discriminator that does not detect the case it exists for.

The direction matters. The error biases **against** the premise (it would lower B2's
RETAIN as readily as B1's), so it would have made "premise holds" harder to reach for
a reason unrelated to the premise.

## The fix

RETAIN is now: the response contains any of the primary's exclusive Test Format
markers: `**Contract:**`, `**Mutation-survival:**`, `**Boundaries covered:**`,
`**Properties:**`, `**Isolation:**`, `**Pyramid level:**`, `**Open gaps:**`.

I checked that each added marker is exclusive to the primary. Neither advisor pair's
format contains `**Properties:**`, `**Isolation:**`, `**Pyramid level:**` or
`**Open gaps:**`: `security-ibex` uses Severity / Category / Location / Evidence /
Exploit sketch / Fix / Confidence, and `architecture-snow-lion` uses Decision /
Context / Alternatives considered / Consequences / Change scenarios absorbed /
Revisit-when / Confidence. `**Confidence:**` is shared by every format and is
deliberately not a marker.

All markers are present in the payload of every arm (verified for the first three on
the generated prompts; the added four are in the primary's `## Test Format` block,
which every arm carries), so the observable can move in either direction.

## What did not change

The decision rule, the arms, the stimulus, LANDING, the behavioural read, the budget
and the invalid-run handling are unchanged. The amended RETAIN is applied to every arm
identically.

## Reporting

B1 is reported both ways: **4/5 under the original markers, 5/5 under the amended
markers.** The amended score gates the instrument control, because the original score
was shown to be wrong on a case I can point to. B2 and B3 are scored with the amended
rule, and also with the original, so a reader can see whether the amendment moved any
verdict.
