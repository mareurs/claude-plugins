---
kind: entry
status: open
title: 'codescout-redirect: the guard''s source-extension rule only picks the message; the allow rules are the exemptions'
created: 2026-11-23
entry_kind: friction
log:
- '2026-11-23 open created codescout:457161f7-f66c-4b6c-a42f-629164dad4f2'
status_since: 2026-11-23
---

**What happened:** My spec (2026-11-24-codescout-redirect-mod-design.md) said the guard denies what its source-file test (SOURCE_EXT_PATTERN) matches, and that the mod must answer "exactly what the guard would deny". In pre-tool-guard.mjs, SOURCE_RE (line 364) only chooses the deny text. Read is denied for every path except: image/PDF, skill payload, harness tool-results, config dir. Edit and Write are denied for every path except an image. Grep and Glob are denied unless the path or pattern is in a config dir. Bash is denied for every command except sandbox_permissions=require_escalated.

**What I did:** Plan for step one changed: extract only the pure exemption rules into hooks/guard-rules.mjs, imported by the guard; messages and breaker state stay in the guard. The spec needs the same correction.

**Worth keeping:** "Which calls does the guard deny" is a set of exemptions, not an extension list. HAS_CODESCOUT and BLOCK_READS (detectFor) are separate, impure gates that a mod would also need.
