// proxy.mjs — the S5 harness's allowlisting CONNECT proxy and the internal network it serves.
//
// Agent containers run on `s5-internal`, a docker network created with --internal: it has no
// gateway, so a container on it has no route to the internet. The only other container on that
// network is `s5-proxy` (tinyproxy), which is ALSO attached to the default bridge and so is the
// one way out. In `allowlist` mode it passes a CONNECT only to the hosts on the list and to port
// 443; in `log-all` mode (pilot discovery only) it passes everything and records every host.
//
// The host runs about 20 unrelated containers, so everything here follows the ownership rule of
// docker.mjs: the proxy container is found by its LABEL (`ps -aq --no-trunc --filter
// label=s5.run=s5-proxy`, with s5=1 as well), every later call acts on the full ID that lookup
// returned, and a container or a network that carries no s5=1 label is never stopped, removed,
// connected or disconnected. Nothing is pruned.
//
//   proxyUp({ mode, allowlist?, dockerBin?, workRoot? })  -> { id, mode, allowlist, network, subnets, url, dir }
//   proxyDown({ dockerBin? })                             -> { removedContainers, network }
//   proxyLog({ dockerBin? })                              -> string (what `docker logs` returned)
//
// proxyLog reads `docker logs <id>`: tinyproxy runs in the foreground (-d) and writes its log to
// stderr, so no log file is configured and nothing is written to the host.
//
// Nothing here is shell-parsed: docker is spawned with an argv array, with a whitelisted
// environment.

import { execFile } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOCKER_PASSTHROUGH } from './docker.mjs';

export const PROXY_NAME = 's5-proxy';
export const NETWORK = 's5-internal';
export const PROXY_IMAGE = 's5/proxy';
export const PROXY_PORT = 8888;
export const PROXY_URL = `http://${PROXY_NAME}:${PROXY_PORT}`;
export const DEFAULT_WORK_ROOT = join(homedir(), 'work', 'claude', 's5-work');

// Where the config directory is mounted in the container (see proxy.Dockerfile).
const CONF_MOUNT = '/etc/s5-proxy';
const TEMPLATE = fileURLToPath(new URL('./images/tinyproxy.conf.tmpl', import.meta.url));
const HELPER_TIMEOUT_MS = 60_000;
const READY_TIMEOUT_MS = 20_000;

// Lower-case host names: dot-separated labels of [a-z0-9-], no wildcard, no port, no scheme.
const HOST_RE = /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/;
const SUBNET_RE = /^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/;
const ID_RE = /^[0-9a-f]{64}$/;
// The only variables a docker process inherits from this one: docker.mjs's list (one definition, R152).

function baseEnv() {
  const env = {};
  for (const k of DOCKER_PASSTHROUGH) if (process.env[k] !== undefined) env[k] = process.env[k];
  return env;
}

// `docker <args>` -> { status, stdout, stderr }. status is the exit status, or null when docker
// could not run or was killed (timeout). Never rejects.
function dock(bin, args, timeoutMs) {
  return new Promise((resolve) => {
    const child = execFile(bin, args, { env: baseEnv(), encoding: 'utf8', timeout: timeoutMs, killSignal: 'SIGKILL', maxBuffer: 256 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (!error) resolve({ status: 0, stdout, stderr });
      else resolve({ status: typeof error.code === 'number' ? error.code : null, stdout: stdout ?? '', stderr: `${stderr ?? ''}${typeof error.code === 'number' ? '' : error.message}` });
    });
    child.stdin?.end();
  });
}

// dock() that throws unless docker exited 0. The message carries docker's stderr.
async function must(bin, args, timeoutMs, what) {
  const r = await dock(bin, args, timeoutMs);
  if (r.status !== 0) throw new Error(`${what} failed (docker ${args[0]} ${args[1] ?? ''}: ${r.status === null ? 'did not run or timed out' : `exit ${r.status}`}): ${r.stderr.trim()}`);
  return r.stdout;
}

const words = (s) => s.split(/\s+/).filter(Boolean);

// The anchored, dot-escaped extended regex tinyproxy's filter matches a host name against.
// `api.anthropic.com` -> `^api\.anthropic\.com$`: neither a longer name that merely contains it
// (`api.anthropic.com.evil.example`, `xapi.anthropic.com`) nor a one-character stand-in for a dot
// (`apixanthropic.com`) matches. Throws TypeError for anything that is not a plain host name.
export function hostPattern(host) {
  const h = typeof host === 'string' ? host.toLowerCase() : host;
  if (typeof h !== 'string' || !HOST_RE.test(h)) throw new TypeError(`proxy allowlist: ${JSON.stringify(host)} is not a plain host name (no scheme, port, path or wildcard)`);
  return `^${h.replaceAll('.', '\\.')}$`;
}

// renderProxyConfig(template, { mode, allowlist, subnets }) -> { conf, filter }
//   conf    the tinyproxy.conf text: the template with @@ALLOW@@ and @@FILTER@@ (each on a line of
//           its own) replaced by whole lines
//   filter  allowlist mode: the filter file text, one anchored pattern per host; log-all: null
export function renderProxyConfig(template, { mode, allowlist, subnets }) {
  if (mode !== 'allowlist' && mode !== 'log-all') throw new TypeError(`proxy mode must be 'allowlist' or 'log-all', got ${JSON.stringify(mode)}`);
  if (!Array.isArray(subnets) || subnets.length === 0 || !subnets.every((s) => typeof s === 'string' && SUBNET_RE.test(s))) {
    throw new TypeError(`proxy subnets must be a non-empty array of IPv4 CIDR strings, got ${JSON.stringify(subnets)}`);
  }
  let filter = null;
  let filterLines = [];
  if (mode === 'allowlist') {
    if (!Array.isArray(allowlist) || allowlist.length === 0) throw new TypeError('proxy allowlist mode needs a non-empty allowlist array');
    filter = `${[...new Set(allowlist.map(hostPattern))].join('\n')}\n`;
    // Default deny: a host that matches no pattern is refused. Extended regexes, matched against
    // the host name only (not the URL), case-insensitively as DNS names are.
    filterLines = ['FilterDefaultDeny Yes', 'FilterType ere', 'FilterURLs Off', 'FilterCaseSensitive Off', `Filter "${CONF_MOUNT}/filter"`];
  } else if (allowlist !== undefined) {
    throw new TypeError("proxy log-all mode takes no allowlist: it passes every host. Use mode 'allowlist' to restrict");
  }
  const allowLines = subnets.map((s) => `Allow ${s}`);
  const out = [];
  const seen = { allow: 0, filter: 0 };
  for (const line of template.split('\n')) {
    if (line === '@@ALLOW@@') {
      seen.allow += 1;
      out.push(...allowLines);
    } else if (line === '@@FILTER@@') {
      seen.filter += 1;
      out.push(...filterLines);
    } else {
      out.push(line);
    }
  }
  if (seen.allow !== 1 || seen.filter !== 1) throw new Error(`tinyproxy.conf.tmpl must have exactly one @@ALLOW@@ line and one @@FILTER@@ line (found ${seen.allow} and ${seen.filter})`);
  return { conf: out.join('\n'), filter };
}

// Our proxy container(s): the label lookup, with s5=1 required as well.
async function oursIds(bin, timeoutMs) {
  const out = await must(bin, ['ps', '-aq', '--no-trunc', '--filter', 'label=s5=1', '--filter', `label=s5.run=${PROXY_NAME}`], timeoutMs, 'looking up the proxy container');
  return words(out);
}

// The network named s5-internal, if there is one: { id, ours, internal, attached, subnets } or
// null. docker's `name` filter is a substring match, so the exact name is checked here.
async function findNetwork(bin, timeoutMs) {
  const out = await must(bin, ['network', 'ls', '--no-trunc', '--filter', `name=${NETWORK}`, '--format', '{{.ID}}\t{{.Name}}\t{{.Label "s5"}}'], timeoutMs, 'listing networks');
  const rows = out.split('\n').filter(Boolean).map((l) => l.split('\t')).filter((c) => c[1] === NETWORK);
  if (rows.length === 0) return null;
  const [id, , label] = rows[0];
  const info = await must(bin, ['network', 'inspect', '--format', '{{.Internal}}\t{{len .Containers}}\t{{range .IPAM.Config}}{{.Subnet}} {{end}}', id], timeoutMs, 'inspecting the network');
  const [internal, attached, subnets] = info.trim().split('\t');
  return { id, ours: label === '1', internal: internal === 'true', attached: Number(attached), subnets: words(subnets ?? '').filter((s) => SUBNET_RE.test(s)) };
}

// Create s5-internal when it does not exist; refuse one that is not ours or not internal (a
// network we did not make, or one with a route out, would defeat the whole point).
async function ensureNetwork(bin, timeoutMs) {
  let net = await findNetwork(bin, timeoutMs);
  if (net === null) {
    const created = await dock(bin, ['network', 'create', '--internal', '--label', 's5=1', NETWORK], timeoutMs);
    net = await findNetwork(bin, timeoutMs); // also covers a creator that won the race
    if (net === null) throw new Error(`creating network ${NETWORK} failed: ${created.stderr.trim()}`);
  }
  if (!net.ours) throw new Error(`a network named ${NETWORK} exists and does not carry the label s5=1: it is not ours, and it is left alone. Refusing to start the proxy on it`);
  if (!net.internal) throw new Error(`network ${NETWORK} carries s5=1 but is not --internal (it has a route out). Remove it (docker network rm ${NETWORK}) and run proxyUp again`);
  if (net.subnets.length === 0) throw new Error(`network ${NETWORK} has no IPv4 subnet`);
  return net;
}

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

// Wait until tinyproxy accepts a connection, probed from inside its own container (portable: it
// does not need a route from the host to the bridge). A container that exited is reported with its
// log, not waited for.
async function waitReady(bin, id, timeoutMs, helperMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const state = await dock(bin, ['inspect', '--format', '{{.State.Running}}', id], helperMs);
    if (state.status === 0 && state.stdout.trim() === 'false') {
      const logs = await dock(bin, ['logs', id], helperMs);
      throw new Error(`the proxy container exited before it was ready:\n${logs.stdout}${logs.stderr}`);
    }
    const probe = await dock(bin, ['exec', id, 'bash', '-c', `exec 3<>/dev/tcp/127.0.0.1/${PROXY_PORT}`], helperMs);
    if (probe.status === 0) return;
    if (Date.now() >= deadline) {
      const logs = await dock(bin, ['logs', id], helperMs);
      throw new Error(`the proxy did not accept connections within ${timeoutMs} ms:\n${logs.stdout}${logs.stderr}`);
    }
    await sleep(250);
  }
}

// proxyUp({ mode: 'allowlist' | 'log-all', allowlist?: string[], dockerBin?, workRoot?, helperTimeoutMs?, readyTimeoutMs? })
// Creates the network if needed, writes the configuration under <workRoot>/proxy/ (default
// ~/work/claude/s5-work/proxy), starts the detached container s5-proxy on s5-internal and then
// attaches it to the default bridge. Refuses when a container named s5-proxy exists already (ours:
// run proxyDown; not ours: left alone) or when s5-internal is not ours. A proxy that does not
// accept connections within readyTimeoutMs (20 s) is removed again and proxyUp throws with its log.
export async function proxyUp({ mode, allowlist, dockerBin = 'docker', workRoot = DEFAULT_WORK_ROOT, helperTimeoutMs = HELPER_TIMEOUT_MS, readyTimeoutMs = READY_TIMEOUT_MS } = {}) {
  // Validate before anything is created.
  validateProxyOptions(mode, allowlist);

  const existing = await oursIds(dockerBin, helperTimeoutMs);
  if (existing.length > 0) throw new Error(`a container named ${PROXY_NAME} already exists (${existing[0].slice(0, 12)}): run proxyDown() first`);
  const named = words(await must(dockerBin, ['ps', '-aq', '--no-trunc', '--filter', `name=^/${PROXY_NAME}$`], helperTimeoutMs, 'looking up the proxy name'));
  if (named.length > 0) throw new Error(`a container named ${PROXY_NAME} exists and is not ours (no s5=1 label); it is left alone. Refusing to start the proxy`);

  const net = await ensureNetwork(dockerBin, helperTimeoutMs);
  const { conf, filter } = renderProxyConfig(readFileSync(TEMPLATE, 'utf8'), { mode, allowlist, subnets: net.subnets });
  const dir = join(workRoot, 'proxy');
  // A comma ends a field in the --mount grammar.
  if (dir.includes(',')) throw new Error(`the proxy config directory must not contain a comma: ${dir}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'tinyproxy.conf'), conf);
  if (filter === null) rmSync(join(dir, 'filter'), { force: true });
  else writeFileSync(join(dir, 'filter'), filter);

  const started = await must(dockerBin, [
    'run', '-d', '--pull=never', '--name', PROXY_NAME,
    '--label', 's5=1', '--label', `s5.run=${PROXY_NAME}`,
    '--network', NETWORK,
    '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
    '--mount', `type=bind,source=${dir},target=${CONF_MOUNT},readonly`,
    PROXY_IMAGE,
  ], helperTimeoutMs, 'starting the proxy container');
  // Act by ID from here on: the ID docker printed, or else the one the label lookup finds.
  let id = started.trim();
  if (!ID_RE.test(id)) id = (await oursIds(dockerBin, helperTimeoutMs))[0] ?? '';
  if (!ID_RE.test(id)) throw new Error(`the proxy container started but its ID could not be determined: ${JSON.stringify(started)}`);

  try {
    await must(dockerBin, ['network', 'connect', 'bridge', id], helperTimeoutMs, 'attaching the proxy to the default bridge');
    await waitReady(dockerBin, id, readyTimeoutMs, helperTimeoutMs);
  } catch (e) {
    // Never leave a half-started proxy behind.
    await dock(dockerBin, ['rm', '-f', id], helperTimeoutMs);
    throw e;
  }
  return { id, mode, allowlist: mode === 'allowlist' ? [...allowlist] : undefined, network: NETWORK, subnets: net.subnets, url: PROXY_URL, dir };
}

// Validates mode/allowlist the way renderProxyConfig would, with a dummy subnet, so proxyUp
// refuses a bad call before it touches docker.
function validateProxyOptions(mode, allowlist) {
  renderProxyConfig('@@ALLOW@@\n@@FILTER@@', { mode, allowlist, subnets: ['10.0.0.0/8'] });
}

// proxyDown({ dockerBin?, helperTimeoutMs? }) -> { removedContainers, network }
// Stops and removes the container s5-proxy when it carries s5=1 (found by label, acted on by ID),
// then removes the network s5-internal when it carries s5=1 and nothing is attached to it.
// network: 'removed' | 'absent' | 'in-use' (something is still attached) | 'not-ours'.
export async function proxyDown({ dockerBin = 'docker', helperTimeoutMs = HELPER_TIMEOUT_MS } = {}) {
  const ids = await oursIds(dockerBin, helperTimeoutMs);
  if (ids.length > 0) {
    await dock(dockerBin, ['stop', '--time', '5', ...ids], helperTimeoutMs); // best effort: rm -f below is the removal
    await must(dockerBin, ['rm', '-f', ...ids], helperTimeoutMs, 'removing the proxy container');
  }
  const net = await findNetwork(dockerBin, helperTimeoutMs);
  let network;
  if (net === null) network = 'absent';
  else if (!net.ours) network = 'not-ours';
  else if (net.attached > 0) network = 'in-use';
  else {
    await must(dockerBin, ['network', 'rm', net.id], helperTimeoutMs, 'removing the network');
    network = 'removed';
  }
  return { removedContainers: ids.length, network };
}

// proxyLog({ dockerBin?, helperTimeoutMs? }) -> string: the proxy container's log (stdout then
// stderr of `docker logs`). In log-all mode it names every CONNECT host. Throws when there is no
// proxy container of ours.
export async function proxyLog({ dockerBin = 'docker', helperTimeoutMs = HELPER_TIMEOUT_MS } = {}) {
  const ids = await oursIds(dockerBin, helperTimeoutMs);
  if (ids.length !== 1) throw new Error(`expected exactly one ${PROXY_NAME} container of ours, found ${ids.length}`);
  const r = await dock(dockerBin, ['logs', ids[0]], helperTimeoutMs);
  if (r.status !== 0) throw new Error(`docker logs failed (${r.status === null ? 'did not run or timed out' : `exit ${r.status}`}): ${r.stderr.trim()}`);
  return `${r.stdout}${r.stderr}`;
}
