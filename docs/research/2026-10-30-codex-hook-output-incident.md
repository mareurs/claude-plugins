# Codex background-wake hook output incident — 2026-10-30

## Observed failure

The native profile hook invoked background-wake/cli.mjs launch directly. The CLI printed its internal result object to stdout. Codex treated this as PostToolUse response JSON and rejected it. An irrelevant foreground tool event also produced unsupported with exit 1, displayed as a hook failure.

A live observer attached to the originating thread captured both host verdicts before the fix: `hook exited with code 1` for a foreground call and `hook returned invalid post-tool-use JSON output` for a detached watcher launch. The launched watcher still delivered its event, so successful receipt correlation did not validate the separate hook-output boundary.

## Correction

The executable launch command is the hook boundary: it emits no stdout and returns zero for unsupported/irrelevant events. Real launch/configuration exceptions retain a nonzero exit and bounded stderr diagnostic. Programmatic runCli results and other operator commands retain their existing JSON contract. The registered command does not change, so its exact-command trust remains applicable.

## Regression evidence

Five real subprocess checks cover disabled launch, foreground no-op without sends, successful detached launch with an observed completed receipt, malformed configuration failure, and doctor JSON. Before the fix three failed (two incorrect exit codes and one unexpected stdout), and two passed. After the fix all five passed. Successful delivery is observed before asserting silence, preventing a no-op implementation from satisfying the launch test.

The first full run failed only this new detached-delivery test: it read config.stateDir instead of the effective PlatformOps stateDir when CS_TEST_STATE_SANDBOX was set. Reproducing with the runner's sandbox exports failed deterministically; observing createPlatform(config).stateDir corrected the test, and all five cases then passed in that exact environment. Unisolated repeats had passed because they did not measure the runner's storage location. The feature/capability command passed 125 tests. After a one-file local repair of the installed CLI (with its old bytes backed up), the native daemon reported two PostToolUse hook completions with status completed and empty entries, covering an ordinary call and an automatic watcher launch. The registered command/trust and version 1.20.25 were unchanged. The new real background job also delivered its notification. The final full command TMPDIR=/var/tmp bash tests/run-all.sh passed without exclusions (job @bg_0000000a, exited 0, All suites passed). No daemon restart, release bump, unrelated profile update or remote push is part of this repair.
