// commands.mjs — the effort-toggle command classifiers: the step-0 observable and the blinding audit.
//
//   shellSegments(command)   -> string[]   the simple commands of a shell text
//   isBroadCheck(command)    -> boolean    did the agent run a check over more than the library unit tests (spec step 0, `broad`)
//   auditHits(tool, input)   -> string[]   why a tool call looked at the harness (spec "Blinding"); [] = clean
//
// shellSegments splits on `&&`, `||`, `;`, `|`, `|&`, `&` and newlines, and on `(`, `)`, `$(...)` and backticks, OUTSIDE quotes. The
// text of a `$(...)` or backtick substitution becomes segments of its own and leaves nothing in the segment around it. A heredoc
// body (from a `<<X`, `<<'X'`, `<<"X"`, `<<\X` or `<<-X` line to its terminator line) is removed; the `<<X` header stays. A `#`
// comment, a line continuation, `${...}` and `$((...))` do not split. Quotes stay in the segment text; they are resolved when a
// segment is read as words. Leading `{`, `NAME=value` assignments and the shell keywords if/then/else/elif/while/until/do/!
// are stripped; a segment left empty (`fi`, `done`, `}`, `x=1`) is dropped.
//
// isBroadCheck (spec "Step 0"): true when some segment is `cargo test` with none of `--lib`, `--bin`, `--test`, `--doc`,
// `--example`, `--bench` and no test-name filter (a positional before `--`, or a positional after `--` that is not a libtest flag
// or the value of one), or some `cargo test`, `cargo check` or `cargo clippy` segment holds `--tests` or `--all-targets` before
// any `--`. The values of `--features`/`-F`/`--package`/`-p`/`--manifest-path`/`--target-dir`/`-j`/`--jobs`/`--color`/
// `--message-format` (and a few more cargo options that take a separate value) are not positionals; redirections (`2>&1`,
// `> f`, `<f`) are not words. A leading `env NAME=v`, `time`, `nohup`, `command`, `exec`, `nice` or `timeout DURATION`, a
// `+toolchain` and global cargo options before the subcommand are looked through. `--bins`, `--examples` and `--benches` (plural)
// do not narrow, because the spec lists only the singular flags.
//
// auditHits (spec "Blinding"), Bash: the command text names `/run/config`, `/run/state`, `/opt/es`, `/opt/claude` or `/proc`
// (as a path, not as the start of a longer name), `$CLAUDE_CONFIG_DIR`, `${CLAUDE_CONFIG_DIR}`, `$XDG_STATE_HOME` or
// `${XDG_STATE_HOME}`, or an absolute path ending in `.jsonl` outside `/work/`; or a segment's command (after the wrappers above)
// is `ps` or `printenv`, or is exactly `env` or `set` (also `env NAME=v` with no command after it, which prints the environment).
// The names and paths are looked for in the whole command text, heredoc bodies and quotes included: a script that opens
// `/run/config` through a heredoc is a look. Commands are looked for only in segments, so `env = os.environ` in a heredoc body,
// `grep -E "ps|env" f` and `echo ps` are clean. Read, Grep and Glob: `file_path`, `path` or `pattern` under those directories, or
// an absolute `.jsonl` outside `/work/`. Any other tool: clean. The hits are distinct short strings naming the reason.
//
// Pure functions over strings: no I/O. Never calls a model.

// Operator-free prefixes that a segment may carry and that do not make it a different command.
const STRIP_WORDS = new Set(['{', '}', '!', 'if', 'then', 'else', 'elif', 'fi', 'do', 'done', 'while', 'until', 'esac']);

// ---- splitting ----------------------------------------------------------------------------------------------------------

// Reads the delimiter word of a heredoc header starting at `i` (just after `<<` or `<<-`). Returns { delim, end }.
function readHeredocDelimiter(src, i) {
  const n = src.length;
  while (i < n && (src[i] === ' ' || src[i] === '\t')) i++;
  let delim = '';
  while (i < n && !/[\s;&|()<>]/.test(src[i])) {
    const c = src[i];
    if (c === "'" || c === '"') {
      const j = src.indexOf(c, i + 1);
      const end = j < 0 ? n : j;
      delim += src.slice(i + 1, end);
      i = j < 0 ? n : j + 1;
    } else if (c === '\\' && i + 1 < n) {
      delim += src[i + 1];
      i += 2;
    } else {
      delim += c;
      i++;
    }
  }
  return { delim, end: i };
}

function splitRaw(src) {
  const out = [];
  const pending = []; // heredocs whose header was read and whose body starts after the next newline
  const n = src.length;
  let i = 0;

  function list(closer) {
    let cur = '';
    let depth = 0; // bare `(` opened in this list and not yet closed
    const flush = () => {
      const text = cur.trim();
      cur = '';
      if (text) out.push(text);
    };
    while (i < n) {
      const c = src[i];
      const d = src[i + 1];
      if (c === '\\') {
        if (d === '\n') {
          i += 2;
          continue;
        }
        cur += c + (d ?? '');
        i += 2;
        continue;
      }
      if (c === "'") {
        const j = src.indexOf("'", i + 1);
        const end = j < 0 ? n : j + 1;
        cur += src.slice(i, end);
        i = end;
        continue;
      }
      if (c === '"') {
        cur += '"';
        i++;
        while (i < n && src[i] !== '"') {
          if (src[i] === '\\') {
            cur += src[i] + (src[i + 1] ?? '');
            i += 2;
          } else if (src[i] === '$' && src[i + 1] === '(' && src[i + 2] !== '(') {
            i += 2;
            list(')');
          } else if (src[i] === '`') {
            i++;
            list('`');
          } else {
            cur += src[i];
            i++;
          }
        }
        cur += '"';
        i++;
        continue;
      }
      if (c === '`') {
        i++;
        if (closer === '`') {
          flush();
          return;
        }
        list('`');
        continue;
      }
      if (c === '$' && d === '(') {
        if (src[i + 2] === '(') {
          // $(( arithmetic )): skip to the matching close, nothing of it is a command
          let parens = 0;
          let j = i + 1;
          do {
            if (src[j] === '(') parens++;
            else if (src[j] === ')') parens--;
            j++;
          } while (j < n && parens > 0);
          i = j;
          continue;
        }
        i += 2;
        list(')');
        continue;
      }
      if (c === '$' && d === '{') {
        const j = src.indexOf('}', i);
        const end = j < 0 ? n : j + 1;
        cur += src.slice(i, end);
        i = end;
        continue;
      }
      if (c === '(') {
        flush();
        depth++;
        i++;
        continue;
      }
      if (c === ')') {
        flush();
        i++;
        if (depth > 0) depth--;
        else if (closer === ')') return;
        continue;
      }
      if (c === '&') {
        if (d === '&') {
          flush();
          i += 2;
        } else if (cur.endsWith('>') || cur.endsWith('<') || d === '>') {
          cur += c; // 2>&1, >&2, <&3, &>file
          i++;
        } else {
          flush(); // a background `&`
          i++;
        }
        continue;
      }
      if (c === '|') {
        flush();
        i += d === '|' || d === '&' ? 2 : 1;
        continue;
      }
      if (c === ';') {
        flush();
        i += d === ';' || d === '&' ? 2 : 1;
        continue;
      }
      if (c === '\n') {
        flush();
        i++;
        while (pending.length) {
          const { delim, dash } = pending.shift();
          while (i < n) {
            let eol = src.indexOf('\n', i);
            if (eol < 0) eol = n;
            let line = src.slice(i, eol);
            i = Math.min(eol + 1, n);
            if (dash) line = line.replace(/^\t+/, '');
            if (line === delim) break;
          }
        }
        continue;
      }
      if (c === '#' && (cur === '' || /\s$/.test(cur))) {
        while (i < n && src[i] !== '\n') i++;
        continue;
      }
      if (c === '<' && d === '<') {
        if (src[i + 2] === '<') {
          cur += '<<<'; // a here-string
          i += 3;
          continue;
        }
        const dash = src[i + 2] === '-';
        const { delim, end } = readHeredocDelimiter(src, i + (dash ? 3 : 2));
        cur += src.slice(i, end);
        i = end;
        pending.push({ delim, dash });
        continue;
      }
      cur += c;
      i++;
    }
    flush();
  }

  list(null);
  return out;
}

// ---- words ----------------------------------------------------------------------------------------------------------------

const REDIRECT_OP = /^\d*(?:<<<|<<-|<<|<>|<&|<|&>>|&>|>>|>&|>\||>)/;

// Reads one word at `i` (quotes resolved, backslashes resolved), stopping at whitespace or an unquoted `<` or `>`.
function readWord(s, i) {
  const n = s.length;
  let text = '';
  while (i < n && !/\s/.test(s[i]) && s[i] !== '<' && s[i] !== '>') {
    const c = s[i];
    if (c === "'") {
      const j = s.indexOf("'", i + 1);
      const end = j < 0 ? n : j;
      text += s.slice(i + 1, end);
      i = j < 0 ? n : j + 1;
    } else if (c === '"') {
      i++;
      while (i < n && s[i] !== '"') {
        if (s[i] === '\\' && i + 1 < n) {
          const e = s[i + 1];
          if (e === '\n') {
            // dropped
          } else if (e === '$' || e === '`' || e === '"' || e === '\\') text += e;
          else text += '\\' + e;
          i += 2;
        } else {
          text += s[i];
          i++;
        }
      }
      i++;
    } else if (c === '\\') {
      if (i + 1 < n && s[i + 1] !== '\n') text += s[i + 1];
      i += 2;
    } else {
      text += c;
      i++;
    }
  }
  return { text, end: Math.min(i, n) };
}

// Tokens of a segment: { text, start, end, redir }. `redir` marks a redirection operator and its target.
function lex(seg) {
  const toks = [];
  const n = seg.length;
  let i = 0;
  while (i < n) {
    while (i < n && /\s/.test(seg[i])) i++;
    if (i >= n) break;
    const start = i;
    const m = REDIRECT_OP.exec(seg.slice(i));
    if (m) {
      i += m[0].length;
      let needsTarget = true;
      if (m[0].endsWith('&') && !m[0].startsWith('&')) {
        const dup = /^(?:\d+|-)/.exec(seg.slice(i)); // 2>&1, >&-
        if (dup) {
          i += dup[0].length;
          needsTarget = false;
        }
      }
      toks.push({ text: m[0], start, end: i, redir: true });
      if (needsTarget) {
        while (i < n && /\s/.test(seg[i])) i++;
        if (i < n && seg[i] !== '<' && seg[i] !== '>') {
          const ts = i;
          const w = readWord(seg, i);
          i = Math.max(w.end, i + 1);
          toks.push({ text: w.text, start: ts, end: i, redir: true });
        }
      }
      continue;
    }
    const w = readWord(seg, i);
    i = Math.max(w.end, i + 1);
    toks.push({ text: w.text, start, end: i, redir: false });
  }
  return toks;
}

const wordsOf = (seg) => lex(seg).filter((t) => !t.redir).map((t) => t.text);
const isAssignment = (w) => /^[A-Za-z_][A-Za-z0-9_]*(?:\[[^\]]*\])?\+?=/.test(w);
const basename = (w) => w.slice(w.lastIndexOf('/') + 1);

export function shellSegments(command) {
  if (typeof command !== 'string') return [];
  const out = [];
  for (const raw of splitRaw(command)) {
    const toks = lex(raw);
    let k = 0;
    while (k < toks.length && !toks[k].redir && (STRIP_WORDS.has(toks[k].text) || isAssignment(toks[k].text))) k++;
    const seg = k < toks.length ? raw.slice(toks[k].start).trim() : '';
    if (seg) out.push(seg);
  }
  return out;
}

// The words of a segment with the wrappers that only prefix a command removed. `envDump` is true when an `env` wrapper had no
// command after it (it prints the environment).
function commandWords(seg) {
  let w = wordsOf(seg);
  let envDump = false;
  for (let guard = 0; guard < 8 && w.length > 0; guard++) {
    while (w.length > 0 && isAssignment(w[0])) w = w.slice(1);
    if (w.length === 0) break;
    const c = basename(w[0]);
    if (c === 'env') {
      w = w.slice(1);
      while (w.length > 0) {
        if (isAssignment(w[0])) w = w.slice(1);
        else if (['-u', '-C', '--unset', '--chdir'].includes(w[0])) w = w.slice(2);
        else if (w[0].startsWith('-') && w[0] !== '-') w = w.slice(1);
        else break;
      }
      if (w.length === 0) envDump = true;
    } else if (['time', 'nohup', 'command', 'exec', 'builtin'].includes(c)) {
      w = w.slice(1);
      while (w.length > 0 && w[0].startsWith('-')) w = w.slice(1);
    } else if (c === 'nice') {
      w = w.slice(1);
      if (w[0] === '-n') w = w.slice(2);
      else if (/^-\d+$/.test(w[0] ?? '')) w = w.slice(1);
    } else if (c === 'timeout') {
      w = w.slice(1);
      while (w.length > 0 && w[0].startsWith('-')) w = ['-s', '-k', '--signal', '--kill-after'].includes(w[0]) ? w.slice(2) : w.slice(1);
      if (w.length > 0) w = w.slice(1); // the duration
    } else break;
  }
  return { words: w, envDump };
}

// ---- isBroadCheck -------------------------------------------------------------------------------------------------------

// cargo options (and libtest options, after `--`) whose value is the next word when it is not attached with `=`.
const CARGO_VALUE_OPTS = new Set([
  '--features', '-F', '--package', '-p', '--manifest-path', '--target-dir', '-j', '--jobs', '--color', '--message-format',
  '--target', '--exclude', '--profile', '--config', '-Z', '-C', '--test', '--bin', '--example', '--bench', '--lockfile-path',
]);
const LIBTEST_VALUE_OPTS = new Set([
  '--test-threads', '--skip', '--format', '--color', '--logfile', '--report-time', '--shuffle-seed', '-Z',
]);
const NARROWING = new Set(['--lib', '--bin', '--test', '--doc', '--example', '--bench']);

// The subcommand of a cargo invocation and its arguments: { sub, flags, positionals, post } where `flags` and `positionals`
// are the words before the first bare `--` and `post` the positional words after it (libtest flags and their values left out).
function parseCargo(words) {
  let i = 1;
  const skipOpts = () => {
    while (i < words.length && (words[i].startsWith('+') || words[i].startsWith('-'))) {
      if (words[i] === '--') break;
      i += CARGO_VALUE_OPTS.has(words[i]) ? 2 : 1;
    }
  };
  skipOpts();
  if (i >= words.length) return null;
  const sub = words[i++];
  const flags = [];
  const positionals = [];
  const post = [];
  let afterDashes = false;
  for (; i < words.length; i++) {
    const w = words[i];
    if (afterDashes) {
      if (w.startsWith('-')) {
        if (LIBTEST_VALUE_OPTS.has(w)) i++;
      } else post.push(w);
    } else if (w === '--') afterDashes = true;
    else if (w.startsWith('-')) {
      flags.push(w);
      if (CARGO_VALUE_OPTS.has(w)) i++;
    } else positionals.push(w);
  }
  return { sub, flags, positionals, post };
}

function segmentIsBroad(seg) {
  const { words } = commandWords(seg);
  if (words.length === 0 || basename(words[0]) !== 'cargo') return false;
  const c = parseCargo(words);
  if (!c || !['test', 'check', 'clippy'].includes(c.sub)) return false;
  if (c.flags.includes('--tests') || c.flags.includes('--all-targets')) return true;
  if (c.sub !== 'test') return false;
  if (c.flags.some((f) => NARROWING.has(f.split('=')[0]))) return false;
  return c.positionals.length === 0 && c.post.length === 0;
}

export function isBroadCheck(command) {
  return shellSegments(command).some(segmentIsBroad);
}

// ---- auditHits ----------------------------------------------------------------------------------------------------------

const HARNESS_DIRS = ['/run/config', '/run/state', '/opt/es', '/opt/claude', '/proc'];
// A directory as a path component: not preceded by a path character, not the start of a longer name.
const DIR_RE = new RegExp(`(?<![\\w.~/-])(${HARNESS_DIRS.map((d) => d.replace(/\//g, '\\/')).join('|')})(?![\\w-])`, 'g');
const VAR_RE = /\$(?:\{(CLAUDE_CONFIG_DIR|XDG_STATE_HOME)\b|(CLAUDE_CONFIG_DIR|XDG_STATE_HOME)(?![A-Za-z0-9_]))/g;
const JSONL_RE = /(?<![\w.~/-])(\/[^\s'"`;|&()<>]*\.jsonl)(?![\w.])/g;

function textHits(text, hits) {
  for (const m of text.matchAll(DIR_RE)) hits.add(`names ${m[1]}`);
  for (const m of text.matchAll(JSONL_RE)) if (!m[1].startsWith('/work/')) hits.add(`reads ${m[1]} outside /work`);
  return hits;
}

function commandHits(command, hits) {
  textHits(command, hits);
  for (const m of command.matchAll(VAR_RE)) hits.add(`names $${m[1] ?? m[2]}`);
  for (const seg of shellSegments(command)) {
    const { words, envDump } = commandWords(seg);
    const raw = wordsOf(seg);
    const first = words.length > 0 ? basename(words[0]) : '';
    if (first === 'ps' || first === 'printenv') hits.add(`runs ${first}`);
    if (envDump || (raw.length === 1 && ['env', 'set'].includes(basename(raw[0])))) hits.add(`prints the environment (${basename(raw[0])})`);
  }
  return hits;
}

export function auditHits(tool, input) {
  const hits = new Set();
  if (input === null || typeof input !== 'object') return [];
  if (tool === 'Bash') {
    if (typeof input.command === 'string') commandHits(input.command, hits);
  } else if (tool === 'Read' || tool === 'Grep' || tool === 'Glob') {
    for (const key of ['file_path', 'path', 'pattern']) if (typeof input[key] === 'string') textHits(input[key], hits);
  }
  return [...hits];
}
