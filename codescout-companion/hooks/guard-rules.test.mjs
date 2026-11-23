import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  norm,
  isBinaryImage,
  isSkillPayload,
  isHarnessOutput,
  isConfigDir,
  isSandboxEscalation,
  exemptReason,
} from './guard-rules.mjs';

const ENV = { home: '/home/u', configDir: '' };
const ENV_CCD = { home: '/home/u', configDir: '/opt/cc-profile' };

test('norm turns backslashes into slashes and tolerates empty input', () => {
  assert.equal(norm('C:\\a\\b.ts'), 'C:/a/b.ts');
  assert.equal(norm(undefined), '');
});

test('isBinaryImage: images and PDF, any case, only at the end', () => {
  for (const p of ['/a/x.png', '/a/x.JPG', '/a/x.jpeg', '/a/x.gif', '/a/x.webp', '/a/x.bmp', '/a/x.ico', '/a/x.PDF'])
    assert.equal(isBinaryImage(p), true, p);
  for (const p of ['/a/x.ts', '/a/png', '/a/x.png.ts', '/a/x.svg'])
    assert.equal(isBinaryImage(p), false, p);
});

test('isSkillPayload: plugin cache, .buddy trees and skill files', () => {
  for (const p of [
    '/home/u/.claude/plugins/cache/m/p/1.0/a.md',
    '/repo/.buddy/s/x.json',
    '/x/skills/foo/SKILL.md',
    '/x/skills/foo/_lens.md',
    '/x/skills/foo/references/r.md',
    'skills/foo/SKILL.md',
  ])
    assert.equal(isSkillPayload(p), true, p);
  for (const p of ['/x/skills/foo/other.md', '/x/skills/SKILL.md', '/x/src/a.ts', '/x/skills/foo/references/deep/r.md'])
    assert.equal(isSkillPayload(p), false, p);
});

test('isHarnessOutput: a tool-results directory', () => {
  assert.equal(isHarnessOutput('/tmp/s/tool-results/abc.txt'), true);
  assert.equal(isHarnessOutput('/tmp/s/tool-result/abc.txt'), false);
});

test('isConfigDir: profile dirs under home, and CLAUDE_CONFIG_DIR', () => {
  assert.equal(isConfigDir('/home/u/.claude/settings.json', ENV), true);
  assert.equal(isConfigDir('/home/u/.claude-stef/settings.json', ENV), true);
  assert.equal(isConfigDir('/home/u/.clauderc', ENV), false);
  assert.equal(isConfigDir('/home/u/work/a.ts', ENV), false);
  assert.equal(isConfigDir('/opt/cc-profile/x', ENV), false);
  assert.equal(isConfigDir('/opt/cc-profile/x', ENV_CCD), true);
  assert.equal(isConfigDir('/opt/cc-profile', ENV_CCD), false, 'the dir itself needs a trailing slash');
  assert.equal(isConfigDir('', ENV), false);
});

test('isSandboxEscalation: only the exact require_escalated value', () => {
  assert.equal(isSandboxEscalation({ sandbox_permissions: 'require_escalated' }), true);
  assert.equal(isSandboxEscalation({ sandbox_permissions: 'use_default' }), false);
  assert.equal(isSandboxEscalation({}), false);
  assert.equal(isSandboxEscalation(undefined), false);
});

test('exemptReason: Read lets through images, skill payloads, harness output and config dirs', () => {
  assert.equal(exemptReason('Read', '/a/x.png', ENV), 'image');
  assert.equal(exemptReason('Read', '/x/skills/foo/SKILL.md', ENV), 'skill-payload');
  assert.equal(exemptReason('Read', '/t/tool-results/a', ENV), 'harness-output');
  assert.equal(exemptReason('Read', '/home/u/.claude/settings.json', ENV), 'config-dir');
  assert.equal(exemptReason('Read', '/repo/src/a.rs', ENV), null);
  assert.equal(exemptReason('Read', '/repo/notes.txt', ENV), null, 'the extension never exempts: only the message differs');
  assert.equal(exemptReason('Read', '/repo/README.md', ENV), null);
});

test('exemptReason: Edit and Write exempt only an image', () => {
  for (const tool of ['Edit', 'Write']) {
    assert.equal(exemptReason(tool, '/a/x.png', ENV), 'image');
    assert.equal(exemptReason(tool, '/home/u/.claude/settings.json', ENV), null, `${tool} on a config dir stays denied`);
    assert.equal(exemptReason(tool, '/x/skills/foo/SKILL.md', ENV), null);
    assert.equal(exemptReason(tool, '/repo/src/a.rs', ENV), null);
  }
});

test('exemptReason: Grep exempts a config-dir path, Glob a config-dir pattern', () => {
  assert.equal(exemptReason('Grep', '/home/u/.claude/plugins', ENV), 'config-dir');
  assert.equal(exemptReason('Grep', '', ENV), null);
  assert.equal(exemptReason('Grep', '/repo/src', ENV), null);
  assert.equal(exemptReason('Glob', '/home/u/.claude-kat/**/*.json', ENV), 'config-dir');
  assert.equal(exemptReason('Glob', '**/*.rs', ENV), null);
});

test('exemptReason: Bash is never exempt here; an unguarded tool is reported as such', () => {
  assert.equal(exemptReason('Bash', 'git log', ENV), null);
  assert.equal(exemptReason('WebFetch', 'https://x', ENV), 'unguarded-tool');
  assert.equal(exemptReason('mcp__codescout__grep', '', ENV), 'unguarded-tool');
});
