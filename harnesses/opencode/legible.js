// legible for OpenCode — the "Explanatory STE" output style as an agent you switch to.
//
// WHAT CLAUDE CODE DOES
//
// legible ships an output style (legible/output-styles/explanatory-ste.md) that you opt into
// with `/output-style legible:Explanatory STE`. Its frontmatter sets
// `keep-coding-instructions: true`: the style is ADDED to the normal coding prompt, it does
// not replace it.
//
// WHAT THIS DOES INSTEAD
//
// OpenCode has no output styles. The nearest opt-in switch is the agent picker (Tab in the
// TUI, `--agent` on the CLI), so this registers a primary agent named `legible`.
//
// It deliberately does NOT set the agent's `system` field. Measured on 2.1.3: the host
// builds the prompt as `agent.system ? agent.system : <default prompt from tool names>`, so
// a `system` would throw away the coding instructions, the opposite of
// keep-coding-instructions. The style is pushed through `session.hook("context")` instead,
// and only when the active agent is `legible` (the context event carries `agent`, measured).
//
// The agent copies the `build` agent's permissions and model, so switching to it changes
// how answers are written and nothing else.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
export const STYLE_FILE = join(REPO, 'legible', 'output-styles', 'explanatory-ste.md');
export const AGENT_ID = 'legible';

// The style body without its YAML frontmatter. Read once at setup; an unreadable file
// yields '' and the agent then behaves exactly like `build` (fail open, reported).
export function styleText(path = STYLE_FILE) {
  try {
    const raw = readFileSync(path, 'utf8');
    const m = raw.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
    return (m ? raw.slice(m[0].length) : raw).trim();
  } catch (e) {
    process.stderr.write(`legible: cannot read ${path} — ${e?.message || e} (agent runs without the style)\n`);
    return '';
  }
}

// Agent registration, as a pure function over the host's transform handle so the tests
// can drive it with a fake. `T` is the object `ctx.agent.transform` passes: list/get/
// update/remove (measured).
export function registerAgent(T) {
  const build = T.get('build');
  T.update(AGENT_ID, (a) => {
    a.description = 'Build, with answers in the legible "Explanatory STE" style: short sentences, one idea each, ★ Insight blocks.';
    a.mode = 'primary';
    if (build) {
      if (Array.isArray(build.permissions)) a.permissions = build.permissions.map((p) => ({ ...p }));
      if (build.model) a.model = { ...build.model };
    }
  });
}

export function onContextFor(text) {
  return (event) => {
    if (!text || event?.agent !== AGENT_ID) return;
    try {
      event.system.push({ type: 'text', text });
    } catch {
      // Unrecognised event shape: the agent still works, just unstyled.
    }
  };
}

export async function Legible(ctx) {
  const text = styleText();
  try {
    await ctx.agent.transform(registerAgent);
  } catch (e) {
    process.stderr.write(`legible: could not register the agent — ${e?.message || e}\n`);
  }
  try {
    await ctx.session.hook('context', onContextFor(text));
  } catch (e) {
    process.stderr.write(`legible: could not register session.context — ${e?.message || e}\n`);
  }
}

export default { id: 'legible', setup: Legible };
