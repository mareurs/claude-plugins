#!/usr/bin/env node
// Installed outside the versioned cache so plugin upgrades cannot remove this entry point.
import {readFile, writeFile, mkdir, realpath, rename, copyFile} from 'node:fs/promises';
import {constants} from 'node:fs';
import {dirname, join, relative, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';

const command = 'node "${CODEX_HOME:-$HOME/.codex}/hooks/codescout-wake.mjs"';
const toolMatcher = 'mcp__codescout__run_command';
const script = fileURLToPath(import.meta.url);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

async function readJson(path, fallback) {
  try {return JSON.parse(await readFile(path, 'utf8'));}
  catch (error) {if (error.code === 'ENOENT' && fallback !== undefined) return fallback; throw error;}
}

async function atomicWrite(path, bytes, mode) {
  const temporary = path + '.' + randomUUID() + '.tmp';
  await writeFile(temporary, bytes, {mode, flag: 'wx'});
  await rename(temporary, path);
}

function previousWakeHook(hook) {
  return typeof hook?.command === 'string' && (
    hook.command === command ||
    /(?:^|[\\/])background-wake[\\/]cli\.mjs['"]?\s+launch\s+--harness\s+codex(?:\s|$)/.test(hook.command)
  );
}

async function install(profilePath) {
  if (!profilePath) throw new Error('installation requires --profile PATH');
  const profile = await realpath(resolve(profilePath));
  const hookPath = join(profile, 'hooks.json');
  const document = await readJson(hookPath, {});
  if (!object(document) || document.hooks !== undefined && !object(document.hooks)) throw new Error('invalid hooks.json object');
  document.hooks ??= {};
  const groups = document.hooks.PostToolUse ?? [];
  if (!Array.isArray(groups) || groups.some(group => !object(group) || !Array.isArray(group.hooks))) throw new Error('invalid PostToolUse hook groups');
  document.hooks.PostToolUse = groups.flatMap(group => {
    if (group.matcher !== toolMatcher) return [group];
    const hooks = group.hooks.filter(hook => !previousWakeHook(hook));
    return hooks.length ? [{...group, hooks}] : [];
  });
  document.hooks.PostToolUse.push({matcher: toolMatcher, hooks: [{type: 'command', command}]});
  const bytes = JSON.stringify(document, null, 2) + '\n';
  const directory = join(profile, 'hooks');
  await mkdir(directory, {recursive: true, mode: 0o700});
  const destination = join(directory, 'codescout-wake.mjs');
  const source = await readFile(script);
  await atomicWrite(destination, source, 0o700);
  let previous;
  try {previous = await readFile(hookPath, 'utf8');}
  catch (error) {if (error.code !== 'ENOENT') throw error;}
  if (previous !== bytes) {
    if (previous !== undefined) {
      try {await copyFile(hookPath, hookPath + '.before-versionless-wake', constants.COPYFILE_EXCL);}
      catch (error) {if (error.code !== 'EEXIST') throw error;}
    }
    await atomicWrite(hookPath, bytes, 0o600);
  }
}

async function installedCli(profile) {
  // Codex is the authority on selection: a newer cached directory may be a rolled-back version.
  const result = spawnSync('codex', ['plugin', 'list', '--json'], {
    env: {...process.env, CODEX_HOME: profile}, encoding: 'utf8', timeout: 15000, maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) throw new Error('cannot query installed Codex plugins');
  const registry = JSON.parse(result.stdout);
  if (!Array.isArray(registry.installed)) throw new Error('invalid Codex plugin listing');
  const matches = registry.installed.filter(plugin => plugin.name === 'codescout-companion' && plugin.installed === true && plugin.enabled === true);
  if (matches.length === 0) return null;
  if (matches.length !== 1) throw new Error('ambiguous installed companion plugins');
  const plugin = matches[0];
  const component = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._+-]*$/.test(value);
  if (!component(plugin.marketplaceName) || !component(plugin.version)) throw new Error('invalid installed plugin cache identity');
  const directory = join(profile, 'plugins', 'cache', plugin.marketplaceName, 'codescout-companion', plugin.version);
  const cli = await realpath(join(directory, 'background-wake', 'cli.mjs'));
  const location = relative(profile, cli);
  if (!location.startsWith(['plugins', 'cache', ''].join(sep))) throw new Error('plugin cache belongs to another profile');
  const manifest = await readJson(join(directory, '.claude-plugin', 'plugin.json'));
  if (manifest.name !== plugin.name || manifest.version !== plugin.version) throw new Error('installed plugin cache manifest mismatch');
  return cli;
}

async function launch() {
  // Bind to the launcher's own profile even when callers inherit a different CODEX_HOME.
  const profile = await realpath(dirname(dirname(script)));
  const config = await readJson(join(profile, 'codescout-wake.json'), null);
  if (config === null) return;
  if (!object(config) || typeof config.profileRoot !== 'string' || await realpath(config.profileRoot) !== profile) throw new Error('wake configuration belongs to another profile');
  if (typeof config.environmentId !== 'string' || !config.environmentId.trim()) throw new Error('wake configuration needs environmentId');
  if (config.adapters?.codex?.enabled === false) return;
  if (config.adapters?.codex?.enabled !== true) throw new Error('wake configuration needs an explicit Codex adapter switch');
  const cli = await installedCli(profile);
  if (!cli) return;
  const result = spawnSync(process.execPath, [cli, 'launch', '--harness', 'codex', '--profile', profile, '--environment', config.environmentId], {
    env: {...process.env, CODEX_HOME: profile}, stdio: ['inherit', 'pipe', 'pipe'], encoding: 'utf8', timeout: 20000, maxBuffer: 64 * 1024,
  });
  if (result.stderr) process.stderr.write(result.stderr.slice(0, 2000));
  if (result.error || result.signal) throw new Error('background wake launch did not complete');
  if (result.stdout) throw new Error('unexpected stdout from background wake launch');
  process.exitCode = result.status;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 3 && args[0] === '--install' && args[1] === '--profile') return install(args[2]);
  if (args.length !== 0) throw new Error('usage: codex-hook.mjs [--install --profile PATH]');
  return launch();
}

main().catch(error => {
  process.stderr.write('codescout-wake: ' + String(error.message).replace(/[\r\n]+/g, ' ').slice(0, 1000) + '\n');
  process.exitCode = 1;
});
