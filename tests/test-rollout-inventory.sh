#!/usr/bin/env bash
set -euo pipefail
python3 -B -m unittest discover -s "$(dirname "${BASH_SOURCE[0]}")" -p test_rollout_inventory.py -v
