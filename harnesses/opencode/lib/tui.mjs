// Shared plumbing for the TUI parts in harnesses/opencode/tui/* (statusline, buddy,
// hint-echo). Measured on OpenCode 2.1.3 with a probe plugin in .opencode/plugins/<dir>/tui.js:
//
//  - A TUI plugin is `export default { id, setup(api) }`; setup gets {options, location, app,
//    renderer, client, data, attention, theme, themeMode, markdown, keymap, storage, ui}.
//  - `api.ui.slot({append: "<slot>", render})` draws into a named slot. render must return
//    host RENDERABLES. A bare string CRASHES THE WHOLE TUI ("Orphan text error: … must have
//    a <text> as a parent"), so every render here goes through textNode()/column().
//  - `import('@opentui/solid')` and `import('solid-js')` resolve to the HOST's own modules
//    (its runtime-plugin-support maps them), so createElement/insert/setProp and signals
//    work without a JSX build step. That is why these plugins are plain .js.
//  - `api.ui.toast` is an object: `api.ui.toast.show({title, message, variant, duration})`.
//
//  - install.sh links each TUI part as a DIRECTORY symlink (plugins/<plugin>-tui →
//    tui/<plugin>). One of the host's load stages ("stage=read") resolves a static
//    `import … from '../../lib/x.mjs'` against the SYMLINK's location, where ../../lib does
//    not exist, and logs "Cannot find module" on every reconciliation. So a tui.js has no
//    static import leaving its own directory: it resolves this lib/ from its REAL path and
//    loads it with a dynamic import inside setup():
//
//      const HERE = dirname(realpathSync(fileURLToPath(import.meta.url)));
//      const lib = (name) => import(pathToFileURL(join(HERE, '..', '..', 'lib', name)).href);
//
// Everything that does not touch the host lives in the pure functions below, so it can be
// unit-tested under plain node (tests/test-tui.mjs).

// --- pure helpers ------------------------------------------------------------------------

// The session a slot should describe: the slot's own `sessionID` prop when it has one
// (sidebar slots do), else the session the router is showing, else none (home screen).
export function currentSessionID(api, props) {
  if (props && typeof props.sessionID === 'string' && props.sessionID) return props.sessionID;
  try {
    const r = api?.ui?.router?.current?.();
    if (r?.type === 'session' && r.sessionID) return r.sessionID;
  } catch {
    /* no router */
  }
  return undefined;
}

// Root of a session family (a subagent's session points at its parent).
export function rootOf(api, sid) {
  if (!sid) return undefined;
  try {
    const r = api?.data?.session?.root?.(sid);
    if (r) return r;
  } catch {
    /* fall through */
  }
  return sid;
}

// Minimal ANSI SGR → [{text, fg?, bold?}] for one line. Covers what buddy's statusline and
// most shell statuslines emit: 30–37/90–97, 38;5;n (0–255), 38;2;r;g;b, 39/0 reset, 1/22
// bold. Anything else (cursor movement, private modes, OSC) is stripped, never rendered as
// garbage.
const BASIC = ['#000000', '#cd3131', '#0dbc79', '#e5e510', '#2472c8', '#bc3fbc', '#11a8cd', '#e5e5e5'];
const BRIGHT = ['#666666', '#f14c4c', '#23d18b', '#f5f543', '#3b8eea', '#d670d6', '#29b8db', '#ffffff'];
function xterm256(n) {
  if (n < 8) return BASIC[n];
  if (n < 16) return BRIGHT[n - 8];
  if (n < 232) {
    const i = n - 16;
    const v = (x) => (x === 0 ? 0 : 55 + x * 40);
    const hex = (x) => v(x).toString(16).padStart(2, '0');
    return `#${hex(Math.floor(i / 36))}${hex(Math.floor(i / 6) % 6)}${hex(i % 6)}`;
  }
  const g = (8 + (n - 232) * 10).toString(16).padStart(2, '0');
  return `#${g}${g}${g}`;
}
export function ansiToParts(line) {
  const parts = [];
  let fg;
  let bold = false;
  let buf = '';
  const flush = () => {
    if (buf) parts.push({ text: buf, ...(fg ? { fg } : {}), ...(bold ? { bold: true } : {}) });
    buf = '';
  };
  const s = String(line ?? '');
  // A CSI sequence is ESC [, parameter bytes 0x30–0x3F, intermediate bytes 0x20–0x2F, then one
  // final byte 0x40–0x7E (ECMA-48). Only digits and ';' with the final 'm' are SGR; a private
  // (`ESC[?25l`) or intermediate (`ESC[0 q`) sequence is dropped whole. Matching only [0-9;]
  // let the `\x1b.` branch eat just `ESC [`, and "?25l" and "0 q" were printed.
  // eslint-disable-next-line no-control-regex
  const re = /\x1b\[([0-?]*)([ -/]*)([@-~])|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b./g;
  let last = 0;
  let m;
  while ((m = re.exec(s))) {
    buf += s.slice(last, m.index);
    last = re.lastIndex;
    if (m[3] !== 'm' || m[2] || !/^[0-9;]*$/.test(m[1])) continue; // not SGR: drop it
    flush();
    const codes = (m[1] === '' ? '0' : m[1]).split(';').map((x) => Number(x || 0));
    for (let i = 0; i < codes.length; i++) {
      const c = codes[i];
      if (c === 0) {
        fg = undefined;
        bold = false;
      } else if (c === 1) bold = true;
      else if (c === 22) bold = false;
      else if (c === 39) fg = undefined;
      else if (c >= 30 && c <= 37) fg = BASIC[c - 30];
      else if (c >= 90 && c <= 97) fg = BRIGHT[c - 90];
      else if (c === 38 && codes[i + 1] === 5) {
        const n = codes[i + 2];
        if (Number.isInteger(n) && n >= 0 && n <= 255) fg = xterm256(n); // else not a colour: ignored
        i += 2;
      } else if (c === 38 && codes[i + 1] === 2) {
        const [r, g, b] = [codes[i + 2], codes[i + 3], codes[i + 4]].map((x) => Math.max(0, Math.min(255, x || 0)));
        fg = `#${[r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('')}`;
        i += 4;
      } else if (c === 48 && (codes[i + 1] === 5 || codes[i + 1] === 2)) {
        i += codes[i + 1] === 5 ? 2 : 4; // background colours are ignored, not misread
      }
    }
  }
  buf += s.slice(last);
  flush();
  return parts;
}
export function stripAnsi(s) {
  return ansiToParts(s).map((p) => p.text).join('');
}

// --- host rendering ----------------------------------------------------------------------
// Loaded lazily: these imports only resolve inside the OpenCode TUI.
export async function loadHost() {
  const solid = await import('@opentui/solid');
  const sjs = await import('solid-js');
  const core = await loadCore();
  return { solid, sjs, core };
}

// A <text> whose children are coloured <span>s. `parts` may be an accessor (a function),
// in which case the content is reactive. `nowrap` keeps it on ONE row, cut at the edge
// (`wrapMode: "none"` + `truncate`, the host's own pattern): a footer row that wraps pushes
// the layout down a line (seen live: the statusline's duration fell onto a second row).
export function textNode(solid, parts, { nowrap = false } = {}) {
  const t = solid.createElement('text');
  if (nowrap) {
    solid.setProp(t, 'wrapMode', 'none');
    solid.setProp(t, 'truncate', true);
  }
  const build = (ps) =>
    (ps || []).map((p) => {
      const s = solid.createElement('span');
      if (p.fg) solid.setProp(s, 'fg', p.fg);
      if (p.bold) solid.setProp(s, 'attributes', 1);
      solid.insert(s, p.text);
      return s;
    });
  if (typeof parts === 'function') solid.insert(t, () => build(parts()));
  else solid.insert(t, build(parts));
  return t;
}

// @opentui/core from the host (for SyntaxStyle). null when unavailable.
export async function loadCore() {
  try {
    return await import('@opentui/core');
  } catch {
    return null;
  }
}

// The scope → style map a <markdown> element reads (scope names measured in the 2.1.3
// binary), coloured from the host theme's own `markdown` palette (RGBA objects).
export const MARKDOWN_SCOPES = {
  default: ['text'],
  'markup.heading': ['heading', { bold: true }],
  'markup.strong': ['strong', { bold: true }],
  'markup.bold': ['strong', { bold: true }],
  'markup.italic': ['emphasis', { italic: true }],
  'markup.raw': ['code'],
  'markup.raw.inline': ['code'],
  'markup.raw.block': ['codeBlock'],
  'markup.link': ['link', { underline: true }],
  'markup.link.url': ['link', { underline: true }],
  'markup.link.label': ['linkText'],
  'markup.list': ['listItem'],
  'markup.quote': ['blockQuote', { italic: true }],
};
export function markdownStyles(theme) {
  const md = theme?.markdown || {};
  const out = {};
  for (const [scope, [key, extra]] of Object.entries(MARKDOWN_SCOPES)) {
    out[scope] = { ...(md[key] ? { fg: md[key] } : {}), ...(extra || {}) };
  }
  return out;
}

// Rows the dialog's scroll area may take: the terminal height minus the dialog chrome and a
// margin (the host places the dialog below the top), never less than 5. A dialog without a cap ran off the bottom of the screen (seen live).
export function dialogBodyHeight(rows) {
  const r = Number(rows) || 24;
  return Math.max(5, r - 16);
}

// Show `markdown` in a dialog: rendered markdown (grid tables, theme colours) inside a
// scrollbox capped to the screen, scrolled with the arrow keys or the wheel, closed with esc.
// Built from the host's own pieces, the way its /btw answer dialog is (measured): a
// <scrollbox> with maxHeight holding a <markdown conceal internalBlockMode="top-level">.
export function markdownDialog(api, host, { title, markdown }) {
  const { solid } = host;
  let style;
  try {
    // fromStyles throws without an owner: "SyntaxStyle requires an explicit resource owner:
    // pass renderer.nativeScene" (measured on 2.1.3). Without a style the markdown keeps its
    // raw markers (`##`, backticks), which is what the first version showed.
    const owner = api.renderer?.nativeScene;
    if (host.core?.SyntaxStyle?.fromStyles && owner) style = host.core.SyntaxStyle.fromStyles(markdownStyles(api.theme), owner);
  } catch {
    style = undefined;
  }
  const release = () => {
    if (!style) return;
    const st = style;
    style = undefined;
    // Plugin-owned OpenTUI resources are destroyed once the renderer is idle (host docs).
    Promise.resolve(api.renderer?.idle?.()).then(() => st.destroy?.()).catch(() => {});
  };
  try {
    api.ui.dialog.set?.({ size: 'large' });
  } catch {
    /* default size */
  }
  api.ui.dialog.show(() => {
    const root = solid.createElement('box');
    solid.setProp(root, 'flexDirection', 'column');
    solid.setProp(root, 'paddingLeft', 2);
    solid.setProp(root, 'paddingRight', 2);
    solid.setProp(root, 'paddingTop', 1);

    const head = solid.createElement('box');
    solid.setProp(head, 'flexDirection', 'row');
    solid.setProp(head, 'justifyContent', 'space-between');
    solid.setProp(head, 'height', 1);
    solid.insert(head, textNode(solid, [{ text: title, bold: true }]));
    solid.insert(head, textNode(solid, [{ text: '↑↓ scroll  esc', fg: '#7f848e' }]));
    solid.insert(root, head);

    const sb = solid.createElement('scrollbox');
    solid.setProp(sb, 'maxHeight', dialogBodyHeight(api.renderer?.height));
    solid.setProp(sb, 'contentOptions', { minHeight: 0 });
    solid.setProp(sb, 'paddingTop', 1);
    const md = solid.createElement('markdown');
    solid.setProp(md, 'conceal', true);
    solid.setProp(md, 'internalBlockMode', 'top-level');
    solid.setProp(md, 'tableOptions', { style: 'grid', cellPaddingX: 1 });
    if (style) solid.setProp(md, 'syntaxStyle', style);
    if (api.theme?.markdown?.text) solid.setProp(md, 'fg', api.theme.markdown.text);
    solid.setProp(md, 'content', markdown);
    solid.insert(sb, md);
    solid.insert(root, sb);

    // Keyboard scrolling: a FOCUSED scrollbox scrolls itself (arrows, PgUp/PgDn). A keymap
    // layer created inside the dialog never received the keys (measured: its handlers did
    // not fire), so the box is focused once it is mounted. esc is the dialog's own close.
    setTimeout(() => {
      try {
        sb.focus();
      } catch {
        /* mouse wheel still scrolls */
      }
    }, 0);
    return root;
  }, release);
}

// A column <box> with one <text> per line; `lines` (array of parts arrays) may be an
// accessor.
export function column(solid, lines) {
  const box = solid.createElement('box');
  solid.setProp(box, 'flexDirection', 'column');
  const build = (ls) => (ls || []).map((parts) => textNode(solid, parts));
  if (typeof lines === 'function') solid.insert(box, () => build(lines()));
  else solid.insert(box, build(lines));
  return box;
}
