// PreToolUse hook — enforcer for codescout tool routing. Port of pre-tool-guard.sh.
// Blocks native Bash/Grep/Glob/Read/Edit/Write in favour of codescout tools via
// permissionDecision:deny + a guidance reason. Exemptions: binary images/PDF,
// skill payloads, harness tool-results, and CC config dirs (read-side only).
import { statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { readInput, detectFor, denyPreToolUse } from './lib.mjs';
import { SOURCE_EXT_PATTERN } from './detect.mjs';

const SOURCE_RE = new RegExp(SOURCE_EXT_PATTERN, 'i');

const input = readInput();
if (!input) process.exit(0);

const toolName = input.tool_name || '';
const cwd = input.cwd || '';

const d = detectFor(cwd);
if (d.HAS_CODESCOUT === 'false') process.exit(0);
if (d.BLOCK_READS === 'false') process.exit(0);

// --- Exemption helpers ---
const isBinaryImage = (p) => /\.(png|jpg|jpeg|gif|webp|bmp|ico|pdf)$/i.test(p);

function isSkillPayload(p) {
  if (/\/plugins\/cache\//.test(p)) return true; // installed plugin payloads, any profile
  if (/\/\.buddy\//.test(p)) return true; // buddy global + project trees
  return /(^|\/)skills\/[^/]+\/(SKILL\.md|_[^/]+\.md|references\/[^/]+)$/.test(p);
}

const isHarnessOutput = (p) => /\/tool-results\//.test(p);

function isConfigDir(p) {
  const home = process.env.HOME || process.env.USERPROFILE || homedir();
  if (p.startsWith(`${home}/.claude/`) || p.startsWith(`${home}/.claude-`)) return true;
  const ccd = process.env.CLAUDE_CONFIG_DIR;
  if (ccd && p.startsWith(`${ccd}/`)) return true;
  return false;
}

// Relative path when under CWD; absolute (cross-repo) otherwise.
const rel = (p) => (cwd && p.startsWith(`${cwd}/`) ? p.slice(cwd.length + 1) : p);

// --- Hard block with reason. First block in a 3s window per (tool,cwd) gets the
// full reason; parallel/repeat calls within the window get a short pointer.
// Window tracked by a temp-file mtime (cross-platform; no backgrounded cleanup).
function enforce(reason) {
  const key = createHash('md5').update(`${toolName}\t${cwd}`).digest('hex').slice(0, 8);
  const dedupFile = join(tmpdir(), `cs-block-${key}`);
  let recent = false;
  try {
    if (Date.now() - statSync(dedupFile).mtimeMs < 3000) recent = true;
  } catch {
    /* no prior file */
  }
  if (recent) {
    denyPreToolUse('BLOCKED (see previous message)');
    process.exit(0);
  }
  try {
    writeFileSync(dedupFile, '');
  } catch {
    /* best-effort */
  }
  denyPreToolUse(reason);
  process.exit(0);
}

if (toolName === 'Bash') {
  const cmd = (input.tool_input && input.tool_input.command) || '';
  let hint;
  if (/^(grep|rg) /.test(cmd)) {
    hint = `  grep(pattern="PATTERN")              — indexed regex, structured results
  symbols(query="NAME")                  — locate symbol by name (much faster)
  semantic_search(query="CONCEPT")       — find code by meaning, not just text`;
  } else if (/^cat .*\.(rs|ts|tsx|js|jsx|py|go|kt|kts|java|cs|rb|swift|cpp|c|h|hpp|sh|bash)/.test(cmd)) {
    const m = cmd.match(/[^ ]+\.(rs|ts|tsx|js|jsx|py|go|kt|kts|java|cs|rb|swift|cpp|c|h|hpp|sh|bash)/);
    const relSrc = rel(m ? m[0] : '');
    hint = `  symbols(path="${relSrc}")             — ALL symbols + line numbers in ~50 tokens (DO THIS FIRST)
  symbols(name=NAME, include_body=true)  — read one specific symbol body`;
  } else if (/^find /.test(cmd)) {
    hint = `  tree(glob="*.pattern")                 — indexed file discovery, instant
  symbols(query="NAME")                  — locate a symbol by name across all files`;
  } else {
    hint = `  run_command(command="${cmd}")          — same command with smart summaries + @ref buffers`;
  }
  enforce(`This call is blocked because codescout offers a leaner path for shell work.

Command: ${cmd}

Suggested codescout tools:
${hint}

For any other shell command: run_command(command="COMMAND") — same execution, with:
- Large output stored in @cmd_* buffers (saves context tokens)
- Buffers queryable: grep PATTERN @cmd_id, tail -20 @cmd_id
- Smart summaries returned inline

Cross-repo: run_command sandboxes cwd to the project. For a sibling repo's git,
use run_command(command="git -C /abs/path <subcommand>") from here — no cd needed.`);
}

if (toolName === 'Grep') {
  const pathVal = (input.tool_input && input.tool_input.path) || '';
  const pattern = (input.tool_input && input.tool_input.pattern) || '';
  if (isConfigDir(pathVal)) process.exit(0);

  let cargoHint = '';
  if (/\.cargo\/registry/.test(pathVal)) {
    const crateDir = (pathVal.match(/.*\.cargo\/registry\/src\/[^/]+\/[^/]+/) || [''])[0];
    let crateName = crateDir ? crateDir.split('/').pop().replace(/-[0-9][0-9.]*$/, '') : '';
    if (!crateName) crateName = pathVal.split('/').pop();
    cargoHint = `
NOTE: This path is inside ~/.cargo/registry — for crate '${crateName}'.
Once the crate is registered, codescout can search it via scope:

  symbols(query="${pattern}", scope="lib:${crateName}")   — search only within this crate
  symbols(scope="lib:${crateName}")                         — browse crate symbols
`;
  }
  enforce(`This call is blocked because codescout has a pre-built index for source files.
${cargoHint}
Native Grep scans files line-by-line and dumps raw matches into context.
codescout uses the index and returns structured, token-efficient results:

  grep(pattern="${pattern}")              — regex search, returns matching lines with optional context_lines
  symbols(query="${pattern}")             — locate symbol by name (faster than text search)
  semantic_search(query="${pattern}")     — concept-level search when the name is unknown`);
}

if (toolName === 'Glob') {
  const pattern = (input.tool_input && input.tool_input.pattern) || '';
  if (isConfigDir(pattern)) process.exit(0);
  const basename = pattern.split('/').pop();
  const stem = basename.replace(/\.[^.]*$/, '');
  enforce(`This call is blocked because codescout has an indexed file lister.

codescout already knows every file in the project. Use the index directly:

  tree(glob="${pattern}")         — glob-style file discovery via codescout index
  symbols(query="${stem}") — find a symbol by name if you know what you are after`);
}

if (toolName === 'Read') {
  const filePath = (input.tool_input && input.tool_input.file_path) || '';
  if (isBinaryImage(filePath)) process.exit(0);
  if (isSkillPayload(filePath)) process.exit(0);
  if (isHarnessOutput(filePath)) process.exit(0);
  if (isConfigDir(filePath)) process.exit(0);

  const relPath = rel(filePath);

  if (/\.md$/i.test(filePath)) {
    enforce(`This call is blocked because codescout has heading-aware markdown reading.

File: ${filePath}

Reading a full markdown file dumps everything into context. read_markdown is size-adaptive (full content for small files, heading map + slice recipe for large):

  read_markdown(path="${relPath}")                            — adaptive output (start here)
  read_markdown(path="${relPath}", heading="## Section")     — one section
  read_markdown(path="${relPath}", headings=["## A", "## B"]) — multiple sections
  grep(pattern="pattern", path="${relPath}")                 — content search

read_markdown works on absolute cross-repo paths too. Native Read of markdown is blocked regardless of which repo the file lives in.`);
  }

  if (SOURCE_RE.test(filePath)) {
    let cargoHint = '';
    if (/\.cargo\/registry/.test(filePath)) {
      const crateDir = (filePath.match(/.*\.cargo\/registry\/src\/[^/]+\/[^/]+/) || [''])[0];
      const crateName = crateDir ? crateDir.split('/').pop().replace(/-[0-9][0-9.]*$/, '') : '';
      if (crateName && crateDir) {
        cargoHint = `
NOTE: This file is from crate '${crateName}' in ~/.cargo/registry.
If the crate is registered, codescout symbol tools work via scope:

  symbols(scope="lib:${crateName}")                       — browse all symbols
  symbols(query="SYMBOL", scope="lib:${crateName}")      — find a specific symbol
  symbol_at(path=PATH, line=LINE)                            — jump to definition from usage site
`;
      }
    }
    enforce(`This call is blocked because codescout has a faster path for source files.

File: ${filePath}
${cargoHint}
Reading a full source file costs thousands of tokens. codescout returns just what you need:

  symbols(path="${relPath}")                       — overview + line numbers (~50 tokens)
  symbols(name=NAME, include_body=true)              — one symbol body, targeted
  read_file(path="${relPath}", start_line=N, end_line=M) — only when symbol tools cannot reach it

Suggested flow: symbols first → symbols(name=NAME, include_body=true) for specific code → read_file with an explicit range only as last resort.`);
  }

  let structHint = '';
  if (/\.json$/i.test(filePath)) {
    structHint = `
  read_file(path="${relPath}", json_path="$.key")    — extract a JSON subtree`;
  } else if (/\.(toml|ya?ml)$/i.test(filePath)) {
    structHint = `
  read_file(path="${relPath}", toml_key="section")     — extract a TOML/YAML section`;
  }
  enforce(`This call is blocked because codescout reads files through its tracked, buffer-aware reader.

File: ${filePath}

  read_file(path="${relPath}")                  — full content; large output stored as an @file_* buffer${structHint}

read_file works on absolute cross-repo paths. Exempt from this block: binary images/PDF (codescout has no renderer), skill payloads (SKILL.md / lens addenda / references, plugin cache, .buddy trees — verbatim fidelity required), and CC harness persisted output (tool-results/ — over-cap hook/tool payloads read back).`);
}

if (toolName === 'Edit') {
  const filePath = (input.tool_input && input.tool_input.file_path) || '';
  if (isBinaryImage(filePath)) process.exit(0);
  enforce(`This call is blocked because codescout's edit_code is the safer path for structural source edits.

File: ${filePath}

The native Edit tool bypasses codescout's LSP awareness and safety gates.
codescout offers structural, LSP-backed editing via edit_code:

  edit_code(symbol=NAME, path=PATH, action="replace", body=...)                       — replace a function/struct/class body
  edit_code(symbol=NAME, path=PATH, action="insert", position="before"|"after", body=...) — inject near a symbol
  edit_code(symbol=NAME, path=PATH, action="remove")                                  — delete a symbol
  edit_code(symbol=NAME, path=PATH, action="rename", new_name=...)                    — project-wide rename via LSP
  edit_file(path=PATH, old_string=OLD, new_string=NEW)                                 — imports, literals, comments, config (not structural code)

Suggested flow: symbols(name=NAME, include_body=true) to inspect the current body → edit_code to change it.`);
}

if (toolName === 'Write') {
  const filePath = (input.tool_input && input.tool_input.file_path) || '';
  if (isBinaryImage(filePath)) process.exit(0);
  enforce(`This call is blocked because codescout's create_file is the tracked path for new source files.

File: ${filePath}

The native Write tool bypasses codescout's safety gates and file tracking.
codescout alternatives:

  create_file(path=PATH, content=CONTENT)                                            — create or overwrite (tracked by codescout)
  edit_code(symbol=NAME, path=PATH, action="replace", body=...)                       — replace an existing symbol body via LSP
  edit_code(symbol=NAME, path=PATH, action="insert", position=..., body=...)          — insert code near a symbol`);
}

process.exit(0);
