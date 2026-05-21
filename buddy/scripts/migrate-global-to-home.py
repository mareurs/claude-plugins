#!/usr/bin/env python3
"""CLI entrypoint for the one-time global-state migration.

Real logic lives in scripts/migrate_global.py (importable module name).
This wrapper just makes `python scripts/migrate-global-to-home.py [--apply]`
work by putting the plugin root on sys.path and delegating to main().
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scripts.migrate_global import main

if __name__ == "__main__":
    sys.exit(main())
