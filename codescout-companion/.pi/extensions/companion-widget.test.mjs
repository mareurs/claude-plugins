import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';

// Only the external text renderer is replaced. Load the real extension and
// observe the widget it produces through both supported skill-read paths.
const textStub = 'data:text/javascript,' + encodeURIComponent(
  'export class Text { constructor(text) { this.text = text; } }'
);
const loader = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@earendil-works/pi-tui') {
      return { url: textStub, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
const { default: companion } = await import(
  '../../../harnesses/pi/extensions/codescout-companion.ts'
);
loader.deregister();

const skillPath = '/fixture/codescout-companion/skills/reconnaissance/SKILL.md';

function fixture(history = []) {
  const handlers = new Map();
  const widgets = [];
  const theme = { fg: (_color, text) => text };
  const ctx = {
    cwd: '/fixture',
    sessionManager: { getSessionFile: () => null, getBranch: () => history },
    ui: {
      theme,
      setWidget: (_name, render) => {
        if (render) widgets.push(render({}, theme).text);
      },
    },
  };
  companion({
    on: (name, handler) => handlers.set(name, handler),
    getAllTools: () => [],
  });
  return { handlers, widgets, ctx };
}

test('codescout_read_file tracks a skill through the live tool_call hook', async () => {
  const { handlers, widgets, ctx } = fixture();
  await handlers.get('session_start')({}, ctx);
  assert.ok(widgets.every(text => !text.includes('cs: reconnaissance')));
  await handlers.get('tool_call')({
    toolName: 'codescout_read_file',
    input: { path: skillPath },
  }, ctx);
  assert.ok(widgets.some(text => text.includes('cs: reconnaissance')));
});

test('codescout_read_file tracks a skill through restored session history', async () => {
  const { handlers, widgets, ctx } = fixture([{
    type: 'message',
    message: {
      role: 'assistant',
      content: [{
        type: 'toolCall',
        name: 'codescout_read_file',
        arguments: { path: skillPath },
      }],
    },
  }]);
  await handlers.get('session_start')({}, ctx);
  assert.ok(widgets.some(text => text.includes('cs: reconnaissance')));
});
