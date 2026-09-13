import assert from 'node:assert/strict';

const { default: codescoutMode } = await import('./codescout-mode.ts');

const handlers = new Map();
const activeTools = new Set(['read', 'edit', 'write', 'bash']);
const availableTools = [
  'codescout_edit_code',
  'codescout_edit_file',
  'codescout_edit_markdown',
  'codescout_create_file',
  'codescout_read_file',
].map((name) => ({ name }));

const pi = {
  getAllTools: () => availableTools,
  getActiveTools: () => [...activeTools],
  setActiveTools: async (tools) => {
    activeTools.clear();
    tools.forEach((tool) => activeTools.add(tool));
  },
  on: (event, handler) => handlers.set(event, handler),
};

codescoutMode(pi);
await handlers.get('session_start')({}, { hasUI: false });
assert.ok(!activeTools.has('edit'));
assert.ok(!activeTools.has('write'));
assert.equal((await handlers.get('tool_call')({ toolName: 'read', input: { path: 'src/lib.rs' } })).block, true);
assert.equal(await handlers.get('tool_call')({ toolName: 'read', input: { path: 'diagram.png' } }), undefined);
assert.equal((await handlers.get('tool_call')({ toolName: 'bash', input: { command: 'rg symbol src' } })).block, true);
assert.equal(await handlers.get('tool_call')({ toolName: 'bash', input: { command: 'cargo test' } }), undefined);

console.log('Pi codescout mode ok');
