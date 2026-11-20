# Stock Codex hook compatibility research — 2026-11-19

## User requirement

User explicitly wants ordinary users to get fixes by normal plugin/Codex updates, without applying patches, compiling Codex or running our custom binary. The local170 repair demonstrates native defect/fix only; it is not distributed plugin compatibility. Keep that distinction in release claims. This turn is research only, no compatibility implementation or policy/config changes authorized by inference.

## Primary evidence checked

1. Boruta PR163 remains an open PoC: https://github.com/malach-it/boruta-server/pull/163 . Direct GitHub API inspection of commitd2fe9ec1505b6667fa7d31db76162423a40f8be0 shows .codex/boruta-hook.env.example changed BORUTA_CODEX_HOOK_ENFORCE true→false and BROWSER_AUTH true→false. Its PR explains observation mode reports authorization failures while continuing. Related missing-field issue openai/codex28117 links this PoC. This is an actual default-behavior workaround, not restoration of the missing native metadata.

2. https://github.com/le-soleil-se-couche/codex-control-plane-hooks/blob/main/README.md . Live GitHub API README blob27e75deae839895c9f47e6e0d64701a02cbebcf8 confirms v0.2.8 caution: false blocks despite authorized Git workflows; temporary workaround removes installed PreToolUse and PermissionRequest registrations, retaining six other lifecycle hooks. This removes ALL plugin pre-execution checks and leaves native Codex sandbox/approval enforcement. Maintainer says no reliable separation of Git authorization without redesign. Do not present it as a complete missing-field fix or copy broad hook removal blindly into Companion.

3. https://github.com/Cygnux-Labs/Tracekit/blob/main/docs/integrations/codex-sandbox.md fetched directly via GitHub API. Docs explicitly say command-only PreToolUse omits escalation request/result; policy gates commands before native approval. Integration is experimental, tested on recorded payloads rather than live Codex. https://github.com/Cygnux-Labs/Tracekit/issues/949 is OPEN doctor-setting diagnostics work, not an implemented fix.

4. https://docs.rs/atm-codex-adapter/latest/atm_codex_adapter/ retrieved page documents v0.2.4/live Codex0.146.1: silent exit0 PermissionRequest is neutral and native approval dialog still appears; PreToolUse precedes PermissionRequest. It proves a documented observational pattern on that version, not a tested170 missing-field fix.

5. Existing native missing-field reports https://github.com/openai/codex/issues/40996 and https://github.com/openai/codex/issues/28117 remain open in fetched sources. No confirmed exact native fix on official170 was found in the reviewed sources. DeepSeek same-mode escalation normalization results concern a different host/bug and are excluded.

## Synthesis / proposed direction, not implemented

Other projects reduce blocking or explicitly separate plugin policy from native approval rather than recover absent metadata. For Companion's ordinary shell-tool routing, investigate Codex compatibility mode that emits routing guidance without denying an otherwise valid native shell call; preserve native sandbox/approval policy and all independent hooks. This weakens hard shell-routing enforcement; be explicit. A later PermissionRequest handler cannot resurrect a call denied by PreToolUse. Do not guess escalation from command text or assume a version alone proves capability.

Acceptance must use explicit stock /usr/bin/codex0.170 (normal codex currently resolves our patched CLI): real guard enabled, ordinary routing behavior observed, native escalation gets exactly1 approval, decline no marker/accept marker, helper lifecycle unchanged, no config or sandbox widening. The proposed compatibility route remains unverified until these live probes pass.

## Evidence and coverage

Researcher tool returned an unverified-synthesis evidence bundle, not a trustworthy finished conclusion; key sources were independently opened/fetched via web and GitHub API. Raw response saved /tmp/codex-hook-research-20261119-raw.json. No public posts, source edits, or runtime policy changes in this research turn.
