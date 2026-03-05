---
description: Launch the code-explorer dashboard web UI for the current project
---

# /dashboard

Launch the code-explorer dashboard web UI for the current project.

## Usage

```
/dashboard [--port <port>] [--host <host>]
```

Defaults: `host=127.0.0.1`, `port=8099`

## Steps

1. **Find the code-explorer binary.**
   Source `detect-tools.sh` logic or inspect the MCP config directly:
   - Check `.mcp.json`, `~/.claude/.claude.json`, `~/.claude/settings.json`
   - Extract `.mcpServers.<server>.command` for the entry whose command or args contain `code-explorer`
   - Fallback: use `code-explorer` if available on PATH

2. **Start the dashboard in the background** using `run_command` with `run_in_background: true`:
   ```
   <binary> dashboard --project <cwd> [--host <host>] [--port <port>]
   ```
   The binary auto-opens the browser. Do not pass `--no-open`.

3. **Report the URL** to the user: `http://<host>:<port>`

## Notes

- The server blocks until killed — always run in background
- If the port is already in use, suggest re-running with `--port <other>`
- If the binary is not found, tell the user to ensure code-explorer is installed and configured as an MCP server
