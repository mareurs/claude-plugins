import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, chmodSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { findHotCollections, hotViewBlock } from './hot-view.mjs';

const HEADER = 'HOT VIEW (codescout hot-view; this hook shows collections whose readme declares hot_cap):';

const roots = [];
function mkRoot() {
  const r = mkdtempSync(join(tmpdir(), 'hot-view-test-'));
  roots.push(r);
  return r;
}
// One item of `collections` in `codescout box --json`.
const col = (key, hot_cap = 5, extra = {}) => ({ key, lifecycle: 'ledger', hot: 1, problem: null, unread: 0, summary: 's', dir: 'd/' + key, hot_cap, ...extra });
// What `codescout box --project <root> --json` prints, as the fake binary answers it.
function boxAnswers(dir, collections) {
  writeFileSync(join(dir, 'box.json'), JSON.stringify({ collections }));
}
// A fake `codescout`: logs its arguments and answers by key.
function fakeBinary(dir) {
  const bin = join(dir, 'fake-codescout');
  writeFileSync(
    bin,
    `#!/usr/bin/env bash
echo "$*" >> "${dir}/calls.log"
if [ "$1" = "box" ]; then
  # The call shape is part of the contract: box --project <root> --json. Anything else is a failure.
  if [ "$2" != "--project" ] || [ "$4" != "--json" ] || [ "$#" -ne 4 ]; then exit 101; fi
  [ -f "${dir}/box-slow" ] && sleep 5
  [ -f "${dir}/box-exit" ] && exit "$(cat "${dir}/box-exit")"
  [ -f "${dir}/box.json" ] || exit 2
  cat "${dir}/box.json"; exit 0
fi
# The call shape is part of the contract: hot-view <key> --project <root>. Anything else is a failure.
if [ "$1" != "hot-view" ] || [ "$3" != "--project" ] || [ "$#" -ne 4 ]; then exit 101; fi
case "$2" in
  busy) printf 'hot view: busy (docs/trackers/ledgers/busy): 1 of 1 hot, 1 live. Scope: x.\\n- [[e1]] t: open since 2026-11-01\\n\\n\\n'; exit 0 ;;
  quality/bugs) printf 'hot view: bugs (docs/boxes/quality/bugs): 1 of 1 hot, 1 live. Scope: x.\\n- [[b1]] t: open since 2026-11-01\\n'; exit 0 ;;
  calm) printf 'hot view: calm (docs/trackers/streams/calm): 0 of 0 hot, 0 live. Scope: x.\\n'; exit 0 ;;
  calmplus) printf 'hot view: calmplus (docs/trackers/ledgers/calmplus): 0 of 0 hot, 0 live. Scope: x.\\n(2 problems found while reading this folder; an entry file with a problem is not listed. Run the doctor for detail.)\\n'; exit 0 ;;
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
const hotViewCalls = (dir) => calls(dir).filter((l) => l.startsWith('hot-view '));

const tests = {
  no_hot_cap_anywhere_gives_empty_block() {
    const root = mkRoot();
    boxAnswers(root, [col('a', null)]);
    assert.equal(hotViewBlock({ root, binary: fakeBinary(root) }), '');
    assert.deepEqual(hotViewCalls(root), []);
  },
  selects_collections_with_a_hot_cap() {
    const root = mkRoot();
    boxAnswers(root, [col('busy'), col('calm'), col('plain', null)]);
    assert.deepEqual(findHotCollections(root, fakeBinary(root)), ['busy', 'calm']);
    assert.deepEqual(calls(root), [`box --project ${root} --json`]);
  },
  skips_a_collection_with_a_problem() {
    const root = mkRoot();
    boxAnswers(root, [col('busy'), col('refused', 5, { problem: 'broken readme' })]);
    assert.deepEqual(findHotCollections(root, fakeBinary(root)), ['busy']);
  },
  an_old_binary_without_hot_cap_selects_nothing() {
    const root = mkRoot();
    boxAnswers(root, [{ key: 'busy', lifecycle: 'ledger', hot: 1, problem: null, unread: 0, summary: 's' }]);
    const bin = fakeBinary(root);
    assert.deepEqual(findHotCollections(root, bin), []);
    assert.equal(hotViewBlock({ root, binary: bin }), '');
  },
  the_old_layout_refusal_selects_nothing() {
    // What this repository's binary prints before `codescout box migrate --apply`: exit 0, no `collections`.
    const root = mkRoot();
    writeFileSync(join(root, 'box.json'), JSON.stringify({ done: false, not_done: 'the boxes use the old layout', old_layout: ['docs/boxes/bugs/bugs'] }));
    const bin = fakeBinary(root);
    assert.deepEqual(findHotCollections(root, bin), []);
    assert.equal(hotViewBlock({ root, binary: bin }), '');
  },
  prefers_the_address_when_present() {
    const root = mkRoot();
    boxAnswers(root, [col('bugs', 5, { box: 'quality', address: 'quality/bugs' })]);
    const bin = fakeBinary(root);
    assert.deepEqual(findHotCollections(root, bin), ['quality/bugs']);
    const block = hotViewBlock({ root, binary: bin });
    assert.deepEqual(hotViewCalls(root), [`hot-view quality/bugs --project ${root}`]);
    assert.match(block, /- \[\[b1\]\] t: open since 2026-11-01/);
  },
  duplicate_name_is_called_once() {
    const root = mkRoot();
    boxAnswers(root, [col('refused'), col('refused')]);
    const bin = fakeBinary(root);
    assert.deepEqual(findHotCollections(root, bin), ['refused']);
    hotViewBlock({ root, binary: bin });
    assert.equal(hotViewCalls(root).length, 1);
  },
  box_json_failures_select_nothing() {
    for (const setup of [
      (r) => writeFileSync(join(r, 'box.json'), 'not json'),
      (r) => writeFileSync(join(r, 'box-exit'), '2'),
      (r) => writeFileSync(join(r, 'box-exit'), '101'),
      () => {}, // the fake exits 2 when box.json is absent
    ]) {
      const root = mkRoot();
      setup(root);
      assert.deepEqual(findHotCollections(root, fakeBinary(root)), []);
    }
  },
  box_json_timeout_selects_nothing() {
    const root = mkRoot();
    boxAnswers(root, [col('busy')]);
    writeFileSync(join(root, 'box-slow'), '');
    const t = Date.now();
    assert.deepEqual(findHotCollections(root, fakeBinary(root), 300), []);
    assert.ok(Date.now() - t < 2000, 'returned too late');
  },
  composes_the_documented_block() {
    const root = mkRoot();
    boxAnswers(root, ['busy', 'calm', 'refused', 'old', 'panic', 'empty'].map((k) => col(k)));
    const block = hotViewBlock({ root, binary: fakeBinary(root) });
    const expected =
      HEADER + '\n' +
      'hot view: busy (docs/trackers/ledgers/busy): 1 of 1 hot, 1 live. Scope: x.\n' +
      '- [[e1]] t: open since 2026-11-01\n' +
      'quiet (0 hot): calm\n' +
      'not shown: empty (hot-view unavailable); old (hot-view unavailable); panic (hot-view unavailable); refused (broken readme)\n\n';
    assert.equal(block, expected);
    assert.doesNotMatch(block, /\n\n\n/); // trailing_newlines_are_trimmed
    for (const line of hotViewCalls(root)) assert.match(line, new RegExp('^hot-view [a-z]+ --project ' + root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$'), line);
    // The exact call shape reaches the binary for every key (a wrong shape makes the fake exit 101,
    // which would turn "busy" into "not shown", so the block above would not match).
    assert.ok(calls(root).includes(`hot-view busy --project ${root}`));
  },
  quiet_view_with_problems_is_shown_verbatim() {
    const root = mkRoot();
    boxAnswers(root, [col('calmplus'), col('calm')]);
    const block = hotViewBlock({ root, binary: fakeBinary(root) });
    assert.equal(
      block,
      HEADER + '\n' +
      'hot view: calmplus (docs/trackers/ledgers/calmplus): 0 of 0 hot, 0 live. Scope: x.\n' +
      '(2 problems found while reading this folder; an entry file with a problem is not listed. Run the doctor for detail.)\n' +
      'quiet (0 hot): calm\n\n',
    );
  },
  a_wrong_call_shape_is_not_shown() {
    // Guards the fake itself: a binary that is called the wrong way must not look healthy.
    const root = mkRoot();
    const bin = fakeBinary(root);
    assert.equal(spawnSync(bin, ['hotview', 'busy', '--projekt', root], { encoding: 'utf8' }).status, 101);
    assert.equal(spawnSync(bin, ['box', '--json', '--project', root], { encoding: 'utf8' }).status, 101);
  },
  timeout_is_not_shown() {
    const root = mkRoot();
    boxAnswers(root, [col('slow')]);
    const t = Date.now();
    const block = hotViewBlock({ root, binary: fakeBinary(root), timeoutMs: 300 });
    assert.ok(Date.now() - t < 2000, 'returned too late');
    assert.match(block, /not shown: slow \(hot-view unavailable\)/);
  },
  limit_lists_the_rest_as_not_checked() {
    const root = mkRoot();
    boxAnswers(root, Array.from({ length: 10 }, (_, i) => col('c' + i)));
    const block = hotViewBlock({ root, binary: fakeBinary(root), maxCollections: 8 });
    assert.equal(hotViewCalls(root).length, 8);
    assert.ok(block.endsWith('not checked: c8, c9 (limit 8 per session start)\n\n'), block);
  },
  missing_binary_gives_an_empty_block() {
    // Without the binary nothing says which collections are hot, so the block is empty.
    for (const binary of ['', '/nonexistent/codescout']) {
      const root = mkRoot();
      assert.equal(hotViewBlock({ root, binary }), '');
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
