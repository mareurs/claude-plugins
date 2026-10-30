# Background-job continuation

The shared Node engine is opt in for each profile. Missing configuration keeps the existing Claude hook and disables Codex delivery. Preparing this source branch does not activate installed profiles.

## Support and evidence

| Path | Measured result | Limit |
|---|---|---|
| Claude legacy | Existing hook parity suite retained | Existing asyncRewake behavior |
| Claude v1, 2.1.312 on Linux | Real native root/child envelopes; wrapper subprocess parity for exit 0/7, heartbeat/rearm, concurrent jobs | Complete new-engine native-host parity unverified: scratch authentication did not reach the model |
| Codex CLI 0.165.0 + daemon 0.160.0 on Linux | Real native envelopes; secondary loaded-thread attach; original tool and permission callbacks after secondary close; real job receipt completed; duplicate suppressed; reconnect completed | Full automatic registration chain unverified. Same-turn control stayed accepted; completion was not observed |
| Native Windows / macOS host adapters | Unverified, disabled | Portable storage/engine/CLI tests are configured in CI; no local native Windows run was available |
| WSL | Separate Linux execution environment | Never reuse a native Windows binding or endpoint |
| Pi / Copilot | Future adapters | Copilot requires an extension-owned authenticated session; SDK feasibility is separate from VS Code integration |

The [dated capability report](research/2026-10-30-background-wake-capabilities.md) and [native secondary-client summary](../codescout-companion/contracts/fixtures/background-wake/codex-linux-secondary-evidence.json) distinguish real host events, synthetic tool outcomes and real job records.

## Prepare the plugin

The optional engine needs Node 24+, Python 3.13+, local private storage, and the exact dependency lock. The legacy Claude path retains its existing requirements. Before copying or activating this source:

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

The callback declaration refers to the measured Linux daemon version, not a promise about another version. A CLI version is not the daemon version. Other combinations are refused. Endpoint identity is a hash of its resolved socket path, device, inode and change time; a restarted/replaced daemon requires a new explicit pin. Obtain it locally from the prepared checkout:

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

Claude's existing hooks/hooks.json already invokes the compatibility wrapper; no additional Claude registration is needed. Codex 0.165.0 was measured with a profile hooks.json containing PostToolUse command hooks. Merge this Linux-only entry into that profile's existing hooks, using absolute prepared-plugin/profile paths and normal shell quoting:

```json
{
  "hooks": {
    "PostToolUse": [{
      "matcher": "mcp__codescout__run_command",
      "hooks": [{
        "type": "command",
        "command": "node '/absolute/prepared/codescout-companion/background-wake/cli.mjs' launch --harness codex --profile '/absolute/selected/profile' --environment linux"
      }]
    }]
  }
}
```

Use the host's normal hook trust/approval flow. launch checks capability and root origin, starts a detached Node watcher with executable/argument arrays, and returns. It does not hold the model turn open while the job runs. No asyncRewake flag is assumed for Codex. No installed profile, daemon or plugin version is changed by these tests.

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

## Verification and extension

Run the full companion suite without exclusions. On this machine, /tmp has an unrelated ancestor git repository, which changes root discovery in older fixture suites; TMPDIR=/var/tmp isolates their temporary projects. Do not remove someone else's /tmp/.git.

```sh
TMPDIR=/var/tmp bash tests/run-all.sh
node --test codescout-companion/background-wake/*.test.mjs codescout-companion/background-wake/adapters/*.test.mjs
```

CI runs portable identity/storage/engine/CLI tests on Linux, macOS and Windows, plus a real CLI subprocess from PowerShell on Windows. A configured CI row is not evidence that it has run.

A future host adds its native normalizer, capability evidence and HostAdapter. Keep SDKs/endpoints in that adapter and OS operations in PlatformOps. Extend the harness allowlist and fixtures explicitly; preserve v1 hash ordering and existing persisted IDs. Pi and Copilot must pass the same origin, lifecycle and correlated-delivery contract before being advertised.
