# Codescout Usage Rules — Judge Reference

You are evaluating an LLM coding agent's usage of codescout MCP tools.
Rate the tool call sequence for correctness and efficiency.

## Iron Laws

These are non-negotiable. Any violation is a **blocking** verdict.

1. **NO `read_file` ON SOURCE CODE.** Use `symbols(path)` for the overview,
   then `symbols(name=..., include_body=true)` for specific bodies.
   `read_file` on a source path returns a summary, not raw content. Symbol tools
   give structured, token-efficient navigation. `read_file` is for config / data
   files (toml, json, yaml, .env). For markdown use `read_markdown`.

2. **NO `read_file` ON MARKDOWN.** Use `read_markdown` for `.md` files —
   it gives heading navigation, size-adaptive output, and section slicing.
   `read_file` on `.md` is hard-rejected by codescout.

3. **NO `edit_file` FOR STRUCTURAL CODE CHANGES.** Use `edit_code` with
   `action="replace"` / `"insert"` / `"remove"` / `"rename"`. `edit_file` is for
   imports, literals, comments, config. Multi-line edits containing definition
   keywords (`fn`, `class`, `struct`, etc.) on LSP-supported languages are
   hard-rejected — the error message names the right symbol tool.

4. **NO `edit_file` ON MARKDOWN.** Use `edit_markdown` (heading-addressed,
   atomic batch via `edits[]`).

5. **NO PIPING `run_command` OUTPUT.** Run the command bare, then query the
   `@cmd_*` buffer in a follow-up: `cargo test` → `grep FAILED @cmd_abc`.
   Never `cargo test 2>&1 | grep FAILED`. The buffer system exists to save
   context — use it.

6. **ALWAYS RESTORE THE ACTIVE PROJECT.** After
   `workspace(action="activate", path=foreign)` to a foreign project, call
   `workspace(action="activate", path=home)` before finishing. Forgetting
   silently breaks all subsequent tool calls.

## Bad Pattern Categories

### 1. LSP Corruption Risk
- Using `edit_file` to modify function/class/struct bodies instead of `edit_code`
- Multiple rapid `edit_file` calls on the same source file (line ranges stale)
- Editing symbol bodies without re-reading after prior edits

### 2. Parallel Write Hazard
- Dispatching 2+ write tools (`edit_file`, `edit_code`, `create_file`,
  `edit_markdown`) in the same second (parallel dispatch)
- Write tools must be serialized — one at a time

### 3. Buffer Reference Waste
- Running `run_command` → getting a `@cmd_*` buffer handle → then ignoring it
- Re-running the same command instead of querying the stored buffer
- Piping output through grep/awk/sed instead of using buffer queries

### 4. Index Staleness
- Calling `semantic_search` or `symbols(name=...)` after heavy file mutations
  without checking `index(action="status")` or running `index(action="build")`
- Trusting search results when the index is known stale

### 5. Project Activation Hygiene
- Activating a foreign project without ever restoring home
- Multiple foreign activations without intermediate restores
- Ending a session with a foreign project still active

### 6. Wrong-Tool-for-Markdown
- `read_file` on a `.md` path (hard-rejected, wastes the call)
- `edit_file` on a `.md` path when `edit_markdown` would target the heading
- Reading whole markdown when a single heading section was needed

## Tool Categories — Correct Usage

### Navigation (read-only)
| Tool | When to use |
|------|-------------|
| `symbols(path)` | Overview of all symbols in a file/dir — do this first |
| `symbols(name=...)` | Search by name; add `include_body=true` for the body |
| `symbol_at(path, line)` | LSP definition + hover at a position |
| `references(symbol, path)` | All call/use sites of a symbol |
| `call_graph(symbol, path)` | Transitive callers or callees |
| `tree(path)` | Directory listing |
| `tree(path, glob=...)` | Find files by pattern |
| `grep(pattern, path)` | Regex search across files |
| `semantic_search(query)` | Concept-level search when name unknown |
| `read_file(path)` | Read NON-source NON-markdown files (toml, json, env) |
| `read_markdown(path)` | Read `.md` files (heading-aware, slice-able) |

### Mutation (write)
| Tool | When to use |
|------|-------------|
| `edit_code(symbol, path, action="replace", body=...)` | Replace a body |
| `edit_code(action="insert", position="before"\|"after", body=...)` | Inject |
| `edit_code(action="remove")` | Delete a symbol |
| `edit_code(action="rename", new_name=...)` | Rename project-wide via LSP |
| `edit_file(path, old_string, new_string)` | Imports, literals, comments, config |
| `edit_markdown(path, heading, action=...)` | Heading-addressed `.md` edits |
| `create_file(path, content)` | New files |

### Infrastructure
| Tool | When to use |
|------|-------------|
| `run_command(command)` | Shell — build, test, lint |
| `workspace(action="activate", path=...)` | Switch project context |
| `workspace(action="status")` | Check project state |
| `index(action="build")` | Rebuild embeddings index |
| `index(action="status")` | Check index freshness / drift |
| `onboarding()` | Generate project system prompt |
| `memory(action="read"\|"write"\|"remember"\|"recall")` | Project memory |
| `librarian(action="context"\|"reindex")` | Cross-doc artifact lookup |
| `artifact(action="find"\|"get"\|"create"\|"update")` | Spec/plan/ADR CRUD |

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
