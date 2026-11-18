---
id: c9ff21c00592bc7f
kind: tracker
status: done
title: Session Log — PR 10 audit
tags:
- pr-review
- reconnaissance
- systematic-debugging
topic: pr10-audit
entry_prefix:
- F
- W
snapshot_anchor: '| ID | Date | Severity | Status | Finding |'
entry_high_water_F: 1
---

# PR 10 audit session log

**CLOSED — 2026-11-18:** [PR #10](https://github.com/mareurs/claude-plugins/pull/10) merged as bfefda19bcc31be4ba58dc17d541239d032d52e9 after corrections, independent review and five passing CI jobs. See Resolution for the final evidence. The original investigation below is historical; re-run its fixtures when classification or citation resolution changes.

## Scope

Reassess PR #10 (`19871cc1f104af46bbaa52b06eeab0abda700b42`) against local main (`34565f9`) and the installed codescout binary. No PR state, production configuration, plugin source, or version changes were requested in this investigation.

## Index

| ID | Date | Severity | Status | Finding |
|----|------|----------|--------|---------|
| F-1 | 2026-11-18 | high | fixed-verified | Corrected current bootstrap, citation qualification and binding diagnostics; reviewed and merged PR #10. |

## History

### 2026-11-18 — systematic reproduction

Ran the current binary over a disposable project and private catalog, checked source implementation, and repeated the experiment with assertions. Scratch harness and raw output are under `/tmp/pr10-audit/`; those files are temporary and are not the durable record. The entry below preserves the measured results.

### 2026-11-18 — authorized correction and review

The user subsequently authorized fixing all confirmed findings and closing PR #10 through merge. Work is isolated in `/tmp/pr10-fix`; the shared checkout's unrelated session-bridge edits are untouched. The documented examples now execute against the real server. Independent review first found one surviving scan-completeness mutation; new negative cases and a complete-result control kill that exact mutation. Whitespace citation wording has a runtime counterexample and is corrected.

The PR's CI also exposed two pre-existing failures, confirmed in main run 44159725156 at 34565f9: a shell-wrapper spawn counter bypassed on native Windows, and lexical versus real temporary paths on macOS. Test-only corrections include a native spawn observer and a forced-symlink regression. Once Windows reached the formerly blocked wake tests, its POSIX-only fixture required native PATH and executable handling as well. Production hooks, installed profiles and plugin versions remain unchanged.

At this point integration remains pending the final GitHub checks and reviewer confirmation. See the eventual resolution below for the final outcome; this paragraph records the intermediate state.

## F-1 — PR 10 remains useful but contains an obsolete bootstrap premise and insufficient collision diagnostics

**Observed:** 2026-11-18, systematic reassessment of PR #10.

**When:** Before choosing merge, close, or rewrite for PR #10.

**Expected (PR):** Copying the fenced template cannot yield a cataloged tracker; only a defining heading activates a namespace; a drop in dangling citations proves capture; searching `docs/` is sufficient before claiming a prefix.

**Got (measured):** The PR has both surviving fixes and claims that need rewriting. The following observations came from actual MCP tool calls to a disposable project, with HOME, XDG paths and LIBRARIAN_DB pointed into temporary directories. The temporary projects were removed after each run.

### Surviving fixes

- The exact current template copied into `docs/trackers/reconnaissance-patterns.md` is absent from the catalog before reindex, but is found afterward as one tracker with status active. Its first line still is not frontmatter. The problem is missing explicit metadata and immediate registration, not permanent inability to classify it.
- In a fixture with two live session logs each defining the first F entry and the first W entry, the template's spaced filename-plus-token form produces two ambiguous citations, each with two candidate definers. Replacing it with file-stem-qualified citations removes both ambiguities and writes one artifact-level cites edge to the intended alpha session log. The two entry citations and the one artifact edge are different measured quantities.
- An incumbent document with only table rows for the first and ninth R entries is initially suppressed as an unknown namespace. Adding an unrelated heading defining the first R entry writes one actual cites edge from the incumbent to the new ledger and reports the ninth R entry as dangling. Renaming the new heading to the first RP entry prunes that edge and returns dangling to zero. Graph reads confirm both edge states.
- A minimal Python fixture with hashable pairs reproduces the positional-key mismatch: comparing `(key, key[1])` with a set containing `key` returns an empty selection without an exception; comparing `key` itself returns the intended pair. This verifies the example mechanism, not the historical incident counts or a universal claim about dynamically typed languages.

### Corrections required in the PR

1. **Obsolete bootstrap explanation.** Built-in classification now includes the trackers directory. Verified the added rule in codescout commit cb1b9bcf34ff083ca9ee47647bb731fd4ff265a3, dated 2026-10-14, after the PR's 2026-09-02 commit. Explicit doc creation is still preferable for metadata and immediate registration, but the claim that a copy cannot have a librarian row is false today.
2. **Obsolete tool name.** The tested server's tools/list has doc and librarian but no artifact tool. Use the current doc creation API.
3. **Heading-only activation is incomplete.** Setting entry_prefix to R, while the only existing heading defines the first RP entry, makes both the first R entry and the ninth R entry dangling. A declaration alone makes a namespace known.
4. **The proposed preflight is too narrow.** With the incumbent at `notes/table-only.md`, the PR's docs-only grep exits 1 with empty stdout, while link_scan subsequently captures its reference to the first R entry. The search scope must cover the relevant markdown corpus, not only docs.
5. **A falling dangling count does not determine intent.** In an independent fixture, declaring an empty QC namespace yields one dangling citation to the first QC entry. Adding that entry's intended defining heading lowers dangling from one to zero and writes the correct edge from quality-reader to quality-owner. The PR's categorical assertion that a drop means capture rejects a legitimate repair too. Inspect changed source-to-destination bindings; use counts as prompts to inspect, not proof.
6. **Use the ownership guard that exists today.** A separate runtime probe declares R on first-owner, then attempts the same declaration on second-owner. The latter is refused by name, and a read confirms entry_prefix was not added. An undeclared duplicate heading remains possible: creating it succeeds, and link_scan reports one ambiguous citation and one prefix conflict. The template's workflow should explicitly declare its chosen prefix and still inspect existing prose and row-only uses.

### Evidence and limits

- Tested codescout 0.15.0, clean build a14ae9d5254977a7f5f90a2627bbf3a0466e2dd9. The inspected current source files for classification and link scanning have no diff against that build commit.
- Initial matrix completed successfully; the repeat run passed 15 explicit assertions over eight scan snapshots, including scan completeness, zero unreadable artifacts, resolved destinations, edge creation/pruning, positive controls, and temporary-project cleanup. These are scratch integration assertions, not the repository's complete test suite.
- The separate declared-owner probe passed its refusal, unchanged-metadata and scan assertions.
- Scratch reproduction: `python3 /tmp/pr10-audit/verify.py`; ownership probe: `python3 /tmp/pr10-audit/guard_probe.py`. Scripts and JSON are temporary, not committed fixtures.
- Source inspected: DEFAULT_RULES_TOML and classify in the codescout classifier; DefinitionIndex/build, DefinitionIndex/prefix_conflicts and resolve in the citation resolver; def_re in the extractor.
- The original PR's incident populations (roughly twenty consumers, ten tests, and the historical citation totals) were not re-established by these fixtures and must not be reported as newly verified.

**Probable cause:** The September proposal predates the October default classifier and retains absolute claims where the current resolver has declarations, self-citation and ownership behavior that require narrower statements.

**Workaround / recommendation:** Keep PR #10 open for a targeted rewrite. Preserve qualified citations and the collision warning. Describe explicit doc creation accurately, declare the chosen namespace, broaden the preflight, inspect actual changed edges, and narrow the key-shape lesson to its demonstrated mechanism. Do not merge the current text unchanged. No production code or PR-state change was made by this investigation.

**Severity:** high — incorrect collision diagnostics and missing prefix ownership can silently misattribute durable evidence; stale bootstrap guidance also obscures the current API.

**Status:** fixed-verified — corrected and merged in PR #10, bfefda19bcc31be4ba58dc17d541239d032d52e9. See Resolution for test and mutation evidence.

**Valid:** dated 2026-11-18

True of the tested binary and fixture corpus; re-run when classification, namespace ownership or citation resolution changes.

**Rests on:** Observed tool outputs and graph edges from the isolated fixtures; commit cb1b9bcf34ff083ca9ee47647bb731fd4ff265a3 establishes the classifier's historical change. The earlier triage recommendation alone is not evidence.

## Resolution — 2026-11-18

GitHub confirms state MERGED at 2026-11-18T10:31:47Z, merge commit bfefda19bcc31be4ba58dc17d541239d032d52e9, from reviewed head 4dc638f9aaf96e5148dbd5fe2f33ac7be5fd2af5. The existing PR branch was updated normally and squash-merged with an exact-head guard.

**Changes:** Current guarded doc creation with selected namespace and table anchor; atomic append example; corpus-wide namespace preflight; declarations as well as headings; complete baseline/post scans and inspection of actual bindings; qualified evidence; narrower key-shape law. The legality harness executes supplied-input examples with strict literal bindings. Test-only portability fixes repair the baseline Windows/macOS failures and the subsequently reached native-Windows fixture.

**Verification:** New reconnaissance suite 13/13, including seven real MCP contract tests against codescout 0.15.0 build a14ae9d5254977a7f5f90a2627bbf3a0466e2dd9. Legality suite 80 passed, zero failed/skipped, using the upstream template. Existing parser suite 9/9. Unique cached-plugin fixture suite 13/13 locally and independently. [Final CI run](https://github.com/mareurs/claude-plugins/actions/runs/44285240552) passed all five jobs: Ubuntu/macOS/Windows smoke and complete Linux suites on Node 24/Python 3.13 and Node 22/Python 3.12. Hosted CI omits optional codescout integration prerequisites; real MCP coverage ran locally.

**Applied mutation review:** Initial six applications killed five and exposed one survivor (deleting the scan-completeness guard). New positive/negative controls kill that exact deletion. Follow-up three applications were killed: completeness deletion, disabling explicit bindings and accepting unknown names. Portability review applied and killed three more mutations: removing root realpath, adding an extra Python probe and removing the preload argv guard. The preload branch experiment on Linux was labeled as such; actual Windows CI independently passed. Reviewer approved final head with no remaining findings. A duplicated regression introduced during editing was removed before final verification.

**Limits:** A local complete-suite attempt hit intermittent failures in the unchanged S4 experiment suite. An isolated run on main passed; the cause was not established or modified here. Both complete CI suites passed at the final head. Original September incident totals remain unverified and were removed from the promoted law. Production hooks, profile configuration and plugin versions were not changed.

## Template for new entries

Append dated findings through `doc(action="append_entry")`; never allocate an id by editing the table.
