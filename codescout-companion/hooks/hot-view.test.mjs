import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { findHotCollections, hotViewBlock } from './hot-view.mjs';

const HEADER = 'HOT VIEW (codescout hot-view; this hook shows collections whose readme declares hot_cap):';
const FM = (extra) => '---\ntitle: T\n' + extra + '---\n# body\n';
const HOT = FM('hot_cap: 5\n');

const roots = [];
function mkRoot() {
  const r = mkdtempSync(join(tmpdir(), 'hot-view-test-'));
  roots.push(r);
  return r;
}
function readme(root, lifecycle, key, text) {
  const dir = join(root, 'docs', 'trackers', lifecycle, key);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'readme.md'), text);
}
// A fake `codescout`: logs "<key>|<project>" and answers by key.
function fakeBinary(dir) {
  const bin = join(dir, 'fake-codescout');
  writeFileSync(
    bin,
    `#!/usr/bin/env bash
echo "$2|$4" >> "${dir}/calls.log"
case "$2" in
  busy) printf 'hot view: busy (docs/trackers/ledgers/busy): 1 of 1 hot, 1 live. Scope: x.\\n- [[e1]] t: open since 2026-11-01\\n\\n\\n'; exit 0 ;;
  calm) printf 'hot view: calm (docs/trackers/streams/calm): 0 of 0 hot, 0 live. Scope: x.\\n'; exit 0 ;;
  refused) printf 'NOT SHOWN — broken readme\\n'; exit 2 ;;
  old) echo "error: unrecognized subcommand 'hot-view'" >&2; exit 2 ;;
  panic) exit 101 ;;
  slow) sleep 5; exit 0 ;;
  empty) exit 0 ;;
  *) exit 2 ;;
esac
`,
  );
  chmodSync(bin, 0o755);
  return bin;
}
const calls = (dir) => (existsSync(join(dir, 'calls.log')) ? readFileSync(join(dir, 'calls.log'), 'utf8').trim().split('\n') : []);

const tests = {
  no_hot_cap_anywhere_gives_empty_block() {
    const root = mkRoot();
    readme(root, 'ledgers', 'a', FM(''));
    const bin = fakeBinary(root);
    assert.equal(hotViewBlock({ root, binary: bin }), '');
    assert.equal(existsSync(join(root, 'calls.log')), false);
  },
  selects_all_three_lifecycles_and_skips_archive() {
    const root = mkRoot();
    readme(root, 'ledgers', 'busy', HOT);
    readme(root, 'streams', 'calm', HOT);
    readme(root, 'temp', 'refused', HOT);
    readme(root, 'ledgers/archive', 'gone', HOT);
    readme(root, 'ledgers', 'nocap', FM(''));
    assert.deepEqual(findHotCollections(root), ['busy', 'calm', 'refused']);
  },
  hot_cap_outside_frontmatter_is_ignored() {
    const root = mkRoot();
    readme(root, 'ledgers', 'a', '---\ntitle: T\n---\nhot_cap: 5\n');
    assert.deepEqual(findHotCollections(root), []);
  },
  crlf_readme_is_selected() {
    const root = mkRoot();
    readme(root, 'ledgers', 'a', HOT.replaceAll('\n', '\r\n'));
    assert.deepEqual(findHotCollections(root), ['a']);
  },
  duplicate_key_is_called_once() {
    const root = mkRoot();
    readme(root, 'ledgers', 'refused', HOT);
    readme(root, 'temp', 'refused', HOT);
    assert.deepEqual(findHotCollections(root), ['refused']);
    hotViewBlock({ root, binary: fakeBinary(root) });
    assert.equal(calls(root).length, 1);
  },
  composes_the_documented_block() {
    const root = mkRoot();
    const keys = { busy: 'ledgers', calm: 'streams', refused: 'temp', old: 'ledgers', panic: 'ledgers', empty: 'ledgers' };
    for (const [k, l] of Object.entries(keys)) readme(root, l, k, HOT);
    const block = hotViewBlock({ root, binary: fakeBinary(root) });
    const expected =
      HEADER + '\n' +
      'hot view: busy (docs/trackers/ledgers/busy): 1 of 1 hot, 1 live. Scope: x.\n' +
      '- [[e1]] t: open since 2026-11-01\n' +
      'quiet (0 hot): calm\n' +
      'not shown: empty (hot-view unavailable); old (hot-view unavailable); panic (hot-view unavailable); refused (broken readme)\n\n';
    assert.equal(block, expected);
    assert.doesNotMatch(block, /\n\n\n/); // trailing_newlines_are_trimmed
    for (const line of calls(root)) assert.ok(line.endsWith('|' + root), line);
  },
  timeout_is_not_shown() {
    const root = mkRoot();
    readme(root, 'ledgers', 'slow', HOT);
    const t = Date.now();
    const block = hotViewBlock({ root, binary: fakeBinary(root), timeoutMs: 300 });
    assert.ok(Date.now() - t < 2000, 'returned too late');
    assert.match(block, /not shown: slow \(hot-view unavailable\)/);
  },
  limit_lists_the_rest_as_not_checked() {
    const root = mkRoot();
    for (let i = 0; i < 10; i++) readme(root, 'ledgers', 'c' + i, HOT);
    const block = hotViewBlock({ root, binary: fakeBinary(root), maxCollections: 8 });
    assert.equal(calls(root).length, 8);
    assert.ok(block.endsWith('not checked: c8, c9 (limit 8 per session start)\n\n'), block);
  },
  missing_binary_is_unavailable() {
    for (const binary of ['', '/nonexistent/codescout']) {
      const root = mkRoot();
      readme(root, 'ledgers', 'busy', HOT);
      const block = hotViewBlock({ root, binary });
      assert.match(block, /not shown: busy \(hot-view unavailable\)/);
    }
  },
};

let failed = 0;
for (const [name, fn] of Object.entries(tests)) {
  try {
    fn();
    console.log('PASS: ' + name);
  } catch (e) {
    failed++;
    console.log('FAIL: ' + name + '\n' + e.message);
  }
}
for (const r of roots) rmSync(r, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
