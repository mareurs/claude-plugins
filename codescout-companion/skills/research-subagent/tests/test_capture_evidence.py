import importlib.util
import pathlib
import tempfile
import unittest
import hashlib

HELPER = pathlib.Path(__file__).resolve().parents[1] / 'scripts' / 'capture_evidence.py'

class SnapshotTests(unittest.TestCase):
    def test_exact_bytes_and_hashes(self):
        spec = importlib.util.spec_from_file_location('snapshot', HELPER)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            source = root / 'original.md'
            source.write_bytes('## Report\r\n\r\n- item\r\n    - \\approx α\r\n'.encode())
            manifest = module.capture(source, root / 'audit', 1)
            saved = pathlib.Path(manifest['destination'])
            self.assertEqual(saved.read_bytes(), source.read_bytes())
            self.assertEqual(manifest['sha256'], hashlib.sha256(source.read_bytes()).hexdigest())
            self.assertEqual(manifest['bytes'], len(source.read_bytes()))
            with self.assertRaises(FileExistsError):
                module.capture(source, root / 'audit', 1)
    def test_missing_evidence_is_an_error(self):
        spec = importlib.util.spec_from_file_location('snapshot', HELPER)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(FileNotFoundError):
                module.capture(pathlib.Path(directory) / 'missing', pathlib.Path(directory) / 'audit', 1)

if __name__ == '__main__':
    unittest.main()
