import assert from 'node:assert/strict';
import { test } from 'node:test';
import { boxWriteVerb, SCRIBE_MESSAGE, WRITE_VERBS } from './scribe-rules.mjs';

test('WRITE_VERBS is exactly the nine box write verbs', () => {
  assert.deepEqual(
    [...WRITE_VERBS].sort(),
    ['add', 'close', 'edit', 'end', 'note', 'now', 'promote', 'reaffirm', 'supersede'],
  );
});

test('boxWriteVerb names the write verb of an unquoted codescout box call', () => {
  const cases = [
    ['codescout box bugs add --title "x"', 'add'],
    ['codescout box add --title x', 'add'],
    ['codescout box --project /r bugs close k fixed', 'close'],
    ['codescout box --json bugs promote k --to other', 'promote'],
    ["/usr/local/bin/codescout box bugs edit k '{}'", 'edit'],
    ['cd d && codescout box bugs now k --text body -', 'now'],
    ['codescout box bugs end', 'end'],
    ['codescout box bugs supersede k', 'supersede'],
    ['codescout box bugs reaffirm k', 'reaffirm'],
    // `note` is the verb of the frictions inbox: the call an agent makes when it notices a friction.
    ['codescout box frictions note --title "x" --tool run_command', 'note'],
    ['codescout box bugs add --title x | tee out', 'add'],
    // A heredoc body that mentions another verb does not change the verb of the call.
    ["codescout box bugs add --title x --text body - <<'EOF'\nsome body that says codescout box bugs close k\nEOF", 'add'],
  ];
  for (const [command, verb] of cases) assert.equal(boxWriteVerb(command), verb, command);
});

test('boxWriteVerb is null for reads, box creation, flush, other doors and quoted text', () => {
  const cases = [
    'codescout box',
    'codescout box bugs list',
    'codescout box bugs show k',
    'codescout box bugs find x',
    'codescout box bugs help close',
    // Help is a read, in every form: `box help <verb>`, `box <key> help <verb>`, `--help` and `-h`.
    'codescout box help close',
    'codescout box help edit 2>&1 | head -5',
    'codescout box help reaffirm',
    'codescout box residuals close 2026-11-22-x done --help 2>&1 | head -15',
    'codescout box bugs add --help',
    'codescout box bugs edit -h',
    // A read verb first: the next word is its argument, not a verb.
    'codescout box find close',
    'codescout box list add',
    'codescout box bugs check',
    'codescout box new bugs --title x',
    'codescout box flush',
    'codescout box decisions',
    'codescout doc create',
    'ls -la',
    '',
    'echo "codescout box bugs add"',
    "git commit -m 'codescout box add x'",
    'grep -r "codescout box close" docs',
    "cat <<'EOF'\ncodescout box bugs add --title x\nEOF",
  ];
  for (const command of cases) assert.equal(boxWriteVerb(command), null, command);
});

test('boxWriteVerb tolerates a non-string without throwing', () => {
  for (const v of [undefined, null, 42, {}]) assert.equal(boxWriteVerb(v), null);
});

test('SCRIBE_MESSAGE carries the recipe, stays short and states no history', () => {
  assert.ok(Buffer.byteLength(SCRIBE_MESSAGE) <= 320, `${Buffer.byteLength(SCRIBE_MESSAGE)} bytes`);
  for (const needed of ['subagent_type="fork"', "get_guide('scribe')", 'repeat this call']) {
    assert.ok(SCRIBE_MESSAGE.includes(needed), needed);
  }
  for (const banned of ['was removed', 'formerly', 'no longer']) {
    assert.ok(!SCRIBE_MESSAGE.includes(banned), banned);
  }
});
