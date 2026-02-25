#!/bin/bash
# SubagentStart hook — inject code-explorer guidance into all subagents
# Skips agents that don't do code work. Agent-type-aware verbosity.

INPUT=$(cat)
AGENT_TYPE=$(echo "$INPUT" | jq -r '.agent_type // empty')

# Skip agents that don't need code exploration guidance
case "$AGENT_TYPE" in
  Bash|statusline-setup|claude-code-guide)
    exit 0
    ;;
esac

CWD=$(echo "$INPUT" | jq -r '.cwd // empty')
source "$(dirname "$0")/detect-tools.sh"

[ "$HAS_CODE_EXPLORER" = "false" ] && exit 0

if [ "$AGENT_TYPE" = "Plan" ]; then
  # Rich guidance for Plan agents — they decide tool routing for the whole implementation
  CONTEXT="CODE-EXPLORER TOOL GUIDE (for planning implementation steps)

TOOL SELECTION:
  Don't know where to look  → semantic_search(\"describe concept or behavior\")
  Know symbol name          → find_symbol(pattern, relative_path)
  Need structure overview   → get_symbols_overview(relative_path)
  Need function list fast   → list_functions(path)   [offline, no LSP cold start]
  Need callers              → find_referencing_symbols(name_path, relative_path)
  Need regex search         → search_for_pattern(pattern, path)
  Need file discovery       → find_file(\"**/*.ext\")

FULL TOOL REFERENCE (use in plan steps):
  semantic_search(query)                              — find code by concept
  find_symbol(pattern, relative_path)                 — find/read symbol by name
  find_symbol(pattern, include_body=true)             — read full symbol source
  get_symbols_overview(relative_path, depth=1)        — symbols in file/directory
  find_referencing_symbols(name_path, relative_path)  — cross-file callers
  list_functions(path)                                — function list (offline)
  extract_docstrings(path)                            — doc comments (offline)
  search_for_pattern(pattern, path)                   — regex search
  find_file(pattern)                                  — glob discovery
  read_file(path, start_line, end_line)               — targeted file read
  replace_symbol_body(name_path, relative_path, new_body) — edit symbol
  insert_before_symbol(name_path, relative_path, code)    — prepend code
  insert_after_symbol(name_path, relative_path, code)     — append code
  rename_symbol(name_path, relative_path, new_name)       — rename everywhere
  git_log(path)  git_blame(path, start, end)  git_diff()  — history
  write_memory(topic, content) / read_memory(topic)       — project knowledge
  execute_shell_command(command)                           — shell in project root

WORKFLOW PATTERNS (embed these sequences in plan steps):

  Understand a module:
    1. get_symbols_overview(dir/)             → directory overview
    2. get_symbols_overview(file)             → file symbol tree
    3. find_symbol(ClassName, include_body)   → read key class

  Read before edit:
    1. get_symbols_overview(file)             → structure
    2. find_symbol(name, include_body=true)   → read current impl
    3. replace_symbol_body(name, file, body)  → edit in place

  Trace callers before refactoring:
    1. find_symbol(name, file)                → confirm location
    2. find_referencing_symbols(name, file)   → all usages
    3. replace_symbol_body or rename_symbol   → safe change

  Discover then drill:
    1. semantic_search(\"concept\")             → find relevant files
    2. get_symbols_overview(file)             → understand structure
    3. find_symbol(name, include_body=true)   → read specifics

PROGRESSIVE DISCLOSURE:
  Always get_symbols_overview BEFORE read_file.
  find_symbol(include_body=true) instead of read_file for symbols.
  read_file only with explicit start_line + end_line.
  Grep/Glob/Read only for non-code files (.md, .yaml, .json, .toml)."

else
  # Compact guidance for all other subagents
  CONTEXT="CODE-EXPLORER WORKFLOW:
  1. get_symbols_overview(file)                       — structure before reading
  2. find_symbol(pattern, include_body=true)           — read specific symbols
  3. find_referencing_symbols(name_path, file)         — trace callers
  4. search_for_pattern(regex, path)                   — regex across files
  5. semantic_search(\"concept\")                        — when name unknown
  6. list_functions(path)                              — fast offline function list

EDIT: replace_symbol_body / insert_before_symbol / insert_after_symbol
NEVER: Read/Grep/Glob for source code files.
NEVER: read_file without explicit start_line + end_line."
fi

jq -n --arg ctx "$CONTEXT" '{
  hookSpecificOutput: {
    hookEventName: "SubagentStart",
    additionalContext: $ctx
  }
}'
