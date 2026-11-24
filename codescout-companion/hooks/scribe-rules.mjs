// Pure rules for the scribe nudge (scribe-nudge.mjs). No I/O, nothing read from the process.
//
// The nudge fires when the main agent starts to write to a box: a `codescout box` command whose
// verb changes a box. `boxWriteVerb` finds that verb. It looks only where the shell would run
// `codescout`: text inside quotes and the body of a heredoc are masked first, so
// `echo "codescout box bugs add"` and a heredoc that mentions a box call are not writes.
// door-shell-guard.mjs is the reference for the quote rules; it cannot be imported because it
// reads stdin when it loads.

export const WRITE_VERBS = ['add', 'now', 'edit', 'close', 'promote', 'end', 'supersede', 'reaffirm'];

export const SCRIBE_MESSAGE =
  'A scribe fork can file this tracker edit while you keep working: ' +
  'Agent(subagent_type="fork", prompt="Scribe: <what to file, which box>. Read get_guide(\'scribe\')."). ' +
  'For a one-line note, repeat this call: it passes.';

// Copies `s` with every quoted character and every heredoc body line replaced by `_`, so a
// later search for `codescout box` sees only text at an unquoted position. Quote characters and
// newlines stay, which keeps the structure and the length.
function mask(s) {
  const out = [];
  const pending = []; // heredoc delimiters that wait for the end of their line
  let inSingle = false;
  let inDouble = false;
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (inSingle) {
      if (c === "'") inSingle = false;
      out.push(c === "'" || c === '\n' ? c : '_');
      i += 1;
    } else if (inDouble) {
      if (c === '\\' && i + 1 < s.length) {
        out.push('__');
        i += 2;
        continue;
      }
      if (c === '"') inDouble = false;
      out.push(c === '"' || c === '\n' ? c : '_');
      i += 1;
    } else if (c === '\\') {
      out.push(c);
      if (i + 1 < s.length) out.push(s[i + 1]);
      i += 2;
    } else if (c === "'") {
      inSingle = true;
      out.push(c);
      i += 1;
    } else if (c === '"') {
      inDouble = true;
      out.push(c);
      i += 1;
    } else if (c === '<' && s[i + 1] === '<' && s[i + 2] !== '<') {
      const m = /^<<-?\s*(?:'([A-Za-z_]\w*)'|"([A-Za-z_]\w*)"|\\?([A-Za-z_]\w*))/.exec(s.slice(i));
      if (m) {
        pending.push(m[1] || m[2] || m[3]);
        out.push(m[0]);
        i += m[0].length;
      } else {
        out.push(c);
        i += 1;
      }
    } else if (c === '\n' && pending.length) {
      out.push(c);
      i += 1;
      for (const delim of pending.splice(0)) i = blankHeredocBody(s, i, delim, out);
    } else {
      out.push(c);
      i += 1;
    }
  }
  return out.join('');
}

// Blanks the body lines from `i` up to and including the delimiter line; returns the next index.
function blankHeredocBody(s, i, delim, out) {
  while (i < s.length) {
    const nl = s.indexOf('\n', i);
    const end = nl === -1 ? s.length : nl;
    const line = s.slice(i, end);
    out.push('_'.repeat(line.length));
    i = end;
    if (i < s.length) {
      out.push('\n');
      i += 1;
    }
    if (line.trim() === delim) break;
  }
  return i;
}

// `codescout box`, at a word start, with or without a path prefix on the binary.
const INVOCATION = /(?:^|[\s;&|(])(?:\S*\/)?codescout\s+box\b/g;

// The words after `codescout box`: box flags (`--project <dir>`, `--json`, `--help`) come first.
// The first other word is a verb of the root ledger, or a box key; after a key the next other
// word is the verb.
function verbOf(words) {
  const named = [];
  for (let i = 0; i < words.length && named.length < 2; i += 1) {
    if (words[i] === '--project') i += 1;
    else if (!words[i].startsWith('-')) named.push(words[i]);
  }
  if (WRITE_VERBS.includes(named[0])) return named[0];
  if (named.length === 2 && WRITE_VERBS.includes(named[1])) return named[1];
  return null;
}

// The first write verb of an unquoted `codescout box` call in `command`, else null.
export function boxWriteVerb(command) {
  if (typeof command !== 'string' || command === '') return null;
  const masked = mask(command);
  for (const m of masked.matchAll(INVOCATION)) {
    const simple = masked.slice(m.index + m[0].length).split(/[;&|\n)]/, 1)[0];
    const verb = verbOf(simple.split(/\s+/).filter(Boolean));
    if (verb) return verb;
  }
  return null;
}
