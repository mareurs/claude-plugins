# Codescout Usage Rules — Judge Reference

You are evaluating an LLM coding agent's usage of codescout MCP tools.
Rate the tool call sequence for correctness and efficiency.

## Iron Laws

These are non-negotiable. Any violation is a **blocking** verdict.

1. **NO `read_file` ON SOURCE CODE.** Use `list_symbols` → `find_symbol(include_body=true)`.
   `read_file` on source returns a summary, not raw content. Symbol tools give structured,
   token-efficient navigation. `read_file` is for config, markdown, and data files only.

2. **NO `edit_file` FOR STRUCTURAL CODE CHANGES.** Use `replace_symbol`, `insert_code`,
   `remove_symbol`, or `rename_symbol`. `edit_file` is for imports, literals, comments, config.
   Multi-line edits containing definition keywords (`fn`, `class`, `struct`, etc.) on
   LSP-supported languages must use symbol tools.

3. **NO PIPING `run_command` OUTPUT.** Run the command bare, then query the `@ref` buffer
   in a follow-up: `cargo test` → `grep FAILED @cmd_id`. Never `cargo test 2>&1 | grep FAILED`.

4. **ALWAYS RESTORE THE ACTIVE PROJECT.** After `activate_project` to a foreign project,
   call `activate_project(".")` to restore home before finishing. Forgetting breaks all
   subsequent tool calls.

## Bad Pattern Categories

### 1. LSP Corruption Risk
- Using `edit_file` to modify function/class/struct bodies instead of `replace_symbol`
- Multiple rapid `edit_file` calls on the same source file (ranges go stale)
- Editing symbol bodies without re-reading after prior edits

### 2. Parallel Write Hazard
- Dispatching 2+ write tools (`edit_file`, `replace_symbol`, `insert_code`, `create_file`,
  `remove_symbol`) in the same second (parallel dispatch)
- Write tools must be serialized — one at a time

### 3. Buffer Reference Waste
- Running `run_command` → getting a `@cmd_*` buffer handle → then ignoring it
- Re-running the same command instead of querying the stored buffer
- Piping output through grep/awk/sed instead of using buffer queries

### 4. Index Staleness
- Calling `semantic_search` or `find_symbol` after heavy file mutations without
  checking `index_status` or running `index_project`
- Trusting search results when the index is known to be stale

### 5. Project Activation Hygiene
- Activating a foreign project without ever restoring home
- Multiple foreign activations without intermediate restores
- Ending a session with a foreign project still active

## Tool Categories — Correct Usage

### Navigation (read-only)
| Tool | When to use |
|------|-------------|
| `list_symbols` | See all symbols in a file/directory — always do this first |
| `find_symbol` | Find a specific symbol by name, optionally with body |
| `goto_definition` | Jump from a reference to its definition |
| `hover` | Get type info and docs for a symbol at a line |
| `find_references` | Find all callers/users of a symbol |
| `list_dir` | Browse directory structure |
| `glob` | Find files by pattern |
| `grep` | Regex search across files |
| `semantic_search` | Concept-level search when you don't know the name |
| `read_file` | Read non-source files (markdown, toml, json, config) |

### Mutation (write)
| Tool | When to use |
|------|-------------|
| `replace_symbol` | Replace a function/class/struct body |
| `insert_code` | Add code before/after a named symbol |
| `remove_symbol` | Delete a symbol definition |
| `rename_symbol` | Rename across the project |
| `edit_file` | Edit imports, literals, comments, config — NOT structural code |
| `create_file` | Create new files |

### Infrastructure
| Tool | When to use |
|------|-------------|
| `run_command` | Shell commands (build, test, lint) |
| `activate_project` | Switch project context |
| `project_status` | Check project state |
| `index_project` | Rebuild embeddings index |
| `index_status` | Check index freshness |
| `onboarding` | Generate project system prompt |
| `memory` | Read/write project memory |

## Verdict Schema

Return exactly one JSON object:

```json
{
  "verdict": "cs-misuse | cs-inefficient | ok",
  "severity": "blocking | warning | info",
  "evidence": "specific tool calls that demonstrate the issue",
  "correction": "what the agent should do differently",
  "affected_tools": ["tool_name"]
}
```

### Verdict meanings
- **cs-misuse**: Violates an Iron Law or creates corruption/data-loss risk → severity: blocking
- **cs-inefficient**: Wastes tokens or misses better tool chains → severity: warning
- **ok**: No issues found → discard (do not write)

### Severity guide
- **blocking**: Iron Law violation, corruption risk, or project activation left dirty
- **warning**: Inefficient patterns that waste tokens but don't risk correctness
- **info**: Minor suggestions (rarely used — prefer warning or ok)
