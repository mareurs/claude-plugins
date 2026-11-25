---
kind: entry
status: mitigated
title: no harness identification, and no tooling to clean up, route or migrate a project across Claude Code, Codex, Copilot, OpenCode and Pi
closed: 2026-11-25
created: 2026-11-24
entry_kind: bug
log:
- '2026-11-24 open created codescout:ce0a6936-5650-4ce2-bd20-10d01f955692'
- '2026-11-25 open -> wontfix codescout:ce0a6936-5650-4ce2-bd20-10d01f955692'
- '2026-11-25 wontfix -> mitigated codescout:ce0a6936-5650-4ce2-bd20-10d01f955692'
severity: high
status_since: 2026-11-25
---

Migrated from `docs/issues/2026-11-13-no-harness-identification-or-project-migration-tooling-across-harnesses.md` on 2026-11-24; opened 2026-11-13; priority high; tags harnesses, migration, instructions, priority-high; owners marius; old id da6eaaa69498077b.

## Summary

Priority: **high**. This repo serves several agent harnesses (Claude Code, Codex, Copilot, OpenCode, Pi), but no component identifies which harness a session or a project runs under. Nothing helps a project owner clean up a project's instruction files, route each file to the right harness, or move a project from one harness to several. Each harness reads different files, and the difference is easy to get wrong.

## What is missing

1. **Harness identification.** A single, tested way to say "this session runs under harness H, version V, on OS O", and "this project is set up for harnesses {…}". The identity work in `docs/issues/2026-10-09-harness-neutral-session-identity-and-provenance.md` covers session identity. It does not cover a project's setup.
2. **Project cleanup.** Instruction files drift: duplicate text across `CLAUDE.md` and `AGENTS.md`, machine facts in public files, stale tool names, files that a harness never loads. No tool lists them or proposes a fix.
3. **Routing.** A rule for which content belongs in which file for which harness, and which files are local (untracked) and which are public.
4. **Migration and integration instructions and scripts.** A guided path to add a harness to an existing project, or to move a project from one harness to another, with a check at the end that says what each harness now loads.

## Evidence

- Measured 2026-11-13 on Codex 0.167.1: a directory with both `AGENTS.md` and `AGENTS.override.md` loads only the override. The override replaces `AGENTS.md`, and a symlink at the root would hide the public file. A project owner has no way to learn this from the repo. Details: `docs/superpowers/specs/2026-11-12-private-setup-separation-design.md` (D3).
- Instruction files differ by harness: Claude Code reads `CLAUDE.md` and `CLAUDE.local.md`; Codex reads `AGENTS.override.md`, then `AGENTS.md`, then configured fallback names (the order is in the installed Codex binary). Copilot and OpenCode have their own conventions, which this repo documents only in per-harness install notes.
- The repo already splits skills by harness and OS (`CLAUDE.md` § Skill layout). Nothing does the same for a project's instruction files.

## Not yet known

- The exact load rules of Copilot, OpenCode and Pi for instruction files. They need a measurement each, as with Codex above. Do not write a guessed rule.
- Whether Codex loads a nested `AGENTS.md` below a root override. Not measured.
- Whether this belongs in an existing plugin (`codescout-companion`, `sdd`) or in a new one.

## Acceptance (draft)

- A command or skill reports, for a project directory, which harnesses it is set up for and which instruction files each harness loads. The report comes from measurement, not from a table.
- A cleanup mode lists duplicated, stale or unloadable instruction content. It changes nothing without the owner's approval.
- A migration guide and script for each measured harness pair. A pair with no measurement says so and stops.
- Tests pin the layout, in the style of `tests/test-peer-skill-split.sh`.

## Related

- `docs/superpowers/specs/2026-11-12-private-setup-separation-design.md`: the sweep that found the Codex override behaviour. Its generator script is a first, small instance of the routing item.
- `docs/issues/2026-10-09-harness-neutral-session-identity-and-provenance.md`.

## Closed

Decided 2026-11-25: a feature request, not a defect. The bugs box takes no feature ideas. Nothing is broken today, no owner or plan exists, and the load rules of Copilot, OpenCode and Pi are unmeasured, so the acceptance list cannot be written as tests. The Codex override finding stays in the 2026-11-12 private-setup-separation design (D3). Reopen as a spec, not as a bug, when a user needs a second harness for one project.

## Closure — 2026-11-25

Reclassified from `wontfix` to `mitigated`. The trap in the evidence is closed. Codex loads one file per directory, and `AGENTS.override.md` replaces `AGENTS.md` there. I re-measured this on Codex 0.171.0: with an override at the root, the base file is ignored, and a nested `AGENTS.md` still loads below it. The official page agrees ("Codex includes at most one file per directory").

- `scripts/gen-local-instructions.sh` builds the override as `AGENTS.md` plus the local facts and writes `CLAUDE.local.md` beside it. `--check` compares content.
- `tests/test-gen-local-instructions.sh` pins it (8 checks). `release.sh` regenerates. Both outputs are gitignored.
- Memory `gotchas` holds the rule and the probe method.

Not done, and not planned: harness identification for a project, cleanup of duplicated instruction text, and the load rules of Copilot, OpenCode and Pi (unmeasured). Open a spec, not a bug, when a user needs a second harness.

## Fix provenance

- **SHA:** `e6f800bc931de278011f6f49b9f5065625c3e543` (`main`)
- **patch-id:** `7773c545edd04a3c6ed2444c56094730caddc26f`
