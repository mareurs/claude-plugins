// proxy.test.mjs — proxy.mjs against a SCRIPTED docker: the argv it sends and, above all, what it
// refuses to touch. Nothing here starts a container or talks to a daemon. The behaviour on a real
// daemon (the filter, the network, the proxy's log) is pinned by images.test.mjs, which runs only
// with S5_DOCKER_TESTS=1.
//
// The fake keeps a tiny world in a JSON file (containers and networks, ours and foreign), applies
// run / rm / network create / network rm to it, and records every call. `rm` and `stop` take effect
// only on full 64-hex IDs, so a call by NAME has no effect and shows up in the assertions below.

import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { t } from '../../core/testkit.mjs';
import { ta } from './fixtures/testkit-async.mjs';
import { hostPattern, proxyDown, proxyLog, proxyUp, renderProxyConfig } from './proxy.mjs';

const made = [];
process.on('exit', () => {
  for (const d of made) rmSync(d, { recursive: true, force: true });
});

const shq = (s) => `'${String(s).replaceAll("'", `'\\''`)}'`;

const FAKE_SRC = `
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
const LOG = process.env.FAKE_LOG;
const CFG = process.env.FAKE_CFG;
const argv = process.argv.slice(2);
const st = JSON.parse(readFileSync(CFG, 'utf8'));
appendFileSync(LOG, JSON.stringify(argv) + '\\n');
const save = () => writeFileSync(CFG, JSON.stringify(st));
const out = (s) => process.stdout.write(s);
const isId = (a) => /^[0-9a-f]{64}$/.test(a);
const filters = argv.flatMap((a, i) => (a === '--filter' ? [argv[i + 1]] : []));
const [a0, a1] = argv;
if (a0 === 'ps') {
  const hits = st.containers.filter((c) => filters.every((f) => {
    const [k, ...v] = f.split('=');
    const val = v.join('=');
    if (k === 'label') {
      const [lk, ...lv] = val.split('=');
      return Object.hasOwn(c.labels, lk) && (lv.length === 0 || c.labels[lk] === lv.join('='));
    }
    if (k === 'name') return new RegExp(val).test('/' + c.name);
    return false;
  }));
  out(hits.map((c) => c.id + '\\n').join(''));
} else if (a0 === 'network' && a1 === 'ls') {
  const f = filters[0].split('=')[1];
  out(st.networks.filter((n) => n.name.includes(f)).map((n) => n.id + '\\t' + n.name + '\\t' + (n.labels.s5 ?? '') + '\\n').join(''));
} else if (a0 === 'network' && a1 === 'inspect') {
  const n = st.networks.find((x) => x.id === argv.at(-1));
  out(n.internal + '\\t' + n.attached + '\\t' + n.subnets.join(' ') + ' \\n');
} else if (a0 === 'network' && a1 === 'create') {
  st.networks.push({ id: 'ee'.repeat(32), name: argv.at(-1), labels: { s5: '1' }, internal: argv.includes('--internal'), attached: 0, subnets: ['172.30.0.0/16'] });
  save();
} else if (a0 === 'network' && a1 === 'rm') {
  st.networks = st.networks.filter((n) => n.id !== argv.at(-1));
  save();
} else if (a0 === 'run') {
  const labels = {};
  argv.forEach((a, i) => { if (a === '--label') { const [k, ...v] = argv[i + 1].split('='); labels[k] = v.join('='); } });
  st.containers.push({ id: st.runId, name: argv[argv.indexOf('--name') + 1], labels });
  save();
  out(st.runId + '\\n');
} else if (a0 === 'inspect') {
  out('true\\n');
} else if (a0 === 'exec') {
  process.exit(st.execStatus ?? 0);
} else if (a0 === 'rm') {
  const ids = argv.filter(isId);
  st.containers = st.containers.filter((c) => !ids.includes(c.id));
  save();
} else if (a0 === 'logs') {
  out('fake log\\n');
}
`;

// fakeDocker(world) -> { bin, calls(), world(), dir }
function fakeDocker(world = {}) {
  const dir = mkdtempSync(join(tmpdir(), 's5-proxy-test-'));
  made.push(dir);
  const log = join(dir, 'log.jsonl');
  const cfg = join(dir, 'world.json');
  const script = join(dir, 'fake.mjs');
  writeFileSync(script, FAKE_SRC);
  writeFileSync(cfg, JSON.stringify({ containers: [], networks: [], runId: 'c0'.repeat(32), ...world }));
  const bin = join(dir, 'docker');
  writeFileSync(bin, `#!/bin/sh\nexport FAKE_LOG=${shq(log)} FAKE_CFG=${shq(cfg)}\nexec ${shq(process.execPath)} ${shq(script)} "$@"\n`);
  chmodSync(bin, 0o755);
  const calls = () => (existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
  return { bin, dir, calls, world: () => JSON.parse(readFileSync(cfg, 'utf8')) };
}

const OURS_ID = 'ab'.repeat(32);
const FOREIGN_ID = 'f0'.repeat(32);
const AGENT_ID = '5a'.repeat(32);
const NET_ID = 'dd'.repeat(32);
const oursProxy = () => ({ id: OURS_ID, name: 's5-proxy', labels: { s5: '1', 's5.run': 's5-proxy' } });
const ourNet = (over = {}) => ({ id: NET_ID, name: 's5-internal', labels: { s5: '1' }, internal: true, attached: 0, subnets: ['172.30.0.0/16'], ...over });
const word = (c) => (c[0] === 'network' ? `network ${c[1]}` : c[0]);
// Calls that create, change or remove something. A refusal must make none of them.
const MUTATING = new Set(['run', 'rm', 'stop', 'kill', 'network create', 'network rm', 'network connect']);
const mutations = (f) => f.calls().filter((c) => MUTATING.has(word(c)));
const adjacent = (argv, ...seq) => argv.some((_, i) => seq.every((s, j) => argv[i + j] === s));

const TEMPLATE = readFileSync(new URL('./images/tinyproxy.conf.tmpl', import.meta.url), 'utf8');
const SUBNETS = ['172.30.0.0/16'];
const lines = (s) => s.split('\n');

// ---- hostPattern, renderProxyConfig: pure ---------------------------------------------------

t('hostPattern anchors the host at both ends and escapes its dots', () => {
  assert.equal(hostPattern('api.anthropic.com'), '^api\\.anthropic\\.com$');
  assert.equal(hostPattern('API.Anthropic.COM'), '^api\\.anthropic\\.com$', 'host names are case-insensitive');
  assert.equal(hostPattern('localhost'), '^localhost$');
  assert.equal(hostPattern('a-b.example'), '^a-b\\.example$');
});

t('hostPattern refuses anything that is not a plain host name', () => {
  for (const bad of ['', ' ', 'https://api.anthropic.com', 'api.anthropic.com:443', 'api.anthropic.com/', '*.anthropic.com', 'a..b', '.a.com', 'a.com.', '-a.com', 'a b.com', 'a.com\n^.*$', '^.*$', 'a|b', undefined, null, 5, ['a.com']]) {
    assert.throws(() => hostPattern(bad), TypeError, JSON.stringify(bad));
  }
});

t('renderProxyConfig in allowlist mode: default deny, the filter file, one anchored pattern per host, CONNECT to 443 only', () => {
  const { conf, filter } = renderProxyConfig(TEMPLATE, { mode: 'allowlist', allowlist: ['api.anthropic.com', 'statsig.anthropic.com', 'api.anthropic.com'], subnets: ['172.30.0.0/16', '172.31.0.0/24'] });
  const l = lines(conf);
  assert.ok(l.includes('FilterDefaultDeny Yes'));
  assert.ok(l.includes('FilterType ere'));
  assert.ok(l.includes('Filter "/etc/s5-proxy/filter"'));
  assert.ok(l.includes('ConnectPort 443'));
  assert.ok(l.includes('Allow 127.0.0.1') && l.includes('Allow 172.30.0.0/16') && l.includes('Allow 172.31.0.0/24'));
  assert.ok(l.includes('Port 8888'));
  assert.deepEqual(lines(conf).filter((x) => !x.startsWith('#') && x.includes('@@')), [], 'no placeholder line is left');
  assert.equal(filter, '^api\\.anthropic\\.com$\n^statsig\\.anthropic\\.com$\n', 'one pattern per host, duplicates folded');
});

t('renderProxyConfig in log-all mode: no filter at all, so nothing is refused', () => {
  const { conf, filter } = renderProxyConfig(TEMPLATE, { mode: 'log-all', subnets: SUBNETS });
  assert.equal(filter, null);
  assert.doesNotMatch(conf, /^Filter/m);
  assert.deepEqual(lines(conf).filter((x) => !x.startsWith('#') && x.includes('@@')), [], 'no placeholder line is left');
  assert.ok(lines(conf).includes('ConnectPort 443'));
});

t('renderProxyConfig refuses a bad call: unknown mode, empty allowlist, an allowlist in log-all, bad subnets, a template without its placeholders', () => {
  assert.throws(() => renderProxyConfig(TEMPLATE, { mode: 'open', subnets: SUBNETS }), /mode/);
  assert.throws(() => renderProxyConfig(TEMPLATE, { mode: 'allowlist', allowlist: [], subnets: SUBNETS }), /allowlist/);
  assert.throws(() => renderProxyConfig(TEMPLATE, { mode: 'allowlist', subnets: SUBNETS }), /allowlist/);
  assert.throws(() => renderProxyConfig(TEMPLATE, { mode: 'log-all', allowlist: ['a.com'], subnets: SUBNETS }), /log-all/);
  assert.throws(() => renderProxyConfig(TEMPLATE, { mode: 'allowlist', allowlist: ['a.com'], subnets: [] }), /subnets/);
  assert.throws(() => renderProxyConfig(TEMPLATE, { mode: 'allowlist', allowlist: ['a.com'], subnets: ['any'] }), /subnets/);
  assert.throws(() => renderProxyConfig('Port 8888\n', { mode: 'log-all', subnets: SUBNETS }), /@@ALLOW@@/);
});

// ---- proxyUp, proxyDown, proxyLog against the scripted docker --------------------------------

await ta('proxyUp: creates the internal network, writes the config, starts the labelled container, attaches the bridge, by ID', async () => {
  const f = fakeDocker();
  const out = join(f.dir, 'work');
  const up = await proxyUp({ mode: 'allowlist', allowlist: ['api.anthropic.com'], dockerBin: f.bin, workRoot: out, readyTimeoutMs: 2000 });
  const calls = f.calls();
  const create = calls.find((c) => word(c) === 'network create');
  assert.deepEqual(create, ['network', 'create', '--internal', '--label', 's5=1', 's5-internal']);
  const run = calls.find((c) => c[0] === 'run');
  assert.ok(run.includes('-d') && run.includes('--pull=never'));
  assert.ok(adjacent(run, '--name', 's5-proxy') && adjacent(run, '--label', 's5=1') && adjacent(run, '--label', 's5.run=s5-proxy'));
  assert.ok(adjacent(run, '--network', 's5-internal'));
  assert.ok(run.includes('--read-only') && adjacent(run, '--cap-drop', 'ALL'));
  assert.ok(adjacent(run, '--mount', `type=bind,source=${out}/proxy,target=/etc/s5-proxy,readonly`), 'the config is mounted read-only');
  assert.equal(run.at(-1), 's5/proxy');
  // The bridge is attached by the ID docker printed, after the run and before anything else uses it.
  const names = calls.map(word);
  assert.ok(names.indexOf('network create') < names.indexOf('run') && names.indexOf('run') < names.indexOf('network connect'));
  assert.deepEqual(calls.find((c) => word(c) === 'network connect'), ['network', 'connect', 'bridge', 'c0'.repeat(32)]);
  assert.equal(up.id, 'c0'.repeat(32));
  assert.equal(up.url, 'http://s5-proxy:8888');
  // The files the container will mount.
  assert.match(readFileSync(join(out, 'proxy', 'tinyproxy.conf'), 'utf8'), /FilterDefaultDeny Yes/);
  assert.equal(readFileSync(join(out, 'proxy', 'filter'), 'utf8'), '^api\\.anthropic\\.com$\n');
  assert.match(readFileSync(join(out, 'proxy', 'tinyproxy.conf'), 'utf8'), /^Allow 172\.30\.0\.0\/16$/m, 'the subnet of s5-internal');
});

await ta('proxyUp: log-all mode writes no filter, and a stale filter file of an earlier allowlist run is removed', async () => {
  const f = fakeDocker({ networks: [ourNet()] });
  const out = join(f.dir, 'work');
  await proxyUp({ mode: 'allowlist', allowlist: ['a.example'], dockerBin: f.bin, workRoot: out, readyTimeoutMs: 2000 });
  assert.ok(existsSync(join(out, 'proxy', 'filter')));
  await proxyDown({ dockerBin: f.bin });
  await proxyUp({ mode: 'log-all', dockerBin: f.bin, workRoot: out, readyTimeoutMs: 2000 });
  assert.equal(existsSync(join(out, 'proxy', 'filter')), false);
  assert.doesNotMatch(readFileSync(join(out, 'proxy', 'tinyproxy.conf'), 'utf8'), /^Filter/m);
});

await ta('proxyUp refuses, and changes nothing, when it must not start', async () => {
  const cases = [
    ['our s5-proxy already exists: run proxyDown first', { containers: [oursProxy()], networks: [ourNet()] }, /proxyDown/],
    ['a foreign container holds the name s5-proxy', { containers: [{ id: FOREIGN_ID, name: 's5-proxy', labels: { owner: 'someone-else' } }], networks: [ourNet()] }, /not ours/],
    ['a foreign network is named s5-internal', { networks: [ourNet({ labels: {} })] }, /not ours/],
    ['s5-internal carries our label but has a route out', { networks: [ourNet({ internal: false })] }, /not --internal/],
  ];
  for (const [what, world, re] of cases) {
    const f = fakeDocker(world);
    await assert.rejects(() => proxyUp({ mode: 'log-all', dockerBin: f.bin, workRoot: join(f.dir, 'work'), readyTimeoutMs: 500 }), re, what);
    assert.deepEqual(mutations(f), [], `${what}: nothing may be created, started, attached or removed`);
    assert.equal(existsSync(join(f.dir, 'work')), false, `${what}: no file is written`);
  }
});

await ta('proxyUp validates its options before it calls docker at all', async () => {
  const f = fakeDocker();
  for (const bad of [{ mode: 'open' }, { mode: 'allowlist' }, { mode: 'allowlist', allowlist: ['https://a.com'] }, { mode: 'log-all', allowlist: ['a.com'] }, {}]) {
    await assert.rejects(() => proxyUp({ ...bad, dockerBin: f.bin, workRoot: join(f.dir, 'work') }), TypeError, JSON.stringify(bad));
  }
  assert.deepEqual(f.calls(), []);
});

await ta('proxyUp: a proxy that never accepts connections is removed by ID, and the error carries its log', async () => {
  const f = fakeDocker({ execStatus: 1 });
  await assert.rejects(() => proxyUp({ mode: 'log-all', dockerBin: f.bin, workRoot: join(f.dir, 'work'), readyTimeoutMs: 300 }), /did not accept connections[^]*fake log/);
  const rm = f.calls().filter((c) => c[0] === 'rm');
  assert.deepEqual(rm, [['rm', '-f', 'c0'.repeat(32)]]);
  assert.deepEqual(f.world().containers, [], 'nothing of ours is left');
});

await ta('proxyDown: stops and removes only our s5-proxy, by ID, and the network only when it is ours and unattached', async () => {
  const world = {
    containers: [
      oursProxy(),
      // Not ours: a tenant that copied the s5.run label but has no s5=1, a tenant named s5-proxy-x,
      // and one of OUR agent containers (s5=1, but not the proxy).
      { id: FOREIGN_ID, name: 'whatever', labels: { 's5.run': 's5-proxy' } },
      { id: '77'.repeat(32), name: 's5-proxy-x', labels: { owner: 'someone-else' } },
      { id: AGENT_ID, name: 's5-run-1', labels: { s5: '1', 's5.run': 's5-run-1' } },
    ],
    networks: [ourNet()],
  };
  const f = fakeDocker(world);
  assert.deepEqual(await proxyDown({ dockerBin: f.bin }), { removedContainers: 1, network: 'removed' });
  const calls = f.calls();
  const acted = calls.filter((c) => c[0] === 'stop' || c[0] === 'rm');
  assert.deepEqual(acted, [['stop', '--time', '5', OURS_ID], ['rm', '-f', OURS_ID]], 'only our proxy, only by its full ID');
  assert.deepEqual(calls.find((c) => word(c) === 'network rm'), ['network', 'rm', NET_ID]);
  assert.deepEqual(f.world().containers.map((c) => c.id).sort(), ['77'.repeat(32), AGENT_ID, FOREIGN_ID].sort());
  // The lookup asked for both labels.
  const ps = calls.find((c) => c[0] === 'ps');
  assert.ok(adjacent(ps, '--filter', 'label=s5=1') && adjacent(ps, '--filter', 'label=s5.run=s5-proxy'));
});

await ta('proxyDown: the network is kept while something is attached, kept when it is not ours, and a second call is a no-op', async () => {
  const cases = [
    ['in-use', ourNet({ attached: 2 })],
    ['not-ours', ourNet({ labels: {} })],
  ];
  for (const [expected, net] of cases) {
    const f = fakeDocker({ networks: [net] });
    assert.deepEqual(await proxyDown({ dockerBin: f.bin }), { removedContainers: 0, network: expected });
    assert.deepEqual(mutations(f), [], expected);
  }
  const none = fakeDocker();
  assert.deepEqual(await proxyDown({ dockerBin: none.bin }), { removedContainers: 0, network: 'absent' });
  assert.deepEqual(mutations(none), []);
});

await ta('proxyLog: returns the log of our proxy; with none, or with two, it throws', async () => {
  const one = fakeDocker({ containers: [oursProxy()] });
  assert.equal(await proxyLog({ dockerBin: one.bin }), 'fake log\n');
  assert.deepEqual(one.calls().find((c) => c[0] === 'logs'), ['logs', OURS_ID]);
  await assert.rejects(() => proxyLog({ dockerBin: fakeDocker().bin }), /found 0/);
  const two = fakeDocker({ containers: [oursProxy(), { ...oursProxy(), id: '12'.repeat(32) }] });
  await assert.rejects(() => proxyLog({ dockerBin: two.bin }), /found 2/);
});
