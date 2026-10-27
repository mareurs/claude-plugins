"""Pytest configuration: put `src/` on the import path and register markers."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent / "src"))


def pytest_configure(config):
    config.addinivalue_line(
        "markers",
        "characterization: pins current behaviour that the docstring does not "
        "specify; a failure here is a decision to make, not necessarily a bug",
    )
