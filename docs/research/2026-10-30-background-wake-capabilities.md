# Background-wake capability probes — 2026-10-30

This report accompanies the cross-harness continuation implementation. It measures native hook envelopes, not end-to-end delivery. The fixture MCP provider returned deterministic synthetic job results. Claude and Codex were real installed executables using bounded authenticated model calls in private scratch profiles. No installed profile was changed.

## Measured host envelopes

| Host | Version | Environment | Native observations | Delivery readiness |
|---|---|---|---|---|
| Claude Code | 2.1.312 | Linux | Root and child `PostToolUse`, spawn/read; child has `agent_id`, root does not. `tool_response` is a content array. | Unverified for the new engine |
| Codex CLI | 0.165.0 | Linux | Root and child `PostToolUse`, spawn/read; child carries `agent_id` while `session_id` names its parent. `tool_response` wraps the array in `content`. | Separate daemon 0.160.0 delivery/callback probes passed; automatic registration and active completion remain unverified |
| Claude Code | unmeasured | Native Windows | No host available here | Unverified; disabled |
| Codex | unmeasured | Native Windows | No endpoint/host available here | Unverified; disabled |

The [fixture manifest](../../codescout-companion/contracts/fixtures/background-wake/manifest.json) hashes the six sanitized native envelopes. `synthetic: false` describes the captured host event; `syntheticToolOutcome: true` separately labels the fixture provider's returned job data. IDs, paths and tool-call IDs were replaced with stable placeholders; transcript paths and server configuration were omitted. These envelopes do not prove a real codescout job ran.

Root/subagent discrimination is scoped to these observed versions. A missing `agent_id` without version-matched root/child evidence is insufficient. Never apply the Claude response-array parser directly to Codex's object wrapper. No message body or project directory identifies the target profile.

## Probe execution and corrections

The private scratch directory was `/tmp/cross-harness-wake-implementation-20261030/live-probe`. Each host was given a deterministic local stdio MCP provider with one tool. A bounded root call, one child call, and a second spawn/read pair produced the captures. Claude used Sonnet with explicit budget limits; Codex used `gpt-6.1-sol` with a time limit. Hooks wrote only inside the scratch directory. Existing authentication was referenced locally, not saved in committed evidence.

The initial Codex call was denied by its tool approval policy; that produced no useful tool-result capture. The corrected invocation retained sandboxing and used approval review for the fixture tool. The installed config warned that the guessed per-tool `approval_policy` field was ignored; the supported configuration field is `approval_mode`. The deprecated `codex_hooks` feature spelling was corrected to `hooks`. Capture output was made an explicit hook argument rather than relying on environment forwarding. These were probe corrections, not evidence of a product wake failure.

Hook definitions were placed only in the temporary profile's `hooks.json`; no duplicate inline hooks were retained. This exercises Codex's user hook layer and its one-invocation trust bypass for our own reviewed capture script. It does not authorize enabling arbitrary unreviewed hooks.

## Inspect the committed captures

From the companion checkout:

```sh
node tools/probe-background-wake.mjs --harness claude-code --profile-root /probe/claude-profile --capture-dir codescout-companion/contracts/fixtures/background-wake
node tools/probe-background-wake.mjs --harness codex --profile-root /probe/codex-profile --capture-dir codescout-companion/contracts/fixtures/background-wake
node --test codescout-companion/hooks/background-wake-capabilities.test.mjs codescout-companion/hooks/background-wake-captures.test.mjs
```

The inspection tool does not launch a host or automatically approve tools. Its process exit code says whether evidence inspection succeeded. A reported `ready: false` remains false even when native shape is `measured`. Fresh capture is an explicit bounded host operation, not a hidden side effect of inspecting fixtures.

## Remaining release gates

The implemented engine was measured against the authenticated Linux Codex daemon 0.160.0 with requested model gpt-6.1-sol; the served model was not independently verified. The native hook capture is separately CLI 0.165.0. A new private thread verified loaded-thread attach with thread/resume plus excludeTurns and no overrides. After the secondary connection closed, the original client received one dynamic tool callback and one actual permission callback; the secondary received neither. Earlier probes with zero permission callbacks were not counted as verification.

Real codescout jobs were supplied through explicit measurement bindings to the implemented engine. Idle exit-7 delivery reached a correlated completed receipt and the model marker; a duplicate kept the same completed event, and a fresh secondary connection completed an exit-0 job. This verifies the delivery/storage path, not the complete automatic registration chain. The same-turn control returned the primary turn ID but its preceding status read said idle; the receipt remained accepted. Active-turn completion remains unverified.

The [native evidence summary](../../codescout-companion/contracts/fixtures/background-wake/codex-linux-secondary-evidence.json) records those limits. Original raw logs remain private. The new Claude scratch parity attempt did not authenticate/reach a model tool call and establishes no additional native delivery claim. Native Windows/macOS host adapters remain unverified and disabled; CI coverage of the portable core does not prove host support.

The earlier unmodified-base failures were reproduced with /tmp fixture roots. All three named baseline suites passed with TMPDIR=/dev/shm; an unrelated ancestor git repository under /tmp changed root discovery. The corrected full-suite run uses TMPDIR=/var/tmp without deleting that repository. /dev/shm fixed those suites but is outside the older foreign-path detector's allowlist; /var/tmp also satisfies that detector.

**Stale when:** host versions, native hook schema, endpoint/attach behavior, profile identity or permission/callback routing change. Keep this dated report rather than relabeling its evidence as observations of another release.
