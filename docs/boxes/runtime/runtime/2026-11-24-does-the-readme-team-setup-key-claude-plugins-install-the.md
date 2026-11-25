---
kind: entry
status: done
title: Does the README Team Setup key claude-plugins install the plugins?
closed: 2026-11-24
created: 2026-11-24
entry_kind: question
log:
- '2026-11-24 open created codescout:9b880af2-23db-4b95-9e16-ebb0c6f8d466'
- '2026-11-24 open -> done codescout:9b880af2-23db-4b95-9e16-ebb0c6f8d466'
status_since: 2026-11-24
topics:
- install
---

**What:** the README snippet uses the marketplace key `claude-plugins`, while `marketplace.json` names it `sdd-misc-plugins` and `@claude-plugins` failed on a clean profile (2026-11-09).

**Why it matters:** a team that copies the snippet may get no plugins.

**Next step:** try it on a clean profile.

## Closed

Answer: no. The marketplace name is sdd-misc-plugins (marketplace.json); README Team Setup now uses it. Not run against a real clone.
