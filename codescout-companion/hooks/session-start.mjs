// SessionStart hook — inject codescout tool guidance into the main agent.
// Port of session-start.sh. No-op if codescout is not configured. Composes one
// additionalContext message from: project-bootstrap nudge (startup only),
// onboarding/memory hints, skills, tracker-hygiene nudge, auto-reindex (bg),
// drift warnings (legacy sqlite; inert post-Qdrant), connectivity note,
// post-compact flush, worktree reminder + symlink, Iron Laws, tool guide.
// Also seeds/sweeps the codescout-active marker and writes cc_session_id.
import {
  existsSync, statSync, lstatSync, readFileSync, readdirSync,
  mkdirSync, writeFileSync, unlinkSync, symlinkSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { spawn } from 'node:child_process';
import { readInput, detectFor, git, emit } from './lib.mjs';

const input = readInput();
if (!input) process.exit(0);

const cwd = input.cwd || '';
const source = input.source || '';
const sessionId = input.session_id || '';

const d = detectFor(cwd);
if (d.HAS_CODESCOUT === 'false') process.exit(0);

const csProjectDir = d.CS_PROJECT_DIR;

// Write CC session id for usage.db correlation.
if (sessionId && csProjectDir) {
  try {
    mkdirSync(csProjectDir, { recursive: true });
    writeFileSync(join(csProjectDir, 'cc_session_id'), sessionId);
  } catch {
    /* best-effort */
  }
}

// Worktree detection (git-common-dir != git-dir).
let inWorktree = false;
if (cwd && git(cwd, ['rev-parse', '--is-inside-work-tree']) !== null) {
  const gitCommon = git(cwd, ['rev-parse', '--git-common-dir']);
  const gitDir = git(cwd, ['rev-parse', '--git-dir']);
  if (gitCommon !== null && gitCommon !== gitDir) inWorktree = true;
}

const home = process.env.HOME || process.env.USERPROFILE || homedir();
const csActiveDir = join(process.env.CLAUDE_CONFIG_DIR || join(home, '.claude'), 'codescout-active');

// Seed the codescout-active marker only when resumed inside a worktree.
if (inWorktree && sessionId) {
  const wtRoot = git(cwd, ['rev-parse', '--show-toplevel']);
  if (wtRoot) {
    try {
      mkdirSync(csActiveDir, { recursive: true });
      writeFileSync(join(csActiveDir, sessionId), wtRoot);
    } catch {
      /* best-effort */
    }
  }
}
// Sweep markers older than 7 days.
if (existsSync(csActiveDir)) {
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  try {
    for (const name of readdirSync(csActiveDir)) {
      const p = join(csActiveDir, name);
      try {
        const st = statSync(p);
        if (st.isFile() && st.mtimeMs < cutoff) unlinkSync(p);
      } catch {
        /* skip */
      }
    }
  } catch {
    /* best-effort */
  }
}

let msg = '';

// Project bootstrap nudge — startup only (skipped in worktrees + on resume/compact).
if (!inWorktree && source === 'startup' && cwd) {
  msg += `PROJECT BOOTSTRAP: As your FIRST codescout action, call
workspace(action="activate", path="${cwd}") (the activate_project tool) to
bootstrap this project — it prewarms LSP, auto-registers dependencies, and
returns project_hints (primary language, entry points, build commands).

`;
}

// Onboarding check.
if (d.HAS_CS_ONBOARDING === 'false') {
  msg += `codescout: Project not yet onboarded.
Run the onboarding() tool first — it detects languages, creates project config,
and generates exploration memories that help every subsequent session.

`;
}

// Memory hint.
if (d.HAS_CS_MEMORIES === 'true') {
  msg += `codescout MEMORIES: ${d.CS_MEMORY_NAMES}
→ Read relevant memories before exploring code (memory(action="read", topic="architecture"), etc.)

`;
}

// Skills.
msg += `SKILLS AVAILABLE:
- Reconnaissance — Skill('codescout-companion:reconnaissance'). Recommended before subagent dispatch or shape-changing edits.

`;

// Tracker-hygiene overdue nudge (ISO date; due-today counts; local date to match `date +%F`).
const hygieneLog = join(cwd, 'docs', 'trackers', 'tracker-hygiene-log.md');
if (existsSync(hygieneLog)) {
  try {
    const m = readFileSync(hygieneLog, 'utf8').match(/^next-sweep-due:[ \t]*(.+?)[ \t]*$/m);
    const due = m ? m[1] : '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(due)) {
      const now = new Date();
      const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      if (due <= today) {
        msg += `TRACKER HYGIENE: sweep overdue (due ${due}) — run /codescout-companion:tracker-hygiene

`;
      }
    }
  } catch {
    /* silent on read/parse error */
  }
}

// recon-loaded marker (feeds buddy [recon] badge).
if (sessionId && cwd) {
  try {
    mkdirSync(join(cwd, '.buddy', sessionId), { recursive: true });
    writeFileSync(join(cwd, '.buddy', sessionId, 'recon-loaded'), '');
  } catch {
    /* best-effort */
  }
}

// Auto-reindex config.
let autoIndex = true;
let driftWarnings = true;
if (d.ROUTING_CONFIG && existsSync(d.ROUTING_CONFIG)) {
  try {
    const rc = JSON.parse(readFileSync(d.ROUTING_CONFIG, 'utf8'));
    if (rc.auto_index === false) autoIndex = false;
    if (rc.drift_warnings === false) driftWarnings = false;
  } catch {
    /* keep defaults */
  }
}

const indexState = join(csProjectDir, 'index-state.json');
const dbPath = join(csProjectDir, 'embeddings.db');

// Auto-reindex if HEAD moved since last index (background; unref'd).
if (autoIndex && !inWorktree && existsSync(indexState) && d.CS_BINARY) {
  let csBinOk = false;
  try {
    csBinOk = statSync(d.CS_BINARY).isFile();
  } catch {
    /* absent */
  }
  if (csBinOk) {
    let lastCommit = '';
    try {
      lastCommit = JSON.parse(readFileSync(indexState, 'utf8')).last_indexed_commit || '';
    } catch {
      /* none */
    }
    const headCommit = git(cwd, ['rev-parse', 'HEAD']);
    if (lastCommit && headCommit && lastCommit !== headCommit) {
      const behind = git(cwd, ['rev-list', '--count', `${lastCommit}..${headCommit}`]) || '?';
      try {
        spawn(d.CS_BINARY, ['index', '--project', cwd], { detached: true, stdio: 'ignore' }).unref();
      } catch {
        /* best-effort */
      }
      msg += `INDEX: Refreshing in background (${behind} commits behind HEAD) — semantic_search works now, results improve as index updates.

`;
    }
  }
}

// Drift warnings (legacy sqlite-vec surface; inert post-Qdrant — embeddings.db no longer exists).
if (driftWarnings && existsSync(dbPath)) {
  let driftEnabled = false;
  try {
    driftEnabled = readFileSync(d.CS_CONFIG_FILE, 'utf8').includes('drift_detection_enabled = true');
  } catch {
    /* absent */
  }
  if (driftEnabled) {
    let driftFiles = [];
    try {
      const { DatabaseSync } = await import('node:sqlite');
      const db = new DatabaseSync(dbPath, { readOnly: true });
      const rows = db
        .prepare('SELECT file_path, max_drift FROM drift_report WHERE max_drift > 0.1 ORDER BY max_drift DESC LIMIT 10')
        .all();
      db.close();
      driftFiles = rows.map((r) => `${r.file_path} (drift: ${Number(r.max_drift).toFixed(2)})`);
    } catch {
      driftFiles = [];
    }
    if (driftFiles.length) {
      msg += `DRIFT WARNING: These files changed significantly since last index:
${driftFiles.map((f) => `  ${f}`).join('\n')}
`;
      if (driftFiles.some((f) => f.startsWith('src/tools/'))) {
        msg += `→ Check if docs/ still matches the tools described.
`;
      }
      if (driftFiles.some((f) => f.startsWith('src/'))) {
        msg += `→ Check if CLAUDE.md and README.md still match these changes.
`;
      }
      let memNames = '';
      try {
        memNames = readdirSync(d.CS_MEMORIES_DIR).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3)).join(' ');
      } catch {
        /* none */
      }
      if (memNames) {
        msg += `→ Memories may need updating: ${memNames}

`;
      }
    }
  }
}

// Connectivity note.
msg += `codescout: Detected in config (${d.CS_SERVER_NAME}).
Tools load automatically — no ToolSearch or setup step needed.
If tools are unavailable, the MCP server failed to connect (check \`claude mcp list\`).

`;

// Post-compact LSP flush.
if (source === 'compact') {
  msg += `POST-COMPACT: Context was just compacted.
→ Call workspace(post_compact=true) as your FIRST action to flush stale LSP position caches.
   LSP clients restart lazily — no disruption to the session.

`;
}

// Worktree reminder (resumed inside a worktree) + ensure .codescout symlink.
if (inWorktree) {
  const wtRoot = git(cwd, ['rev-parse', '--show-toplevel']) || cwd;
  const mainGit = git(cwd, ['rev-parse', '--git-common-dir']);
  const mainRoot = mainGit ? dirname(mainGit) : '';
  if (mainRoot && mainRoot !== '.') {
    const ceDest = join(wtRoot, '.codescout');
    if (!existsSync(ceDest)) {
      try {
        mkdirSync(join(mainRoot, '.codescout'), { recursive: true });
        symlinkSync(join(mainRoot, '.codescout'), ceDest, 'junction');
      } catch {
        /* best-effort */
      }
    }
    let dstStat;
    try {
      dstStat = lstatSync(ceDest);
    } catch {
      /* absent */
    }
    if (dstStat && dstStat.isDirectory() && !dstStat.isSymbolicLink()) {
      for (const asset of ['embeddings']) {
        const src = join(mainRoot, '.codescout', asset);
        const dst = join(ceDest, asset);
        if (!existsSync(src)) continue;
        let dstExists = false;
        try {
          lstatSync(dst);
          dstExists = true;
        } catch {
          /* absent */
        }
        if (dstExists) continue;
        try {
          symlinkSync(src, dst, 'junction');
        } catch {
          /* best-effort */
        }
      }
    }
  }
  msg += `WORKTREE SESSION: You are inside a git worktree at: ${wtRoot}
→ Call workspace(action="activate", path="${wtRoot}") before using any codescout write tools.
→ Memory writes go directly to the main project via symlink and can be committed there.

`;
}

// Iron Laws reminder.
msg += `CODESCOUT RULES (compression-resilient reminder):
• Source code: symbols (list + find), NOT read_file/Read
• Code edits: edit_code (LSP-aware; action=replace/insert/remove/rename), NOT edit_file/Edit for structural changes
• Shell commands: run_command, NOT Bash — output buffers save tokens
• Markdown: read_markdown/edit_markdown, NOT read_file/edit_file
• Never pipe unbounded run_command output — run bare, query @cmd_* buffer (bounded LHS like ls, cat, awk, sed, find -maxdepth N is OK)

`;

// Tool guide.
msg += `NEVER USE BASH AGENTS FOR CODE WORK.
Bash agents have no codescout tools. Use general-purpose, Plan, or Explore
agents for any task involving code reading, writing, or navigation.`;

emit({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: msg } });
process.exit(0);
