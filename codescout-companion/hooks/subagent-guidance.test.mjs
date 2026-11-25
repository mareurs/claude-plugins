import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { hasBugsBox } from './lib.mjs';

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

// get_guide lists only these topics. Agent-facing companion text must not name any other.
test('agent-facing companion text names only public get_guide topics', async () => {
  const PUBLIC = ['box', 'scribe'];
  const pkg = fileURLToPath(new URL('..', import.meta.url));
  const files = [];
  const walk = (dir, accept) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p, accept);
      else if (accept(e.name)) files.push(p);
    }
  };
  walk(join(pkg, 'hooks'), n => n.endsWith('.mjs') && !/\.test\./.test(n));
  walk(join(pkg, 'skills'), n => n.endsWith('.md'));
  const bad = [];
  for (const f of files) {
    readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      for (const m of line.matchAll(/get_guide\(\s*\\?["']([a-z-]+)\\?["']\s*\)/g)) {
        if (!PUBLIC.includes(m[1])) bad.push(`${f}:${i + 1} names ${m[1]}`);
      }
    });
  }
  assert.deepEqual(bad, []);

  const root = mkdtempSync(join(tmpdir(), 'subagent-guidance-topics-'));
  try {
    mkdirSync(join(root, '.claude'));
    mkdirSync(join(root, '.codescout'));
    mkdirSync(join(root, 'empty-profile'));
    writeFileSync(join(root, '.claude', 'codescout-companion.json'), '{"server_name":"codescout"}');
    const r = spawnSync(process.execPath, [fileURLToPath(new URL('./subagent-guidance.mjs', import.meta.url))], {
      env: { PATH: process.env.PATH, HOME: root, CLAUDE_CONFIG_DIR: join(root, 'empty-profile') },
      input: JSON.stringify({ cwd: root, agent_type: 'general-purpose' }),
      encoding: 'utf8',
    });
    assert.equal(r.status, 0, r.stderr);
    const ctx = JSON.parse(r.stdout).hookSpecificOutput.additionalContext;
    for (const word of ['untrusted-content', 'project-activation-bootstrap']) {
      assert.ok(!ctx.includes(word), `the subagent message must not name ${word}`);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// hasBugsBox asks the binary; it never looks for a path. The fake answers only the exact call
// `box --project <root> bugs --json`, so a wrong call shape reads as "no bugs box".
function fakeBox(dir, reply, status = 0) {
  const bin = join(dir, 'fake-codescout');
  writeFileSync(
    bin,
    `#!/usr/bin/env bash\n[ "$*" = "box --project ${dir} bugs --json" ] || exit 101\ncat <<'EOF'\n${reply}\nEOF\nexit ${status}\n`,
  );
  chmodSync(bin, 0o755);
  return bin;
}

test('hasBugsBox is true only when codescout shows the bugs box', () => {
  const dir = mkdtempSync(join(tmpdir(), 'has-bugs-box-'));
  try {
    assert.equal(hasBugsBox(dir, fakeBox(dir, '{"shown":true,"key":"bugs","address":"quality/bugs"}')), true);
    // Not shown: a box that exists but is not shown, a refusal with exit 2, the old-layout refusal (exit 0, no `shown`),
    // output that is not JSON, and a failing binary.
    assert.equal(hasBugsBox(dir, fakeBox(dir, '{"shown":false}')), false);
    assert.equal(hasBugsBox(dir, fakeBox(dir, 'NOT SHOWN — no box bugs', 2)), false);
    assert.equal(hasBugsBox(dir, fakeBox(dir, '{"done":false,"not_done":"the boxes use the old layout","old_layout":["docs/trackers/ledgers/bugs"]}')), false);
    assert.equal(hasBugsBox(dir, fakeBox(dir, 'not json')), false);
    assert.equal(hasBugsBox(dir, fakeBox(dir, '{"shown":true}', 101)), false);
    // No binary, no root, and a call shape the fake does not know.
    assert.equal(hasBugsBox(dir, ''), false);
    assert.equal(hasBugsBox(dir, null), false);
    assert.equal(hasBugsBox(dir, '/nonexistent/codescout'), false);
    assert.equal(hasBugsBox('', fakeBox(dir, '{"shown":true}')), false);
    assert.equal(hasBugsBox(join(dir, 'other'), fakeBox(dir, '{"shown":true}')), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('hasBugsBox gives up at the timeout', () => {
  const dir = mkdtempSync(join(tmpdir(), 'has-bugs-box-slow-'));
  try {
    const bin = join(dir, 'slow-codescout');
    writeFileSync(bin, '#!/usr/bin/env bash\nsleep 5\necho \'{"shown":true}\'\n');
    chmodSync(bin, 0o755);
    const t = Date.now();
    assert.equal(hasBugsBox(dir, bin, 300), false);
    assert.ok(Date.now() - t < 2000, 'returned too late');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
