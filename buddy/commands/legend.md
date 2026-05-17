You are printing the buddy plugin reference card.

## Step 1 — Resolve currently active specialists

Use the `Bash` tool to gather the active list and resolve plain labels:

```bash
python3 - <<'PY'
import json, os, sys
from pathlib import Path
sys.path.insert(0, os.environ.get("CLAUDE_PLUGIN_ROOT", ""))
from scripts.specialist_labels import resolve_labels

project = Path(os.environ.get("CLAUDE_PROJECT_DIR") or os.getcwd())
pointer = project / ".buddy" / ".current_session_id"
if not pointer.is_file():
    print("(no active session)")
    sys.exit(0)
sid = pointer.read_text().strip()
state_path = project / ".buddy" / sid / "state.json"
if not state_path.is_file():
    print("(none)")
    sys.exit(0)
state = json.loads(state_path.read_text())
active = state.get("active_specialists", []) or []
if not active:
    print("(none)")
    sys.exit(0)
plugin_root = Path(os.environ["CLAUDE_PLUGIN_ROOT"])
pairs = resolve_labels(active, plugin_root=plugin_root,
                       project_root=project, home=Path.home())
for slug, label in pairs:
    print(f"- **{label}** (`{slug}`)")
PY
```

## Step 2 — Emit the markdown

Emit exactly the following markdown in your response. Substitute the output of
Step 1 into the **Currently Active** section. No preamble, no commentary.

## Buddy Legend

### Currently Active

<output of Step 1 — bullet list, or `(none)` if empty>

Dismiss one with `/buddy:dismiss <alias>` or all with `/buddy:dismiss`.

### Builtin Specialists

| Initial | Specialist | Summon With |
|---------|-----------|-------------|
| D | Debugging Yeti | `/buddy:summon yeti` |
| R | Refactoring Yak | `/buddy:summon yak` |
| T | Testing Snow Leopard | `/buddy:summon leopard` |
| P | Performance Lammergeier | `/buddy:summon lammergeier` |
| S | Security Ibex | `/buddy:summon ibex` |
| A | Architecture Snow Lion | `/buddy:summon lion` |
| C | Planning Crane | `/buddy:summon crane` |
| W | Docs Lotus Frog | `/buddy:summon frog` |
| L | Data Leakage Snow Pheasant | `/buddy:summon pheasant` |
| M | ML Training Takin | `/buddy:summon takin` |

Project-scoped specialists (under `<cwd>/.buddy/skills/`) are shown in
*Currently Active* when summoned; they live alongside the builtin set with
project > global > builtin precedence on name collision.

### Moods

| Mood | Triggers |
|------|----------|
| flow | Default — calm baseline |
| racing | High edit velocity in a young session |
| exploratory | Many tool calls, low context |
| full-context | Context ≥ 80% |
| stuck | 3+ test failures in last 15 min |
| victorious | Green tests after prior errors |
| test-streak | Recent green, no prior errors |
| long-session | Session > 2 hours |
| idle | No input for 5+ min |
| late-night | Hour ≥ 23 or ≤ 5 |
