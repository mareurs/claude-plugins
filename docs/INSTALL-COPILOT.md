# Running these plugins under GitHub Copilot CLI

Status: **plan / reference** (authored 2026-07-13, not yet verified on a live Copilot
install). The Windows work (Claude Code on Linux/macOS/Windows) is complete and shipped; this
document is the map for the *second* half — GitHub Copilot CLI — which is a **separate port**,
not a free side effect.

> **Why it's separate.** Copilot CLI does **not** load the Claude Code plugin format. It has
> its own plugin manifest, its own hooks schema (different event names, `bash`/`powershell`
> keys, **no `args`**, **no `${CLAUDE_PLUGIN_ROOT}` expansion**), and a **user-level-only** MCP
> config. Skills are the one thing that largely carries over. Plan ~2–3× the CC effort per
> capability, and note two upstream bugs below.

Everything here is sourced from the official Copilot CLI docs (linked at the bottom). Items we
could not confirm from docs are marked **UNCONFIRMED — verify empirically**.

## TL;DR — what ports, what doesn't

| Capability | Copilot target | Verdict |
|---|---|---|
| **codescout MCP** | `~/.copilot/mcp-config.json` (user-level) | ✅ Ports. Manual, one-time. This is the highest-value, lowest-effort win. |
| **Skills** | `.claude/skills/` (Copilot reads it) or `.github/skills/` | ✅ Largely already compatible. |
| **Hooks** | `.github/hooks/*.json` or `~/.copilot/hooks/` | ⚠️ Ports with rewrite, **blocked on one unknown** (plugin-script path — see below). |
| **Slash commands** | Copilot has no direct equivalent; skills are the unifying mechanism | ➖ Re-express as skills if needed. |
| **`${CLAUDE_PLUGIN_ROOT}`** | not expanded by Copilot | ❌ Must be replaced (this is the hooks blocker). |
| **Per-repo MCP config** | not supported yet (issue #2528) | ❌ User-level `~/.copilot/mcp-config.json` shared across repos. |

## 1. codescout MCP (do this first — it's the real win)

Copilot CLI supports stdio MCP servers, configured **user-level only** at
`~/.copilot/mcp-config.json`. Add codescout with the **same command/args/env you already use in
Claude Code** (copy them from your CC codescout registration — `~/.claude.json`'s
`mcpServers`, or the project `.mcp.json`):

```json
{
  "mcpServers": {
    "codescout": {
      "type": "local",
      "command": "<same command as your CC codescout MCP>",
      "args": ["<same args>"],
      "env": {},
      "tools": ["*"]
    }
  }
}
```

Caveats:
- **No per-repo MCP config** (issue #2528): this one file serves every project. codescout
  resolves the active project from `cwd`, so a single registration is usually fine.
- If you package these as a Copilot plugin (§4), its declared MCP servers are **not
  auto-merged** into `mcp-config.json` on install (issue #2709) — you still add codescout by
  hand.
- Copilot does not surface the `mcp__codescout__*` prefix in config the way CC does; tool
  visibility is controlled by the `tools` list.

Once this lands, codescout's tools (semantic_search, symbols, read_file, edit_code, artifact,
run_command, …) are available inside Copilot CLI. The `codescout-companion` *skills*
(researcher, reconnaissance, tracker-hygiene, explore-project) then work too (§3).

## 2. Hooks — the schema mapping, and the one blocker

Copilot hooks live in `.github/hooks/*.json` (repo) or `~/.copilot/hooks/` (user); both are
loaded and merged. Schema:

```json
{
  "version": 1,
  "hooks": {
    "preToolUse": [
      {
        "type": "command",
        "matcher": "Read|Grep|Glob|Bash|Edit|Write",
        "bash": "node <PLUGIN_PATH>/hooks/pre-tool-guard.mjs",
        "powershell": "node <PLUGIN_PATH>/hooks/pre-tool-guard.mjs",
        "cwd": ".",
        "timeoutSec": 10
      }
    ]
  }
}
```

### Event-name mapping (CC → Copilot)

| Claude Code | Copilot CLI |
|---|---|
| `SessionStart` | `sessionStart` |
| `UserPromptSubmit` | `userPromptSubmitted` |
| `PreToolUse` | `preToolUse` |
| `PostToolUse` | `postToolUse` |
| `SessionEnd` | `sessionEnd` |
| `PreCompact` | `preCompact` |
| `Stop` | `agentStop` |
| `SubagentStart` | `subagentStart` |

Copilot adds `postToolUseFailure`, `subagentStop`, `errorOccurred`, `notification` (no CC
equivalents — ignore for the port).

### What already fits

- **Exit-code contract:** Copilot `preToolUse` is **fail-closed** (nonzero → deny), exactly
  the model our hooks were rewritten for. Our fail-open convention (exit 0 on error; intended
  denials via JSON, not exit code) ports directly. `exit 2` = deny for `preToolUse`.
- **Matchers:** supported per hook entry (regex on tool name) — the same matchers from CC
  `hooks.json` transfer, one entry per matcher (Copilot has no multi-matcher grouping).
- **Node exec-form:** our hooks are already plain `node <script>.mjs` / (buddy) a Node
  launcher, so there is no shell/jq/bash dependency to fight — only the path prefix below.
- **buddy's Node launcher (`run.mjs`)** self-locates via `import.meta.url`, so once the hook
  *command* can name `run.mjs`, the python resolution keeps working under Copilot unchanged.

### The blocker: referencing plugin scripts without `${CLAUDE_PLUGIN_ROOT}`

Copilot does **not** expand `${CLAUDE_PLUGIN_ROOT}` (or any documented plugin-root variable) in
a hook command. So `<PLUGIN_PATH>` above has no portable value. Candidate resolutions, in
rough order of robustness — **all UNCONFIRMED until tested on a real Copilot install:**

1. **Copilot plugin install path.** If installed as a Copilot plugin (§4), the payload lives at
   `~/.copilot/installed-plugins/<marketplace>/<name>/` — reference that absolute path.
   *Unknown:* whether Copilot injects an env var naming it for the plugin's own hooks.
2. **An env var set in the hook's `env` block** (or the user's shell) pointing at the install
   dir, e.g. `"bash": "node \"$BUDDY_ROOT/hooks/run.mjs\" pre-tool-use"` with
   `"env": {"BUDDY_ROOT": "/abs/path"}`. Portable but requires per-machine setup.
3. **`cwd`-relative**, only if the plugin is vendored inside the repo (not the installed-plugin
   case).
4. **Hardcoded absolute path** — works, brittle, per-machine.

**→ First empirical task before authoring any hook manifest:** on a real Copilot CLI, determine
whether a plugin's own hooks receive an env var (or `cwd`) that locates the plugin root. That
answer decides whether §2 is a clean port or a per-machine setup step.

### Windows note

Copilot hooks on Windows need **PowerShell 7+** on `PATH`; provide the `powershell` key
alongside `bash`. Our hook commands are just `node <script>` either way, so the two keys are
usually identical. Keep hooks under ~5s (30s hard timeout).

## 3. Skills

Copilot reads skills from `.claude/skills/`, `.github/skills/`, and `~/.copilot/skills/` —
`SKILL.md` with YAML frontmatter (`name`, `description`). Our skills already use that shape, so
the `codescout-companion` and `buddy` skills are **largely usable as-is** once codescout MCP is
registered (§1). No slash-command mechanism in Copilot — commands would need re-expressing as
skills if desired.

## 4. Optional: package as a Copilot plugin

Copilot has its own `plugin.json` (fields: `name`, plus component paths `agents`, `skills`,
`commands`, `hooks`, `extensions`, `mcpServers`, `lspServers`), installed under
`~/.copilot/installed-plugins/`. Packaging would let a user `plugin install` the bundle, but:
the MCP-not-auto-merged bug (#2709) still forces a manual `mcp-config.json` edit, and the
plugin-root path question (§2) still gates hooks. Packaging is polish, not a prerequisite.

## Recommended sequencing

1. **codescout MCP** (§1) — immediate, high value, fully doable today.
2. **Skills** (§3) — verify they load under Copilot; near-zero work.
3. **Resolve the hooks blocker** (§2) — one empirical test on a Copilot install: how do plugin
   hooks locate their own files? Then author `.github/hooks/` manifests from the mapping above.
4. **Package** (§4) — only if a one-command install is wanted.

## Sources

- Copilot CLI config dir: https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-config-dir-reference
- Hooks configuration: https://docs.github.com/en/copilot/reference/hooks-configuration
- Hooks reference (exit codes): https://docs.github.com/en/copilot/reference/hooks-reference
- Using hooks (Windows / PowerShell 7): https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/use-hooks
- MCP servers: https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers
- Skills: https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-skills
- Plugin reference: https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-plugin-reference
- Plugin MCP not merged (bug): https://github.com/github/copilot-cli/issues/2709
- Per-repo MCP config (feature request): https://github.com/github/copilot-cli/issues/2528
