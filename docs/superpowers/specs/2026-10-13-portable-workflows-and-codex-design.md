---
id: f8cfc0601374b062
kind: spec
status: superseded
title: Portable workflows and Codex integration
tags:
- codex
- harness-compatibility
- pi
- buddy
- codescout-companion
---

# Portable workflows and Codex integration

## Superseded — 2026-10-13

The user judged this design too large and chose a small change instead. This document stays as a record; do not plan from it.

What replaced it:

- `buddy/commands/status.md`, `check.md` and `legend.md` gain a frontmatter `description` (plus `disable-model-invocation: true`, so Claude Code keeps them user-only). Codex 0.160+ then converts them at install into `buddy:source-command-<name>` skills. They locate Buddy through the text `${CLAUDE_PLUGIN_ROOT}`, which Claude Code substitutes; in Codex the model walks up from the skill file to the folder that contains `.codex-plugin/`.
- Summon needs nothing new. In Codex, a typed `/buddy:summon <name>` already runs Buddy's prompt hook (full persona and session state); `$buddy:<specialist>` loads the persona only.
- Not available in Codex after this change: dismiss, focus, remember, consolidate, create, introspect.

Why, in short (evidence in `docs/trackers/portable-workflows-session-log.md`):

- Codex 0.160.0 already loads Buddy and Companion through the Claude-compatible path and trusts their hooks (F-5). Per-plugin overlays and a new marketplace file would change that live behavior.
- Codex's command converter skips any command that uses `$ARGUMENTS` or `$`+digit, exceeds 4,000 bytes or lacks a frontmatter description (F-5; `codex-rs/core-plugins/src/command_migration.rs`). Only short, argument-free commands can use it.
- Workflow skills placed in `buddy/skills/` would become summonable specialists (F-1). A command's `$1` was the second argument word (F-4, fixed in `52ac94c`).

## Intent and scope

The user wants Codex to receive as much of this marketplace's useful behavior as possible while keeping shared behavior reusable by Pi and future harnesses. On 2026-10-13 the user delegated prioritization: "use your judgement. I want the most". This document chooses the scope and architecture; it is a draft for review, not evidence that implementation or installed runtime parity is complete.

The first delivery makes Buddy and Codescout Companion workflows available through canonical skills and explicitly packages the existing useful runtime hooks for Codex. Legible's existing explain skill is included in the Codex catalog because it is already a portable workflow. Claude command names remain usable. Pi discovers the same skill files through its existing skill-directory wiring.

SDD, a native Codex statusline, and cross-harness peer RPC are later deliveries. Their absence must be visible in the capability table; they must not be represented as silently supported. SDD is currently absent from the measured Codex configuration and is a separate governance migration, not an incidental Buddy command conversion.

## Verified baseline

Reconnaissance was performed against the main checkout on 2026-10-13. The native CLI reports codex-cli 0.160.0. This is an observed CLI version, not a claim that every running daemon has the same binary or supports every documented feature.

- Companion source manifest is 1.20.17. Buddy is 0.11.9. The measured Codex configuration enables Companion, Buddy, Superpowers, and Frontend Design Director.
- Only /home/marius/.codex exists among the checked lowercase and uppercase main/secondary/Kat Codex paths. Do not fabricate absent profiles.
- harnesses/ currently owns only the Pi integration. Its installer references Companion, Buddy and SDD skill directories.
- Buddy has twelve Markdown commands and twelve specialist skills. Specialist discovery is not command discovery.
- Companion has one dashboard command. Legible already has skills/explain/SKILL.md.
- Buddy's track_specialist.py::_resolve_sid reads .buddy/.current_session_id first. state.py::resolve_session_id_for_command also falls back to that last-writer pointer and a sole directory. Those paths do not establish the identity of a Codex or Pi caller.
- The session-context-v1 contract and normalizeHookContext already exist in Companion. They deliberately recognize claude-code, codex and manual, not Pi.
- The active session-identity passover records completed native approval/context work and pending Codex execution-inventory coverage. This delivery must preserve that boundary and must not claim complete write provenance.

Evidence: buddy/scripts/track_specialist.py, buddy/scripts/state.py, codescout-companion/hooks/session-context.mjs, codescout-companion/contracts/session-context-v1.schema.json, harnesses/pi/install.sh, and [the existing identity handoff](../../trackers/passover-harness-neutral-session-identity-2026-10-10.md).

The main checkout also contains unrelated effort-steering edits. Implementation must isolate or explicitly preserve them; no blanket staging, reset, or cleanup.

## Architecture decision

Use shared workflow content, reusable session-aware operations, and small per-harness adapters. Do not put harness detection into every skill, manufacture Claude environment variables in Codex, or create a second provenance protocol.

| Responsibility | Location | Contract |
|---|---|---|
| Canonical workflows | buddy/skills/ and codescout-companion/skills/ | Host-neutral instructions and packaged resources |
| Claude aliases | Existing commands/ paths | Forward the complete user argument to the canonical workflow |
| Buddy operation helpers | buddy/scripts/ | Explicit workspace and session context; no global last-writer identity |
| Codex discovery and hooks | Per-plugin .codex-plugin/ plus harnesses/codex/ | Explicit skill paths and a reviewed hook selection |
| Pi discovery and state adapter | Existing harnesses/pi/ | Reuse the same skills; native context only where verified |
| Artifact/version consistency | scripts/ and tests/ | Derived host manifests track the canonical plugin version |

Choose .codex-plugin/plugin.json compatibility overlays for this delivery rather than replacing the repository's canonical Claude manifests with a new portable root manifest. The installed 0.160.0 loader must be checked before choosing exact marketplace fields. A future portable manifest can be another derived view; business logic does not depend on the manifest format.

Do not add a general plugin framework, another daemon, or runtime dependencies merely to route Markdown workflows.

## Workflow inventory and invocation

Create canonical Buddy workflow skills with unambiguous names: buddy-summon, buddy-dismiss, buddy-focus, buddy-remember, buddy-status, buddy-check, buddy-consolidate, buddy-create, buddy-introspect and buddy-legend. Preserve all twelve existing specialist skill names and directories. Add codescout-dashboard as the canonical Companion dashboard workflow. Reuse Legible's existing explain skill.

Each workflow has explicit-request triggers. A workflow named status must not automatically activate for every ordinary status question. The descriptions identify Buddy or Codescout and the actual user goal.

The workflow input is the complete user request/argument string. Do not use dollar-plus-digit substitutions inside skill bodies, and do not assume a skill is given hook stdin. Paths, lesson text and consolidation feedback retain spaces, quotes and newlines. Claude aliases forward the complete argument through the host-supported mechanism; Codex invokes the discovered skill; Pi uses native /skill invocation or automatic discovery. Exact rendered invocation names are recorded from the host's actual catalog, not invented from file paths.

Canonical instructions use actions such as read a file, invoke the helper, and request native approval. Harness-specific names, plugin-root variables and invocation syntax go in a short reference loaded once. Resolve packaged resource paths from the actual skill location supplied by discovery; shell commands do not assume an ambient CLAUDE_PLUGIN_ROOT.

Existing Claude command files become forwarding aliases with no second copy of the workflow body. Verify actual Claude argument delivery and summon hook behavior before replacing them. Retain source-scoped aliases if the host cannot forward reliably, but generate them from the canonical skill and make stale generated output fail a check. Never maintain two hand-edited versions.

Buddy install and uninstall currently mean Claude statusLine setup/removal. Keep those as explicitly Claude-only commands. Codex documentation directs plugin installation/removal through its native plugin surface and reports native statusline parity as unavailable. Do not reinterpret them as permission to edit Claude settings from Codex.

## Session-aware operations

Portability includes state ownership. Introduce a narrow Buddy operation entry point that consumes a validated context and workspace, and delegates to existing state/memory/payload helpers. Move inline command glue into that entry point only where needed; retain existing specialist-resolution precedence, required lenses, memory protocols and consolidation review gates.

Use the existing session-context-v1 field meanings and identity lifetime as the compatibility contract. Buddy must remain usable without an installed Companion: package its validator/helper and test against the shared contract fixtures rather than import another plugin's installed cache. Keep the ownership root plus optional child identity; tool cwd and explicit workspace remain distinct inputs.

A stateful operation requires authoritative invocation context or an explicit validated context file. Compare contradictory native and explicit evidence; do not silently choose one. Never use a PID, a sole .buddy directory, or .current_session_id as authority for the new portable entry point. Invalid or missing context returns an actionable result and performs no state writes. Existing call sites must be migrated deliberately; replacing the generic state resolver across unrelated consumers is outside this delivery.

Preserve existing Claude .buddy session directory compatibility. New portable operations must address the exact session state supplied by their adapter. If a harness namespace is needed to avoid equal IDs, establish one deterministic mapping shared with its hook writer; do not make command and hook paths disagree. Cross-harness equal-ID fixtures are required before claiming mixed-harness state isolation.

Summon without verified state can still load the selected persona and required lens into the current conversation, with a clear report that persistent activation/dedup tracking is unavailable. It must never skip persona loading based on another session's state. Focus changes, dismiss-state writes and implicit active-specialist memory targeting require verified state; explicit memory targeting can use existing non-session memory operations.

Shared global Buddy memory stays at BUDDY_HOME or ~/.buddy. It is intentionally shared, not a session identity store. Protected global writes use the harness's native approval path and respect filesystem permissions.

### Pi boundary

Pi must continue discovering the same workflow skills without copies. Session-independent operations work through the existing file/tool surfaces. Native session state support is a distinct capability.

The current v1 contract does not include pi. Do not label a Pi principal manual to evade validation. A Pi identity adapter requires a reviewed contract extension/version and independently verified native root/child/lifecycle semantics in all consumers. Until then, the Pi guide documents which stateful operations are unavailable and the persona-only summon behavior. This delivery validates that fallback rather than claiming full Pi runtime parity.

## Codex runtime adapter

Provide a maintained harnesses/codex/README.md and explicit overlays for Buddy, Companion and Legible. Each overlay points at shared skills and explicitly declares its hook selection, including an empty hooks configuration for skill-only Legible.

Unlike Superpowers, Companion relies on runtime hooks for behavior beyond skill discovery. Do not disable every Companion/Buddy hook just because Codex discovers skills natively. Inventory each hook by required input, event, output and effect. Include only hooks supported by the measured native payload and exercised by a fixture or live smoke. Unsupported agent/worktree events are listed precisely and are not silently registered as Claude events.

Preserve the completed native approval-routing fix. Native approval reachability is separate from ordinary Codescout command routing. Missing escalation metadata on older hosts is a capability limit with a tested response, not evidence that approval is unnecessary.

Expose separate capability results for workflow discovery, command aliases, session context, state mutation, lifecycle delivery, guard enforcement, peer contact and write-evidence coverage. Use verified, limited, unavailable and untested with evidence/version references; do not reduce these to a single supported boolean.

Codex code-mode provenance coverage remains limited as recorded in the existing handoff. This project must not change Codescout's formatter clearance or claim the limitation is repaired by packaging.

## Packaging, versions and installation

Canonical plugin.json versions remain unchanged during feature development. Derive new host-manifest versions from each plugin's .claude-plugin/plugin.json, and extend check-versions.sh to reject stale overlays. Marketplace entries do not acquire version fields.

The Codex marketplace lives in .agents/plugins/marketplace.json and references actual plugin roots. Confirm root-relative source resolution with the installed loader and an isolated native plugin-install/discovery test before documenting installation commands.

A generation/check command can render manifest metadata and any required alias artifacts, with --check refusing drift without writing. It must only touch declared generated files, never caches or config.

A release must regenerate derived manifests before committing the release bump and run the consistency checks. Source artifact validation and local installed-profile parity are separate checks. Integrate Codex profile verification with the release workflow only for actually installed plugins; distinguish absent profiles from broken installations. Check all three configured profile candidates and their actual config roots, without creating the absent ones or confusing case-sensitive names. Every recorded install path must belong to its profile.

Use the native plugin loader/install/update path where available. Do not invent installed_plugins.json under Codex or blindly copy Claude records. Do not edit plugin-enable flags, trust records or third-party settings in this feature. An installation affecting protected configuration requires the native permission path and a concrete reviewable artifact first.

No feature commit bumps a version. Publishing, pushing, restarting peers and changes to shared binaries are separate rollout actions.

## Validation and acceptance

1. Catalog tests measure the full declared workflow inventory against source and built plugin artifacts. All ten Buddy workflows, twelve unchanged specialist skills, Companion dashboard and Legible explain are present exactly once; Claude aliases resolve to the canonical content.
2. Argument tests exercise actual forwarding/operation input with spaces, quotes, newlines and hostile shell characters. A misplaced dollar-plus-digit token fails the repository skill guard.
3. State tests create two concurrent sessions and two harnesses with equal native IDs; a summon/dismiss/focus action affects only its addressed state. Missing, conflicting, malformed and out-of-workspace context leaves every fixture byte-identical. Tests clean up scratch state.
4. Payload tests cover all required lens behavior, shadow precedence, advisor projection, protocol/gate loading and reading spilled payloads to EOF. Discovery alone is not success.
5. Codex hook fixtures cover native approval allow/deny transport, ordinary routing, and each enabled event. A fresh real Codex run proves loaded manifests/skills and at least summon, focus and status behavior in isolated scratch state. Record full host version and artifact identity.
6. Pi routing/extension tests remain green. A real Pi run proves discovery of the shared skills, persona/lens loading and the declared missing-context fallback. If Pi is unavailable, report live validation untested while fixture checks remain separate.
7. Manifest tests install from the actual marketplace root, reject missing targets, compare generated versions, and preserve files outside the generated allowlist. Source generation idempotence is byte-tested.
8. Run the repository suite and relevant Buddy tests. Apply candidate mutations to forwarding, context selection, namespace/path resolution, hook inclusion and generated-file checking, then run the relevant tests and report observed killed/surviving counts.
9. Do not call the delivery installed or runtime-complete merely because source tests passed. Installation, hook trust, fresh-load evidence and each pending capability are reported independently.

## Delivery sequence and builder latitude

Implement one cohesive first delivery in four ordered steps: canonical workflow extraction and argument forwarding; session-safe Buddy operations; explicit Codex packaging/hook capability inventory; release checks, guides and real-host acceptance. Keep each step independently testable. Pi reuse/fallback checks run alongside the first two steps.

The builder chooses helper signatures, fixture organization and the exact generated-file layout after checking the current loader and hook contracts. Those choices may not weaken state isolation, duplicate workflow bodies or expand support claims beyond evidence.

The user delegated priorities; the choices of the initial three plugins, ten portable Buddy workflows, compatibility overlays and conservative Pi state fallback are the agent's choices, not explicit user selections.

A fresh read-only builder check on 2026-10-13 returned "nothing important left". This establishes that the reviewer found no planning-blocking questions; it does not verify implementation, host loading or runtime behavior.

## Sources and existing work

- [OpenAI plugin packaging](https://developers.openai.com/plugins/build/plugins): manifest paths, explicit hooks, native installation and trust boundaries.
- [Claude plugin migration guidance](https://developers.openai.com/plugins/guides/submit-claude-plugin): commands become skills; hook-dependent local distributions have a distinct boundary.
- [Prior session-context design](2026-10-10-harness-neutral-session-identity-design.md) and [identity handoff](../../trackers/passover-harness-neutral-session-identity-2026-10-10.md): reuse the completed contract and retain provenance limitations.
- [Harness integration conventions](../../../harnesses/README.md): shared skills stay in plugin packages; supported adapters require an actual maintained integration.
