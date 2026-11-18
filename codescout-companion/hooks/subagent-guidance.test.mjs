import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

test('subagent guidance drains stdout before exiting when its consumer is slow', { timeout: 15000 }, async () => {
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
    child.stdin.end(JSON.stringify({ cwd: root, agent_type: 'general-purpose' }));
    // Leave stdout paused until the producer has filled its transport buffer.
    await delay(250);
    const chunks = [];
    child.stdout.on('data', data => chunks.push(data));
    const result = await done;
    assert.deepEqual(result, { code: 0, signal: null }, Buffer.concat(errors).toString());
    const output = JSON.parse(Buffer.concat(chunks).toString());
    assert.equal(output.hookSpecificOutput.hookEventName, 'SubagentStart');
    assert.ok(output.hookSpecificOutput.additionalContext.endsWith(prompt), 'complete prompt must reach the consumer');
  } finally {
    child?.kill();
    rmSync(root, { recursive: true, force: true });
  }
});
