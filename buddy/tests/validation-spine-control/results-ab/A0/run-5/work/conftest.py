import sys
from pathlib import Path

# `src/` is not a package and there is no install step, so make it importable.
sys.path.insert(0, str(Path(__file__).parent / "src"))
