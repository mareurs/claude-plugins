# Reconnaissance rules — claude-plugins

Project-shaped recon lessons, distilled to one line each (promoted from debugging
sessions per the reconnaissance skill's routing). Cap ~10 rules; consolidate past that.

## Rules

- **R-1 — To find which file a live plugin hook runs, print the resolved `CLAUDE_PLUGIN_ROOT`; do not trust the install record.**
  A session's `CLAUDE_PLUGIN_ROOT` is frozen at process launch and can diverge from the
  current `installed_plugins.json` installPath — the cold-restart trap: a mid-session
  version bump, `dev-install`, or symlink change updates the record but not the running
  process. To learn which file a hook actually executes, emit `CLAUDE_PLUGIN_ROOT` /
  `BASH_SOURCE` from a hook that fires (e.g. a one-line breadcrumb at the top of
  `post-tool-use.sh`, which runs on every tool call) and read it back — never infer from
  the record. Confirm that boundary value before forming hypotheses.
  (Origin: 2026-06-13 summon-path debug — the frozen root was the repo via a `0.1.0` dev
  symlink while the record named a cache copy. That symlink has since been removed: buddy
  is now a plain cache-based plugin, so the specific divergence is gone, but the
  trust-the-boundary-not-the-record rule generalizes to any frozen-vs-current install drift.)
