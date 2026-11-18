---
id: d22931a86102ccb4
kind: unknown
---
# Background-job continuation

The shared Node engine is opt in for each profile. Missing configuration keeps the existing Claude hook and disables Codex delivery. Preparing this source branch does not activate installed profiles.

## Support and evidence

| Path | Measured result | Limit |
|---|---|---|
| Claude legacy | Existing hook parity suite retained | Existing asyncRewake behavior |
| Claude v1, 2.1.312 on Linux | Real native root/child envelopes; wrapper subprocess parity for exit 0/7, heartbeat/rearm, concurrent jobs | Complete new-engine native-host parity unverified: scratch authentication did not reach the model |
| Codex CLI 0.165.0 + daemon 0.160.0 on Linux | Real native envelopes; secondary loaded-thread attach; original tool and permission callbacks after secondary close; real job receipt completed; duplicate suppressed; reconnect completed | Full automatic registration chain unverified. Same-turn control stayed accepted; completion was not observed |
| Codex CLI + daemon 0.167.0 on Linux | Root/child identity observed in the separate 2026-11-08 native-observability spike; callback probe observed one original tool callback and one original permission callback after secondary close, zero secondary callbacks. A real 15-second root job triggered the installed hook and resumed the idle session automatically, with one send and receipt `continuation_observed` | No equivalent standalone 0.167.0 wake-envelope set; spike observer was throwaway. Single root-job delivery observed; receipt `completed`, active-turn completion, repeated-job and platform parity remain unverified |
| Native Windows / macOS host adapters | Unverified, disabled | Portable storage/engine/CLI tests are configured in CI; no local native Windows run was available |
| WSL | Separate Linux execution environment | Never reuse a native Windows binding or endpoint |
| Pi / Copilot | Future adapters | Copilot requires an extension-owned authenticated session; SDK feasibility is separate from VS Code integration |

Codex eligibility uses feature minimums: CLI 0.165.0 and daemon 0.160.0, with no upper version ceiling. Valid newer prereleases and build identifiers are accepted; a prerelease of the minimum itself is below that stable minimum. Eligibility still requires explicit per-profile callback proof and all runtime identity checks. The measured rows above remain historical evidence, not measurements of every eligible version.

The [dated capability report](research/2026-10-30-background-wake-capabilities.md), [fixture manifest](../codescout-companion/contracts/fixtures/background-wake/manifest.json) and native secondary-client summaries distinguish real host events, synthetic tool outcomes and real job records.

The manifest's measured 0.165.0 row contains standalone native wake root/spawn/read envelopes. Its documented 0.167.0 row links the separate [native-observability spike](evidence/2026-11-08-stock-codex-hooks-spike.json): root/child identity was observed, but no equivalent standalone wake-envelope set is committed. The spike's passive proxy was a throwaway observer, not an authorization boundary or production journal; no spike changes were installed or integrated into production. Those observations are distinct from the 0.167.0 callback probe and single root-job delivery recorded on 2026-11-10.

## Prepare the plugin

The optional engine needs Node 22+, Python 3.12+, local private storage, and the exact dependency lock. CI runs the whole test suite on Node 22 with Python 3.12 (the floor) and on Node 24 with Python 3.13 (the runtimes the engine was first built on). The floor is measured on Linux only; CI runs the portable wake tests on macOS and Windows with Node 24. The legacy Claude path retains its existing requirements. Before copying or activating this source:

```sh
npm ci --prefix codescout-companion --ignore-scripts --omit=optional
bash tests/test-background-wake-package.sh
```

The copier includes prepared node_modules. A fresh git installation has no installed dependencies. Hooks never fetch packages. The Codex client loads ws lazily; missing dependencies disable that path. It accepts only measured Linux Unix IPC, checks current-user private socket permissions, the socket generation and initialize.codexHome. TCP, TLS and guessed Windows named pipes are unsupported.

## Profile configuration

Create codescout-wake.json inside the explicitly selected profile. Its profileRoot must be that profile's canonical native path. Give every profile its own stateDir; storage records its owner and refuses reuse by another profile. Choose a distinct environmentId for native Windows, WSL, containers and remote machines.

```json
{
  "version": 1,
  "engine": "legacy",
  "profileRoot": "/absolute/selected/profile",
  "environmentId": "linux",
  "stateDir": "/absolute/selected/profile/codescout-wake-state",
  "pythonArgv": ["python3"],
  "adapters": {
    "claudeCode": {"enabled": false},
    "codex": {
      "enabled": true,
      "endpoint": "unix:///absolute/selected/profile/app-server-control/app-server-control.sock",
      "maxPayloadBytes": 8388608
    }
  },
  "bindings": {
    "codex": {
      "hostVersion": "0.165.0",
      "hostInstanceId": "<pinned-socket-generation>",
      "runtimeGeneration": "<same-pinned-socket-generation>"
    }
  },
  "capabilities": {
    "codex": {
      "daemonVersion": "0.160.0",
      "subscription": "resume-loaded",
      "callbackPreserved": true
    }
  },
  "migration": {"legacyStateDir": "/absolute/previous/state/codescout-companion/wake"}
}
```

The callback declaration records proof for the exact configured daemon version and selected profile; set callbackPreserved=true only after verifying that combination. A CLI version is not the daemon version. Codex CLI versions from 0.165.0 and daemon versions from 0.160.0 are eligible without an upper ceiling. The observed daemon version must still match capabilities.codex.daemonVersion exactly, including prerelease/build identifiers. Endpoint identity is a hash of its resolved socket path, device, inode and change time; a restarted/replaced daemon requires a new explicit pin. Obtain it locally from the prepared checkout:

```sh
node --input-type=module -e 'import {endpointIdentity} from "./codescout-companion/background-wake/adapters/codex-client.mjs"; console.log(await endpointIdentity(process.argv[1]))' unix:///absolute/selected/profile/app-server-control/app-server-control.sock
node codescout-companion/background-wake/cli.mjs doctor --profile /absolute/selected/profile --environment linux
```

For Claude v1, use adapters.claudeCode.enabled=true and bindings.claudeCode with hostVersion 2.1.312 and explicit hostInstanceId/runtimeGeneration. Only Linux envelopes are measured. Claude receipts record stderr emission, not host acceptance. Keep the legacy default until native parity is established for deployment.

## Migration and registration

Disable the previous intake first. Let mapped legacy watchers finish or expire, retain their mappings and ownership files, then activate only the selected profile:

```sh
node codescout-companion/background-wake/cli.mjs activate --profile /absolute/selected/profile --environment linux --legacy-intake-disabled
```

Activation inspects the explicit legacyStateDir and refuses live or unverified mapped watcher PIDs. It never adopts an existing legacy job. Rolling the config back cannot adopt a v1-owned record either. The acknowledgement flag is an operator assertion that old intake is disabled; the tool cannot inspect arbitrary host registration. Do not enable both registrations during migration.

Claude's existing hooks/hooks.json already invokes the compatibility wrapper; no additional Claude registration is needed. For Codex, install the stable profile-local launcher from the prepared checkout:

```sh
node codescout-companion/background-wake/codex-hook.mjs --install --profile /absolute/selected/profile
```

The installer preserves unrelated hooks, replaces the previous versioned wake registration, and saves the original `hooks.json` as `hooks.json.before-versionless-wake`. Re-running it is safe. The installed launcher stays in the profile when plugin caches are replaced. Each invocation asks `codex plugin list --json` which enabled companion version is installed and validates that version's manifest and cache path inside the same profile. It follows the selected version, including downgrades; it never guesses the newest directory or falls back to another profile. The profile comes from the launcher's location, and `environmentId` comes from that profile's wake configuration. Missing configuration or a disabled/uninstalled companion is a silent no-op; malformed configuration, missing selected caches, ambiguous installations and launch failures remain errors.

The resulting Linux hook command uses `CODEX_HOME` with the normal single-profile fallback:

```json
{
  "hooks": {
    "PostToolUse": [{
      "matcher": "mcp__codescout__run_command",
      "hooks": [{
        "type": "command",
        "command": "node \"${CODEX_HOME:-$HOME/.codex}/hooks/codescout-wake.mjs\""
      }]
    }]
  }
}
```

Use the host's normal hook trust/approval flow. launch checks capability and root origin, starts a detached Node watcher with executable/argument arrays, and returns. As a native hook entry point, launch writes no stdout: its internal result is not PostToolUse response JSON. Disabled or irrelevant events are successful no-ops; genuine configuration/launch errors still report a nonzero exit and a bounded stderr diagnostic. doctor and other operator commands retain their machine-readable JSON. It does not hold the model turn open while the job runs. No asyncRewake flag is assumed for Codex. No installed profile, daemon or plugin version is changed by these tests.

For this machine's three Codex installations, prepare and verify all three independently when installation is authorized. Each installation record must point into its own cache; no profile may borrow another profile's state or endpoint.

## Delivery and recovery

The event key includes the full job/server generation and exact target binding. Terminal and heartbeat IDs differ. Generation-specific watch registrations remain immutable; an OS-locked current-handle index can move to a new server generation and rejects replay of a retired one. The engine consults an existing terminal receipt before declaring tracking loss, and omits handle-read instructions when the original handle cannot be verified. Only one owner can persist a send permit. A durable send intent precedes transport delivery; a crash in the return window is unknown and is never replayed automatically. Only definite pre-send failures retry, up to four persisted send attempts.

Codex records accepted from the request reply, continuation_observed from the matching tool-output event, and completed only after that item and its exact turn complete. A generic idle event proves nothing. Closing the secondary connection does not unload, interrupt or close the thread.

Claude v1 records sending plus emitted-unconfirmed. This suppresses automatic duplicate emission without claiming that the host resumed. Receipts retain the outcome snapshot after the server record disappears. Tracking loss invalidates the handle and never suggests reading it on a replacement server.

```sh
node codescout-companion/background-wake/cli.mjs doctor --profile /absolute/selected/profile --environment linux --event wake1:<64-hex-digits>
node codescout-companion/background-wake/cli.mjs reconcile --profile /absolute/selected/profile --environment linux --event wake1:<64-hex-digits>
node codescout-companion/background-wake/cli.mjs recover-pre-send --profile /absolute/selected/profile --environment linux --event wake1:<64-hex-digits>
node codescout-companion/background-wake/cli.mjs acknowledge --profile /absolute/selected/profile --environment linux --event wake1:<64-hex-digits> --note 'Inspected externally; no resend'
node codescout-companion/background-wake/cli.mjs gc --profile /absolute/selected/profile --environment linux --event wake1:<64-hex-digits>
```

reconcile currently observes the stored evidence only; it cannot infer missing host completion. recover-pre-send can recover only expired claims without send intent. acknowledge records an operator decision while preserving unknown/sending/accepted; it is not host evidence and never resends. There is no generic retry command.

GC conservatively retains all stable identities, including completed and unconfirmed ones, and every persistent lock file. This prevents reopening a replay window and costs continuing local storage growth. Do not manually erase unresolved receipts to trigger delivery.

## Recheck Codex callback compatibility

The adapter accepts valid daemon versions from 0.160.0; native intake accepts valid CLI versions from 0.165.0. Neither has an upper ceiling. Newer prereleases are eligible, but a prerelease of a feature's stable minimum is below that minimum. Callback preservation must still be explicitly verified for the configured version/profile with subscription=resume-loaded and callbackPreserved=true. Exact observed version, canonical profile, both endpoint-generation fields, loaded-thread, root-only hook and correlated completion checks remain required. The CLI evidence classes differ as described above; eligibility alone does not establish measured callback or hook compatibility. Keep the older [0.160.0 evidence](../codescout-companion/contracts/fixtures/background-wake/codex-linux-secondary-evidence.json) distinct from the [0.167.0 evidence](../codescout-companion/contracts/fixtures/background-wake/codex-linux-secondary-evidence-0167.json).

Daemon version parsing uses the leading `<originator>/<major.minor.patch[-prerelease][+build]>` token from `initialize.userAgent`. The originator comes from the first client to initialize that server process and may differ from the current client. Both the adapter and probe compare the parsed version exactly with the configured or expected version; malformed tokens remain rejected. Historical callback `evidenceRef` values name a JSON file relative to the plugin root plus the summary's `id` fragment. Eligible versions without bundled measurements return evidenceRef=null and a diagnostic naming the configured per-profile callback proof; they do not acquire a historical evidence reference.

The opt-in native probe creates its own test thread, starts one bounded model turn to make its rollout resumable, attaches and closes a secondary client, and then requires an actual tool callback and an actual permission callback on the primary. It declines the escalated command. Its own thread-local hooks are disabled so installed routing hooks do not intercept the probe command. Existing user threads and profile configuration are not changed. The test thread is archived on cleanup. This consumes account usage; run it only with permission.

```sh
node tools/probe-codex-wake-callbacks.mjs --help
node tools/probe-codex-wake-callbacks.mjs \
  --endpoint unix:///absolute/profile/app-server-control/app-server-control.sock \
  --profile /absolute/profile --expected-version 0.167.0 \
  --allow-model-call --timeout-ms 90000
node --test tools/probe-codex-wake*.test.mjs
```

An absent permission callback, an early callback, a callback on the secondary, timeout, or failed attach is not a compatibility pass. The probe does not enable a profile or prove full automatic hook-to-wake delivery. A new daemon generation still requires explicit endpoint repinning. Use Node 22+ and Python 3.12+ for activation and the full wake test suite; installing `ws` alone does not provide those runtimes.

## Verification and extension

Run the full companion suite without exclusions. On this machine, /tmp has an unrelated ancestor git repository, which changes root discovery in older fixture suites; TMPDIR=/var/tmp isolates their temporary projects. Do not remove someone else's /tmp/.git.

```sh
TMPDIR=/var/tmp bash tests/run-all.sh
node --test codescout-companion/background-wake/*.test.mjs codescout-companion/background-wake/adapters/*.test.mjs
```

CI runs portable identity/storage/engine/CLI tests on Linux, macOS and Windows, plus a real CLI subprocess from PowerShell on Windows. A configured CI row is not evidence that it has run.

A future host adds its native normalizer, capability evidence and HostAdapter. Keep SDKs/endpoints in that adapter and OS operations in PlatformOps. Extend the harness allowlist and fixtures explicitly; preserve v1 hash ordering and existing persisted IDs. Pi and Copilot must pass the same origin, lifecycle and correlated-delivery contract before being advertised.
