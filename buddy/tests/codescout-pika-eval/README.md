# codescout-pika eval

A [prompt-tdd](../../../) eval for the `codescout-pika` skill. It hands the model
a log of codescout tool calls and judges whether the skill flags the real Iron
Law violations (recall) while staying quiet on clean calls (precision).

## Why this needs an isolated profile

`codescout-pika` is a **globally-installed buddy plugin**. A plain `claude -p`
loads it from the plugin install regardless of the scenario's `setup.skills`, so
omitting the skill does **not** remove it — every run is confounded and a
no-skill negative control is impossible. An eval whose result never changes when
you remove the skill is measuring nothing.

The fix: run the system-under-test against a deliberately **blank** claude
profile that has no plugins, skills, or MCP servers. Then `setup.skills` is the
*only* source of the skill, and a no-skill run is genuinely skill-free.

`prompt_tdd.yaml` points the harness at that profile via:

```yaml
claude_code:
  session:
    config_dir: ~/.claude-test
```

The adapter sets `CLAUDE_CONFIG_DIR=~/.claude-test`, adds `--strict-mcp-config`
(no ambient MCP), and strips any ambient `ANTHROPIC_API_KEY` so the profile's own
credentials are used.

## One-time setup: the `~/.claude-test` profile

A blank, plugin-free profile. Subscription auth is reused by symlinking the main
profile's credentials:

```bash
mkdir -p ~/.claude-test
ln -sf ~/.claude/.credentials.json ~/.claude-test/.credentials.json
cat > ~/.claude-test/settings.json <<'JSON'
{
  "theme": "dark",
  "skipAutoPermissionPrompt": true,
  "autoMemoryEnabled": false,
  "autoCompactEnabled": false,
  "remoteControlAtStartup": false
}
JSON
```

Do **not** install any plugins, skills, hooks, or MCP servers into it — keeping
it blank is the whole point. (This is the deliberate exception to the
"apply config to all instances" rule.)

Smoke-test it:

```bash
cd /tmp && CLAUDE_CONFIG_DIR=~/.claude-test claude -p "Reply with: READY" \
  --permission-mode bypassPermissions --strict-mcp-config < /dev/null
```

## Running

The judge tier (T3) calls the Anthropic API, so an `ANTHROPIC_API_KEY` must be in
the environment (the adapter strips it from the *isolated subprocess* only — the
judge still sees it):

```bash
set -a; . /path/to/prompt-engineering/.env; set +a
cd buddy/tests/codescout-pika-eval
prompt-tdd run
```

## Validation (this eval has teeth)

| Skill | Result |
|---|---|
| present (`setup.skills`) | 2/2 PASS |
| absent (remove `setup.skills`) | 0/2 FAIL — the bare model refuses, lacking the Iron Laws |

The GREEN-with / RED-without gap is the proof the eval measures the skill, not
the base model. See `prompt-engineering/docs/trackers/skill-eval-playbook.md`.
