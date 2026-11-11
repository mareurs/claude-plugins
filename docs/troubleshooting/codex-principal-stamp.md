# Codex: principal-stamp updatedInput incompatibility

## Symptom and cause

Codex can report:

> PreToolUse hook returned updatedInput without permissionDecision:allow

The companion's principal-stamp.mjs hook attaches dev.codescout.mcp/agentId to CodeScout tool arguments when the event includes both session_id and agent_id. It deliberately returns updatedInput without a permission decision. The absence of that decision protects the Claude behavior: attaching identity metadata must not automatically approve every matching CodeScout operation.

The [Codex PreToolUse contract](https://learn.chatgpt.com/docs/hooks) requires permissionDecision:allow with updatedInput. The existing metadata-only response therefore does not meet that contract. A hook failure is not proof that the underlying tool was blocked or that every agent failure has this cause.

## Narrow, manual workaround

In Codex's hook browser, disable **only** the codescout-companion PreToolUse handler whose command invokes hooks/principal-stamp.mjs. Leave the plugin and all protection handlers enabled. Do not add allow to the metadata hook.

For a configuration review, the read-only renderer prints the corresponding per-hook setting:

```sh
node scripts/render-codex-principal-override.mjs \
  --plugin-id 'codescout-companion@YOUR-MARKETPLACE' \
  --hooks '/path/to/installed-plugin/hooks/hooks.json'
```

Replace both placeholders with the identifier and registry of the installed plugin. The identifier must match Codex's actual hook source; marketplace names vary. The tool supports the standard hooks/hooks.json source and the current exact node command and matcher. It refuses missing, unexpected, or ambiguous registrations instead of guessing.

Without --hooks it reads this repository's registry, which is useful for previewing only. For application, use the installed registry. The renderer derives both indices; do not assume a fixed group or handler number.

Its output has this shape (G and H stand for derived numbers):

```toml
[hooks.state."codescout-companion@YOUR-MARKETPLACE:hooks/hooks.json:pre_tool_use:G:H"]
enabled = false
```

The renderer prints a proposal; it never reads or edits Codex config, installs hooks, creates backups, trusts changed content, or restarts anything.

Before a manual change:
1. Review the exact target and obtain the operator's approval; coordinate with other active sessions.
2. Make a private, recoverable backup of the current config and verify the copy against the original.
3. Recheck the installed registry and config for concurrent changes.
4. Add or change only enabled in the EXISTING target state table, preserving its trust fields and every other setting. Do not append a duplicate table.
5. Validate the effective hook state in a separate controlled Codex session at a coordinated time. Do not assume an already-running session reloaded the change.

For rollback, restore the previous value or absence of enabled for this target only. Do not replace newer unrelated settings with a stale full-config snapshot.

## Impact and limits

This is a workaround, not an implementation of identity stamping compatible with both hosts.

- Codex stops invoking this metadata handler when it honors the disabled state; original tool arguments remain unchanged by that handler.
- Worktree, constitution, routing, and other protection handlers are not disabled or rewritten.
- Claude's script and configuration remain unchanged.
- Codex loses the additional principal identity stamp. Parent and subagent guide ledgers and caller-attribution diagnostics can consequently lose distinctions that depend on that stamp. Native Codex identity behavior is not validated by this workaround.
- Workspace selection is shared; keep calls pinned to their intended workspace. Disabling metadata does not resolve concurrent workspace activation.
- No claim is made that normal operations or the entire plugin ecosystem are compatible after this one change.

## Reusable offline checks

```sh
node --test codescout-companion/hooks/principal-stamp.codex.test.mjs
```

The suite runs real hook subprocesses on synthetic fixtures. It reproduces the response/contract mismatch, checks the unchanged Claude metadata response and original arguments, verifies six routing-deny cases, and tests the read-only renderer against reordered indices, ambiguous registrations, invalid identifiers, and malformed input. Fixture identities never reach an MCP server; fixture tool commands are not executed. Home, temporary files and hook state are isolated and cleaned up.

The suite is discovered by tests/run-all.sh. These are offline contract and process tests, not a live Codex loading, approval-composition, or parent/subagent-ledger test. After an approved application, verify those separately without interrupting active work.
