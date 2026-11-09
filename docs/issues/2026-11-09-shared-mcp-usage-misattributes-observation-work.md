---
id: '16de4012209e895f'
kind: bug
status: open
title: Shared MCP usage stamps observation work with unrelated native session IDs
tags:
- session-identity
- codescout
- cluster/unclassified
opened: 2026-11-09
owner: marius
related:
- ce484db75532c7f0
severity: medium
unverified: The incoming MCP metadata and installed recorder's actual branch have not been captured; a recurrence of the earlier fixed cause is not established.
---

## Symptom and evidence

During stock-observation implementation in the new isolated Codescout checkout /tmp/codescout-stock-observations-20261109, the foreign-index guard attributed files created in this session to unrelated sessions. Read-only usage.db queries showed cc_session_id 01a1bf68-e650-7f20-911e-b53f86597c27 for Task 1 calls and 01a1bf89-3111-7c70-b934-5f6fd89102a3 for later Task 2 writes. Native exec_command and Codescout run_command both reported CODEX_SESSION_ID / CODEX_THREAD_ID 01a1b59b-676f-7881-b7eb-4d8e1687c3f8. The latest stored edit_file input had only path/workspace/old_string/new_string keys, with no caller argument.

These are observed mismatches, not proof of which fallback or transport branch caused them. Source at ef7fe2ee9a2c452637c0d93fbecc86c84ee17677 prefers asserted/native identities above serving-session and construction-time fallbacks; the running binary's incoming metadata was not captured.

## Class fit

This remains unclassified because the wrong writer stamp is measured but the causal transport or fallback boundary is not. It resembles earlier native-session incidents, while differing in that shell context already exposes the correct native root. Equal symptoms do not establish equal causes.

## Workaround and remaining work

The maintainer approved notifying the first named local thread and using the documented ACK for Task 1. Notification was delivered; Task 1 landed in Codescout c1dd47d09 + 1c1546798, with explicit notes that the acknowledged stamp was incorrect. The guard accepts ACK for all-contested batches but refuses mixed own/contested batches; primitives and wiring were committed separately to preserve that rule.

Later tasks acquired wrong stamps under four session IDs. After source verification and independent review, the operator approved the concrete four-recipient notifications and guarded commits, then manually approved previously denied sends. Codescout support `505e8033a`, wiring `c7b38be29` and caller tests `f89590d31` are committed. No usage rows or peer files were modified; no hook was disabled.

## Related and next verification

The prior fixed incident is Codescout artifact ce484db75532c7f0, docs/issues/archive/2026-11-07-hook-diagnostic-root-misattributed-effort-steering-writes.md. Its incoming-native-root fix does not prove the cause of this incident.

Capture only real client identity and native metadata at the running server boundary; compare to the native task and recorded row. Do not persist tool bodies, prompts or secrets. The new stock observer must keep missing/conflicting identity unknown instead of using startup/rendezvous identity.

## Resume

2026-11-09: source delivery is committed: plugin `381ae57` + documentation `bb8ff30`; Codescout support `505e8033a`, wiring `c7b38be29` and caller tests `f89590d31`. The guard classified 23 wiring paths under four unrelated IDs; three owned caller-test paths were committed separately. All precommit hooks passed.

The original notification to `01a1bf68-e650-7f20-911e-b53f86597c27` was accepted. After the operator manually approved the exact previously denied sends, retries to `01a15ca9-f939-7603-acb5-01c6b02f68e2` and `01a1bf89-3111-7c70-b934-5f6fd89102a3` were accepted at 20:10 UTC. The retry to `01a1c000-a771-79b2-8ebe-a72aeb509c54` passed the approval boundary but failed with thread not loaded (-32600). No reading acknowledgment or successful delivery is claimed for that inaccessible target. The operator's approved scope allowed documenting delivery failure honestly.

The guarded wiring commit records all four mandatory bare stamp IDs and explains that they are disputed usage identities, not peer authorship or review. The hook's warning that bare IDs are interpreted as Claude sessions is another limit of these legacy stamps; changing the required ACK IDs would not repair attribution. Root cause remains unverified and this incident stays open. The remaining engineering work is the boundary capture and cause verification described above, not another commit-guard bypass.
