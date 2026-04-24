# Plugin Manifest Format — Research Notes

Date: 2026-04-13
Source: docs.claude.com via `working-with-claude-code` skill (plugins.md, plugins-reference.md, statusline.md, slash-commands.md)

---

## Question 1: Does `plugin.json` accept an inline `statusLine` field?

**No.** The `plugin.json` schema (plugins-reference.md "Complete schema") supports exactly these fields:

- `name`, `version`, `description`, `author`, `homepage`, `repository`, `license`, `keywords`
- Component paths: `commands`, `agents`, `hooks`, `mcpServers`

There is no `statusLine` field in the plugin manifest. The statusline is configured exclusively in the user's `~/.claude/settings.json` via:

```json
{
  "statusLine": {
    "type": "command",
    "command": "~/.claude/statusline.sh",
    "padding": 0
  }
}
```

The statusline script receives session JSON on stdin and prints one line to stdout. ANSI color codes are supported.

**Implication for buddy-plugin:** The install process must add a `statusLine` entry to the user's `settings.json` pointing at `${CLAUDE_PLUGIN_ROOT}/scripts/statusline.py`, or the user must add it manually.

---

## Question 2: Are hooks registered via `plugin.json`, via `hooks/hooks.json`, or both?

**Both are supported.** From plugins-reference.md:

- Location: `hooks/hooks.json` in plugin root, **or** inline in `plugin.json`
- The `hooks` field in `plugin.json` accepts `string|object` — a path to an external hooks file, or an inline hooks object.

The format is the same either way:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [
          {
            "type": "command",
            "command": "${CLAUDE_PLUGIN_ROOT}/scripts/format-code.sh"
          }
        ]
      }
    ]
  }
}
```

The default convention is `hooks/hooks.json` at the plugin root. Using a separate file is cleaner for our plugin since we have multiple hook events.

**Implication for buddy-plugin:** Keep hooks in `hooks/hooks.json` (as Task 1.1 already sketches). No changes needed.

---

## Question 3: How are plugin-scoped slash command names resolved?

From slash-commands.md "Plugin commands" section:

- Commands are **namespaced** as `/plugin-name:command-name`
- The plugin prefix is **optional unless there are name collisions**
- So `/buddy:status` and `/status` both work (if no collision on `status`)

The command name comes from the **markdown filename** (without `.md`), not from frontmatter. A file at `commands/status.md` in a plugin named `buddy` resolves as `/buddy:status` (or `/status` if unique).

Frontmatter `description` controls the help text, not the command name.

**Implication for buddy-plugin:** Name command files `status.md`, `check.md`, `summon.md`, `dismiss.md`. Users invoke as `/buddy:status`, `/buddy:check`, etc. This matches the plan's intent.

---

## Task 1.1 Sketch Accuracy Assessment

The Task 1.1 sketches are **mostly correct**. Specific findings:

1. **`plugin.json`** — The sketch is correct and minimal. The `author` field should technically be an object `{"name": "marius"}` per the schema, not a bare string. Minor fix needed.

2. **`hooks/hooks.json`** — The sketch is correct. The format matches the official docs exactly. Using `${CLAUDE_PLUGIN_ROOT}` for script paths is the documented pattern.

3. **Statusline** — The plan already correctly notes "Statusline registration may need to be in the user's `~/.claude/settings.json`". This is confirmed: there is no plugin-level statusline registration. The install step (Task 1.12) must handle this.

4. **`.claude-plugin/plugin.json` vs `plugin.json`** — The official docs place the manifest at `.claude-plugin/plugin.json`, NOT at the plugin root. The plan says `buddy-plugin/plugin.json` but the correct path is `buddy-plugin/.claude-plugin/plugin.json`. This is an important structural fix.

### Required changes to Task 1.1:

- **Change `buddy-plugin/plugin.json` to `buddy-plugin/.claude-plugin/plugin.json`** (add `.claude-plugin/` subdirectory)
- **Change `"author": "marius"` to `"author": {"name": "marius"}`**
- Add a Step 3 note: create `.claude-plugin/` directory alongside hooks/, scripts/, etc.
