import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, writeFile, rm, chmod, symlink, cp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const source = fileURLToPath(new URL('./codex-hook.mjs', import.meta.url));
const command = 'node "${CODEX_HOME:-$HOME/.codex}/hooks/codescout-wake.mjs"';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'codex wake hook '));
  t.after(() => rm(root, {recursive: true, force: true}));
  const profile = join(root, 'profile one');
  const bin = join(root, 'bin');
  await mkdir(profile); await mkdir(bin);
  await writeFile(join(bin, 'codex'), `#!/usr/bin/env node\nconst fs=require('node:fs');\nif(JSON.stringify(process.argv.slice(2))!==JSON.stringify(['plugin','list','--json']))process.exit(22);\nprocess.stdout.write(fs.readFileSync(process.env.CODEX_HOME+'/registry.json'));\n`);
  await chmod(join(bin, 'codex'), 0o700);
  const env = {...process.env, PATH: bin + ':' + process.env.PATH, CODEX_HOME: profile};
  await writeFile(join(profile, 'codescout-wake.json'), JSON.stringify({profileRoot: profile, environmentId: 'fixture-environment', adapters: {codex: {enabled: true}}}));
  async function installed(version, options = {}) {
    const directory = join(profile, 'plugins/cache/fixture-market/codescout-companion', version);
    await mkdir(join(directory, '.claude-plugin'), {recursive: true});
    await mkdir(join(directory, 'background-wake'), {recursive: true});
    await writeFile(join(directory, '.claude-plugin/plugin.json'), JSON.stringify({name: 'codescout-companion', version}));
    await writeFile(join(directory, 'background-wake/cli.mjs'), `import fs from 'node:fs';\nfs.writeFileSync(process.env.CODEX_HOME+'/observed.json',JSON.stringify({version:${JSON.stringify(version)},argv:process.argv.slice(2),input:fs.readFileSync(0,'utf8'),profile:process.env.CODEX_HOME}));\nprocess.stderr.write(${JSON.stringify(options.stderr || '')});\nprocess.stdout.write(${JSON.stringify(options.stdout || '')});\nprocess.exit(${options.exit || 0});\n`);
    await writeFile(join(profile, 'registry.json'), JSON.stringify({installed: [{name: 'codescout-companion', version, marketplaceName: 'fixture-market', enabled: options.enabled !== false, installed: true}]}));
    return directory;
  }
  function install() {return spawnSync(process.execPath, [source, '--install', '--profile', profile], {env, encoding: 'utf8'});}
  function invoke(input = '{"tool_name":"mcp__codescout__run_command","tool_response":{"exit_code":0}}', extra = {}) {
    return spawnSync('/bin/sh', ['-c', command], {env: {...env, ...extra}, input, encoding: 'utf8'});
  }
  return {root, profile, env, installed, install, invoke};
}

function successful(result) {assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout, ''); assert.equal(result.stderr, '');}

test('disabled adapter never executes and missing or nonboolean switches fail', async t => {
  const f = await fixture(t); await f.installed('8.0.0'); assert.equal(f.install().status, 0);
  const configPath = join(f.profile, 'codescout-wake.json');
  const base = JSON.parse(await readFile(configPath, 'utf8'));
  base.adapters.codex.enabled = false;
  await writeFile(configPath, JSON.stringify(base)); successful(f.invoke());
  for (const value of [undefined, 'false', 0, null]) {
    base.adapters.codex.enabled = value;
    await writeFile(configPath, JSON.stringify(base));
    const result = f.invoke(); assert.notEqual(result.status, 0); assert.equal(result.stdout, ''); assert.match(result.stderr, /adapter switch/);
  }
  await assert.rejects(readFile(join(f.profile, 'observed.json')), {code: 'ENOENT'});
});

test('default home fallback runs the independent profiles own cached plugin', async t => {
  const f = await fixture(t); const cached = await f.installed('2.0.0');
  const home = join(f.root, 'other home'); await mkdir(home);
  const other = join(home, '.codex'); await mkdir(other);
  await writeFile(join(other, 'codescout-wake.json'), JSON.stringify({profileRoot: other, environmentId: 'other', adapters: {codex: {enabled: true}}}));
  const install = spawnSync(process.execPath, [source, '--install', '--profile', other], {env: f.env, encoding: 'utf8'});
  assert.equal(install.status, 0, install.stderr);
  await writeFile(join(other, 'registry.json'), await readFile(join(f.profile, 'registry.json')));
  await cp(cached, join(other, 'plugins/cache/fixture-market/codescout-companion/2.0.0'), {recursive: true});
  successful(f.invoke('other profile input', {CODEX_HOME: '', HOME: home}));
  const observed = JSON.parse(await readFile(join(other, 'observed.json'), 'utf8'));
  assert.equal(observed.profile, other);
  assert.deepEqual(observed.argv, ['launch', '--harness', 'codex', '--profile', other, '--environment', 'other']);
  assert.equal(observed.input, 'other profile input');
});

test('manifest mismatch and ambiguous installed companions are rejected before execution', async t => {
  const f = await fixture(t); assert.equal(f.install().status, 0);
  const directory = await f.installed('6.0.0');
  await writeFile(join(directory, '.claude-plugin/plugin.json'), JSON.stringify({name: 'wrong-plugin', version: '6.0.0'}));
  let result = f.invoke(); assert.notEqual(result.status, 0); assert.match(result.stderr, /manifest/); assert.equal(result.stdout, '');
  await f.installed('6.0.0');
  const registryPath = join(f.profile, 'registry.json');
  const registry = JSON.parse(await readFile(registryPath, 'utf8'));
  registry.installed.push({...registry.installed[0], marketplaceName: 'another-market'});
  await writeFile(registryPath, JSON.stringify(registry));
  result = f.invoke(); assert.notEqual(result.status, 0); assert.match(result.stderr, /ambiguous/); assert.equal(result.stdout, '');
  await assert.rejects(readFile(join(f.profile, 'observed.json')), {code: 'ENOENT'});
});

test('installed launcher binds to its own location rather than an inherited foreign CODEX_HOME', async t => {
  const f = await fixture(t); await f.installed('7.0.0'); assert.equal(f.install().status, 0);
  const result = spawnSync(process.execPath, [join(f.profile, 'hooks/codescout-wake.mjs')], {env: {...f.env, CODEX_HOME: f.root}, input: 'own-profile', encoding: 'utf8'});
  successful(result);
  const observed = JSON.parse(await readFile(join(f.profile, 'observed.json'), 'utf8'));
  assert.equal(observed.profile, f.profile); assert.equal(observed.input, 'own-profile');
});

test('absent configuration is a no-op but malformed configuration and registry are errors', async t => {
  const f = await fixture(t); assert.equal(f.install().status, 0);
  const configPath = join(f.profile, 'codescout-wake.json');
  await rm(configPath); successful(f.invoke());
  await writeFile(configPath, '{bad-json');
  let result = f.invoke(); assert.notEqual(result.status, 0); assert.equal(result.stdout, '');
  await writeFile(configPath, JSON.stringify({profileRoot: f.profile, environmentId: 'test', adapters: {codex: {enabled: true}}}));
  await writeFile(join(f.profile, 'registry.json'), '{bad-json');
  result = f.invoke(); assert.notEqual(result.status, 0); assert.equal(result.stdout, '');
});

test('installation migrates old versioned hooks and preserves unrelated configuration idempotently', async t => {
  const f = await fixture(t);
  const before = {custom: {keep: true}, hooks: {SessionStart: [{hooks: [{type: 'command', command: 'keep-start'}]}], PostToolUse: [{matcher: 'mcp__codescout__run_command', hooks: [{type: 'command', command: "node '/gone/1.2.3/background-wake/cli.mjs' launch --harness codex --profile '/old' --environment linux"}, {type: 'command', command: 'keep-post'}]}]}};
  await writeFile(join(f.profile, 'hooks.json'), JSON.stringify(before));
  assert.equal(f.install().status, 0);
  const after = JSON.parse(await readFile(join(f.profile, 'hooks.json'), 'utf8'));
  assert.deepEqual(after.custom, before.custom);
  assert.deepEqual(after.hooks.SessionStart, before.hooks.SessionStart);
  assert.deepEqual(after.hooks.PostToolUse.flatMap(g => g.hooks.map(h => h.command)), ['keep-post', command]);
  const bytes = await readFile(join(f.profile, 'hooks.json'), 'utf8');
  assert.equal(f.install().status, 0);
  assert.equal(await readFile(join(f.profile, 'hooks.json'), 'utf8'), bytes);
  assert.deepEqual(JSON.parse(await readFile(join(f.profile, 'hooks.json.before-versionless-wake'), 'utf8')), before);
});

test('installed hook follows upgrades after cache deletion and selected downgrades instead of largest cached version', async t => {
  const f = await fixture(t);
  assert.equal(f.install().status, 0);
  const old = await f.installed('1.2.9'); successful(f.invoke('first input'));
  const newer = await f.installed('1.2.10'); await rm(old, {recursive: true});
  successful(f.invoke('second input'));
  let observed = JSON.parse(await readFile(join(f.profile, 'observed.json'), 'utf8'));
  assert.equal(observed.version, '1.2.10');
  assert.equal(observed.input, 'second input');
  assert.deepEqual(observed.argv, ['launch', '--harness', 'codex', '--profile', resolve(f.profile), '--environment', 'fixture-environment']);
  await f.installed('1.2.8'); // 1.2.10 remains cached but is no longer selected.
  successful(f.invoke('downgrade'));
  observed = JSON.parse(await readFile(join(f.profile, 'observed.json'), 'utf8'));
  assert.equal(observed.version, '1.2.8'); assert.equal(observed.profile, f.profile);
});

test('default CODEX_HOME fallback handles spaces and independent profiles', async t => {
  const f = await fixture(t); await f.installed('2.0.0'); assert.equal(f.install().status, 0);
  const home = join(f.root, 'other home'); await mkdir(home);
  const other = join(home, '.codex'); await mkdir(other);
  await writeFile(join(other, 'codescout-wake.json'), JSON.stringify({profileRoot: other, environmentId: 'other', adapters: {codex: {enabled: true}}}));
  const install = spawnSync(process.execPath, [source, '--install', '--profile', other], {env: f.env, encoding: 'utf8'});
  assert.equal(install.status, 0, install.stderr);
  await writeFile(join(other, 'registry.json'), await readFile(join(f.profile, 'registry.json')));
  const result = f.invoke('{}', {CODEX_HOME: '', HOME: home});
  assert.notEqual(result.status, 0); assert.equal(result.stdout, '');
  await assert.rejects(readFile(join(f.profile, 'observed.json')), {code: 'ENOENT'});
});

test('disabled plugin is a silent no-op and unavailable installed cache is a real failure', async t => {
  const f = await fixture(t); assert.equal(f.install().status, 0);
  const directory = await f.installed('3.0.0', {enabled: false}); successful(f.invoke());
  await assert.rejects(readFile(join(f.profile, 'observed.json')), {code: 'ENOENT'});
  await f.installed('3.0.0'); await rm(directory, {recursive: true});
  const failed = f.invoke(); assert.notEqual(failed.status, 0); assert.equal(failed.stdout, ''); assert.match(failed.stderr, /cache|ENOENT/);
});

test('launcher rejects caches symlinked to another profile', async t => {
  const f = await fixture(t); assert.equal(f.install().status, 0);
  const directory = await f.installed('4.0.0');
  const outside = join(f.root, 'other-profile-plugin');
  await mkdir(join(outside, 'background-wake'), {recursive: true});
  await writeFile(join(outside, 'background-wake/cli.mjs'), 'process.exit(0);');
  await rm(join(directory, 'background-wake'), {recursive: true});
  await symlink(join(outside, 'background-wake'), join(directory, 'background-wake'));
  const result = f.invoke(); assert.notEqual(result.status, 0); assert.equal(result.stdout, ''); assert.match(result.stderr, /profile|cache/);
});

test('child failures propagate and accidental stdout never becomes hook response JSON', async t => {
  const f = await fixture(t); assert.equal(f.install().status, 0);
  await f.installed('5.0.0', {exit: 7, stderr: 'real launch failure'});
  let result = f.invoke(); assert.equal(result.status, 7); assert.equal(result.stdout, ''); assert.match(result.stderr, /real launch failure/);
  await f.installed('5.0.1', {stdout: '{"unexpected":true}'});
  result = f.invoke(); assert.notEqual(result.status, 0); assert.equal(result.stdout, ''); assert.match(result.stderr, /stdout|output/);
});

test('malformed hook configuration is left byte-identical by installer', async t => {
  const f = await fixture(t); const file = join(f.profile, 'hooks.json');
  await writeFile(file, '{bad-json'); assert.notEqual(f.install().status, 0);
  assert.equal(await readFile(file, 'utf8'), '{bad-json');
});
