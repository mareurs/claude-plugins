---
id: '426454b7dcf02ef5'
kind: report
status: done
title: Hook fixture isolation under an ancestor project
tags:
- tests
- isolation
- codex
---

# Hook fixture isolation — 2026-11-18

The final repository validation exposed a test isolation bug while repairing GitHub issues14/15. `TMPDIR` was `/home/marius/.cache/cc-tmp`, and `/home/marius/.codescout/project.toml` made the home directory an enclosing project. The actual `resolveProjectRoot` call returned `/home/marius` for the temporary diagnostic project. Three suites expected state beneath their fixture cwd and failed because the production resolver correctly chose the enclosing project.

## Observed RED and GREEN

An owned controlled enclosing `.git` project reproduced the same failures without using the home directory. Before fixture fixes, `test-cross-platform-hooks.sh` reported7pass/5fail, `test-skill-hints-lib.sh`4pass/3fail, and `constitution-epoch-bump.test.sh`2pass/2fail. The initial three-suite regression runner first reported3pass/6fail. The three original suites independently passed with `TMPDIR=/tmp`, which had no enclosing project marker.

Those fixtures now declare their own project boundaries; the malformed-input case also isolates its fallback cwd and HOME. The epoch fixture has EXIT cleanup. No production resolver behavior or shared fixture helper changed. After repair, all three original suites passed under both the controlled ancestor and the machine's default TMPDIR:12/0,7/0,4/0 pass/fail. The initial runner passed9/0.

The subsequent whole run found four additional suites affected by ancestor dedup state. A separate owned reproduction ran each twice against the same ancestor. First runs passed but second runs failed: `test-suspicious-zero-hint.sh`7/4, `constitution-brief.test.sh`3/2, `constitution-guard.test.sh`5/7, `skill-hints.test.sh`4/4. The controlled brief result differs from the home-run4/1; no equivalence is claimed. The extended seven-suite runner initially reported15/6, catching ancestor writes and leftover fixture directories even where the first nested suite passed.

The four additional fixtures now have their own boundaries; brief/guard also clean their owned temporary project and stub directories on EXIT. After repair, both consecutive controlled runs passed11/0,5/0,12/0,8/0 respectively, with no ancestor state writes or fixture leftovers. Final `tests/test-hook-fixture-isolation.sh` measures21 checks across all seven suites: successful execution, no ancestor state, and no owned fixture leftovers per suite. It passed21/0 twice with `TMPDIR=/tmp` and twice with the inherited `/home/marius/.cache/cc-tmp`. Syntax and whitespace checks passed. Addendum and exact synthetic state bodies/schema capture: `/tmp/hook-fixture-isolation-followup-exm3e6/addendum.json` and `red-state-summary.json`.

## SDD fixture follow-up

The subsequent complete check exposed the same assumption in `sdd/hooks/lib.test.mjs`: its temporary outside-repository directory inherited an ancestor `.git`, which `mainCheckout` deliberately discovers. Fresh unchanged suite: 36 passed / 1 failed. Production resolver code is unchanged. The negative fixture now creates an owned invalid `.git` pointer inside a known ancestor repository, verifies the parent is discoverable first, and then verifies the invalid boundary returns null. Restored suite: 37 passed / 0 failed with the machine's inherited TMPDIR. No global markers were removed.

## Buddy fixture follow-up

The clean release preflight at `ab6befc` completed `./tests/run-all.sh` successfully, then its separate buddy pytest gate failed7cases with572passing. A controlled enclosing `.git` reproduced the same seven failures and `.buddy` ancestor writes. Initial fixture corrections produced579passing tests, while a separate containment assertion still failed. Per-test filesystem snapshots identified five additional passing writers: three SessionStart helper tests and two migration subprocess cases. These were observed writes, not inferred coverage gaps.

Four buddy test modules now declare owned project boundaries. The unmarked-filesystem fallback unit masks only `.git` and `.codescout/project.toml` predicates so that its negative world is independent of the actual host. Production resolver/hook code is unchanged. New `tests/test-buddy-fixture-isolation.sh` runs the complete579-test population beneath an owned enclosing project and asserts no state appears in that ancestor. Final result579passed and ancestor untouched, exit0. The runner cleans its owned scratch state on EXIT and skips explicitly if pytest is unavailable.

The broad repository command passed before this fixture-only delta. The delta is covered by the complete buddy suite and new containment runner; subsequent release uses that composed verified preflight rather than repeating unchanged shell/Node suites. F-8 records the exact RED, incomplete GREEN, observed writers and final containment result.

## Cleanup and evidence

The earlier failing runs created17 files under seven known synthetic home `.buddy` fixture IDs (`cp-se`, `cp-stub`, `cp-once`, `cp-noyaml`, `sid-1`, `sid-2`, `ci-smoke`). A narrowly scoped cleanup validated the exact filenames, backed them up to `/tmp/issue15-test-pollution-backup-20261118`, removed those files and the synthetic pointer, and left the home project configuration unchanged. The repository's malformed-input `unknown` pointer was restored to the active harness session. Cleanup targeted the validated synthetic fixture files and pointers.

The follow-up also identified16 exact synthetic files from the four additional suites. The controller compared their bodies with the owned reproduction, explicitly checked three combined epoch/global-state variants, validated regular files and absence of symlinks, backed up all16 files, and removed only that allowlist. Backup: `/tmp/issue15-test-pollution-followup-backup-20261118`. The cleanup reported16 validated fixture files removed and no other files changed; configuration files were left alone.

Full local verification logs and the external reproduction harness are in `/tmp/hook-fixture-isolation-UtMJPu/` and `/tmp/hook-fixture-isolation-followup-exm3e6/`. Durable regression coverage is the seven-suite runner, discovered by `tests/run-all.sh`. Full repository validation after all fixture fixes is recorded in the issues14/15 implementation plan.
