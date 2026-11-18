---
id: '3554963c3e08442d'
kind: spec
status: done
title: Codex wake — forward compatibility without an exact-version ceiling
tags:
- codex
- background-wake
- compatibility
---

# Codex wake forward compatibility

## Intent

The user requested raising the version restriction because compatible users are left without usable wake behavior after Codex updates. Closed CLI/daemon version allowlists currently reject versions such as0.167.1 and0.169.0 before checking the existing protocol/profile proof. Successful Session Bridge asks are useful transport evidence but do not establish background-wake callback preservation.

## Approaches

1. Extend the exact allowlist through0.169.0. Smallest textual change, but every later update can reproduce the same avoidable outage and prereleases remain blocked.
2. Remove the upper ceiling while retaining explicit protocol/profile evidence and minimum feature versions. Recommended engineering choice: updates can work without a plugin release; malformed versions and real capability/identity mismatches remain rejected.

The user explicitly selected: “Da, fără plafon pentru versiunile mai noi.” The policy below is approved. Implementation will run inline in the existing session; independent final review follows.

## Proposed policy and acceptance criteria

- AC1: Accept valid SemVer Codex hook versions at or above0.165.0 and daemon versions at or above0.160.0, with no upper ceiling. Valid newer prereleases/build identifiers are supported; minimum-version prereleases sort before the stable minimum. Invalid, missing and non-leading version tokens remain rejected.
- AC2: The shared daemon userAgent parser remains independent of the first client's originator and retains strict token boundaries. Exact configured daemon version must match the actual initialized daemon version; this is independent of the removed bundled-version allowlist.
- AC3: Explicit adapter enablement, v1 selection, per-profile callbackPreserved=true and subscription=resume-loaded remain required. Canonical profile ownership, endpoint hostInstanceId/runtimeGeneration, exact loaded thread, event correlation and root-only intake remain enforced. No automatic enabling or config migration is included.
- AC4: Bundled codexDaemonEvidence remains a historical exact-version lookup. For accepted newer versions without bundled measurement, capability returns evidenceRef=null and an honest reason based on the profile's configured callback proof. No historical0.167 evidence is relabeled as0.169 evidence.
- AC5: Native hook structural/context validation remains. Claude compatibility policy, other host adapters, native approval behavior and the stock0.169 metadata repair are unchanged.
- AC6: Tests pin newer stable/patch/prerelease versions, version floors, malformed tokens, unknown-version missing proof and mismatched identities. Preserve archived measured evidence and document the new policy. Run focused and complete wake suites and repository tests; report unrelated failures by name. Review load-bearing guards with actually applied mutations.

## Delivery scope

Implement the compatibility change in the companion source and its tests/docs, preserving the earlier issue14 parser repair and unrelated dirty work. No version bump is done inline. Any plugin release must use scripts/release.sh. Configuration changes, if later requested, must cover all configured profiles; this change requires none. Distinguish local source/candidate validation from an installed-profile rollout.

## Implementation — 2026-11-18

Implemented and reviewed locally. Spec-drift verdict recorded:24 implemented,0 missing,0 divergent for this approved source scope. Final focused64/64 and sequential complete wake231/231. The full default-environment repository command remains red only in the unchanged SDD outside-repo fixture; isolated temporary-root rerun37/37. Native0.169 accepts the new policy but two callback probes failed secondary attachment, so no new native callback evidence or automatic enabling is claimed. No release or installed-profile rollout.

Verification, review closure and rulings: ../../evidence/2026-11-18-codex-forward-compatibility.md (f755dbdb21179631).
