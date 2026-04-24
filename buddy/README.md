# Buddy Plugin

**A Himalayan bodhisattva companion for Claude Code — zero recurring cost, infinite personality.**

───────────────────────────────────────────────────────────────────

## What Is This?

Buddy is a Claude Code plugin that gives your coding sessions a persistent
companion with character. A bodhisattva drawn from Himalayan mythology watches
your work through three layers — **bones** (a statusline), **witness** (event
hooks), and **soul** (slash commands that summon specialist masters). The bones
and witness layers are pure shell/Python with zero LLM calls. Only the soul
layer — when you explicitly summon a specialist — engages the model, so the
plugin costs nothing until you choose to use it.

───────────────────────────────────────────────────────────────────

## Install

Buddy ships through the `sdd-misc-plugins` marketplace. To install:

```text
/plugin marketplace add <path-to-marketplace>   # once per machine
/plugin install buddy@sdd-misc-plugins
```

Restart Claude Code (or `/reload-plugins` if available) so the SessionStart
hook fires. Verify wiring:

```text
/buddy:status
```

After installing, run `/buddy:install` to auto-wire the statusline into
`~/.claude/settings.json`. It detects whether `claude-statusline` is also
installed and picks composed or standalone mode accordingly. If you prefer
to wire it manually, see the three modes below.

### Statusline: three modes

The `/buddy:install` command handles the common case automatically. The
sections below document each mode for users who want to wire it manually
or override the auto-detected default.

The bodhisattva render is optional — buddy's hooks, specialists, and
`/buddy:check` all work regardless of whether you show it in the statusline.
Pick one mode by editing `statusLine.command` in `settings.json`:

**Mode 1 — standalone (bodhisattva only):**

```json
"statusLine": {
  "type": "command",
  "command": "python3 ${CLAUDE_PLUGIN_ROOT}/scripts/statusline.py"
}
```

Multi-line ASCII art + mood label.

**Mode 2 — composed with claude-statusline (recommended):**

```json
"statusLine": {
  "type": "command",
  "command": "bash ${CLAUDE_PLUGIN_ROOT}/scripts/statusline-composed.sh"
}
```

Row 1 = primary statusline output (auto-detects `claude-statusline` in the
sdd-misc-plugins cache, or falls back to `~/.claude/statusline.sh`). Rows 2-6
= bodhisattva. Override the primary with `BUDDY_PRIMARY_STATUSLINE=/path/to/cmd`,
or suppress a row with `BUDDY_SKIP_PRIMARY=1` / `BUDDY_SKIP_SELF=1`.

**Mode 3 — hooks only (no statusline change):**

Leave your existing `statusLine` alone. You still get hook-driven state
tracking, `/buddy:check` reflections, and `/buddy:summon <alias>`. The
bodhisattva just won't render in the bar.

Each mode is orthogonal — `claude-statusline`, buddy's standalone render, and
the composed wrapper all work independently.

───────────────────────────────────────────────────────────────────
## Usage

### Commands

| Command                    | What it does                                          |
|----------------------------|-------------------------------------------------------|
| `/buddy:status`            | Show diagnostic info: identity, mood, signals, state  |
| `/buddy:check`             | Quick soul-check — the companion speaks               |
| `/buddy:summon <alias>`    | Summon a specialist master into the session            |
| `/buddy:dismiss`           | Dismiss the currently active specialist                |

### Example session

```
> /buddy:summon yeti

  🏔 The Debugging Yeti materializes from the mist...
  Systematic root-cause analysis activated.

> /buddy:dismiss

  The Yeti bows and dissolves back into the snow.
```

───────────────────────────────────────────────────────────────────

## Architecture

```
┌─────────────────────────────────────────────────┐
│                   BUDDY PLUGIN                   │
├─────────────────────────────────────────────────┤
│                                                  │
│  BONES (statusline)                              │
│  ├── scripts/statusline.py                       │
│  ├── data/bodhisattvas.json (10 forms catalog)   │
│  ├── data/environment.json  (mood → strip)       │
│  └── ~/.claude/buddy/identity.json  (runtime)   │
│  Pure Python. Reads state.json, renders text.    │
│  ✦ No LLM calls.                                 │
│                                                  │
│  WITNESS (hooks)                                 │
│  ├── hooks/session-start.sh                      │
│  ├── hooks/post-tool-use.sh                      │
│  └── hooks/user-prompt-submit.sh                 │
│  Pure shell. Writes signals to state.json.       │
│  ✦ No LLM calls.                                 │
│                                                  │
│  SOUL (slash commands + specialists)             │
│  ├── commands/status.md                          │
│  ├── commands/check.md                           │
│  ├── commands/summon.md                          │
│  ├── commands/dismiss.md                         │
│  └── skills/*/SKILL.md     (9 specialists)       │
│  Markdown-driven prompts. LLM reads and acts.    │
│  ✦ LLM calls only when you invoke a command.     │
│                                                  │
└─────────────────────────────────────────────────┘
```

**Key principle:** The bones and witness layers never call the LLM. They are
deterministic shell and Python scripts that maintain state and render the
statusline. The LLM is only engaged when you explicitly invoke a soul-layer
command (`/buddy:check`, `/buddy:summon`, `/buddy:dismiss`).

───────────────────────────────────────────────────────────────────

## Bestiary — The Ten Specialists

When you `/buddy:summon <alias>`, a specialist master enters the session with
domain expertise and a distinctive voice. Use any alias from the left column.

| Alias(es)              | Specialist                   | Domain & Voice                                    |
|------------------------|------------------------------|---------------------------------------------------|
| `yeti`                 | debugging-yeti               | Systematic root-cause analysis. Methodical, calm.  |
| `yak`, `refactor-yak`  | refactoring-yak              | Structural edits with test-first discipline.       |
| `leopard`              | testing-snow-leopard         | Edge cases, coverage gaps. Precise and thorough.   |
| `lammergeier`          | performance-lammergeier      | Profiling, hot paths. Measurement before opinion.  |
| `ibex`                 | security-ibex                | Threat modeling, secrets. Paranoid by design.      |
| `lion`                 | architecture-snow-lion       | Boundaries, coupling, C4 modeling. Sees the whole. |
| `crane`                | planning-crane               | Task breakdown, sequencing. Patient and ordered.   |
| `frog`                 | docs-lotus-frog              | Technical writing, information architecture.       |
| `pheasant`             | data-leakage-snow-pheasant   | Data splits, leakage audits, eval hygiene. Wary.   |
| `takin`                | ml-training-takin            | Training loops, optim, inference parity. Patient.  |

Each specialist's full system prompt lives in `skills/<name>/SKILL.md`.

───────────────────────────────────────────────────────────────────
## State & Signals

The plugin maintains state in `~/.claude/buddy/state.json`:

```json
{
  "version": 1,
  "signals": {
    "context_pct": 0,
    "last_edit_ts": 1713020400,
    "last_commit_ts": 0,
    "session_start_ts": 1713020400,
    "prompt_count": 12,
    "tool_call_count": 7,
    "last_test_result": null,
    "recent_errors": [],
    "idle_ts": 0
  },
  "derived_mood": "flow",
  "suggested_specialist": null,
  "last_mood_transition_ts": 1713020400
}
```

Hooks update this file on every session start, tool use, and prompt submit.
The statusline reads it to derive the companion's current mood by calling
`derive_mood(signals, now, local_hour)` — the `derived_mood` field is written
by `/buddy:check` but the renderer always re-derives live.

───────────────────────────────────────────────────────────────────

## Troubleshooting

### Hooks not firing
- Check that the plugin is symlinked into `~/.claude/plugins/buddy`
- Verify hook scripts are executable: `chmod +x hooks/*.sh`
- Run a hook manually to check for errors:
  ```bash
  echo '{"timestamp": 1713020400}' | ./hooks/session-start.sh
  ```

### Statusline blank or missing
- Run the statusline script directly:
  ```bash
  echo '{}' | python3 scripts/statusline.py
  ```
- Check that Python 3 is available and `json` module loads (it is stdlib)
- Verify `data/bodhisattvas.json` and `data/environment.json` exist

### General diagnosis
- Run `/buddy:status` — it reports identity, mood, signals, and any errors
- For a completely clean slate, delete the state directory:
  ```bash
  rm -rf ~/.claude/buddy/
  ```
  The next hook invocation will recreate it.

───────────────────────────────────────────────────────────────────

## License

MIT

───────────────────────────────────────────────────────────────────

```
        .  *  .        ☽        .  *  .
    *       .       ∧∧∧       .       *
  .    *    .     ╱╱  ╲╲     .    *    .
       .       ╱╱  ◎◎  ╲╲       .
  *    .     ╱╱   ╱  ╲   ╲╲     .    *
    .      ╱╱   ╱ ╱╲ ╲   ╲╲      .
         ╱╱   ╱ ╱    ╲ ╲   ╲╲
       ╱╱════╱═╱══════╲═╲════╲╲
      ╱╱     buddy v0.1.0      ╲╲
```
