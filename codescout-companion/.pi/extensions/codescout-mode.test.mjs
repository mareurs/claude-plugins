import assert from 'node:assert/strict';

const { default: codescoutMode } = await import('./codescout-mode.ts');

const handlers = new Map();
const activeTools = new Set(['read', 'edit', 'write', 'bash']);
const availableTools = [
  'codescout_edit_code',
  'codescout_edit_file',
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
// edit_markdown was folded into edit_file on 2026-09-03 with no alias, so the tool set a
// current codescout registers has no `codescout_edit_markdown`. The native-edit block must
// still arm on that set, and its refusal must not send the model to a tool that is gone.
const editBlock = await handlers.get('tool_call')({ toolName: 'edit', input: { path: 'src/lib.rs' } });
assert.equal(editBlock.block, true);
assert.ok(!/markdown/.test(editBlock.reason), editBlock.reason);
assert.equal((await handlers.get('tool_call')({ toolName: 'read', input: { path: 'src/lib.rs' } })).block, true);
assert.equal(await handlers.get('tool_call')({ toolName: 'read', input: { path: 'diagram.png' } }), undefined);
assert.equal((await handlers.get('tool_call')({ toolName: 'bash', input: { command: 'rg symbol src' } })).block, true);
assert.equal(await handlers.get('tool_call')({ toolName: 'bash', input: { command: 'cargo test' } }), undefined);

console.log('Pi codescout mode ok');
