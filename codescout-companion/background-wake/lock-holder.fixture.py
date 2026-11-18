"""Hold the production OS lock until the owning test releases stdin."""
import importlib.util
from pathlib import Path
import sys
spec = importlib.util.spec_from_file_location('wake_receipt', Path(__file__).with_name('receipt_txn.py'))
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)
with open(sys.argv[1], 'a+b') as lock:
    helper.locked(lock)
    print('LOCKED', flush=True)
    sys.stdin.buffer.read(1)
