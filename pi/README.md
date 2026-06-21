# pi

Pi companion extensions for [pi](https://github.com/earendil-works/pi-mono). All skills live in the sibling CC plugin directories — no duplication.

## Install

```bash
cd claude-plugins/pi
./install.sh
# follow printed mcp.json instructions, then /reload in pi
```

## What it installs

**Extension** (`~/.pi/agent/extensions/codescout-companion.ts`) — widget below the editor:

```
cs: reconnaissance                  [recon F2/W1]
skills: debugging-yeti, pdf, docx
MCP: 2/2  codescout ●  researcher ●
```

**Skill directories** wired into `~/.pi/agent/settings.json`:

| Directory | Skills |
|---|---|
| `codescout-companion/skills/` | reconnaissance, explore-project, researcher-mcp, research-web, research-subagent |
| `buddy/skills/` | debugging-yeti, testing-snow-leopard, planning-crane, … (12 specialists) |
| `sdd/skills/` | sdd-flow |

All skill content lives in those directories — nothing is duplicated here.

## Extension: codescout-companion.ts

Tracks skill loads (reads of `SKILL.md` files), shows the recon badge from `.buddy/<session_id>/` marker files, and shows MCP server status from `pi.getAllTools()`.

The `MCP_SERVERS` constant in `extensions/codescout-companion.ts` lists which indicator tools to watch — edit if you use different servers.

## Requirements

- [pi](https://github.com/earendil-works/pi-mono)
- [codescout](https://github.com/mareurs/codescout) MCP server (for the cs: line and recon badge)
- `jq` (for install.sh)
- [researcher-mcp](https://github.com/mareurs/researcher) (optional)
