# This directory is an eval, not a pytest suite. Its fixtures and recorded runs
# contain the stimulus projects' own tests/test_*.py (and conftest.py files the
# model wrote mid-run). They share basenames, so `pytest tests` from buddy/
# failed collection with 20 errors and aborted release.sh's pre-flight
# (2026-10-27). Nothing under here is meant to be collected; the runners are
# exercised by their fake-claude shell tests instead.
collect_ignore_glob = ["*"]
