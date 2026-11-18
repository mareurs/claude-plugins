# Codex forward-compatibility independent review — 2026-11-18

Scope: only /tmp/codex-forward-compatibility-20261118/review.diff relative to its saved dirty baseline, plus the subsequent comment-only intake change described by the executor. Worktree source was read-only; all applied mutations used /tmp/codex-forward-review-20261118. No subagents dispatched. Spec3554963c3e08442d, plan6da0633f21fec651, execution ledger and reviewer template read.

## Strengths

- compatibility.mjs:12-28 validates complete SemVer and compares decimal component strings by length and value, avoiding numeric overflow. Stable floors reject equal-floor prereleases.
- adapters/codex.mjs:16-26 retains enablement, callback/subscription, both generation halves, canonical profile and exact observed-version checks. Unknown eligible versions use evidenceRef=null with a reason that accurately describes configured proof.
- Native intake and callback probe tests exercise newer stable and prerelease acceptance through real production entry points. Historical evidence fixtures and Claude behavior are outside the delta.

## Issues

### Important — patch dimension is unpinned

compatibility.test.mjs:5-10; adapters/codex-compatibility.test.mjs:11-33; production comparator compatibility.mjs:22.

Actually changing the comparator loop from i<minimum.length to i<minimum.length-1 leaves all 53 focused tests passing. The skipped patch component makes0.160.1-alpha daemon and0.165.1-alpha hook versions fail eligibility although both exceed the stable floors. Current accepted prerelease examples have a larger minor component and therefore return before reaching this boundary.

Add those exact versions at the shared helper and adapter/intake callsites, with the stable floor prereleases retained as rejection controls. This finding is a confirmed regression-coverage gap, not a defect in the current comparator.

### Important — preserved guard callsites need direct regression coverage

adapters/codex-version.test.mjs:83-103 and adapters/codex-compatibility.test.mjs:27-33; production guards adapters/codex.mjs:16 and intake.mjs:41,43.

Three separately applied deletions leave all 53 focused tests passing: adapter enablement, intake enablement, and the normalizeHookContext validation call. The approved policy explicitly retains enablement and native hook context validation. Direct tests should pass otherwise valid newer-version config/input, then independently set enabled=false / omit enablement and supply missing or relative cwd. A missing-context-call mutant can accept the malformed cwd because cwd is not carried into target validation.

Each of these three mutants also survives a broader 110-test suite: all background-wake adapter test files plus config-binding, codex-hook, cli, cli-stdin and launch, using --test-concurrency=1. Baseline110/110; each independent mutant110/110. This is not a claim about every repository test.

## Mutation evidence

Focused command:
node --test codescout-companion/background-wake/compatibility.test.mjs codescout-companion/background-wake/adapters/codex-version.test.mjs codescout-companion/background-wake/adapters/codex-compatibility.test.mjs tools/probe-codex-wake-originator.test.mjs

Unmutated baseline53 pass/0 fail. Seventeen distinct mutations actually applied one at a time: 13 killed, 4 survived. Original source bytes restored between each and in finally; each run has its own log.

| Mutation | Observed focused pass/fail | Outcome/test |
|---|---|---|
| Drop decimal-length comparison |52/1|Killed by numeric feature-floor test, specifically0.9.0|
| Accept equal-floor prerelease |51/2|Killed by helper and0.165.0-alpha intake|
| Drop numeric prerelease leading-zero rejection |51/2|Killed by SemVer and daemon parser tests|
| Drop daemon minimum callsite |52/1|Killed by0.159.999 adapter|
| Drop exact observed-version comparison |45/8|Killed by adapter mismatch/malformed/build cases|
| Drop hostInstanceId generation half |52/1|Killed by newer host-generation test|
| Drop runtimeGeneration half |51/2|Killed by independently mismatched runtime and newer-runtime tests|
| Drop canonical profile comparison |52/1|Killed by newer profile guard|
| Drop callbackPreserved check |52/1|Killed by newer false-callback test|
| Drop subscription check |52/1|Killed by newer wrong-subscription test|
| Drop adapter enablement |53/0|Survived|
| Drop root/child guard |51/2|Killed by old/new child intake cases|
| Drop hook-context validation call |53/0|Survived|
| Drop hook minimum callsite |50/3|Killed by below-floor, floor-prerelease and malformed intake|
| Drop probe exact-version check |49/4|Killed by probe mismatch/malformed cases|
| Drop intake enablement |53/0|Survived|
| Skip patch comparison component |53/0|Survived|

Artifacts: mutate.py, mutations.json, patch-mutation.py, patch-component.tap, recheck.py, broader-mutations.json and individual *.tap logs in this report directory. Three guard mutants were additionally reapplied against the broader 110-test suite; each survived110/110 and exact source bytes were restored. Those are reruns of three candidates, not additional distinct mutations. Two initial broader baselines failed due omitted copied probe test imports; neither failure is counted as a mutation kill.

## Declined to judge

- Actual native0.169 callback or automatic wake acceptance: this review uses protocol fixtures; executor-owned native probes provide separate evidence.
- Stock0.169 rollout/metadata repair: explicitly excluded by the spec.
- Profile configuration rollout, installation caches, version bump and release: explicitly excluded; no configuration change or release is implied.
- Whole repository health beyond the selected tests: executor is running repository checks independently.

## Assessment

Ready to merge: With fixes. No production behavior defect was found in the reviewed delta. Close the observed patch-dimension and retained-guard regression gaps before claiming the plan's test coverage is complete.

Ledger checked: cd15dd2c76c1f7eb,4858a9179d30d447,2646bba03b528020,da6eaaa69498077b,33de9ea8980e85c9.
