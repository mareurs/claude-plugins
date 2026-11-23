import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

// History: this test used to prove the hook DRAINED a 2.3 MB payload (the system prompt, copied
// verbatim) to a slow consumer. Since 2026-11-23 the hook sends a pointer and never copies the
// prompt, so a 3.4 KB payload cannot fill a pipe and that premise is gone. The fixture stays, because it
// is the harshest input there is: a prompt this size must still produce a small, complete, valid payload.
test('subagent guidance stays small and complete when the system prompt is huge', { timeout: 15000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'subagent-guidance-drain-'));
  let child;
  try {
    mkdirSync(join(root, '.claude'));
    mkdirSync(join(root, '.codescout'));
    mkdirSync(join(root, 'empty-profile'));
    writeFileSync(join(root, '.claude', 'codescout-companion.json'), '{"server_name":"codescout"}');
    const prompt = 'complete-system-prompt-'.repeat(100000) + '\nEND-OF-PROMPT';
    writeFileSync(join(root, '.codescout', 'system-prompt.md'), prompt);
    child = spawn(process.execPath, [fileURLToPath(new URL('./subagent-guidance.mjs', import.meta.url))], {
      env: { PATH: process.env.PATH, HOME: root, CLAUDE_CONFIG_DIR: join(root, 'empty-profile') },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const done = new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => resolve({ code, signal }));
    });
    const errors = [];
    child.stderr.on('data', data => errors.push(data));
    // Attach the reader NOW. A pause is no longer possible here: Node discards the unread stdout of a
    // child that has exited and has no 'data' listener, and a 3.5 KB payload lets the child exit within
    // milliseconds. The old 2.3 MB payload kept the child alive until the consumer drained it.
    const chunks = [];
    child.stdout.on('data', data => chunks.push(data));
    child.stdin.end(JSON.stringify({ cwd: root, agent_type: 'general-purpose' }));
    const result = await done;
    assert.deepEqual(result, { code: 0, signal: null }, Buffer.concat(errors).toString());
    const output = JSON.parse(Buffer.concat(chunks).toString());
    assert.equal(output.hookSpecificOutput.hookEventName, 'SubagentStart');
    const ctx = output.hookSpecificOutput.additionalContext;
    assert.ok(ctx.length < 5000, `payload must not grow with the prompt file (got ${ctx.length} chars)`);
    assert.ok(!ctx.includes('complete-system-prompt-'), 'the prompt text must never be copied into the payload');
    assert.ok(ctx.includes('.codescout/system-prompt.md'), 'the prompt is named by path instead');
  } finally {
    child?.kill();
    rmSync(root, { recursive: true, force: true });
  }
});
