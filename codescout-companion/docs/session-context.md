# Session context and verification

The version 1 contract in [session-context-v1.schema.json](../contracts/session-context-v1.schema.json) carries `harness`, the opaque root `session_id`, nullable `agent_id`, canonical absolute Git `workspace`, `source`, and nullable `harness_version`. Harnesses are `claude-code`, `codex`, and `manual`. A child remains attributed to its root principal; principals are namespaced as `<harness>:<native root id>`.

The pure [hook adapter](../hooks/session-context.mjs) accepts an explicitly identified native hook payload. The CLI adapter additionally verifies the actual Git root:

```sh
node codescout-companion/scripts/session-context.mjs --harness claude-code --workspace /absolute/checkout < hook-payload.json
```

This adapter adds no hook registration, stdout event, permission policy, or change to `principal-stamp.mjs`. A separate source-only stock Codex observation registration is described below; native MCP context reaches Codescout commands independently.

## Codescout consumers

In the matching Codescout checkout:

```sh
./scripts/gate.sh --check
./scripts/gate.sh
./scripts/gate.sh --context /absolute/context.json
./scripts/gate.sh --exclusive-checkout /absolute/checkout
```

`--check` runs formatting read-only and needs no session identity or history scan. Ordinary formatting resolves identity and only formats proven own or git-clean paths. Unknown coverage refuses clearance; known shared ownership remains shared. `--exclusive-checkout` is an operator declaration of exclusive control over its matching Git checkout. It grants authorization without changing provenance labels and rejects conflicting context and outside-checkout descendants.

Codescout resolves `CLAUDE_CODE_SESSION_ID` or `CODEX_SESSION_ID`; both together conflict. `CODEX_THREAD_ID` is child metadata, never a replacement root. `--context` and `CODESCOUT_CONTEXT_FILE` accept an absolute context file. A disagreement with native identity or the actual checkout fails closed. No PID, shared last-writer pointer, or host precedence supplies identity.

Missing or conflicting context blocks formatting, while the gate still leases a bounded target slot and runs Python, clippy, lean tests, then default tests. The summary retains `PYTHON_LIGHT`, `FMT`, `CLIPPY`, `LEAN`, `DEFAULT` and adds `FMT_STATE`. Formatter states are `passed`, `differences`, `ownership-refused`, `context-blocked`, or `tool-error`. Gate exit 1 reports a completed lane failure; exit 2 reports invalid entry or lease failure. A private context snapshot is removed on normal and handled signal exits.

## History and contact

Claude discovery uses `HOME` profiles, `CLAUDE_CONFIG_DIR`, and the legacy `FILE_PROVENANCE_ROOTS` override. Codex discovery uses Codex profiles under `HOME`, `CODEX_HOME`, and native `sessions` plus `archived_sessions`. For explicit discovery use:

```sh
FILE_PROVENANCE_CODEX_ROOTS_JSON='["/absolute/native-history-root"]' ./scripts/file-provenance.py src/example.rs
```

The override is a JSON array of absolute roots; `[]` deliberately selects none. A malformed override, unreadable source, unknown wrapper, or unsupported history boundary produces a coverage gap. Shell writes are heuristic; manual editors and external tools remain outside transcript evidence. Refused atomic writes are excluded, while failed or unpaired shell operations may have written before failing. Copies of the same original event are deduplicated; equal arguments alone are insufficient.

Claude contact registry data is consulted only for Claude owners. A Codex owner may have known ownership with unknown contact and liveness. Unknown contact or a not-live marker does not prove abandoned work.

## Observed capabilities — 2026-10-12

These observations extend the dated capture below. They do not establish a supported version range.

| Capability | Claude Code 2.1.296 | Codex 0.160.0 |
|---|---|---|
| Root and child context | Native root retained for child writes | Native MCP sessionId/threadId automatically reach spawned commands; child retains its shared root |
| Actual authored writes | Main-profile MCP write and owned formatting passed | Completed native MCP writer recovered with full root/thread/call identity and exact arguments |
| Resume | Same-root write and formatting passed | Same-root context and recovered writer retained; formatter reports UNKNOWN and preserves bytes |
| Compaction and new-root fork | Native fork replay refusal preserves bytes | Native context continuity passed; complete authored-history continuity remains pending |
| Native child history | Parent formats an actual child write | Native post-boundary MCP items recovered under shared root and distinct child ID |
| Installed plugin load | Three profiles cold-loaded 1.20.17; main/SDD authenticated, Kat pending | Existing lowercase profile cold-loaded 1.20.17 |
| Peer contact | Existing Claude registry | Unavailable; ownership is retained |

The matching Codescout reader normalizes paginated event_msg/item_completed McpToolCall records using native call ID, executing thread, actual argument object and completion result. It preserves failed, missing, conflicting and refused outcomes, current turn cwd, and verified native child/fork boundaries. Known ownership does not establish complete coverage: opaque code-mode wrappers and unsupported native effects still add gaps. No JavaScript source is treated as proof of executed calls.

Actual Codex root 01a12f3a-ae7e-7882-87e8-8b6e4eb81706 wrote a disposable Rust file. On resume, its ordinary formatter retained known THIS-session ownership, exited 1/UNKNOWN and left exact bytes unchanged. Complete code-mode execution inventory and successful Codex owned formatting remain unestablished. Kat's authenticated smoke remains pending because reauthentication is unavailable.

The implementation [review](../../../docs/reviews/2026-10-10-harness-neutral-session-identity.md) links native evidence and applied mutation results. F-16 was installed and freshly verified on 2026-10-11; the shared executable's hash changed afterward, so the 2026-10-12 resumed check uses the saved verified production artifact. Existing peer processes were preserved.

## Observed capabilities — 2026-10-10

| Capability | Claude Code 2.1.296 | Codex 0.160.0 |
|---|---|---|
| Captured root identity | Native root PreToolUse payload | Native session metadata |
| Captured durable tool evidence | Root Read refusal | Opaque exec wrapper and hook rejection |
| Direct writes, children and history boundaries | Synthetic source tests; live pending | Synthetic source tests; live pending |
| Resume, compaction and fork continuity | Live pending | Live pending |
| Peer contact | Existing Claude registry | Unavailable; ownership is retained |

The [capture manifest](../contracts/fixtures/native-histories/manifest.json) records actual commands and limits. Process exit 0 did not mean the requested tool ran: native routing refused the captured requests, and Claude's capture surface lacked Bash. These versions are observations, not a supported minimum or range. Successful authored formatting and installed-hook acceptance remain pending. No profile/cache changes or permission bypass were used.

See the [smoke procedure](../../../tests/scenarios/harness-neutral-session-identity-smoke.md). Run `CODESCOUT_CONTRACT_ROOT=/absolute/codescout bash tests/test-session-context-contract.sh` to verify packaged agreement. An absent automatic sibling is reported as skipped, not compatible.

## Stock Codex operation observations — source integration

This route uses stock Codex hooks and native MCP metadata. It does not patch the Codex executable installed through yay. The initial native spike measured Linux Codex 0.167.0; that is an observed version, not a supported minimum. The shared Claude hooks and session-context v1 contract are unchanged.

Capture is **off by default for each Git checkout**. With a matching Codescout binary, explicit operator opt-in is:

```sh
codescout observations enable --workspace /absolute/checkout --json
codescout observations status --workspace /absolute/checkout --json
codescout observations disable --workspace /absolute/checkout --json
python3 /path/to/codescout/scripts/inspect-observations.py --workspace /absolute/checkout --json
```

Disabling leaves prior evidence readable. Do not delete or reset the journal to obtain formatter clearance. Capture uses private directories (0700), regular files (0600), no-follow opens, bounded records (64 KiB), shards (8 MiB), and a checkout budget (64 MiB). The initial filesystem support is Linux ext/tmpfs/btrfs/xfs/overlay. Atomic expected producer sequence counts detect missing entire shards; metadata and temporary control replacement bytes count toward the quota. A private write-once marker, `codescout-observation-policy-v1.json`, lives in the actual per-checkout Git directory; it preserves reset uncertainty when journal files disappear. Linked checkouts have separate markers and epochs. The source v1 store control now requires this bounded sequence registry; older/incomplete control files are unavailable. This is cooperative local evidence, not protection against an account owner deleting all Git metadata or recreating a checkout.

Render a candidate hook configuration for review:

```sh
node scripts/render-codex-observation-hooks.mjs --plugin-root /absolute/profile/cache/codescout-companion/source --codescout /absolute/codescout --existing /absolute/hooks.json
node scripts/render-codex-observation-hooks.mjs --plugin-root /absolute/profile/cache/codescout-companion/source --codescout /absolute/codescout --capabilities
```

The renderer only prints JSON. It merges unrelated hooks and reports contract version 1 plus a fingerprint of the adapter and its source dependencies. `available` describes source/executable presence; `runtime_verified: false` explicitly requires an installed runtime check. It does not write profiles, install plugins, enable the host hook feature, trust hashes, or reload processes. The source template `codex/observation-hooks.json` contains a renderer placeholder and is not a directly installed configuration.

For future deployment, inspect the merged JSON, opt into stock hooks, review and trust it through the stock Codex trust flow, then cold-load/reload and verify a real isolated write. Repeat acceptance separately for each existing profile (`~/.Codex`, `~/.Codex-sdd`, `~/.Codex-kat`); each install path must remain inside that profile's own cache. Missing or case-distinct profiles are not implicitly created. This feature's source work performs no live profile installation or version bump.

The hook adapter resolves its working directory to the actual Git checkout with a bounded 200 ms argv-only Git query, including invocation from nested directories. It reads at most 4 MiB of native stdin, has a bounded input wait, sends a normalized record to the local CLI with argv/stdin, and kills an overdue CLI after 1500 ms. Host registrations have a 3-second timeout. Every recording outcome returns neutral `{}`; the adapter never changes permissions or tool input. No raw bodies, command text, results, prompts, reasoning, environment or credentials are persisted. Native root, executing child/thread, call and turn remain separate. The optional bounded `native_cwd` path retains the raw native hook/turn cwd separately from canonical `workspace`; absence remains unknown. Capture time is diagnostic only and never establishes causal order.

Server observations retain supported actual replacement facts using resolved target paths and the bytes supplied at the write boundary. Missing terminal results and contradictory results retain explicit uncertainty. Errors or cancellation can coexist with committed facts; post-hook refusal does not erase an effect. Arbitrary shell/Code Mode effects remain opaque. Hooks pair only with a unique compatible full native key and a comparable fingerprint; repeated calls remain distinct. A missing root is unknown and a lone thread never supplies it. A foreign MCP client remains an unknown harness.

The Python inspector is read-only and always reports `coverage: unknown`. Hash-only facts remain separate from rich history bodies and experimental checkpoints. They never discharge existing coverage gaps, create content evidence, or grant formatting permission. A positive foreign writer can restrict an existing verdict; missing, corrupt, quota-limited or reset evidence adds uncertainty.

The current stock hook review model is documented in [official OpenAI documentation](https://learn.chatgpt.com/docs/hooks). The private native acceptance uses freshly returned hooks/list hashes, reviewed against its own rendered commands, with config/batchWrite persistence; it never uses a trust-bypass flag.
