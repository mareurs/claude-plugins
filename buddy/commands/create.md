---
name: buddy:create
description: Create a new buddy specialist (global or project scope; builtin is frozen). Brainstorms with the user, drafts from the canonical skill template, previews what /buddy:summon will load (template + memory protocol + gates), then writes. Discovery is path-scan — no registration step needed. The argument is a freeform hint (e.g. "buddy for X", "buddy for X project") or empty.
---

You are creating a new buddy specialist. The argument passed by the user is `$1` (may be empty or freeform).

This command is the authoring counterpart to `/buddy:summon`. The hand-authored existing specialists came from a process Hamsa formalized: locate the artifact, draft from a written template, preview what the model will see, write. Follow it. **Do not invent new top-level sections without strong justification — section drift erodes the predictability that makes summoning a specialist feel coherent.**

## Step 0 — Read the canonical template (always, first)

Use `Read` to load `${CLAUDE_PLUGIN_ROOT}/data/skill-template.md`. The template marks sections as REQUIRED, RECOMMENDED, or CONDITIONAL, and lists 7 anti-patterns to refuse at draft time. **The template is the canon for this command's draft phase — do not draft from memory of existing specialists.**

## Step 1 — Parse the hint and resolve scope

The hint may contain:
- A scope keyword: `global`, `project`, or `builtin` (latter is rejected — see below)
- A name signal: an explicit archetype name the user proposes
- A domain signal: project-specific concepts (project codename, regulatory framework, domain vocabulary) — strong signal for project scope
- A craft signal: cross-project tooling/method language — strong signal for global scope

Resolve scope using this decision tree:

1. **If hint contains `builtin`** → refuse:
   > "Builtin specialists are frozen at the 11 entries shipped in the plugin. To add one, PR the marketplace repo. For your case, would `global` (your CC instance, every project you work on) or `project` (this repo only) work?"
   Then await user input and re-enter Step 1.

2. **If hint contains `project`** → scope = `project`.

3. **If hint contains `global`** → scope = `global`.

4. **If hint contains a project-specific domain signal** (named project, regulatory framework, domain vocabulary unique to this repo) → propose `project` and confirm:
   > "Your hint mentions `<signal>` — that reads as a `project`-scoped concern. Want to scope to `<cwd>` (project, lives in `.buddy/skills/`), or `global` (your CC instance, follows you across projects)?"

5. **Otherwise** → propose `global` and confirm:
   > "I'll default to `global` scope (your CC instance, every project sees it). Override with `project` if this specialist is repo-specific."

**Never silently default.** The original Owl was misfiled because scope was never asked. Always confirm scope before proceeding.

Resolve the write target path:
- `global` → `${CLAUDE_DIR}/buddy/skills/<dir>/` where `${CLAUDE_DIR}` is the parent of `CLAUDE_PLUGIN_ROOT` matching `.claude`, `.claude-sdd`, or `.claude-kat`
- `project` → `${PWD}/.buddy/skills/<dir>/` (create `.buddy/skills/` if missing)

`<dir>` is determined in Step 2 after the collision check.

## Step 2 — Compose the existing-specialist index and pre-check for collision

Run the 3-scope discovery scan (same logic as `summon.md` Step 1). Use the `Bash` tool:

```bash
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT}"
CLAUDE_DIR=$(dirname "$(dirname "$PLUGIN_ROOT")")
case "$(basename "$CLAUDE_DIR")" in
  .claude|.claude-sdd|.claude-kat) ;;
  *) CLAUDE_DIR="" ;;
esac

scan() {
  local scope="$1" root="$2"
  [ -z "$root" ] && return
  [ -d "$root" ] || return
  for dir in "$root"/*/; do
    [ -f "$dir/SKILL.md" ] || continue
    echo "$scope $(basename "$dir")"
  done
}

scan builtin "$PLUGIN_ROOT/skills"
scan global "${CLAUDE_DIR:+$CLAUDE_DIR/buddy/skills}"
scan project "$PWD/.buddy/skills"
```

Compose the index into a list of names with their scopes. The collision check happens at archetype-naming time (Step 4) — keep this list ready.

## Step 3 — Brainstorm (≤3 clarifying questions, Hamsa cap)

Infer everything you can from the hint and conversation context. Only ask if the hint is genuinely under-specified. **Hard cap: 3 clarifying questions.** Each question must close a specific draft gap.

The three highest-value questions, in priority order:

1. **What does this specialist do that no existing specialist covers?** (one sentence)
   - Skip if hint is explicit enough that you can summarize it back in one sentence.
2. **Voice and posture in one sentence.** (archetype + stance)
   - Skip if hint names the archetype and gives a voice cue.
3. **Yields-to: which existing specialist should this defer to in adjacent territory?**
   - Skip if no adjacent specialist exists or hint already names one.

**Lens is NOT asked here.** Defer to Step 4 — if the draft surfaces two distinct cognitive frameworks, halt and ask then.

## Step 4 — Draft SKILL.md from template

Using the brainstorm answers + the template:

1. **Pick the archetype name and `<dir>` slug.** Convention: dir = archetype slug (e.g. `# The Snow Owl` → `snow-owl`). Avoid domain-named slugs (e.g. `mrv-reviewer` for a Snow Owl) — they hide the archetype.

2. **Check the collision list from Step 2.** If `<dir>` exists in any scope, refuse:
   > "`<dir>` is already used in scope `<scope>`. Picking the same name would silently shadow that specialist on summon. Please pick a different archetype, or confirm you want to deliberately shadow (rare — usually a mistake)."
   Then await alternative name. Re-check.

3. **Detect lens-need during draft.** If the brainstorm answers describe two cognitive frameworks where one prompt cannot serve both (e.g. classic ML vs LLM eval; output integrity vs compliance coverage), halt and ask:
   > "Your description has two distinct cognitive frames: `<A>` and `<B>`. A single prompt that mixes both will produce vague drafts. I propose a lens-required specialist with `<A>` and `<B>` as the two lenses (matches the Pheasant / Owl pattern). Confirm?"
   On confirm, plan addenda `_<A>.md` and `_<B>.md`.

4. **Fill the template.** Use the canonical section order:
   - `# Title`
   - `## Voice`
   - `## Lens` (only if Step 4.3 declared one)
   - `## Operating Principles`
   - `## When summoned` (only if lens-required)
   - `## Method — Three Phases`
   - `## <Domain> Report Format` (only if specialist produces structured output)
   - `## Heuristics`
   - `## Reactions`
   - `## Self-Traps`
   - `## Memory Cadence` (only if save criteria diverge from default two-strike)

5. **Refuse template anti-patterns at draft time** (per `skill-template.md`'s anti-pattern list):
   - More than 3 phases in Method
   - Heuristics without anchors
   - Reactions that praise or reassure
   - Voice longer than 4 sentences
   - Operating Principles about other people's craft
   - Lens declared with one cognitive framework
   - Self-Traps duplicating negated Principles

If a draft section would commit any of these, rework it before showing the user.

## Step 5 — Preview ("play the model's part")

This is the Hamsa principle applied to the create-buddy command itself: before writing to disk, render exactly what `/buddy:summon <name>` will hand the model.

Output to the user:

```
=== What the model will read when /buddy:summon <name> runs ===

[full filled SKILL.md verbatim]

[for each addendum, full _<lens>.md verbatim]

## Memory Protocol
(injected at summon from ${CLAUDE_PLUGIN_ROOT}/data/memory-protocol.md
— see that file for the full content)

## Gates
(injected at summon from ${CLAUDE_PLUGIN_ROOT}/data/gates.md
— see that file for the full content)

=== End of model-facing content ===
```

Then ask:
> "This is what the model will operate from when summoned. Anything sound wrong as a stranger reading it for the first time?"

Hamsa's stranger-reading test catches gaps the drafting process is too close to see. If the user names a gap, return to Step 4 and revise. If the user accepts, proceed to Step 6.

**Do not skip the preview.** A command that writes to disk without showing the user what the model will see has the same failure mode as a writer-pipeline that ships without a witness — drift hidden by the convenience of bypass.

## Step 6 — Write

Use the `Bash` tool to create the directory and write the files atomically:

```bash
# For global scope
DST="${CLAUDE_DIR}/buddy/skills/<dir>"
# For project scope
DST="${PWD}/.buddy/skills/<dir>"
mkdir -p "$DST"
```

Use the `Write` tool (or codescout `create_file`) to write `<DST>/SKILL.md` and any `<DST>/_<lens>.md` addenda. Do NOT write to `${CLAUDE_PLUGIN_ROOT}/skills/` — builtin is frozen.

Do NOT edit `${CLAUDE_PLUGIN_ROOT}/commands/summon.md`. Discovery is path-scan (commit 4850c8c) — the new specialist will be found at summon time without any registration.

## Step 7 — Stop condition

Report to the user:

```
✓ Specialist created at <DST>

Try it now:
  /buddy:summon <name>[:<lens>]

The command is complete when:
  (a) SKILL.md exists on disk at <DST>  ← done
  (b) you have run /buddy:summon <name> once and confirmed it loads correctly

Iterate by editing the files directly. The template is sound; if the
specialist drifts in use, the fix is usually in Voice (cadence) or
Self-Traps (failure modes the specialist did not anticipate).

For lens-required specialists: consider adding a ## Memory Cadence
section if your specialist has a cross-lens correlation save criterion
(the Snow Owl pattern). The template marks it conditional.
```

**Then stop.** Do not loop on further refinements. Do not offer to write more sections. The user iterates by editing files directly — they have everything they need.

## Anti-patterns for this command itself

- **Do not register in `summon.md` table.** That table is hand-curated documentation for the 11 builtin specialists. Global and project specialists are discovered by path-scan, not by table lookup.
- **Do not bump plugin version.** This command writes user content, not plugin content. Version bumps are for plugin releases.
- **Do not spawn a subagent to validate the draft.** Same-turn self-critique on the same model is unreliable (Hamsa Heuristic 8). User's manual summon is the validation.
- **Do not skip the preview.** The preview is the Hamsa principle applied recursively — buddy-builder must read its own buddies as a stranger.
- **Do not write to builtin scope.** Reject any path resolution that lands in `${CLAUDE_PLUGIN_ROOT}/skills/`.
- **Do not commit on the user's behalf.** For project-scoped writes, the user handles the git side on their own terms (the project may have commit conventions you do not know).
