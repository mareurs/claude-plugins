// statusline for OpenCode — TUI part. Port of statusline/bin/statusline.sh.
//
// Claude Code's statusline is a shell command fed one JSON blob per render. OpenCode v2
// has no such hook; it has TUI plugins that draw into named slots, so this is a native
// TUI plugin, not a bridge. It reads the same facts from OpenCode's own data API
// (measured on 2.1.3: a session record carries agent, model {id, providerID, variant},
// cost, tokens {input, output, reasoning, cache {read, write}} and time.created).
//
//   statusline.sh field   here
//   ───────────────────── ───────────────────────────────────────────────────────────────
//   model · effort        session model id · variant (the variant is OpenCode's effort)
//   agent                 the session's agent (build, plan, a subagent's name…)
//   context %             NOT drawn: the host already prints "23.4K (12%)" in this footer
//   rate limits           NOT available: Claude-subscription data with no OpenCode source
//   git                   branch, or worktree name + branch (git, every 5 s, async)
//   lines +/-             working-tree `git diff --shortstat HEAD` — NOT per-session as on
//                         Claude Code, which counts the session's own edits
//   cache                 cache write / read tokens in k
//   cost                  session cost in USD (hidden while 0, e.g. local models)
//   duration              since the session was created
//
// Drawn in `prompt.footer.status`, the row under the prompt (where the host draws its own
// context figure). Install: install.sh --plugins statusline.
import { execFile } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { basename, dirname, join } from 'node:path';

// No static import outside this directory: see lib/tui.mjs (symlinked plugin dirs).
const HERE = dirname(realpathSync(fileURLToPath(import.meta.url)));
const lib = (name) => import(pathToFileURL(join(HERE, '..', '..', 'lib', name)).href);

const C = {
  model: '#c678dd',
  agent: '#61afef',
  git: '#98c379',
  add: '#98c379',
  del: '#e06c75',
  dim: '#7f848e',
  cost: '#e5c07b',
};

export function fmtK(n) {
  const v = Number(n) || 0;
  if (v < 1000) return String(v);
  return `${(v / 1000).toFixed(v < 10000 ? 1 : 0)}k`;
}

export function fmtDuration(ms) {
  const s = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`;
}

// git `diff --shortstat` → {add, del}.
export function parseShortstat(text) {
  const t = String(text || '');
  const add = Number(t.match(/(\d+) insertions?\(\+\)/)?.[1] || 0);
  const del = Number(t.match(/(\d+) deletions?\(-\)/)?.[1] || 0);
  return { add, del };
}

// The segments, as [{text, fg}] — pure, so tests can pin the layout.
export function segments(session, git = {}, now = Date.now()) {
  const out = [];
  const sep = () => out.push({ text: ' │ ', fg: C.dim });
  if (!session) return out;
  const model = session.model || {};
  if (model.id) {
    const variant = model.variant && model.variant !== 'default' ? ` · ${model.variant}` : '';
    out.push({ text: `${model.id}${variant}`, fg: C.model });
  }
  if (session.agent) {
    if (out.length) sep();
    out.push({ text: session.agent, fg: C.agent });
  }
  if (git.branch) {
    if (out.length) sep();
    out.push({ text: git.worktree ? `${git.worktree}:${git.branch}` : git.branch, fg: C.git });
  }
  if (git.add || git.del) {
    if (out.length) sep();
    out.push({ text: `+${git.add || 0}`, fg: C.add });
    out.push({ text: ' ' });
    out.push({ text: `-${git.del || 0}`, fg: C.del });
  }
  const cache = session.tokens?.cache || {};
  if (cache.read || cache.write) {
    if (out.length) sep();
    out.push({ text: `cache ${fmtK(cache.write)}w/${fmtK(cache.read)}r`, fg: C.dim });
  }
  if (Number(session.cost) > 0) {
    if (out.length) sep();
    out.push({ text: `$${Number(session.cost).toFixed(2)}`, fg: C.cost });
  }
  const created = session.time?.created;
  if (created) {
    if (out.length) sep();
    out.push({ text: fmtDuration(now - created), fg: C.dim });
  }
  return out;
}

const git = (cwd, args) =>
  new Promise((res) => {
    execFile('git', ['-C', cwd, ...args], { timeout: 2000 }, (err, stdout) => res(err ? '' : String(stdout).trim()));
  });

export async function readGit(cwd) {
  if (!cwd) return {};
  const branch = await git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
  if (!branch) return {};
  // A linked worktree has its own git dir, apart from the repo's common dir; in a main
  // checkout the two are the same. Matching "/worktrees/" in --git-dir also flagged a main
  // checkout that lives under a directory named "worktrees". (--path-format needs git 2.31;
  // an older git fails the call, and the row shows the branch alone.)
  const [gitDir, commonDir] = (await git(cwd, ['rev-parse', '--path-format=absolute', '--git-dir', '--git-common-dir'])).split(/\r?\n/);
  const linked = Boolean(gitDir && commonDir && gitDir !== commonDir);
  const worktree = linked ? basename(await git(cwd, ['rev-parse', '--show-toplevel'])) : '';
  const { add, del } = parseShortstat(await git(cwd, ['diff', '--shortstat', 'HEAD']));
  return { branch, worktree, add, del };
}

export default {
  id: 'sdd-misc.statusline',
  async setup(api) {
    let host;
    let currentSessionID;
    let textNode;
    try {
      const t = await lib('tui.mjs');
      ({ currentSessionID, textNode } = t);
      host = await t.loadHost();
    } catch (e) {
      process.stderr.write(`statusline: host runtime unavailable — ${e?.message || e}\n`);
      return;
    }
    const { solid, sjs } = host;
    const [tick, setTick] = sjs.createSignal(0);
    const [gitInfo, setGitInfo] = sjs.createSignal({});
    const bump = () => setTick((n) => n + 1);

    const dirOf = (sid) => {
      try {
        return api.data.session.get(sid)?.location?.directory || api.location?.directory || process.cwd();
      } catch {
        return process.cwd();
      }
    };
    let gitBusy = false;
    const refreshGit = async () => {
      if (gitBusy) return;
      gitBusy = true;
      try {
        setGitInfo(await readGit(dirOf(currentSessionID(api))));
      } finally {
        gitBusy = false;
      }
    };

    const unlisten = api.data.listen?.(({ details } = {}) => {
      const t = details?.type || '';
      if (t.startsWith('session.usage') || t.startsWith('session.execution') || t === 'session.step.ended' || t === 'session.created') bump();
    });
    const clock = setInterval(bump, 1000);
    const gitTimer = setInterval(() => void refreshGit(), 5000);
    void refreshGit();

    api.ui.slot({
      append: 'prompt.footer.status',
      render: (props) =>
        textNode(solid, () => {
          tick();
          const sid = currentSessionID(api, props);
          let session;
          try {
            session = sid ? api.data.session.get(sid) : undefined;
          } catch {
            session = undefined;
          }
          return segments(session, gitInfo());
        }, { nowrap: true }),
    });

    return () => {
      clearInterval(clock);
      clearInterval(gitTimer);
      unlisten?.();
    };
  },
};
