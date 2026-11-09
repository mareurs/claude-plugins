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

Task 2 has a different wrong stamp. Its source passed the full canonical gate, but its commit is deferred rather than expanding the prior notification approval or disabling a hook. No usage rows or peer files were modified.

## Related and next verification

The prior fixed incident is Codescout artifact ce484db75532c7f0, docs/issues/archive/2026-11-07-hook-diagnostic-root-misattributed-effort-steering-writes.md. Its incoming-native-root fix does not prove the cause of this incident.

Capture only real client identity and native metadata at the running server boundary; compare to the native task and recorded row. Do not persist tool bodies, prompts or secrets. The new stock observer must keep missing/conflicting identity unknown instead of using startup/rendezvous identity.

## Resume

2026-11-09: stock-observation source verification is complete. Plugin feature `381ae57` and Codescout support `505e8033a` are committed. The guard classifies 23 remaining wiring paths under four other session IDs; three caller-test paths follow that wiring. Automatic approval review rejected a new notification to `01a1bf89-3111-7c70-b934-5f6fd89102a3` because the existing explicit approval covered only `01a1bf68-e650-7f20-911e-b53f86597c27`. Further notifications and the documented ACK require the actual named destinations to be authorized. No bypass or attribution-database edit was performed. Root cause remains unverified; the guard result is not proof that those peers authored our isolated work.
