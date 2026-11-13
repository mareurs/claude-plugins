// buddy for OpenCode — TUI part: the mood-reactive spirit animal, and /buddy-status and
// /buddy-legend answered without the model.
//
// SPIRIT ANIMAL. On Claude Code buddy's statusline is buddy/scripts/statusline.py, run as the
// statusline command with Claude Code's JSON on stdin. This plugin runs THE SAME script with
// the same JSON shape — session_id, cwd and workspace.current_dir, so it reads the
// `.buddy/<session_id>/state.json` that the server part (plugins/buddy.js) writes under the
// OpenCode session id — and draws its rows, ANSI colours translated, in the sidebar. The id is
// the session family's ROOT: the server part keeps state for top-level sessions only, so a
// subagent's view shows its parent's animal. Refresh: on session events (debounced) and every
// 3 s, because mood decays with time. One render at a time; a slow or failed run keeps the
// frame on screen instead of piling up or blanking it.
// context_window.used_percentage is not sent: OpenCode's session record has token counts but
// no context limit, and statusline.py treats a missing value as "unknown" (0), so the
// context-pressure mood signal does not fire on OpenCode.
//
// STATUS AND LEGEND. On OpenCode a command is a prompt, and a prompt sent to a busy session
// is delivered with `delivery: "steer"`: it interrupts the turn in progress. buddy's status
// and legend are read-only reports with no reasoning in them (both commands are
// `disable-model-invocation` on Claude Code), so they are TUI commands here: `/buddy-status`
// and `/buddy-legend` (also in the ctrl+p palette, group "Buddy") run report.py next to this
// file and show its text in a dialog. The model never sees them and the running turn is not
// touched. install.sh therefore does not install those two as model commands.
// Registration is the host's own pattern (measured in the 2.1.3 binary: /btw, /diff, /stats):
// `api.keymap.layer(() => ({mode: "global", commands: [{id, title, group, palette, slash,
// run}]}))` created inside an `app` slot whose render returns null.
import { existsSync, realpathSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';

// No static import outside this directory: see lib/tui.mjs (symlinked plugin dirs).
const HERE = dirname(realpathSync(fileURLToPath(import.meta.url)));
const lib = (name) => import(pathToFileURL(join(HERE, '..', '..', 'lib', name)).href);
export const BUDDY_ROOT = join(resolve(HERE, '..', '..', '..', '..'), 'buddy');
export const STATUSLINE = join(BUDDY_ROOT, 'scripts', 'statusline.py');
export const REPORT = join(HERE, 'report.py');
const WIDTH = 38; // the sidebar is ~40 columns; statusline.py wraps to COLUMNS
const PYTHONS = [['python3', []], ['python', []], ['py', ['-3']]]; // buddy/hooks/run.mjs's order

export function statuslineInput(sid, dir) {
  return { session_id: sid || '', cwd: dir, workspace: { current_dir: dir } };
}

export async function toLines(stdout) {
  const text = String(stdout || '').replace(/\s+$/, '');
  if (!text) return [];
  const { ansiToParts } = await lib('tui.mjs');
  return text.split(/\r?\n/).map(ansiToParts);
}

// Run a Python script with the first interpreter that RUNS it, the rule buddy/hooks/run.mjs
// follows: a candidate that cannot start, or that exits non-zero (the Windows Store
// `python3` alias stub starts, exits 9009 and runs nothing), passes to the next. A timeout
// does not: the script did start, and running it again under another name only doubled the
// wait. Resolves {code, stdout, stderr} (the last non-zero answer when none succeeded) or null.
async function runPython(script, args, { input = '', cwd, env = process.env, timeoutMs = 3000, run } = {}) {
  const exec = run ?? (await lib('host.mjs')).runProcess;
  let last = null;
  for (const [cmd, pre] of PYTHONS) {
    let failure;
    const onFail = (kind) => {
      failure = kind;
    };
    const res = await exec(cmd, [...pre, script, ...args], { input, cwd, env, timeoutMs, label: 'buddy-tui', onFail });
    if (res?.code === 0) return res;
    if (res) last = res;
    else if (failure === 'timeout') return null;
  }
  return last;
}

// The rows to draw, or null when this run drew nothing (no interpreter, a timeout, a non-zero
// exit): the caller keeps the frame it has. [] only when statusline.py itself is gone.
export async function renderBuddy(sid, dir, { run } = {}) {
  if (!existsSync(STATUSLINE)) return [];
  const res = await runPython(STATUSLINE, [], {
    input: JSON.stringify(statuslineInput(sid, dir)),
    cwd: dir,
    env: { ...process.env, COLUMNS: String(WIDTH) },
    run,
  });
  return res && res.code === 0 ? toLines(res.stdout) : null;
}

// The sidebar's refresh and session choice, apart from the host so they can be tested. The
// session is the one on screen, mapped to its family root (see the header): without that a
// subagent's view drew a default animal, and /buddy-status reported "state.json: missing …
// hooks are not firing" for a session the server part never keeps state for.
export function buddySidebar(api, { currentSessionID, rootOf, setLines, dirOf, render = renderBuddy }) {
  let busy = false;
  let lastSid;
  const sid = () => {
    const s = rootOf(api, currentSessionID(api)) ?? lastSid;
    if (s) lastSid = s;
    return s;
  };
  async function refresh() {
    if (busy) return;
    busy = true;
    try {
      const s = sid();
      const next = await render(s, dirOf(s));
      if (next) setLines(next); // null: this run drew nothing, keep the last frame
    } catch {
      /* keep the last frame */
    } finally {
      busy = false;
    }
  }
  return { refresh, sid };
}

// `kind` is "status" or "legend". Returns the report text (never throws).
export async function runReport(kind, sid, dir, { run } = {}) {
  if (!existsSync(REPORT)) return `buddy ${kind}: report.py is missing (${REPORT})`;
  const res = await runPython(REPORT, [kind, BUDDY_ROOT, dir, sid || ''], { cwd: dir, timeoutMs: 8000, run });
  if (!res) return `buddy ${kind}: no python3/python could run ${REPORT}`;
  const text = String(res.stdout || '').trim();
  return text || `buddy ${kind}: no output${res.stderr ? ` — ${res.stderr.trim().slice(0, 300)}` : ''}`;
}

// The two TUI commands, as data (tests pin the names: they must match what install.sh skips).
export const REPORT_COMMANDS = [
  { kind: 'status', id: 'buddy.status', slash: 'buddy-status', title: 'Buddy: status', description: 'Session state, identity, mood signals and hook health — without interrupting the session' },
  { kind: 'legend', id: 'buddy.legend', slash: 'buddy-legend', title: 'Buddy: legend', description: 'Active specialists, how to summon the builtin ones, and the moods — without interrupting the session' },
];

// The keymap layer the TUI registers: one global command per report, in the ctrl+p palette
// and as a TUI slash command. `show(c)` displays report `c`.
export function reportLayer(show) {
  return {
    mode: 'global',
    commands: REPORT_COMMANDS.map((c) => ({
      id: c.id,
      title: c.title,
      description: c.description,
      group: 'Buddy',
      palette: true,
      slash: { name: c.slash },
      run: () => void show(c),
    })),
  };
}

export default {
  id: 'sdd-misc.buddy',
  async setup(api) {
    let host;
    let column;
    let currentSessionID;
    let markdownDialog;
    let rootOf;
    try {
      const t = await lib('tui.mjs');
      ({ column, currentSessionID, markdownDialog, rootOf } = t);
      host = await t.loadHost();
    } catch (e) {
      process.stderr.write(`buddy-tui: host runtime unavailable — ${e?.message || e}\n`);
      return;
    }
    const { solid, sjs } = host;
    const [lines, setLines] = sjs.createSignal([]);

    const dirOf = (sid) => {
      try {
        return api.data.session.get(sid)?.location?.directory || api.location?.directory || process.cwd();
      } catch {
        return process.cwd();
      }
    };
    const sidebar = buddySidebar(api, { currentSessionID, rootOf, setLines, dirOf });
    const refresh = sidebar.refresh;

    let debounce;
    const soon = () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => void refresh(), 300);
    };
    const unlisten = api.data.listen?.(({ details } = {}) => {
      const t = details?.type || '';
      if (t.startsWith('session.execution') || t === 'session.step.ended' || t === 'session.created' || t.startsWith('session.tool')) soon();
    });
    const timer = setInterval(() => void refresh(), 3000);
    void refresh();

    api.ui.slot({ append: 'sidebar.content', render: () => column(solid, lines) });

    const showReport = async (c) => {
      const sid = sidebar.sid();
      const text = await runReport(c.kind, sid, dirOf(sid));
      try {
        // Rendered markdown in a scrollable, screen-capped dialog. A plain alert showed the
        // legend's raw markdown and ran off the bottom of the screen (seen live).
        markdownDialog(api, host, { title: c.title, markdown: text });
      } catch {
        try {
          api.ui.toast.show({ title: c.title, message: text.slice(0, 400), variant: 'info', duration: 10000 });
        } catch {
          /* no surface to show it on */
        }
      }
    };
    api.ui.slot({
      append: 'app',
      render: () => {
        api.keymap.layer(() => reportLayer(showReport));
        return null;
      },
    });

    return () => {
      clearInterval(timer);
      clearTimeout(debounce);
      unlisten?.();
    };
  },
};
