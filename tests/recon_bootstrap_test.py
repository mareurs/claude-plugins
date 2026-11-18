"""Execute the reconnaissance examples; optionally verify the real MCP contracts."""
import contextlib
import json
import os
from pathlib import Path
import queue
import re
import shutil
import subprocess
import tempfile
import threading
import time
import unittest

ROOT = Path(__file__).resolve().parents[1]
REFS = ROOT / 'codescout-companion/skills/reconnaissance/references'
PATTERNS = REFS / 'patterns-tracker.md'
TEMPLATE = REFS / 'reconnaissance-patterns-template.md'


def example(text, needle):
    matches = [code for code in re.findall(r'```python\n(.*?)\n```', text, re.S) if needle in code]
    if len(matches) != 1:
        raise AssertionError(f'expected one executable Python example containing {needle!r}, got {len(matches)}')
    return matches[0]


def template_body():
    return TEMPLATE.read_text().split('```yaml\n', 1)[1].split('```', 1)[1].lstrip()


def bootstrap(doc, prefix='R'):
    namespace = {'doc': doc, 'prefix': prefix, 'template_body': template_body()}
    exec(compile(example(PATTERNS.read_text(), 'action="create"'), str(PATTERNS), 'exec'), namespace)
    return namespace


def evidence_row():
    return next(line for line in TEMPLATE.read_text().splitlines() if line.startswith('| R-<n> |')).split('|')[-2].strip()


class Examples(unittest.TestCase):
    def test_bootstrap_preserves_body_and_explicit_metadata(self):
        calls = []
        def doc(**args):
            calls.append(args)
            return {'id': 'fixture-id'}
        namespace = bootstrap(doc, 'RP')
        self.assertEqual(len(calls), 1, 'registration and prefix reservation must be one create')
        created = calls[0]
        self.assertEqual(created['action'], 'create')
        self.assertEqual(created['kind'], 'tracker')
        self.assertEqual(created['status'], 'active')
        self.assertEqual(created['body'], template_body())
        self.assertTrue(created['body'].startswith('# Reconnaissance patterns\n'))
        self.assertEqual(created['extra']['entry_prefix'], 'RP')
        self.assertEqual(created['extra']['snapshot_anchor'], '| ID | Date | Verdict | Pattern | Evidence (session-log) |')
        self.assertEqual(namespace['tracker_id'], 'fixture-id')

    def test_append_uses_selected_prefix_and_atomic_index_row(self):
        calls = []
        def doc(**args):
            calls.append(args)
            return {'id': 'RP-1'}
        namespace = {'doc': doc, 'tracker_id': 'fixture-id', 'prefix': 'RP',
                     'entry_title': 'Observed result', 'entry_body': '**Verdict:** hit\n\n**Status:** validated\n'}
        exec(compile(example(TEMPLATE.read_text(), 'action="append_entry"'), str(TEMPLATE), 'exec'), namespace)
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0]['id_prefix'], 'RP')
        self.assertEqual(calls[0]['id'], 'fixture-id')
        self.assertIn('{id}', calls[0]['index_row'])
        self.assertEqual(calls[0]['anchor_heading'], '## Template for new entries')

    def test_both_evidence_examples_are_qualified(self):
        self.assertIn('<topic>-session-log:F-<n>', evidence_row())
        self.assertIn('<topic>-session-log:W-<n>', evidence_row())
        source = re.search(r'^\*\*Source session log:\*\* (.*)$', TEMPLATE.read_text(), re.M).group(1)
        self.assertIn('<topic>-session-log:F-<n>', source)

    def test_guidance_checks_bindings_and_current_contracts(self):
        text = PATTERNS.read_text()
        for field in ('edges_missing', 'edges_stale', 'scan_truncated', 'entry_prefix'):
            self.assertIn(field, text)
        self.assertRegex(text.lower(), r'legitimate.{0,50}repair')
        self.assertNotIn('A **drop** anywhere is a captured', text)
        self.assertNotIn('no frontmatter at all', text)
        self.assertNotIn('artifact(action=', text)


class MCP:
    """One private server per test; never borrow the live catalog or rendezvous."""
    def __init__(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='recon-bootstrap-')
        self.root = Path(self.tmp.name)
        self.project = self.root / 'project'
        self.project.mkdir()
        subprocess.run(['git', 'init', '-q', str(self.project)], check=True, capture_output=True)
        env = os.environ.copy()
        for key in ('HOME', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'XDG_DATA_HOME', 'XDG_STATE_HOME', 'CLAUDE_CONFIG_DIR', 'CODEX_HOME', 'TMPDIR'):
            directory = self.root / key.lower()
            directory.mkdir()
            env[key] = str(directory)
        env['LIBRARIAN_DB'] = str(self.root / 'catalog.db')
        self.errors = (self.root / 'server.log').open('w')
        self.process = subprocess.Popen([shutil.which('codescout'), 'start', '--project', str(self.project)],
                                        cwd=self.project, env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                        stderr=self.errors, text=True)
        self.inbox = queue.Queue()
        self.sequence = 0
        self.reader = threading.Thread(target=self._read, daemon=True)
        self.reader.start()
        try:
            self.request('initialize', {'protocolVersion': '2024-11-05', 'capabilities': {}, 'clientInfo': {'name': 'recon-bootstrap-test', 'version': '1'}})
            self.send({'jsonrpc': '2.0', 'method': 'notifications/initialized'})
        except BaseException:
            self.close()
            raise

    def _read(self):
        for line in self.process.stdout:
            self.inbox.put(line)

    def send(self, message):
        self.process.stdin.write(json.dumps(message) + '\n')
        self.process.stdin.flush()

    def request(self, method, params):
        self.sequence += 1
        wanted = self.sequence
        self.send({'jsonrpc': '2.0', 'id': wanted, 'method': method, 'params': params})
        deadline = time.monotonic() + 45
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError(method)
            try:
                result = json.loads(self.inbox.get(timeout=remaining))
            except queue.Empty:
                raise TimeoutError(f'{method}: {self.errors.name}') from None
            if result.get('id') == wanted:
                if 'error' in result:
                    raise AssertionError(result['error'])
                return result['result']

    def call(self, name, **arguments):
        result = self.request('tools/call', {'name': name, 'arguments': arguments})
        first = next(item['text'] for item in result['content'] if item['type'] == 'text')
        try:
            value = json.loads(first)
        except json.JSONDecodeError:
            value = first
        if result.get('isError') or (isinstance(value, dict) and value.get('ok') is False):
            raise AssertionError(value)
        return value

    def doc(self, **arguments):
        return self.call('doc', **arguments)

    def create(self, stem, body, **extra):
        return self.doc(action='create', kind='tracker', status='active', title=stem,
                        rel_path=extra.pop('rel_path', 'docs/trackers/' + stem + '.md'), body=body, **extra)['id']

    def scan(self):
        value = self.call('librarian', action='link_scan', write=True, findings_limit=100)
        if value['counts']['scan_truncated'] or value['counts']['unreadable'] or any(value['counts']['truncated'].values()):
            raise AssertionError('incomplete fixture scan: ' + json.dumps(value['counts']))
        return value

    def close(self):
        self.process.terminate()
        try:
            self.process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self.process.kill()
            self.process.wait(timeout=5)
        self.reader.join(timeout=5)
        self.process.stdin.close()
        self.process.stdout.close()
        self.errors.close()
        self.tmp.cleanup()


@unittest.skipUnless(shutil.which('codescout'), 'codescout binary unavailable: real MCP integration not run')
class Contracts(unittest.TestCase):
    def setUp(self):
        self.client = MCP()
        self.addCleanup(self.client.close)

    def test_documented_bootstrap_and_append_run_on_current_server(self):
        namespace = bootstrap(self.client.doc, 'RP')
        created = self.client.doc(action='get', id=namespace['tracker_id'], full=True)
        self.assertEqual(created['kind'], 'tracker')
        self.assertEqual(created['status'], 'active')
        self.assertEqual(created['extra']['entry_prefix'], 'RP')
        namespace.update(entry_title='Observed result', entry_body='**Verdict:** hit\n\n**Status:** validated\n')
        exec(example(TEMPLATE.read_text(), 'action="append_entry"'), namespace)
        current = self.client.doc(action='get', id=namespace['tracker_id'], full=True)['body']
        self.assertIn('## RP-1 — Observed result', current)
        self.assertRegex(current, r'(?m)^\| RP-1 \|')

    def test_copied_template_is_classified_after_reindex(self):
        path = self.client.project / 'docs/trackers/reconnaissance-patterns.md'
        path.parent.mkdir(parents=True)
        shutil.copyfile(TEMPLATE, path)
        self.assertFalse(path.read_text().startswith('---\n'))
        self.assertEqual(self.client.doc(action='find', kind='tracker')['count'], 0)
        self.client.call('librarian', action='reindex')
        rows = self.client.doc(action='find', kind='tracker')['items']
        self.assertEqual([(row['kind'], row['status']) for row in rows], [('tracker', 'active')])

    def test_documented_evidence_targets_the_right_session_log(self):
        for stem in ('alpha-session-log', 'beta-session-log'):
            self.client.create(stem, '# Log\n\n## F-1 — Friction\n\nEvidence.\n\n## W-1 — Win\n\nEvidence.\n')
        def render(value):
            return value.replace('<topic>', 'alpha').replace('<n>', '1')
        source = re.search(r'^\*\*Source session log:\*\* (.*)$', TEMPLATE.read_text(), re.M).group(1)
        for evidence in (evidence_row(), source):
            with self.subTest(evidence=evidence):
                citer = self.client.create('evidence-citer-' + str(len(evidence)), '# Evidence\n\n' + render(evidence))
                scan = self.client.scan()
                self.assertEqual(scan['counts']['ambiguous'], 0)
                self.assertEqual(scan['counts']['dangling'], 0)
                graph = self.client.doc(action='graph', id=citer, depth=1)
                alpha = self.client.doc(action='find', filter={'rel_path': {'eq': 'docs/trackers/alpha-session-log.md'}})['items'][0]['id']
                self.assertIn({'src': citer, 'dst': alpha, 'rel': 'cites'}, graph['edges'])

    def test_prefix_capture_and_rename_change_actual_edges(self):
        owner = self.client.create('old-row-ledger', '# Old\n\n| R-1 | Old first item |\n| R-9 | Old ninth item |\n', rel_path='notes/old-row-ledger.md')
        self.client.create('hidden-row-ledger', '# Hidden\n\n| R-2 | Hidden item |\n', rel_path='.codescout/memories/hidden-row-ledger.md')
        searches = []
        def grep(**args):
            searches.append(args)
            return self.client.call('grep', **args)
        exec(example(PATTERNS.read_text(), 'grep('), {'grep': grep, 'prefix': 'R'})
        self.assertEqual(searches[0]['path'], '.')
        self.assertTrue(searches[0]['include_hidden'])
        result = self.client.call('grep', **searches[0])
        rendered = json.dumps(result)
        self.assertIn('notes/old-row-ledger.md', rendered)
        self.assertIn('hidden-row-ledger.md', rendered)
        self.assertEqual(self.client.scan()['counts']['dangling'], 0)
        ledger = self.client.create('new-ledger', '# New\n\n## R-1 — Unrelated new item\n\nNew.\n')
        activated = self.client.scan()
        self.assertEqual({x['raw'] for x in activated['dangling']}, {'R-2', 'R-9'})
        self.assertIn({'src': owner, 'dst': ledger, 'rel': 'cites'}, self.client.doc(action='graph', id=owner, depth=1)['edges'])
        self.client.doc(action='update', id=ledger, patch={'body': '# New\n\n## RP-1 — Unrelated new item\n\nNew.\n'})
        renamed = self.client.scan()
        self.assertEqual(renamed['counts']['edges_pruned'], 1)
        self.assertEqual(renamed['counts']['dangling'], 0)
        self.assertEqual(self.client.doc(action='graph', id=owner, depth=1)['edges'], [])

    def test_declared_prefix_and_legitimate_repair(self):
        owner = self.client.create('intended-owner', '# Empty ledger\n', extra={'entry_prefix': 'QC'})
        reader = self.client.create('reader', '# Reader\n\nExpected evidence is in intended-owner: QC-1.\n')
        before = self.client.scan()
        self.assertEqual([x['raw'] for x in before['dangling']], ['QC-1'])
        self.client.doc(action='update', id=owner, patch={'body': '# Ledger\n\n## QC-1 — Intended evidence\n\nEvidence.\n'})
        after = self.client.scan()
        self.assertEqual(after['counts']['dangling'], 0)
        self.assertIn({'src': reader, 'dst': owner, 'rel': 'cites'}, self.client.doc(action='graph', id=reader, depth=1)['edges'])

    def test_duplicate_bootstrap_refuses_without_leaving_a_file(self):
        self.client.create('existing-owner', '# Existing\n', extra={'entry_prefix': 'R'})
        with self.assertRaisesRegex(AssertionError, 'entry prefix already taken'):
            bootstrap(self.client.doc, 'R')
        self.assertFalse((self.client.project / 'docs/trackers/reconnaissance-patterns.md').exists())


if __name__ == '__main__':
    unittest.main(verbosity=2)
