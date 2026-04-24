---
name: buddy:legend
description: Print a reference card showing specialist initials, aliases, and mood meanings. Useful when the statusline shows [DT] and you want to know what that means.
---

You are printing the buddy plugin reference card. Emit exactly the following markdown table in your response. No preamble, no commentary — just the table.

## Buddy Legend

### Specialist Initials

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

Dismiss one with `/buddy:dismiss <alias>` or all with `/buddy:dismiss`.
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
