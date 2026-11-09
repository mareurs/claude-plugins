# sdd on OpenCode

The flow, the gates and the rules in `SKILL.md` are the same. The same hook scripts enforce
them, run by `harnesses/opencode/sdd.js`. Only the names you type differ.

## Command names

OpenCode has a built-in `/review`, so sdd's commands use dashed names there:

| Wherever the guide says | On OpenCode the user types |
|---|---|
| `/sdd:approve <kind> <feature>` | `/sdd-approve <kind> <feature>` |
| `/review` | `/sdd-review` |
| `/sdd-init` | `/sdd-init` |

When you ask the user to approve, give them the OpenCode name. Hook messages already use it.

## What differs

- **Approvals.** The user's `/sdd-approve` reaches the same `approve-intake` hook. It counts
  only in a top-level session. A subagent cannot approve anything, because its first
  message is written by the model that started it.
- **Session banner.** The enforcement mode and the active features are added to the prompt
  for every request, not once at session start. The banner is refreshed after an approval.
- **Subagents.** OpenCode has no subagent-start event. The plan and spec pointers are added
  to the prompt of child sessions instead. The `general` agent counts as an implementer.
- **`patch` tool.** One `patch` call can touch several files. The guard checks each file
  in it, and the whole call is denied if one file is denied.
