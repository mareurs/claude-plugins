// Tests for the OpenCode host bridge. Plain node, no opencode install required:
//   node harnesses/opencode/tests/test-codescout-companion.mjs
//
// WHAT THIS COVERS, and what it deliberately cannot
//
// The two halves of the port are testable for different reasons:
//   - the CONTRACT with the host loader (what shape `export default` must have, which
//     channels setup() registers) is asserted directly against the shape read out of the
//     opencode 2.1.3 binary — see adapter §"API SURFACE". This exists because the first
//     version of the adapter was a v1 plugin and opencode refused to load it; a v1-shaped
//     regression must fail HERE, not on someone's machine.
//   - the PURE parts (name matching, reason re-hosting) run anywhere, and they are where
//     the silent-no-op bugs live, so they are asserted exhaustively.
//   - the BRIDGE (spawn pre-tool-guard, translate its deny into a throw) runs here too,
//     against a throwaway project dir — but no assertion here proves that OpenCode itself
//     fires these hooks with these payloads. That needs a live opencode session. See
//     README §"Verified vs asserted". A green run here is not proof of the port.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

import PLUGIN_DEF, {
  codescoutBareTool,
  rehostReason,
  buildBridge,
  resolveDir,
  resolveRuntime,
  runHook,
  GUARDED_TOOLS,
  CodescoutCompanion,
} from '../plugins/codescout-companion.js';
import { normalizedToolName, breakerFile, detectFor } from '../../../codescout-companion/hooks/lib.mjs';

// Test isolation (repo rule: clean up mutated state). The guard writes cs-redirect-* /
// cs-block-* markers into os.tmpdir(), and cs-liveness refreshes the codescout rendezvous
// slot under XDG_STATE_HOME — the LIVE server's slot when this file is run directly rather
// than through run-all.sh (docs/issues/archive/2026-08-27-test-suite-rekeys-live-codescout-server.md).
// Both are read from env at call time, by this process and by every hook it spawns, so
// pointing them at a throwaway dir before any test runs contains all of it.
const SANDBOX = mkdtempSync(join(tmpdir(), 'cs-oc-test-'));
mkdirSync(join(SANDBOX, 'tmp'));
mkdirSync(join(SANDBOX, 'state'));
process.env.TMPDIR = join(SANDBOX, 'tmp');
process.env.XDG_STATE_HOME = join(SANDBOX, 'state');
process.on('exit', () => rmSync(SANDBOX, { recursive: true, force: true }));

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolvePath(HERE, '..', '..', '..');

// Session ids must be unique per RUN, not per test. The Claude-side circuit breaker files
// are keyed by session id in os.tmpdir() (now the sandbox above); reusing a fixed id across runs accumulates
// redirect strikes until the third run starts failing with 'BLOCKED (see previous
// message)' — a flake indistinguishable from a real regression. State this test mutates
// gets fresh keys.
const RUN = `${process.pid}-${Date.now()}`;
const SID = (name) => `${name}-${RUN}`;

let pass = 0;
const ok = async (name, fn) => {
  try {
    await fn();
    pass++;
    console.log(`  PASS: ${name}`);
  } catch (e) {
    console.error(`  FAIL: ${name}\n        ${e.message}`);
    process.exitCode = 1;
  }
};

console.log('── opencode host bridge ──');

// 0. THE LOADER CONTRACT — the bug that reached us from a real install.
//
// OpenCode 2.1.3 validates `module.default` against:
//   Union([ Struct({id: String, effect: Function}), Struct({id: String, setup: Function}) ])
// A v1 plugin (a bare function default, or an object without `id`) is rejected with
// "Plugin must export a default definition with an id and an effect or setup function."
// and the whole plugin never loads — so every other test here would still pass green
// while the feature is dead. Hence test 0.
await ok('default export matches the v2 loader union (id + exactly one of effect|setup)', () => {
  assert.equal(typeof PLUGIN_DEF, 'object', 'default must be a definition OBJECT, not the v1 function');
  assert.notEqual(PLUGIN_DEF, null);
  assert.equal(typeof PLUGIN_DEF.id, 'string', 'id is required by both union arms');
  assert.ok(PLUGIN_DEF.id.length > 0, 'id must be non-empty');
  const arms = ['effect', 'setup'].filter((k) => typeof PLUGIN_DEF[k] === 'function');
  assert.equal(arms.length, 1, `exactly one of effect|setup must be a function, got ${arms.join(',')}`);
  assert.equal(arms[0], 'setup', 'we use the plain-setup arm, so no @opencode/plugin import is needed');
  // Effect Schema structs validate the listed keys; a stray field is a needless risk on a
  // host we do not control, so the definition stays to exactly the two keys the schema names.
  assert.deepEqual(Object.keys(PLUGIN_DEF).sort(), ['id', 'setup']);
});

// 1. OpenCode v2 built-in names must reach the guard's vocabulary. Each row here is a
//    call that would otherwise fall through unmatched and make the guard a no-op —
//    the failure mode is silence, not an error, which is why it is asserted explicitly.
await ok('opencode tool names normalise to the guard vocabulary', () => {
  const t = (tool_name) => normalizedToolName({ tool_name });
  assert.equal(t('read'), 'Read');
  assert.equal(t('grep'), 'Grep');
  assert.equal(t('glob'), 'Glob');
  assert.equal(t('edit'), 'Edit');
  assert.equal(t('write'), 'Write');
  // v2 renamed these; a host that sends the v1 name must still be understood.
  assert.equal(t('shell'), 'Bash', 'v2 name for the shell tool');
  assert.equal(t('bash'), 'Bash', 'v1 name still mapped');
  assert.equal(t('patch'), 'Edit', 'v2 name for apply_patch');
  assert.equal(t('apply_patch'), 'Edit', 'v1 name still mapped');
  // An unmapped name must pass through unchanged — NOT become 'Read' or 'Bash'. A
  // permissive default would deny unrelated tools.
  assert.equal(t('subagent'), 'subagent');
  assert.equal(t('codescout_symbols'), 'codescout_symbols');
});

// 2. Which MCP names count as codescout. v2 added tool namespacing (ctx.tool.transform
//    exposes a `namespace`) and the exact v2 spelling of an MCP tool is NOT re-verified in
//    the 2.1.3 binary, so every plausible prefix is accepted rather than guessed at. A
//    false positive would mis-arm the guard on an unrelated server, so the negatives are
//    asserted too.
await ok('codescout MCP tools are recognised across name forms, and lookalikes are not', () => {
  assert.equal(codescoutBareTool('codescout_symbols'), 'symbols');
  assert.equal(codescoutBareTool('codescout_run_command'), 'run_command');
  assert.equal(codescoutBareTool('mcp__codescout__edit_code'), 'edit_code', 'Claude form');
  assert.equal(codescoutBareTool('mcp_codescout_symbols'), 'symbols', 'namespaced form');
  assert.equal(codescoutBareTool('mcp.codescout.symbols'), 'symbols', 'dotted namespace');
  assert.equal(codescoutBareTool('codescout/symbols'), 'symbols', 'path form');
  assert.equal(codescoutBareTool('read'), null);
  assert.equal(codescoutBareTool(''), null);
  assert.equal(codescoutBareTool(undefined), null);
  assert.equal(codescoutBareTool('codescouthood_symbols'), null, 'prefix must be the whole server name');
  assert.equal(codescoutBareTool('notcodescout_symbols'), null, 'codescout must start the name');
  // An underscore inside the tool name is part of the name, not a delimiter: run_command
  // and edit_code are real tools, so a greedy tail is correct and asserted as such.
  assert.equal(codescoutBareTool('codescout_symbols_x'), 'symbols_x');
});

// 3. The guard's escape hatch names Claude Code affordances. On OpenCode they may not
//    exist, and a wrong command in advice is worse than no advice.
await ok('the deny reason drops Claude-only instructions and states opencode-true ones', () => {
  const cc =
    'Use codescout read_file instead.\n\nIf a tool named above is not in your tool list, do not assume the MCP server is down… run /mcp…';
  const out = rehostReason(cc);
  assert.ok(!out.includes('/mcp'), 'must not tell an opencode user to run /mcp');
  assert.ok(!out.includes('! <command>'), 'must not reference the Claude prompt prefix');
  assert.ok(out.includes('Use codescout read_file instead.'), 'the actual redirect survives');
  assert.ok(out.includes('mcp.servers.codescout'), 'names the opencode config that IS authoritative here');
  // A reason with no Claude footer must not be truncated.
  assert.ok(rehostReason('plain reason').startsWith('plain reason'));
  // Regression (live, 2.1.3): the breaker warning sits AFTER the Claude footer and was cut.
  const warned = 'reason' + '\n\nIf a tool named above is not in your tool list, run /mcp.' +
    '\n\n[!] 3 redirects in a row and none of the tools they name has answered.';
  const re = rehostReason(warned);
  assert.ok(re.includes('[!] 3 redirects in a row'), 'breaker warning must survive re-hosting');
  assert.ok(!re.includes('/mcp'), 'Claude-only advice must still be removed');
});

// 4. What setup() registers. The v1 plugin returned a hooks OBJECT; v2 registers
//    imperatively, and the four channel names below are the v2 spellings from the
//    migration table. Registering a v1 name would be accepted by the loader and then do
//    nothing forever — the silent class again, so assert the names literally.
await ok('setup registers the four v2 channels and returns a cleanup FUNCTION', async () => {
  const seen = [];
  const ctx = {
    session: { hook: async (name, fn) => void seen.push(['session', name, typeof fn]) },
    tool: { hook: async (name, fn) => void seen.push(['tool', name, typeof fn]) },
    directory: REPO,
  };
  const teardown = await PLUGIN_DEF.setup(ctx);
  assert.deepEqual(
    seen.map(([g, n]) => `${g}.${n}`).sort(),
    ['session.compaction', 'session.context', 'tool.execute.after', 'tool.execute.before'],
  );
  assert.ok(seen.every(([, , t]) => t === 'function'), 'each hook must be callable');
  // The host calls a truthy setup return as its disposer: `o()`. Returning an object here
  // would make teardown throw.
  assert.equal(typeof teardown, 'function');
  teardown();
});

// 5. A rejecting/absent context must not take the plugin down. Registration failure is
//    reported on stderr, but setup RESOLVES: a plugin that rejects at load is what
//    happened on the user's machine, and it must not be repeatable from a partial ctx.
await ok('a context missing its hook groups still loads (fail-open at registration)', async () => {
  const writes = [];
  const real = process.stderr.write.bind(process.stderr);
  process.stderr.write = (chunk) => void writes.push(String(chunk));
  try {
    const teardown = await CodescoutCompanion({});
    assert.equal(typeof teardown, 'function');
    assert.ok(writes.some((w) => w.includes('codescout-companion')), 'the failure is reported, not swallowed');
    assert.ok(writes.some((w) => w.includes('execute.before')), 'naming the channel that failed');
    teardown();
  } finally {
    process.stderr.write = real;
  }
});

// 6. Which project we speak for. ctx's directory key is UNVERIFIED (adapter §4), so the
//    fallback order is the safety net and is asserted, not assumed.
await ok('resolveDir prefers explicit context keys and ends at process.cwd()', () => {
  assert.equal(resolveDir({ directory: '/a' }), '/a');
  assert.equal(resolveDir({ location: { directory: '/b' } }), '/b');
  assert.equal(resolveDir({ worktree: '/c' }), '/c');
  assert.equal(resolveDir({}), process.cwd());
  assert.equal(resolveDir(undefined), process.cwd());
});

// Regression: the real 2.1.3 setup ctx carries `worktree` as an API group (an object),
// not a path. Returning it crashed setup with ERR_INVALID_ARG_TYPE ("paths[0]" … object).
await ok('resolveDir ignores non-string keys like the v2 ctx.worktree API group', () => {
  const v2ctx = {
    app: {},
    location: { directory: '/proj' },
    worktree: { list: () => {} },
    tool: { hook: () => {} },
  };
  assert.equal(resolveDir(v2ctx), '/proj');
  assert.equal(resolveDir({ worktree: { list: () => {} } }), process.cwd());
  assert.equal(resolveDir({ location: {}, directory: { x: 1 } }), process.cwd());
});

// Regression: inside OpenCode, process.execPath is the compiled opencode binary. Spawning
// it with the hook script ran `opencode <script>`, which failed ENOTDIR and failed OPEN.
await ok('resolveRuntime never spawns the host binary as the hook interpreter', () => {
  const oc = '/x/@opencode/cli/bin/opencode.exe';
  assert.equal(resolveRuntime(oc, {}), 'node');
  assert.equal(resolveRuntime('/usr/bin/opencode', {}), 'node');
  assert.equal(resolveRuntime('/usr/bin/node', {}), '/usr/bin/node');
  assert.equal(resolveRuntime('/home/u/.bun/bin/bun', {}), '/home/u/.bun/bin/bun');
  assert.equal(resolveRuntime('C:\\node\\node.exe', {}), 'C:\\node\\node.exe');
  assert.equal(resolveRuntime(oc, { CS_COMPANION_NODE: '/opt/node' }), '/opt/node');
});

// --- The bridge itself, against a throwaway project ---------------------------------
const dir = mkdtempSync(join(tmpdir(), 'cs-oc-'));
try {
  writeFileSync(
    join(dir, 'opencode.json'),
    JSON.stringify({ mcp: { servers: { codescout: { type: 'local', command: ['codescout'] } } } }),
  );
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'src', 'main.rs'), 'fn main() {}\n');
  writeFileSync(join(dir, 'src', 'notes.txt'), 'prose\n');
  // The guard's read exemption is EXTENSION-based — isBinaryImage() is
  // /\.(png|jpg|jpeg|gif|webp|bmp|ico|pdf)$/i — so a `.bin` is NOT exempt. Assert against
  // the real rule, not the idea of it: a `blob.bin` fixture produced a false "exempt"
  // failure on the first run of this suite.
  writeFileSync(join(dir, 'src', 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));

  const bridge = () => buildBridge(dir);

  // A probe reporting whether this machine's Claude-side detection already passes on its
  // own. If it does, the bridge is being exercised WITHOUT the CS_COMPANION_HOST_ARMED
  // signal, which means the flag's necessity on an opencode-only host stays UNVERIFIED
  // here rather than verified. Printed, never asserted — it describes the test, not the
  // product.
  const claudeDetectsHere = (() => {
    try {
      const res = spawnSync(process.execPath, [join(REPO, 'codescout-companion', 'hooks', 'detect.mjs'), '--json'], {
        encoding: 'utf8',
        env: { ...process.env, CWD: dir },
        timeout: 5000,
      });
      const out = `${res.stdout || ''}${res.stderr || ''}`;
      return /"HAS_CODESCOUT":\s*"true"/.test(out);
    } catch {
      return false;
    }
  })();
  console.log(
    `  INFO: Claude-side detect.mjs already reports codescout here: ${claudeDetectsHere}${
      claudeDetectsHere ? ' — so CS_COMPANION_HOST_ARMED is NOT what armed this run' : ''
    }`,
  );

  // 7. The system-prompt channel. v2 `event.system` is a typed SystemPart[], so a bare
  //    string push (the v1 shape) would inject nothing useful while still not throwing.
  await ok('session context hook pushes a TYPED system part', async () => {
    const event = { system: [] };
    await bridge().onContext(event);
    assert.equal(event.system.length, 1, 'exactly one part pushed');
    assert.equal(event.system[0].type, 'text', 'v2 parts are {type,text}, not strings');
    assert.ok(event.system[0].text.includes('codescout'), 'and it carries the routing directive');
  });

  await ok('compaction hook re-injects the directive', async () => {
    const event = { system: [] };
    await bridge().onCompaction(event);
    assert.equal(event.system.length, 1);
    assert.ok(event.system[0].text.includes('codescout'));
  });

  // 8. The enforcement path, end to end: v2 event → guard subprocess → throw.
  await ok('a native read of a source file is DENIED (by throwing, the only v2 lever)', async () => {
    let threw = null;
    try {
      await bridge().onToolBefore({
        tool: 'read',
        sessionID: SID('deny'),
        id: `call-${SID('deny')}`,
        input: { filePath: join(dir, 'src', 'main.rs') },
      });
    } catch (e) {
      threw = e;
    }
    assert.ok(threw, 'expected a throw to block the call');
    assert.ok(/codescout/i.test(threw.message), `reason must name codescout: ${threw.message}`);
    assert.ok(!/\/mcp/.test(threw.message), 'the reason must be re-hosted, not the Claude one');
  });

  await ok('a plain-text read is redirected too, not just source', async () => {
    const b = bridge();
    let threw = null;
    try {
      await b.onToolBefore({
        tool: 'read',
        sessionID: SID('txt'),
        id: `call-${SID('txt')}`,
        input: { filePath: join(dir, 'src', 'notes.txt') },
      });
    } catch (e) {
      threw = e;
    }
    assert.ok(threw, 'the guard redirects plain-text reads as well');
  });

  await ok('an exempt binary image read proceeds untouched', async () => {
    await bridge().onToolBefore({
      tool: 'read',
      sessionID: SID('bin'),
      id: `call-${SID('bin')}`,
      input: { filePath: join(dir, 'src', 'logo.png') },
    });
  });

  // 8b. Genuinely unarmed: no project config, no user config, no Claude config, and a
  // session that has never seen a codescout tool. HOME/XDG are isolated because on a
  // machine whose USER-level opencode.json registers codescout, an empty project dir is
  // not actually unarmed — asserting that way produced the first false failure here.
  await ok('an UNARMED session is never blocked', async () => {
    const fakeHome = mkdtempSync(join(tmpdir(), 'cs-oc-nohome-'));
    const bare = mkdtempSync(join(tmpdir(), 'cs-oc-bare-'));
    const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME, CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR };
    process.env.HOME = fakeHome;
    process.env.USERPROFILE = fakeHome;
    process.env.XDG_CONFIG_HOME = join(fakeHome, 'xdg-empty');
    delete process.env.CLAUDE_CONFIG_DIR;
    try {
      const b = buildBridge(bare);
      await b.onToolBefore({
        tool: 'read',
        sessionID: SID('unarmed'),
        id: `call-${SID('unarmed')}`,
        input: { filePath: join(bare, 'x.rs') },
      });
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      rmSync(fakeHome, { recursive: true, force: true });
      rmSync(bare, { recursive: true, force: true });
    }
  });

  // 9. The whole point of CS_COMPANION_HOST_ARMED: a machine with opencode and no Claude
  //    config at all, where codescout is registered for THIS project. Without the flag,
  //    detect.mjs finds nothing, every hook exits 0, and the port silently enforces
  //    nothing. With it set from a USER-level entry instead, the same code would block
  //    reads in repos codescout does not serve — so both directions are asserted.
  const isolatedIn = async (fakeHome, project, run) => {
    // CLAUDE_CONFIG_DIR too: detect.mjs reads it, so a developer whose Claude profile
    // registers codescout would otherwise arm detection and defeat the "unregistered
    // project" assertion below. Measured 2026-11-10 with CLAUDE_CONFIG_DIR=~/.claude-kat.
    const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME, CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR };
    process.env.HOME = fakeHome;
    process.env.USERPROFILE = fakeHome;
    process.env.XDG_CONFIG_HOME = join(fakeHome, 'xdg');
    delete process.env.CLAUDE_CONFIG_DIR;
    try {
      return await run(project);
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      rmSync(fakeHome, { recursive: true, force: true });
    }
  };
  const OC_CFG = JSON.stringify({ mcp: { servers: { codescout: { type: 'local', command: ['codescout'] } } } });
  const sourceReadIn = async (project, name) => {
    let threw = null;
    try {
      await buildBridge(project).onToolBefore({
        tool: 'read',
        sessionID: SID(name),
        id: `call-${SID(name)}`,
        input: { filePath: join(project, 'src', 'main.rs') },
      });
    } catch (e) {
      threw = e;
    }
    return threw;
  };

  await ok('an opencode-only host with PROJECT config still blocks (host-armed signal)', async () => {
    const fakeHome = mkdtempSync(join(tmpdir(), 'cs-oc-home-'));
    const project = mkdtempSync(join(tmpdir(), 'cs-oc-proj-'));
    mkdirSync(join(project, 'src'), { recursive: true });
    writeFileSync(join(project, 'opencode.json'), OC_CFG);
    writeFileSync(join(project, 'src', 'main.rs'), 'fn main() {}\n');
    const threw = await isolatedIn(fakeHome, project, (p) => sourceReadIn(p, 'opencode-only'));
    assert.ok(
      threw,
      'with no Claude config present, only CS_COMPANION_HOST_ARMED can arm the guard — if this fails, the port is inert on an opencode-only machine',
    );
  });

  await ok('a USER-level registration does NOT lock an unrelated project', async () => {
    const fakeHome = mkdtempSync(join(tmpdir(), 'cs-oc-global-'));
    const project = mkdtempSync(join(tmpdir(), 'cs-oc-unreg-'));
    mkdirSync(join(fakeHome, 'xdg', 'opencode'), { recursive: true });
    writeFileSync(join(fakeHome, 'xdg', 'opencode', 'opencode.json'), OC_CFG);
    mkdirSync(join(project, 'src'), { recursive: true });
    writeFileSync(join(project, 'src', 'main.rs'), 'fn main() {}\n');
    // No opencode.json in the project: registration is global, so presence for THIS cwd is
    // unproven and detect.mjs(cwd) gets the decision. It finds no codescout here → no block.
    const threw = await isolatedIn(fakeHome, project, (p) => sourceReadIn(p, 'user-only'));
    assert.equal(
      threw && threw.message,
      null,
      'a global codescout registration must not block native reads in repos codescout does not serve',
    );
  });

  await ok('a codescout tool call never trips its own guard, and arms its session', async () => {
    const b = bridge();
    const sid = SID('self');
    await b.onToolBefore({ tool: 'codescout_read_file', sessionID: sid, id: 'c1', input: { path: join(dir, 'src', 'main.rs') } });
    await b.onToolAfter({ tool: 'codescout_read_file', sessionID: sid, id: 'c1', status: 'completed', result: { output: 'ok' } });
    // Proof of life is what arms a session that was configured nowhere.
    const unconfigured = buildBridge(join(tmpdir(), 'cs-oc-nope-'));
    assert.ok(unconfigured, 'bridge built without a project on disk');
    await b.onToolAfter({ tool: 'read', sessionID: sid, id: 'c2', status: 'completed', result: { output: 'x' } });
  });

  // 10. Junk from a host we do not control: never fatal, per the fail-open contract.
  await ok('malformed events are ignored, not fatal', async () => {
    const b = bridge();
    await b.onToolBefore(undefined);
    await b.onToolBefore({});
    await b.onToolBefore({ tool: 42, input: 'not-an-object', sessionID: null });
    await b.onToolAfter(undefined);
    await b.onToolAfter({});
    // An unknown callID with an unrecognised result shape must not be corrupted.
    const event = { tool: 'read', sessionID: SID('junk'), id: 'never-seen', status: 'completed', result: { weird: [1, 2] } };
    await b.onToolAfter(event);
    assert.deepEqual(event.result, { weird: [1, 2] }, 'result left byte-for-byte intact');
    // A missing system array must throw nothing.
    b.onContext({});
    b.onCompaction({ system: null });
  });

  await ok('advice is appended only where the result shape is provably a string', async () => {
    // Drives the private `pending` path through its real producer: a guard decision that
    // yields additionalContext. If the guard denies instead (it may, for a source file),
    // the throw is the correct outcome and this case still asserts the invariant that a
    // NON-string result is never rewritten.
    const b = bridge();
    const sid = SID('adv');
    const ev = { tool: 'read', sessionID: sid, id: `adv-${sid}`, status: 'completed', result: { output: 'body' } };
    await b.onToolAfter(ev); // no remembered advice → untouched
    assert.equal(ev.result.output, 'body');
  });

  // Regression, measured live on 2.1.3: the model reads `result.content` (an array of
  // parts), and `result.output` is structured data — for `read` a file OBJECT. The old
  // bridge appended to a string `output` only, so on a real host every advisory, including
  // the circuit breaker's stand-down explanation, was dropped. Drives the REAL producer:
  // seed this session's breaker past the threshold so the real guard stands down with
  // additionalContext, then deliver an execute.after shaped exactly like the host's.
  await ok('stand-down advice reaches the model via result.content (v2 shape)', async () => {
    const { breakerFile } = await import('../../../codescout-companion/hooks/lib.mjs');
    const b = bridge();
    const sid = SID('standdown');
    const bf = breakerFile(sid);
    writeFileSync(bf, '4\tread_file');
    try {
      const id = `sd-${sid}`;
      await b.onToolBefore({ tool: 'read', sessionID: sid, id, input: { filePath: join(dir, 'src', 'main.rs') } });
      const fileObj = { type: 'file', name: 'main.rs', content: 'Zm4=', encoding: 'base64' };
      const ev = {
        tool: 'read', sessionID: sid, id, status: 'completed',
        result: { output: fileObj, content: [{ type: 'text', text: 'fn main() {}' }] },
      };
      await b.onToolAfter(ev);
      assert.equal(ev.result.output, fileObj, 'structured output must be left untouched');
      assert.equal(ev.result.content.length, 2, 'advice must be appended as a new part');
      assert.equal(ev.result.content[1].type, 'text');
      assert.match(ev.result.content[1].text, /stood its guard down/);
    } finally {
      rmSync(bf, { force: true });
    }
  });

  // hint-echo: the advice the model got is also written to the echo channel, so the
  // hint-echo TUI part can show it to the user (lib/host.mjs → echoHint).
  await ok('appended advice is echoed to the hint-echo channel with its session and tool', async () => {
    const { breakerFile } = await import('../../../codescout-companion/hooks/lib.mjs');
    const echoed = [];
    const b = buildBridge(dir, { echo: (r) => echoed.push(r) });
    const sid = SID('echo');
    const bf = breakerFile(sid);
    writeFileSync(bf, '4\tread_file');
    try {
      const id = `echo-${sid}`;
      await b.onToolBefore({ tool: 'read', sessionID: sid, id, input: { filePath: join(dir, 'src', 'main.rs') } });
      const ev = { tool: 'read', sessionID: sid, id, status: 'completed', result: { content: [{ type: 'text', text: 'fn main() {}' }] } };
      await b.onToolAfter(ev);
      assert.equal(echoed.length, 1);
      assert.equal(echoed[0].sessionID, sid);
      assert.equal(echoed[0].tool, 'read');
      assert.equal(echoed[0].source, 'codescout-companion');
      assert.equal(echoed[0].text, ev.result.content[1].text, 'the echo must be exactly what the model got');
    } finally {
      rmSync(bf, { force: true });
    }
  });

  // Proof of life = "the server is REACHABLE" (lib.mjs breaker rule: "An error payload
  // still counts"). A server-returned error counts; a CONNECTION failure must not, or a
  // server that died mid-session resets the breaker forever (code review, 2026-11-09).
  await ok('a connection failure does not clear the breaker; a server error or success does', async () => {
    const b = bridge();
    const waitGone = async (f) => { for (let i = 0; i < 50 && existsSync(f); i++) await new Promise((r) => setTimeout(r, 100)); };
    const sid = SID('pol');
    const bf = breakerFile(sid);
    writeFileSync(bf, '1\tread_file');
    await b.onToolAfter({ tool: 'codescout_read_file', sessionID: sid, id: 'p1', status: 'error',
      error: { message: 'Connection closed: MCP server process exited with code 1' } });
    await new Promise((r) => setTimeout(r, 1500));
    assert.ok(existsSync(bf), 'a transport failure must leave the breaker alone');
    await b.onToolAfter({ tool: 'codescout_read_file', sessionID: sid, id: 'p2', status: 'error',
      error: { message: 'path not found: nope.rs' } });
    await waitGone(bf);
    assert.ok(!existsSync(bf), 'a server-returned error proves the server is reachable');
    writeFileSync(bf, '1\tread_file');
    await b.onToolAfter({ tool: 'codescout_read_file', sessionID: sid, id: 'p3', status: 'completed', result: { content: [] } });
    await waitGone(bf);
    assert.ok(!existsSync(bf), 'a completed call must clear the breaker');
  });

  // Fix 4 (review): Claude Code limits the guard with a matcher; the bridge must too, or
  // every unrelated tool call pays a node start-up.
  await ok('only the guarded native tools reach the guard', () => {
    for (const t of ['read', 'grep', 'glob', 'shell', 'bash', 'edit', 'patch', 'apply_patch', 'write']) assert.ok(GUARDED_TOOLS.has(t), t);
    for (const t of ['todowrite', 'webfetch', 'skill', 'question', 'codescout_read_file', 'execute']) assert.ok(!GUARDED_TOOLS.has(t), t);
  });
} finally {
  rmSync(dir, { recursive: true, force: true });
}

// Fix 1 (review): host arming forces PRESENCE only. It used to also force BLOCK_READS, so a
// project's `block_reads: false` opt-out was ignored under OpenCode. Reproduced by the
// reviewer with a real pre-tool-guard run.
await ok('host arming keeps the project block_reads:false opt-out', () => {
  const p = mkdtempSync(join(tmpdir(), 'cs-oc-optout-'));
  mkdirSync(join(p, '.claude'));
  writeFileSync(join(p, '.claude', 'codescout-companion.json'), JSON.stringify({ block_reads: false }));
  // An EMPTY home: with a real ~/.claude.json registering codescout, detection already says
  // "present", the override branch never runs, and this test would pass under the bug
  // (caught by mutation-checking it).
  const saved = { a: process.env.CS_COMPANION_HOST_ARMED, h: process.env.HOME, c: process.env.CLAUDE_CONFIG_DIR };
  const home = join(SANDBOX, 'empty-home');
  mkdirSync(home, { recursive: true });
  process.env.HOME = home;
  delete process.env.CLAUDE_CONFIG_DIR;
  try {
    delete process.env.CS_COMPANION_HOST_ARMED;
    assert.equal(detectFor(p).HAS_CODESCOUT, 'false', 'precondition: nothing detects codescout here');
    process.env.CS_COMPANION_HOST_ARMED = '1';
    const d = detectFor(p);
    assert.equal(d.HAS_CODESCOUT, 'true');
    assert.equal(d.BLOCK_READS, 'false');
  } finally {
    for (const [k, v] of [['CS_COMPANION_HOST_ARMED', saved.a], ['HOME', saved.h], ['CLAUDE_CONFIG_DIR', saved.c]]) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    rmSync(p, { recursive: true, force: true });
  }
});

// Fix 3 (review): a hook that cannot start fails open, but must SAY so — live bug #2 was a
// spawn failure that printed nothing and blocked nothing.
await ok('a hook that cannot be spawned fails open AND is reported on stderr', async () => {
  const orig = process.stderr.write.bind(process.stderr);
  let seen = '';
  process.stderr.write = (c, ...rest) => {
    seen += String(c);
    return true;
  };
  try {
    const r = await runHook(join(SANDBOX, 'nope.mjs'), { cwd: SANDBOX }, { runtime: join(SANDBOX, 'no-such-node') });
    assert.equal(r, null);
  } finally {
    process.stderr.write = orig;
  }
  assert.match(seen, /codescout-companion: hook spawn-failed/);
});

// Fix 6 (review): CLAUDE_CONFIG_DIR must reach the hooks (repo rule), not be stripped.
await ok('runHook passes CLAUDE_CONFIG_DIR through to the hook', async () => {
  const script = join(SANDBOX, 'env-echo.mjs');
  writeFileSync(script, "process.stdout.write(JSON.stringify({ d: process.env.CLAUDE_CONFIG_DIR || null }));");
  const prev = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = '/profiles/claude-test';
  try {
    const r = await runHook(script, { cwd: SANDBOX }, { runtime: process.execPath });
    assert.equal(r?.d, '/profiles/claude-test');
  } finally {
    if (prev === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = prev;
  }
});

// Review follow-up: runHook is built on runProcess, so a hook that times out takes its
// children with it (detect.mjs can start the codescout or sqlite3 binaries). It used to kill
// the direct `node <hook>` child alone and leave them running.
await ok("runHook: a timeout ends the hook's whole process tree", async () => {
  if (process.platform === 'win32') {
    console.log('        (process groups are POSIX; the taskkill /T path is not exercised here)');
    return;
  }
  const pidFile = join(SANDBOX, 'hook-grandchild.pid');
  const script = join(SANDBOX, 'hangs.cjs');
  writeFileSync(script, [
    "const { spawn } = require('node:child_process');",
    "const g = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 20000)'], { stdio: 'inherit' });",
    `require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(g.pid));`,
    'setTimeout(() => {}, 20000);',
  ].join('\n'));
  const orig = process.stderr.write.bind(process.stderr);
  let seen = '';
  process.stderr.write = (c) => {
    seen += String(c);
    return true;
  };
  let gpid;
  try {
    const r = await runHook(script, { cwd: SANDBOX }, { runtime: process.execPath, timeoutMs: 1500, label: 'test-hook-tree' });
    assert.equal(r, null);
    gpid = Number(readFileSync(pidFile, 'utf8'));
    await new Promise((res) => setTimeout(res, 400));
    assert.throws(() => process.kill(gpid, 0), /ESRCH/, `grandchild ${gpid} outlived the hook's timeout`);
  } finally {
    process.stderr.write = orig;
    try {
      if (gpid) process.kill(gpid, 'SIGKILL');
    } catch {
      /* gone, as it should be */
    }
  }
  assert.match(seen, /test-hook-tree: hook timeout/);
});

console.log(`\nResults: ${pass} passed, ${process.exitCode ? 'FAILURES above' : '0 failed'}`);
