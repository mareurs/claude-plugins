---
id: bf85321bff73c6f1
kind: plan
status: active
title: PR 10 — current reconnaissance bootstrap and citation checks
---

# PR 10 implementation plan

**Goal:** Correct the confirmed findings in PR #10 and integrate it through GitHub after review and verification.

**Approved scope:** The user approved fixing every finding from the systematic audit. Preserve qualified evidence citations and the key-shape warning. Rewrite obsolete bootstrap and namespace claims against the current API, with executable examples and regression coverage. Do not change production hooks, versions or installed profile configuration.

**Design:** Keep one executable bootstrap example in patterns-tracker.md; the template points to it. Create explicit metadata through doc and declare the selected namespace. Search the relevant markdown corpus including hidden files and files outside docs. Compare actual citation destinations before/after bootstrap, accounting for declared namespaces, incomplete scans and legitimate repairs. Use the demonstrated hashable-Python example for key-shape drift without unverifiable historical counts.

**Approaches:** A direct merge retains disproved claims; a prose-only rewrite lacks executable coverage. Use a targeted rewrite with offline example tests plus isolated integration tests against codescout when the binary is installed. Missing optional integration prerequisites are reported as skips, never passes.

## Task 1 — regression coverage

- Add a discovered test runner and standard-library Python suite.
- Execute the documented bootstrap and qualified evidence examples; fail before editing the docs.
- Reuse disposable MCP fixtures for catalog classification, citation ambiguity, namespace activation, changed edges, ownership refusal and legitimate repairs. Isolate HOME/XDG/catalog state and clean up processes and files.

## Task 2 — documentation fixes

- Rewrite the bootstrap and namespace guidance in patterns-tracker.md; replace artifact with doc.
- Update template metadata guidance, prefix-dependent append examples and qualified evidence citations.
- Narrow the key-shape law to the demonstrated mechanism; retain the current main branch's other laws.
- Run the new tests, recon split/count checks, version consistency and the complete root suite. Compare unrelated failures with origin/main before attributing them to this PR.

## Task 3 — review and integration

- Request a separate reviewer; require applied mutations and observed test results on the load-bearing examples and guards.
- Fix findings and repeat affected checks.
- Commit and push the existing PR branch; rewrite its title/body for the final scope and measured validation.
- Verify GitHub checks, merge the PR with the reviewed head, and confirm state=MERGED. Record the audit as addressed and preserve the investigation record.
