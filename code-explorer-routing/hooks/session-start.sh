#!/bin/bash
# SessionStart hook — inject code-explorer tool guidance into main agent
# No-op if code-explorer is not configured for this project.

INPUT=$(cat)
CWD=$(echo "$INPUT" | jq -r '.cwd // empty')
source "$(dirname "$0")/detect-tools.sh"

[ "$HAS_CODE_EXPLORER" = "false" ] && exit 0

MSG=""

# --- Onboarding check ---
if [ "$HAS_CE_ONBOARDING" = "false" ]; then
  MSG="CODE-EXPLORER: Project not yet onboarded.
Run the onboarding() tool first — it detects languages, creates project config,
and generates exploration memories that help every subsequent session.

"
fi

# --- Memory hint ---
if [ "$HAS_CE_MEMORIES" = "true" ]; then
  MSG="${MSG}CODE-EXPLORER MEMORIES: ${CE_MEMORY_NAMES}
→ Read relevant memories before exploring code (read_memory(\"architecture\"), etc.)

"
fi

# --- Tool guide ---
MSG="${MSG}CODE-EXPLORER TOOL GUIDE

WHAT DO YOU KNOW?
  Nothing about this codebase  → onboarding() then semantic_search(\"describe concept\")
  A concept / behavior         → semantic_search(\"how is X implemented\")
  A symbol name                → find_symbol(pattern, relative_path)
                                    or get_symbols_overview(file)
  Need function list fast      → list_functions(file)   [offline tree-sitter, instant]
  Need docstrings / comments   → extract_docstrings(file) [offline tree-sitter]
  Need callers of a symbol     → find_referencing_symbols(name_path, relative_path)
  Need regex across files      → search_for_pattern(pattern, path)
  Need to find a file          → find_file(\"**/*.ext\")
  Need file history / blame    → git_log(file) or git_blame(file, start_line, end_line)

PROGRESSIVE DISCLOSURE — always start compact, drill down:
  BEFORE read_file              → get_symbols_overview(file) to see structure first
  To read one symbol            → find_symbol(pattern, include_body=true)
  read_file                     → ONLY with start_line + end_line (never whole file)
  list_dir(recursive=true)      → avoid — use find_file(\"**/*.ext\") for discovery

EXPLORATION WORKFLOW:
  1. ORIENT:    onboarding() or read_memory(\"architecture\")
  2. DISCOVER:  semantic_search(\"concept\") or find_file(\"**/*.ext\")
  3. STRUCTURE: get_symbols_overview(file) — see symbols before reading
  4. READ:      find_symbol(name, include_body=true) — targeted reads only
  5. NAVIGATE:  find_referencing_symbols(name_path, file) — trace callers/usages
  6. EDIT:      replace_symbol_body / insert_before_symbol / insert_after_symbol

TOOL QUICK REFERENCE:
  semantic_search(query)                          — find code by concept/meaning
  find_symbol(pattern, relative_path)             — find symbol by name (LSP)
  find_symbol(pattern, include_body=true)         — read symbol source
  get_symbols_overview(relative_path)             — all symbols in file/directory
  find_referencing_symbols(name_path, relative_path) — cross-file callers
  list_functions(path)                            — function list, offline, instant
  extract_docstrings(path)                        — doc comments, offline, instant
  search_for_pattern(pattern, path)               — regex across source files
  find_file(pattern)                              — glob file discovery
  read_file(path, start_line, end_line)           — targeted file section
  replace_symbol_body(name_path, relative_path, new_body) — edit symbol in place
  insert_before_symbol / insert_after_symbol      — add code at symbol boundaries
  git_log(path)                                   — commit history
  git_blame(path, start_line, end_line)           — line-level authorship
  git_diff()                                      — uncommitted changes
  write_memory(topic, content)                    — persist project knowledge
  read_memory(topic)                              — retrieve stored knowledge
  execute_shell_command(command)                  — run shell in project root

NEVER use Grep/Glob/Read for source code files — code-explorer tools are faster,
more token-efficient, and symbol-aware.
Grep/Glob/Read are fine for: .md, .yaml, .json, .toml, .env, config files.

NEVER USE BASH AGENTS FOR CODE WORK.
Bash agents have no code-explorer tools. Use general-purpose, Plan, or Explore
agents for any task involving code reading, writing, or navigation."

jq -n --arg ctx "$MSG" '{
  hookSpecificOutput: {
    hookEventName: "SessionStart",
    additionalContext: $ctx
  }
}'
