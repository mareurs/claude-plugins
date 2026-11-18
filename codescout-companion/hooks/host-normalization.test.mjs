import assert from 'node:assert/strict';
import { inputPath, isCodescoutTool, isWriteOperation, normalizedToolName } from './lib.mjs';

assert.equal(normalizedToolName({ tool_name: 'Read' }), 'Read');
assert.equal(normalizedToolName({ tool_name: 'read_file' }), 'Read');
assert.equal(normalizedToolName({ tool_name: 'run_in_terminal' }), 'Bash');
assert.equal(normalizedToolName({ tool_name: 'replace_string_in_file' }), 'Edit');
assert.equal(inputPath({ tool_input: { file_path: 'src/lib.rs' } }), 'src/lib.rs');
assert.equal(inputPath({ tool_input: { filePath: 'src/lib.rs' } }), 'src/lib.rs');
assert.ok(isCodescoutTool({ tool_name: 'mcp__codescout__edit_code' }, ['edit_code']));
assert.ok(isCodescoutTool({ tool_name: 'codescout_edit_code' }, ['edit_code']));
assert.ok(isCodescoutTool({ tool_name: 'codescout/edit_code' }, ['edit_code']));
assert.ok(!isCodescoutTool({ tool_name: 'other_edit_code' }, ['edit_code']));
assert.ok(isWriteOperation({ tool_name: 'replace_string_in_file' }));
assert.ok(isWriteOperation({ tool_name: 'codescout_edit_file' }));
assert.ok(!isWriteOperation({ tool_name: 'read_file' }));

console.log('host normalization ok');
