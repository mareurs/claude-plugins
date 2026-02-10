#!/bin/bash
# SessionStart hook - semantic tool reminder + schema pre-loading
# Ensures Claude knows the right tools and loads their schemas upfront

echo "SEMANTIC TOOLS AVAILABLE:

Serena (all languages with LSP support):
  find_symbol / replace_symbol_body - Read/edit symbols by name
  get_symbols_overview - File structure overview
  search_for_pattern - Regex search (param: substring_pattern, NOT pattern)
  find_referencing_symbols - Find all usages

IntelliJ (all languages in project):
  ide_find_symbol - Find classes/functions by name
  ide_find_references - Find all usages
  ide_find_file - Find files by name
  ide_file_structure - File outline

Text search (non-source files only):
  Grep - Literal strings, regex, config/docs files

STARTUP TASK - Load tool schemas now:
1. ToolSearch(query='select:mcp__serena__find_symbol', max_results=1)
2. ToolSearch(query='select:mcp__serena__search_for_pattern', max_results=1)
3. ToolSearch(query='select:mcp__serena__get_symbols_overview', max_results=1)
4. ToolSearch(query='select:mcp__intellij-index__ide_find_symbol', max_results=1)
5. ToolSearch(query='select:mcp__intellij-index__ide_find_references', max_results=1)
6. ToolSearch(query='select:mcp__intellij-index__ide_find_file', max_results=1)

Execute these ToolSearch calls before responding to the user."
