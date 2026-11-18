// images.test.mjs — the S5 images, the allowlisting proxy and the internal network, against REAL
// Docker. Every container here goes through dockerRun (labels s5=1 and s5.run=<name>, removed by
// ID when it ends) and the proxy goes through proxy.mjs, so the ownership rules of both apply on
// a host that also runs other people's containers.
//
// No model call anywhere: `claude --version` and TLS handshakes only, and no request carries an
// auth header.
//
// Runs only with S5_DOCKER_TESTS=1 (it needs the images from images/build.sh, the proxy and the
// network, and it reaches the internet through the proxy). Without it the file prints one skip
// line and exits 0, so ./tests/run-all.sh stays free of Docker.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { ta } from './fixtures/testkit-async.mjs';

if (process.env.S5_DOCKER_TESTS !== '1') {
  console.log('skip - images.test.mjs needs real Docker: set S5_DOCKER_TESTS=1 to run it');
} else {
  await main();
}

async function main() {
  const { dockerRun } = await import('./docker.mjs');

  const CLAUDE_HOST = join(homedir(), '.local', 'share', 'claude', 'versions', '2.1.292');
  const CLAUDE_MOUNT = { host: CLAUDE_HOST, container: '/opt/claude/claude', readOnly: true };
  const NET = 's5-internal';
  const PROXY_URL = 'http://s5-proxy:8888';
  const CODESCOUT = 's5/codescout';
  const PLUGINS = 's5/plugins';

  let seq = 0;
  // One name per container: `s5-t4-<what>-<pid>-<n>` (dockerRun requires the s5- prefix).
  const nameOf = (what) => `s5-t4-${what}-${process.pid}-${++seq}`;

  // One foreground container through dockerRun. The container must have been created and removed:
  // a run that docker refused (no image: exit 125, created false) fails here with docker's words.
  async function run(image, what, cmd, over = {}) {
    const r = await dockerRun({ image, name: nameOf(what), cmd, timeoutMs: 180_000, stdin: 'null', ...over });
    assert.equal(r.timedOut, false, `${what}: timed out\n${r.stderr}`);
    assert.equal(r.created, true, `${what}: no container was created (status ${r.status})\n${r.stderr}`);
    assert.equal(r.rmOk, true, `${what}: the container was not removed`);
    return r;
  }

  // curl with every limit set, printing only the HTTP status and the TLS verification result.
  const CURL = ['curl', '-sS', '-o', '/dev/null', '-w', '%{http_code} tls=%{ssl_verify_result}', '--connect-timeout', '10', '--max-time', '40'];
  const sh = (script) => ['sh', '-c', script];
  const lines = (s) => s.split('\n').map((l) => l.trim()).filter(Boolean);

  // curl exits 6 (could not resolve), 7 (could not connect) or 28 (timed out) when there is no
  // route. 127 (curl missing) and 126 would be a broken image, not a refused route.
  const NO_ROUTE = [6, 7, 28];

  // docker CLI for the leftover checks. The host's other containers are never touched: these are
  // read-only listings filtered by our labels and names.
  const dockerOut = (...args) => {
    const r = spawnSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000 });
    assert.equal(r.status, 0, `docker ${args.join(' ')}: ${r.stderr}`);
    return r.stdout.trim();
  };

  await ta('codescout image: rustc 1.97.1, node v26, the mounted claude 2.1.292, and the tools a task needs', async () => {
    const r = await run(CODESCOUT, 'cs-tools', sh([
      'rustc --version', 'node --version', '/opt/claude/claude --version',
      'cargo clippy --version', 'rustfmt --version', 'rust-analyzer --version',
      'python3 --version', 'git --version', 'jq --version', 'curl --version | head -1',
      'echo "uid=$(id -u) user=$(id -un) home=$HOME"',
      'echo "CARGO_HOME=$CARGO_HOME CARGO_NET_OFFLINE=$CARGO_NET_OFFLINE"',
    ].join('; ')), { mounts: [CLAUDE_MOUNT] });
    assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
    const out = lines(r.stdout);
    assert.match(out[0], /^rustc 1\.97\.1 /, out[0]);
    assert.ok(out[1].startsWith('v26'), out[1]);
    assert.equal(out[2], '2.1.292 (Claude Code)');
    assert.match(out[3], /^clippy 0\.1\.97 /, out[3]);
    assert.match(out[4], /^rustfmt /, out[4]);
    assert.match(out[5], /^rust-analyzer /, out[5]);
    assert.match(out[6], /^Python 3\./, out[6]);
    assert.match(out[7], /^git version /, out[7]);
    assert.match(out[8], /^jq-/, out[8]);
    assert.match(out[9], /^curl /, out[9]);
    assert.equal(out[10], 'uid=1000 user=agent home=/home/agent');
    assert.equal(out[11], 'CARGO_HOME=/cargo CARGO_NET_OFFLINE=true');
  });

  await ta('codescout image: a tree with codescout\'s own toolchain file and cargo config builds with NO network', async () => {
    // Pins what the R19 check found on codescout HEAD: rust-toolchain.toml names a target the image
    // does not hold (rustup would download it on every cargo call), .cargo/config.toml wants
    // sccache as the rustc wrapper and mold as the linker. --network none: any attempt to reach
    // out fails the build.
    const toolchain = '[toolchain]\\nchannel = "1.97.1"\\ncomponents = ["rustfmt", "clippy", "rust-analyzer"]\\ntargets = ["x86_64-pc-windows-gnu"]\\n';
    const config = '[build]\\nrustc-wrapper = "sccache"\\n[target.x86_64-unknown-linux-gnu]\\nlinker = "cc"\\nrustflags = ["-C", "link-arg=-fuse-ld=mold"]\\n';
    const r = await run(CODESCOUT, 'cs-build', sh([
      'set -e', 'mkdir /tmp/hello && cd /tmp/hello', 'cargo init --name hello --vcs none -q',
      `printf '${toolchain}' > rust-toolchain.toml`, `mkdir .cargo && printf '${config}' > .cargo/config.toml`,
      'cargo run -q', 'cargo clippy -q -- -D warnings', 'cargo fmt --check', 'echo done',
    ].join('; ')), { network: 'none' });
    assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
    assert.deepEqual(lines(r.stdout), ['Hello, world!', 'done']);
    assert.doesNotMatch(r.stderr, /downloading|syncing channel|installing/, r.stderr);
  });

  await ta('codescout image: no secret, repo or claude binary is baked in', async () => {
    // The binary is mounted, never baked: without the mount there is nothing at /opt/claude/claude.
    const r = await run(CODESCOUT, 'cs-clean', sh('test ! -e /opt/claude/claude && echo no-claude; ls -A /home/agent | wc -l; env | grep -c -E "^(ANTHROPIC|CLAUDE)" || true'));
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(lines(r.stdout), ['no-claude', '0', '0']);
  });

  await ta('plugins image: node v26, the mounted claude 2.1.292, bash, jq, python3, git, curl; uid 1000', async () => {
    const r = await run(PLUGINS, 'pl-tools', sh([
      'node --version', '/opt/claude/claude --version', 'bash --version | head -1', 'jq --version',
      'python3 --version', 'git --version', 'curl --version | head -1',
      'echo "uid=$(id -u) user=$(id -un) home=$HOME"',
    ].join('; ')), { mounts: [CLAUDE_MOUNT] });
    assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
    const out = lines(r.stdout);
    assert.ok(out[0].startsWith('v26'), out[0]);
    assert.equal(out[1], '2.1.292 (Claude Code)');
    assert.match(out[2], /^GNU bash, version /, out[2]);
    assert.match(out[3], /^jq-/, out[3]);
    assert.match(out[4], /^Python 3\./, out[4]);
    assert.match(out[5], /^git version /, out[5]);
    assert.match(out[6], /^curl /, out[6]);
    assert.equal(out[7], 'uid=1000 user=agent home=/home/agent');
  });

  // ---- the network and the proxy: one proxy at a time, always brought down ----------------

  const proxy = await import('./proxy.mjs');

  // The proxy is brought down even when the body fails, and the next mode starts from nothing.
  async function withProxy(opts, body) {
    const up = await proxy.proxyUp(opts);
    try {
      await body(up);
    } finally {
      await proxy.proxyDown();
    }
  }

  // curl in a container on s5-internal, through the proxy (HTTPS_PROXY) unless `direct`.
  const onInternal = (what, args, { direct = false } = {}) =>
    run(PLUGINS, what, [...CURL, ...args], { network: NET, ...(direct ? {} : { env: { HTTPS_PROXY: PROXY_URL } }) });

  await ta('a container on s5-internal cannot reach https://github.com directly (and can with a route: control)', async () => {
    // Control first: the same curl on the default bridge reaches github.com. Without this, a host
    // with no internet would pass the refusal below for the wrong reason.
    const control = await run(PLUGINS, 'direct-control', [...CURL, 'https://github.com'], { network: 'bridge' });
    assert.equal(control.status, 0, `control: curl failed on the default bridge: ${control.stderr}`);
    assert.match(control.stdout, /^[23]\d\d tls=0$/, control.stdout);

    await withProxy({ mode: 'allowlist', allowlist: ['api.anthropic.com'] }, async () => {
      const r = await onInternal('direct', ['https://github.com'], { direct: true });
      assert.ok(NO_ROUTE.includes(r.status), `expected no route (curl 6, 7 or 28), got ${r.status}: ${r.stderr}`);
      assert.notEqual(r.stdout.slice(0, 1), '2', r.stdout);
      // Not by IP either: a literal address has no DNS to fail. 140.82.112.3 is one of github.com's.
      const ip = await onInternal('direct-ip', ['--resolve', 'github.com:443:140.82.112.3', 'https://github.com'], { direct: true });
      assert.ok(NO_ROUTE.includes(ip.status), `by IP: expected curl 7 or 28, got ${ip.status}: ${ip.stderr}`);
    });
  });

  await ta('allowlist [api.anthropic.com]: CONNECT github.com:443 is refused, api.anthropic.com:443 connects', async () => {
    await withProxy({ mode: 'allowlist', allowlist: ['api.anthropic.com'] }, async () => {
      // The refusal: the proxy answers CONNECT with 403, curl reports the failed tunnel.
      const refused = await onInternal('refuse', ['https://github.com']);
      assert.equal(refused.status, 56, `expected curl 56 (tunnel failed), got ${refused.status}: ${refused.stderr}`);
      assert.match(refused.stderr, /CONNECT tunnel failed, response 403/, refused.stderr);
      assert.equal(refused.stdout, '000 tls=0', 'no HTTP response from github.com may have come back');

      // The success: a TLS handshake with api.anthropic.com completed (verified certificate) and
      // the server answered with some HTTP status. No auth header, so no token is used.
      const ok = await onInternal('allow', ['https://api.anthropic.com/']);
      assert.equal(ok.status, 0, `api.anthropic.com through the proxy: ${ok.stderr}`);
      const [code, tls] = ok.stdout.split(' ');
      assert.match(code, /^[1-5]\d\d$/, ok.stdout);
      assert.equal(tls, 'tls=0', 'the certificate must verify');

      // The proxy's own record agrees: the refused host is named as filtered, the allowed one was
      // connected to. (If the log said the opposite, the 403 above would have another cause.)
      const log = await proxy.proxyLog();
      assert.match(log, /Proxying refused on filtered domain "github\.com"/, log);
      assert.match(log, /Established connection to host "api\.anthropic\.com"/, log);
      assert.doesNotMatch(log, /Established connection to host "github\.com"/, log);
    });
  });

  await ta('allowlist: a host that merely resembles an allowed one is refused (anchored patterns, escaped dots)', async () => {
    await withProxy({ mode: 'allowlist', allowlist: ['api.anthropic.com'] }, async () => {
      for (const url of [
        'https://api.anthropic.com.s5-test.invalid/', // suffix: an unanchored pattern would pass it
        'https://xapi.anthropic.com/', // prefix
        'https://apixanthropic.com/', // an unescaped dot would match any character
        'https://anthropic.com/', // the parent domain is not on the list
        'https://API.ANTHROPIC.COM.evil.example/',
        'https://140.82.112.3/', // an IP literal: github.com's address is not a name on the list
        'https://api.anthropic.com@github.com/', // the host curl connects to is github.com
      ]) {
        const r = await onInternal('lookalike', [url]);
        assert.equal(r.status, 56, `${url}: expected a refused tunnel, got ${r.status}: ${r.stderr}`);
        assert.match(r.stderr, /response 403/, `${url}: ${r.stderr}`);
      }
      // Every one of them was refused by the filter, not by a failed lookup.
      const log = await proxy.proxyLog();
      assert.equal((log.match(/Proxying refused on filtered domain/g) ?? []).length, 7, log);
      assert.doesNotMatch(log, /Established connection/, log);
    });
  });

  await ta('allowlist: an allowed host on another port, and plain HTTP to a host not on the list, are refused', async () => {
    await withProxy({ mode: 'allowlist', allowlist: ['api.anthropic.com'] }, async () => {
      const port = await onInternal('port', ['https://api.anthropic.com:8443/']);
      assert.equal(port.status, 56, `port 8443: ${port.status} ${port.stderr}`);
      assert.match(port.stderr, /response 403/, port.stderr);
      // A request to the proxy that is not a CONNECT: the filter applies to it as well.
      const plain = await run(PLUGINS, 'plain', [...CURL, '-x', PROXY_URL, 'http://github.com/'], { network: NET });
      assert.equal(plain.stdout.slice(0, 3), '403', `plain http to github.com: ${plain.stdout} ${plain.stderr}`);
      const log = await proxy.proxyLog();
      assert.match(log, /Refused CONNECT method on port 8443/, log);
      assert.match(log, /GET http:\/\/github\.com\/ HTTP\/1\.1\n.*Proxying refused on filtered domain "github\.com"/, log);
      assert.doesNotMatch(log, /Established connection/, log);
    });
  });

  await ta('the proxy serves s5-internal only: a container on the default bridge is refused, even in log-all mode', async () => {
    await withProxy({ mode: 'log-all' }, async (up) => {
      // The proxy is attached to the default bridge (that is its way out), so another tenant's
      // container could reach it there. The Allow list is what stops it.
      const ip = dockerOut('inspect', '--format', '{{.NetworkSettings.Networks.bridge.IPAddress}}', up.id);
      assert.match(ip, /^\d+\.\d+\.\d+\.\d+$/, ip);
      const r = await run(PLUGINS, 'bridge-client', [...CURL, '-x', `http://${ip}:8888`, 'https://example.com/'], { network: 'bridge' });
      assert.equal(r.status, 56, `expected a refused tunnel, got ${r.status}: ${r.stderr}`);
      assert.match(r.stderr, /response 403/, r.stderr);
      const log = await proxy.proxyLog();
      assert.match(log, /Unauthorized connection from/, log);
      assert.doesNotMatch(log, /example\.com/, log);
    });
  });

  await ta('log-all mode: the proxy log names the CONNECT host', async () => {
    await withProxy({ mode: 'log-all' }, async () => {
      // A HEAD request to example.com (IANA's reserved demo host; no auth, no token): it must
      // pass, because log-all refuses nothing, and the CONNECT is what the log records.
      const r = await onInternal('logall', ['-I', 'https://example.com']);
      assert.equal(r.status, 0, `log-all CONNECT to example.com: ${r.stderr}`);
      assert.match(r.stdout, /^[1-5]\d\d tls=0$/, r.stdout);
      const log = await proxy.proxyLog();
      assert.match(log, /CONNECT example\.com:443/, log);
    });
  });

  await ta('after proxyDown: this file leaves no container behind, and the network only while something is attached', async () => {
    // Scoped to what THIS file made: another s5 run on the host may be using the network.
    assert.equal(dockerOut('ps', '-aq', '--filter', 'label=s5.run=s5-proxy'), '', 'the proxy container is left');
    assert.equal(dockerOut('ps', '-aq', '--filter', `name=^/s5-t4-.*-${process.pid}-`), '', 'a test container is left');
    const net = dockerOut('network', 'ls', '-q', '--no-trunc', '--filter', `name=^${NET}$`);
    if (net !== '') {
      const attached = dockerOut('network', 'inspect', '--format', '{{len .Containers}}', net);
      assert.notEqual(attached, '0', `${NET} is still there with nothing attached`);
    }
  });
}
