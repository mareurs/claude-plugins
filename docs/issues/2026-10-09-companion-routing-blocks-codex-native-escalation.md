---
id: cd15dd2c76c1f7eb
kind: bug
status: fixed
title: Codescout Companion blocks Codex native escalation before the approval flow and redirects to a tool without that capability
tags:
- codescout-companion
- codex
- hooks
- permissions
- tool-routing
codex_source_commit: 5eedcdc5439da3a57516196df386fc2db7ffa288
fixed_on: 2026-10-11
last_observed: 2026-10-11
native_acceptance: passed; canonical protected Git write, ordinary routing, actual native RPC accept/decline with marker equality
opened: 2026-10-09
owner: marius
plugin_feature_commit: 4ce5432
plugin_release_delivery_commit: f8a73ee616414b2d83c7dde069dcb403c3321248
severity: medium
unverified: 'TRACKED 33de9ea8980e85c9 — None for native routing: installed paired host/guard acceptance and rejection observed. Remaining Codex automatic context/durable history and Kat authenticated acceptance are tracked in issue 33de9ea8980e85c9; observed Claude owned/child/fork-safe and explicit mixed-host refusal checks pass.'
---

## Summary

Codescout Companion's tool-routing hook blocks Codex native shell calls that explicitly request host approval, then redirects them to an MCP command tool that has no equivalent native approval interface. The routing optimization prevents the user from reaching the permission decision.

Observed 2026-10-09 in a resident-site session while installing a user-requested, narrowly scoped preference in `/home/marius/.codex/config.toml`. No config edit occurred. A subsequent harmless `true` call with native escalation reproduced the same rejection, so installer contents and filesystem errors are not necessary to trigger it.

## Recurrence — 2026-10-10: authorised local daemon integration blocked

**Observed friction:** During the 6 Origins website privacy integration, the user authorised merging the reviewed daemon implementation into `/home/marius/work/claude/whatsapp`. That checkout is outside the session's writable roots (`/home/marius/work/personal/6-origins/website` and `/tmp`). Native `exec_command` calls explicitly requested `sandbox_permissions: "require_escalated"`, a justification, and a narrowly scoped Git prefix rule.

Both commands were rejected by PreToolUse before the native filesystem approval could appear:

```sh
git -C /home/marius/work/claude/whatsapp merge --ff-only feat/privacy-consent
git -C /home/marius/work/claude/whatsapp fetch /home/marius/work/personal/6-origins/website/.worktrees/whatsapp-privacy feat/privacy-consent
```

The observed rejection was `Command blocked by PreToolUse hook: This call is blocked because codescout offers a leaner path for shell work.` It suggested Codescout `run_command`, which does not expose the native filesystem approval mechanism. No alternate-tool write bypass was attempted.

**Impact:** The authorised daemon integration remains incomplete. The original daemon checkout stayed at `85df65aeba15ae46c3f6786914d1d67f88e071e7`; the reviewed implementation is `a9abe05d969b89a78732aa979159cc930fbe9e62`. The user had to be handed manual commands despite already authorising the merge.

**Independent handoff correction:** The first command also referenced a branch absent from the target repository: the feature lives in a separate local clone. The corrected local fetch followed by an exact-SHA fast-forward actually passed in `/tmp/daemon-merge-rehearsal-uzAp89`, a disposable clone of the target master. The original checkout was independently rechecked and remained unchanged. This distinguishes the Git handoff defect from the approval-routing friction; the corrected fetch was still blocked before approval.

**Status:** KNOWN recurrence of `cd15dd2c76c1f7eb`, still open. No hook, host permissions, plugin caches, or configuration were changed. The website merge completed separately; this record does not claim the daemon merge or deployment completed.

## Expected behavior

Routing must preserve access to the host's permission-request path when the suggested replacement cannot express it. Letting a native tool proceed to its usual approval flow must not itself approve the command or relax filesystem policy. Ordinary shell work should retain the existing Codescout routing behavior.

## Actual behavior and impact

The native call rejects during PreToolUse, before the shell handler runs. The agent cannot present the normal filesystem approval and is told to use `run_command`. That tool's live schema has no `sandbox_permissions`, approval justification, or prefix-rule field.

The result is a blocked authorized task and an extra conversational permission request. Using an MCP process's own OS privileges would not reproduce the native sandbox approval/grant mechanism; this report does not claim that the MCP process is physically unable to write the target file.

## Environment and revision anchors

- Codex CLI: 0.160.0; running app-server: 0.159.2.
- Installed Codescout Companion: 1.20.16, loaded from `/home/marius/.codex/plugins/cache/sdd-misc-plugins/codescout-companion/1.20.16`.
- Plugin source HEAD: `fcc733cf6d819ec9d63a93d3aa9e212c940c881c`.
- Local Codex source HEAD: `59f18e8133f2c1d3427677658752ac46697d41b7`.
- Local Codescout source HEAD: `918b3d51d2a50114f5fb94b3939a0a5c26ea140e`.
- Session project: `/home/marius/work/personal/6-origins/website`; native writable roots: that project and `/tmp`.
- Linux; native hook rejection is separate from an OS permission failure.

## Native reproduction — observed

Call the native tool, not Codescout's replacement:

```json
{
  "cmd": "true",
  "sandbox_permissions": "require_escalated",
  "justification": "May I run a harmless command to reproduce whether Codescout blocks the native approval flow?"
}
```

Observed tool result on 2026-10-09:

```text
Command blocked by PreToolUse hook: This call is blocked because codescout offers a leaner path for shell work.

Command: true

Suggested codescout tools:
  run_command(command="true")          — same command with smart summaries + @ref buffers
```

The earlier native installer call used `python3 /tmp/codex-peer-autoallow-7qdxhafl/apply.py` with `sandbox_permissions: "require_escalated"` and an installation justification. It was rejected by the same hook. The temporary installer path is incident evidence, not required by the minimal reproduction.

## Mechanism

1. `codescout-companion/hooks/hooks.json:80` matches Bash and invokes `pre-tool-guard.mjs`.
2. `codescout-companion/hooks/pre-tool-guard.mjs:161` routes every Bash call to `enforce`, regardless of command or escalation metadata. `enforce` at line 100 ultimately calls `denyPreToolUse`; `codescout-companion/hooks/lib.mjs:31` emits `permissionDecision: "deny"`.
3. Local Codex source constructs the shell hook payload in `/home/marius/work/claude/codex/codex-rs/core/src/tools/handlers/unified_exec/exec_command.rs:518`: `tool_name: HookToolName::bash()`, `tool_input: {"command": args.cmd}`. It omits the native escalation flag and justification.
4. Local Codex source `/home/marius/work/claude/codex/codex-rs/core/src/tools/registry.rs:602` runs PreToolUse before dispatch. Its Blocked branch returns at line 625, before the shell handler and its normal permission flow.
5. The advertised replacement's actual tool schema and `/home/marius/work/claude/codescout/src/tools/run_command/mod.rs:319` have no native escalation fields. `effect` records read/write telemetry, and `acknowledge_risk` bypasses Codescout's own command check; neither is a host sandbox grant.

**Evidence boundary:** the live native rejection and source/installed-plugin behavior were observed. The Codex payload shape and dispatch ordering were read from the local source at the revision above; raw stdin from the running 0.159.2 daemon was not captured. This report does not claim that the local source revision exactly matches that binary.

**Why checking the flag alone is insufficient:** even an enriched synthetic payload carrying `sandbox_permissions: "require_escalated"` is denied by the current plugin. Under the local Codex payload contract, that field is absent altogether. A repair needs a verified host-compatible signal or routing policy; it cannot merely assume that metadata exists.

## Isolated hook reproduction — observed

This checks the hook as a subprocess. It never executes the requested shell command. Every case gets a fresh child `TMPDIR`; live config and live circuit-breaker/dedup state are untouched, and scratch files are removed afterward.

```python
"""Reproduce routing capability loss without running the requested command."""
import json
import os
from pathlib import Path
import subprocess
import tempfile

hooks = {
    "source": Path("/home/marius/work/claude/claude-plugins/codescout-companion/hooks/pre-tool-guard.mjs"),
    "installed": Path("/home/marius/.codex/plugins/cache/sdd-misc-plugins/codescout-companion/1.20.16/hooks/pre-tool-guard.mjs"),
}
cases = {
    "actual_codex_escalation_payload": {"command": "true"},
    "hypothetical_metadata_preserved": {"command": "true", "sandbox_permissions": "require_escalated",
                                        "justification": "Harmless approval-flow reproduction"},
    "ordinary_shell": {"command": "true"},
}
with tempfile.TemporaryDirectory(prefix="companion-escalation-repro-", dir="/tmp") as tmp:
    root = Path(tmp)
    project = root / "project"
    project.mkdir()
    (project / ".mcp.json").write_text(json.dumps({"mcpServers": {"codescout": {"command": "codescout"}}}))
    for origin, hook in hooks.items():
        for name, tool_input in cases.items():
            tmp_dir = root / (origin + "-" + name)
            tmp_dir.mkdir()
            env = dict(os.environ, TMPDIR=str(tmp_dir))
            payload = {"hook_event_name": "PreToolUse", "tool_name": "Bash", "cwd": str(project),
                       "tool_input": tool_input}
            child = subprocess.run(["node", str(hook)], input=json.dumps(payload), text=True,
                                   capture_output=True, timeout=15, env=env, check=True)
            output = json.loads(child.stdout)
            decision = output["hookSpecificOutput"]["permissionDecision"]
            assert decision == "deny", (origin, name, output)
            assert "run_command" in output["hookSpecificOutput"]["permissionDecisionReason"]
            print(origin + "/" + name + ": " + decision + "; redirects to run_command")
        # Positive control: the guard detects the fixture and honors the known routing opt-out.
        routing = project / ".claude"
        routing.mkdir(exist_ok=True)
        (routing / "codescout-companion.json").write_text('{"block_reads": false}')
        tmp_dir = root / (origin + "-positive-control")
        tmp_dir.mkdir()
        child = subprocess.run(["node", str(hook)], input=json.dumps(payload), text=True,
                               capture_output=True, timeout=15, env=dict(os.environ, TMPDIR=str(tmp_dir)), check=True)
        assert child.stdout == "", child.stdout
        print(origin + "/routing_opt_out_positive_control: no deny")
        (routing / "codescout-companion.json").unlink()
print("Requested shell commands were never executed; scratch state was removed.")
```

Observed output, exit 0:

```text
source/actual_codex_escalation_payload: deny; redirects to run_command
source/hypothetical_metadata_preserved: deny; redirects to run_command
source/ordinary_shell: deny; redirects to run_command
source/routing_opt_out_positive_control: no deny
installed/actual_codex_escalation_payload: deny; redirects to run_command
installed/hypothetical_metadata_preserved: deny; redirects to run_command
installed/ordinary_shell: deny; redirects to run_command
installed/routing_opt_out_positive_control: no deny
Requested shell commands were never executed; scratch state was removed.
```

The command-only synthetic escalation payload and ordinary-shell payload are deliberately identical, reflecting the local host contract. Only the native call above proves that the caller actually requested escalation. Exit 0 here means the current defective routing was reproduced; it does not mean the bug is fixed.

## Existing tests and related incident

`codescout-companion/hooks/pre-tool-guard.test.sh:95` expects all Bash calls, including cross-repository commands, to be denied. The current suite contains no native escalation case. Its cleanup deletes shared `/tmp/cs-block-*` and `/tmp/cs-redirect-*`, so it was not run in this live session; the isolated reproduction above avoids those shared markers.

Related: `docs/issues/archive/2026-08-26-companion-blocks-bash-after-codescout-disconnect.md`. That fix handles a missing replacement tool. Here Codescout is responsive, but its command tool lacks the required host capability. Proof-of-life re-arms the existing circuit breaker, so the disconnect workaround does not establish recovery from this case.

## Fix status and acceptance criteria

Fixed — paired source repair and installed host/guard acceptance verified on 2026-10-11. Native approvals reach execution; native rejection prevents execution; ordinary routing remains active.

### Implemented

Companion's Bash branch passes explicit `tool_input.sandbox_permissions: "require_escalated"` to the host via advisory context, without permissionDecision, updatedInput, or a breaker/dedup strike. Ordinary Bash routing and native Read/Edit denial remain covered. The new test isolates HOME/config/TMPDIR/XDG_STATE_HOME; the colocated guard suite's cleanup now uses its own private TMPDIR.

The Codex adapter preserves supplied sandbox_permissions, justification and prefix_rule in PreToolUse, retaining the command-only shape when metadata is absent. Changes are in `/tmp/codex-native-approval-20261010`, based on `59f18e8133f2c1d3427677658752ac46697d41b7`; the durable [Codex patch](../patches/2026-10-10-codex-native-approval-hook-payload.patch) includes source and regression tests.

### Observed verification

- Plugin escalation fixtures: 11 passed. Both escalation cases first failed with deny against the original guard. Requested shell commands were never executed by these hook-only fixtures.
- Full `bash tests/run-all.sh`: exit 0, "All suites passed", with private TMPDIR. Final colocated guard suite: 59 passed, 0 failed.
- Codex `cargo test -p codex-core --lib exec_command_pre_tool_use_payload`: 3 passed. The new metadata assertion first failed against the original adapter because approval fields were omitted.
- Codex `cargo test -p codex-core --test all pre_tool_use_native_escalation_retains_host_approval -- --test-threads=1`: 2 passed with the project's 8 MiB RUST_MIN_STACK. The local test engine captures actual hook stdin containing approval metadata. Both cases observe an ExecApprovalRequest before execution; acceptance creates the private marker, rejection leaves it absent. Its advisory hook fixture emits no permissionDecision.
- Three plugin mutations were actually applied: suppress advisory output, emit permissionDecision allow, and make enforce a no-op. The first initially survived; the missing assertion was added only after observing that result. All three fail the final fixtures. Production helpers were restored; lib.mjs has no final diff.
- Independent review found no Critical or Important source findings. Three private mutations were applied: nested-object coercion and expanded Read/Edit exemption were caught; permission-prefix matching initially survived all 10 fixtures. A negative `require_escalated_extra` fixture was added after observing that survivor; it catches the recreated mutation while all 11 fixtures pass on production. Private hook copies were restored.
- Syntax, rustfmt, whitespace checks and `git apply --check` against the original Codex checkout pass.

### Blocker and remaining work

The cold-load boundary is complete. The public installer selected and pinned the GNU/Linux 0.160.0 candidate. The actual shared daemon and code-mode helper execute from local-525877d294d6fccc7888a9da84d174c8a3e1ffc6d57f68e3b3717ff95c9e17b7-x86_64-unknown-linux-gnu. All six installed package files match the versioned manifest's sizes and SHA-256 digests. The resumed session has the scoped writable roots; protected .git rules still apply.

A native require_escalated Git command created a temporary ref in the protected canonical Git directory, with exit 0; its exact HEAD value was observed, then native cleanup removed it. A use_default native Git status call was denied by the installed routing hook and redirected to Codescout. This proves the paired exemption reaches native execution while ordinary routing remains active.

The interactive rejection probe was approved and executed, so it is not evidence of rejection. The resulting empty marker was removed through native escalation and absence verified after recovery. The native app-server smoke completed successfully in disposable scratch state using the existing authenticated profile, without copying credentials or changing permissions. The accepted request completed with exit 0 and created its marker. The declined request completed with status declined, no exit code, and no marker. These real request/response and filesystem observations satisfy routing acceptance and rejection. Successful authored-formatting and mixed-host/lifecycle provenance remain the separate harness-neutral issue's acceptance work.

Evidence: .codescout/native-approval-live-check-20261011.json and the versioned installer/version/provenance manifests. Original task-owned source integration is complete through legitimate native escalation: plugin feature 4ce5432, separate delivery of actual release-script outputs f8a73ee, Codex 5eedcdc543 and Codescout eed25579. Explicit pathspec commits preserved unrelated work. No push occurred.

### Installation attempt — 2026-10-11

The user authorized installation. The saved Codex patch still passes git apply --check against the protected original checkout; its three target files are unchanged there. The three-file diff in /tmp/codex-native-approval-20261010 is byte-identical to the saved patch (SHA-256 2df49a790f060742612150f77bc2b781632185de49bfeafb6e132d3fbbaadc37).

A native exec_command application with require_escalated, justification and a scoped Git prefix was again rejected by the installed PreToolUse routing hook before host approval. Its suggestion to use MCP was not followed for this protected write. This is an installed-hook rejection, not an automatic approval-review rejection.

Read-only inventory found /usr/bin/codex resolving to /usr/lib/openai-codex/bin/codex. The running app-server uses the local managed package under /home/marius/.codex/packages/app-server-daemon/releases/. The uppercase .Codex/.Codex-sdd/.Codex-kat paths are absent; the complete home-directory inventory found one existing Codex root, /home/marius/.codex. It has no plugins/installed_plugins.json; the companion is enabled in config.toml and cached at plugins/cache/sdd-misc-plugins/codescout-companion/1.20.16. Do not create missing profiles to satisfy instructions copied from another environment.

No source checkout index, installed cache, config or running daemon was changed. Candidate preparation used the existing isolated source copy and its writable build target.

The direct offline Cargo build exited 101 after the default V8 URL returned HTTP 404. The repository's resolve_codex_v8_cargo_env supplied the checked archive/binding pair; the repeated codex-cli plus codex-code-mode-host build exited 0 in 3m 40s (@bg_00000070). The codex-bwrap helper build exited 0 (@bg_00000071). The existing package builder, with the newly built binaries and pinned zsh resource, produced /home/marius/work/claude/claude-plugins/.codescout/native-approval-candidate-20261011, exit 0 (@bg_00000072). This is a local dev package reporting 0.0.0, not a plugin version bump or a production release.

The candidate smoke job @bg_00000073 checks CLI version/resume help, code-mode-host help, and bwrap/rg/zsh versions under a private temporary CODEX_HOME, then hashes all package files. Its digest record is .codescout/native-approval-candidate-20261011.sha256.json. These probes verify package executables load; they do not prove authored-file, lifecycle, or live approval acceptance.

A syntax-checked scoped resume launcher is prepared at .codescout/resume-native-approval-install-20261011.sh. It resumes origin session 01a12505-eb95-76a1-911a-4610c7b95ab3 with workspace-write/on-request and explicit additional paths: the original plugin .git, Codex and Codescout source checkouts, the measured existing lowercase Codex root, all three existing Claude roots, and the existing Copilot root needed by release.sh. It changes no files and does not restart the shared daemon. The existing CLI help and resume/shared-option merge bodies establish support for these flags. After the user relaunches, VERIFY the actual session permission grant before any protected write; parsing a flag is not evidence that the new session permits it.

The source patches still pass git apply --check against both protected original checkouts. Keep native acceptance pending until actual application, install, cold loading and the approved live scenarios have completed. Recon F-11 records the profile drift and F-12 the corrected build invocation.

### Source application and bootstrap release — 2026-10-11

After the user ran the scoped launcher, current permission instructions include both source working trees and installed-profile directories. Fresh `git apply --check` passed for both saved patches, then application exited 0 for each. The Codex patch touches the three reviewed files; the Codescout patch carries the reviewed 22-file delivery. Original indexes and unrelated changes were untouched.

The plugin checkout advanced through unrelated commits d82c268 and 61608048 and retains unrelated effort-steering files. Release preparation uses /tmp/harness-release-20261011, cloned independently at 61608048, containing only this thread's reviewed companion/session-context/archive-rule changes and evidence. This bootstrap release is necessary to load the paired approval fix before live acceptance. Prior source verification permits installation preparation; native acceptance remains explicitly pending, and no issue is closed by the release alone. NO_PUSH=1 keeps all release commits local.

### Installed companion snapshot — 2026-10-11

The clean-copy release preflight completed all plugin suites and buddy pytest (528 passed). It committed companion 1.20.17, seeded/repointed all three existing Claude profiles, and reported Copilot companion absent. Its final parity gate initially exited 1 on unrelated third-party marketplace revision skew. F-13 records the repair: four unpinned catalog copies aligned to the main profile, full old-directory backups retained, untracked hashes preserved, and registry pointers unchanged. Repeated companion/full parity and canonical version checks exited 0; the version bump was not repeated. NO_PUSH=1; no push occurred.

The public `/usr/bin/codex plugin add codescout-companion@sdd-misc-plugins --json` exited 0 and installed 1.20.17 in /home/marius/.codex/plugins/cache/sdd-misc-plugins/codescout-companion/1.20.17. All 98 release-source files compare equal against that cache and the three Claude caches. The Codex-generated dashboard skill's command body equals its source command; runtime .codescout DB/lock/stamp files and documented build/runtime classes are excluded explicitly. The version-bump-checklist was refreshed through doc and verified. Its companion rows are ✅; unrelated Legible source/cache differences remain visible as ❌ rather than being re-seeded under an existing version.

The new host candidate still passes full manifest/digest population checks. The current daemon was queried through the candidate's public version command and still reports appServerVersion 0.159.2. The outside-session cold-load launcher is prepared; successful installed native execution remains pending.

### Daemon model regression and versioned repair — 2026-10-11

The outside-session installer selected the local development package reporting 0.0.0. On resume, its backend rejected gpt-6.1-sol with the user's exact 400. F-14 in guard-hardening-session-log records the paired verification: the same patched source rebuilt as 0.160.0 completes full client and JSON-RPC app-server turns with OK, while the old build fails. Only isolated Cargo workspace/lockfile version metadata changed; the three native-approval patch files remain byte-identical to the original source checkout.

The first versioned package used the package builder's default x86_64-unknown-linux-musl target while its executable was built for x86_64-unknown-linux-gnu. A disposable profile reproduced the updater's exact failure: the CLI package does not match this platform or executable. The package was regenerated with explicit --target x86_64-unknown-linux-gnu and its full digest map refreshed. The guard now also rejects an incorrect target; its new regression test failed before the guard change, and all six tests pass after it. Launcher bash syntax passes.

The public installer now passes a complete disposable-profile upgrade: a running 0.0.0 daemon is replaced and restarted as 0.160.0. The JSON-RPC probe completes an initial gpt-6.1-sol turn, thread/compact/start with one completed contextCompaction item and no errors, and a subsequent model turn. Evidence is saved in .codescout/native-approval-upgrade-after-20261011.json and .codescout/native-approval-remote-compaction-after-20261011.json. The corrected launcher captures installer stderr, explicitly starts the selected daemon if needed, and requires both installed and running versions to equal 0.160.0 before resuming the original thread. Shared-daemon cold-load and native approval/provenance acceptance remain pending.

The native exec_command attempt to run the repaired package's public daemon installer with require_escalated was rejected by the installed PreToolUse routing hook before the host approval flow. The hook suggested the MCP command tool; that suggestion was not followed for this protected profile write. The protected installer has not run through this session. A fresh daemon-version query still reports managedCodexVersion and appServerVersion 0.0.0, including after the user's new-session restart. A second native installation attempt after correcting the package was blocked by the same hook. This is an installed-hook rejection, not an automatic approval-review rejection. Run the prepared cold-load launcher from a terminal after closing connected daemon sessions.

### Live acceptance — 2026-10-11

The selected shared daemon and helper now execute from the verified GNU/Linux 0.160.0 package. Installer/version JSON and /proc paths agree; every one of the six installed package files matches its versioned manifest size and SHA-256. The current conversation successfully executes gpt-6.1-sol after resume and a subsequent daemon recovery.

A real native require_escalated Git command wrote a temporary ref to the protected canonical Git directory. The ref value matched the actual HEAD; native deletion completed and absence was verified. An ordinary use_default native Git command was still denied by the installed routing hook and redirected to Codescout. The interactive rejection probe was approved, so it was recorded only as an approved write; its marker was removed.

A separate real native app-server turn used the same installed executable and existing authenticated lowercase profile, on-request approval and workspace-write sandbox. The client answered one exact command request with accept and the other with decline, without any session or persistent permission grant. The accepted commandExecution item completed with exit 0 and its marker existed. The declined item had status declined and its marker did not exist. The scratch directory was removed after observation. Raw account/history content was not copied into fixtures.

The same native thread resumed across a new app-server process with its root ID unchanged, completed remote compaction, completed a subsequent turn, and forked to a distinct root ID with another completed turn. This establishes lifecycle transport, while decoder provenance remains limited by opaque wrappers and external history. Evidence: .codescout/native-approval-live-check-20261011.json and .codescout/native-runtime-smoke-20261011.json. The routing issue is fixed; provenance acceptance remains tracked by 33de9ea8980e85c9.

## Fix provenance

- **SHA:** `4ce543210dab3b7a3f46aa56b66fc14d96adcb9e` (`main`)
- **patch-id:** `747239436418bd81a3e729f9f5a81cb6f5e327a0`

This is the companion half of the paired repair. `4ce5432` is a combined commit (29 files); it carries the `require_escalated` handling in `codescout-companion/hooks/pre-tool-guard.mjs` and `tests/test-native-escalation.sh`, and `git log -S"require_escalated"` over `codescout-companion/hooks` finds only this commit. The patch-id covers the whole commit. `f8a73ee` is the separate delivery of release-script outputs, not the fix.

The Codex adapter half lives in the Codex repository (`5eedcdc543`, as recorded in this file). I could not resolve that commit from this repository, so it has no SHA line here. The revisions `a335403` and `fe68488` under § Environment and revision anchors are where the bug was observed, not fixes.
