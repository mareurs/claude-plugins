# pi companion

Companion extensions for [pi](https://github.com/earendil-works/pi-mono).
Wires all skills from this repo into pi, adds an editor widget for MCP and skill status,
and connects codescout's code-intelligence tools as first-class pi tools.

## What you get

**Widget below the editor** — updates every turn:

```
cs: reconnaissance                    [recon F2/W1]
skills: debugging-yeti, pdf, docx
MCP: 2/2  codescout ●  researcher ●
```

- `cs:` line — codescout-companion skills loaded this session (reconnaissance, explore-project, …)
- `skills:` line — all other skills loaded (buddy specialists, document skills, …)
- `[recon …]` badge — reconnaissance skill is active (`●`) or was used this session (`F2/W1` = 2 frictions, 1 win)
- `MCP:` line — connected MCP servers from `mcp.json`

**Skills wired into pi** — no duplication, everything lives in the original directories:

| Directory | Skills |
|---|---|
| `codescout-companion/skills/` | reconnaissance, explore-project, researcher-mcp, research-web, research-subagent, tracker-hygiene |
| `buddy/skills/` | debugging-yeti, testing-snow-leopard, planning-crane, architecture-snow-lion, and 8 more |
| `sdd/skills/` | sdd-flow |

**codescout tools as native pi tools** — when codescout is connected, its read/search/edit
tools surface without the `mcp__codescout__` prefix:
`symbols`, `read_file`, `read_markdown`, `semantic_search`, `references`, `edit_code`,
`edit_file`, `edit_markdown`, `tree`, `symbol_at`.
`grep` stays prefixed as `codescout_grep` to avoid a name collision with pi's built-in.

**codescout-mode extension** (from the codescout repo) — on each session start:
- drops pi's native `edit` tool and activates the codescout hot-set (guarded: no-ops if codescout isn't loaded)
- appends a one-time hint when bash is used to grep/find source files

## Prerequisites

- [pi](https://github.com/earendil-works/pi-mono) installed (`npm install -g --ignore-scripts @earendil-works/pi-coding-agent`)
- [jq](https://jqlang.github.io/jq/) (`apt install jq` / `brew install jq`)
- [codescout](https://github.com/mareurs/codescout) binary on PATH (for the cs: line, code tools, and recon badge)

Optional:
- [researcher-mcp](https://github.com/mareurs/researcher) binary (for `/research-web` and `/research-subagent`)

## Install

### Step 1 — pi-mcp-adapter package

pi uses `pi-mcp-adapter` to connect MCP servers. Install it once:

```bash
pi install npm:pi-mcp-adapter
```

This adds `"packages": ["npm:pi-mcp-adapter"]` to `~/.pi/agent/settings.json`.

### Step 2 — companion extension + skill dirs

```bash
git clone https://github.com/mareurs/claude-plugins
cd claude-plugins/pi
./install.sh
```

The script:
- Symlinks `pi/extensions/codescout-companion.ts` → `~/.pi/agent/extensions/codescout-companion.ts`
- Adds `codescout-companion/skills`, `buddy/skills`, and `sdd/skills` to `~/.pi/agent/settings.json`

### Step 3 — codescout-mode extension (from the codescout repo)

If you have the codescout repo checked out, run its install script too:

```bash
cd /path/to/codescout/contrib/pi
cp mcp.json.example mcp.json    # create your personal mcp.json (gitignored)
bash install.sh
```

This symlinks `codescout-mode.ts` → `~/.pi/agent/extensions/codescout-mode.ts`
and `AGENTS.md` → `~/.pi/agent/AGENTS.md` (the tool-routing guidance the model reads).

### Step 4 — MCP configuration

Create or edit `~/.pi/agent/mcp.json`. This file is personal — keep it out of git
(it holds your API keys).

**Minimal setup (codescout only):**

```json
{
  "mcpServers": {
    "codescout": {
      "command": "/home/you/.cargo/bin/codescout",
      "args": ["start"],
      "lifecycle": "lazy",
      "directTools": [
        "symbols",
        "symbol_at",
        "tree",
        "semantic_search",
        "references",
        "read_file",
        "read_markdown",
        "edit_code",
        "edit_file",
        "edit_markdown"
      ]
    }
  }
}
```

> Note: `grep` is intentionally absent from `directTools` — it collides with pi's
> built-in `grep`. Reach codescout's grep as `codescout_grep` (it's still available
> via the mcp proxy, and AGENTS.md documents this).

**With semantic search** (Ollama + Qdrant or llama-server embedder):

```json
{
  "mcpServers": {
    "codescout": {
      "command": "/home/you/.cargo/bin/codescout",
      "args": ["start"],
      "lifecycle": "lazy",
      "directTools": [
        "symbols", "symbol_at", "tree", "semantic_search", "references",
        "read_file", "read_markdown", "edit_code", "edit_file", "edit_markdown"
      ],
      "env": {
        "CODESCOUT_QDRANT_URL": "http://127.0.0.1:6334",
        "CODESCOUT_EMBEDDER_URL": "http://127.0.0.1:11434/v1"
      }
    }
  }
}
```

**With researcher-mcp:**

```json
{
  "mcpServers": {
    "codescout": { ... },
    "researcher": {
      "command": "/path/to/researcher-mcp",
      "lifecycle": "lazy",
      "directTools": ["research", "research_person", "research_company", "research_code", "market_insight", "search_jobs"],
      "env": {
        "LLM_BASE_URL": "https://generativelanguage.googleapis.com/v1beta/openai/",
        "LLM_MODEL":    "gemini-2.5-flash",
        "LLM_API_KEY":  "<your-api-key>",
        "SEARXNG_URL":  "http://localhost:4000"
      }
    }
  }
}
```

### Step 5 — warm the directTools cache

On the very first launch, pi needs one reconnect to register the codescout tools
as direct (non-proxied) tools. In pi, run:

```
/mcp reconnect codescout
```

After that, every session auto-connects codescout on first tool use (`lifecycle: lazy`).

### Step 6 — reload

```
/reload
```

The widget should appear below the editor. If the MCP line shows `0/2` circles,
the servers haven't connected yet — they connect lazily on first use.

## What `settings.json` looks like after install

```json
{
  "packages": ["npm:pi-mcp-adapter"],
  "skills": [
    "/path/to/claude-plugins/codescout-companion/skills",
    "/path/to/claude-plugins/buddy/skills",
    "/path/to/claude-plugins/sdd/skills"
  ],
  "defaultThinkingLevel": "high"
}
```

You can also set `"defaultProvider"`, `"defaultModel"`, and `"theme"` here.
Thinking level can also be changed interactively with **Shift+Tab** or via `/settings`.

## Extension: codescout-companion.ts

The widget extension in `pi/extensions/codescout-companion.ts`.

**What it tracks:**

- Skill loads — intercepts `read` / `codescout_read_file` / `codescout_read_markdown`
  calls on `SKILL.md` files, and `/skill:<name>` inputs
- Recon badge — reads `.buddy/<session_id>/recon-{loaded,active,counts.json}` marker
  files written by the reconnaissance skill
- Session bridge — writes pi's session ID to `.buddy/.current_session_id` so the
  recon skill's bash snippets find the right marker directory
- MCP status — inferred from `pi.getAllTools()` at each turn end; no extra config

**Configuring which MCP servers to show:**

Edit the `MCP_SERVERS` constant at the top of the file:

```typescript
const MCP_SERVERS: { name: string; indicatorTool: string }[] = [
  { name: "codescout",  indicatorTool: "codescout_grep" },
  { name: "researcher", indicatorTool: "researcher_research" },
];
```

Each `indicatorTool` is a tool name that is only registered when that server is
connected. Pick a tool that is always present when the server is up.

## Extension: codescout-mode.ts

Shipped in the codescout repo at `contrib/pi/codescout-mode.ts`.

On `session_start`:
- If `edit_code` and `symbols` are present (codescout is connected and cache is warm),
  drops pi's native `edit` and activates the codescout hot-set via `pi.setActiveTools()`
- Safe no-op if codescout isn't loaded (e.g. in a non-code directory)

On `tool_result` from bash:
- Appends a one-time hint if the command looks like `rg`, `ag`, recursive grep, or `find -name`

## Skill usage in pi

Skills from all three directories are available as `/skill:<name>` or load automatically
when the model reads their `SKILL.md`.

Key ones:

| Invocation | Effect |
|---|---|
| `/skill:reconnaissance` | Runs a recon sweep before a risky change |
| `/skill:research-web` | Quick inline web research (uses researcher-mcp) |
| `/skill:research-subagent` | Deep research via subagent (keeps context clean) |
| `/skill:debugging-yeti` | Systematic debugging protocol |
| `/skill:sdd-flow` | Full spec-driven development lifecycle |

All buddy specialist skills, document skills (pdf, docx, xlsx, …), and
superpowers skills are also available if their directories are in `settings.json`.

## Adding skills from superpowers / anthropic-agent-skills

These plugins install to versioned cache dirs (e.g.
`~/.claude/plugins/cache/superpowers-marketplace/superpowers/6.1.1/`). Point
`settings.json` at a `latest` symlink so you don't need to update the path on
every plugin update:

```bash
CACHE=~/.claude/plugins/cache/superpowers-marketplace/superpowers
LATEST=$(ls -d "$CACHE"/*/ | grep -v '/latest/' | sort -V | tail -1 | xargs basename)
ln -sfn "$LATEST" "$CACHE/latest"
```

Then add to `settings.json`:

```json
{
  "skills": [
    "/home/you/.claude/plugins/cache/superpowers-marketplace/superpowers/latest/skills",
    "-/home/you/.claude/plugins/cache/superpowers-marketplace/superpowers/latest/skills/claude-api"
  ]
}
```

The `-` prefix force-excludes a specific skill. Rerun the symlink command after
`claude plugin update`.
