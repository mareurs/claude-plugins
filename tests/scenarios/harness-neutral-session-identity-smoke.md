# Harness-neutral session identity smoke

Use an isolated scratch Git checkout with no credentials in its fixtures. Use existing authenticated profiles and native approval routing. Keep raw histories private; copy only identity, cwd, ordinal, call and result fields into normalized captures. Do not copy prompt bodies, account metadata, reasoning or auth files.

## Required observations

Record each host's actual `--version`, launch command, root session identity, explicit child identity when present, and actual history shape. A process exit 0 is not proof that a requested tool executed: record its result and before/after file bytes.

1. Begin with a tracked formatted Rust file; commit the base, then author an unformatted change through the host's real write tool. Keep a peer file untracked. Record native calls/results and normalized identity.
2. Run the matching Codescout `./scripts/gate.sh --check` through that host. Record `PYTHON_LIGHT`, `FMT`, `CLIPPY`, `LEAN`, `DEFAULT`, `FMT_STATE`, aggregate status and the leased target. Confirm no source bytes changed.
3. Run authored `./scripts/gate.sh`. Verify the owned file changes and becomes format-clean. Write the peer file from the other host; rerun and require refusal plus byte-identical peer contents. Test both caller directions.
4. Resume, compact, start a child and fork using that host's native lifecycle. Verify stable root attribution, explicit child metadata, inherited-history boundaries and independently observed results. Never substitute a synthetic environment variable for this acceptance test.
5. Exercise missing and conflicting identity separately: formatting stays blocked while every verification lane runs, and default remains last. Exercise exclusive declaration only after establishing operator control.
6. For a deployment, cold-load installed hooks in every installed profile, verify each install path belongs to its profile root, then repeat these observations.

Record blocked scenarios as pending with their actual rejection or missing capability. A read-only suite or synthetic decoder fixture does not establish authored support.

## Evidence on 2026-10-10

Claude Code 2.1.296: the root PreToolUse Read payload and durable Read refusal were captured. Installed routing refused Read; the earlier capture surface had no Bash tool. No successful write, child, resume, compact or fork observation was obtained.

Codex 0.160.0: root session metadata plus the raw exec wrapper and hook rejection were captured. No recoverable inner native call executed. Direct hook, successful write, child, resume, compact and fork observations remain pending.

Both capture processes exited 0; neither completed the requested tool execution. The [manifest](../../codescout-companion/contracts/fixtures/native-histories/manifest.json) records normalized artifacts and limits. The native approval routing repair is tracked separately; installed caches have not been altered for this feature.

Source verification covers context, direct native record decoding, mixed-host ownership, refusal/gap behavior, formatter byte preservation, gate continuation and leased pool behavior. Its final execution and review evidence is recorded in the implementation ledger and issue. This is a source-only result until the pending native and installation observations pass.
