// Exact measured versions, not a minimum-version or forward-compatibility claim.
// Daemon evidence: contracts/fixtures/background-wake/codex-linux-secondary-evidence*.json.
// 0.167.0 native hook identity: docs/evidence/2026-11-08-stock-codex-hooks-spike.json.
const daemonEvidence=Object.freeze({
 '0.160.0':'codex-linux-0.160.0-callback-probe',
 '0.167.0':'codex-linux-0.167.0-callback-probe',
});
export const codexDaemonEvidence=version=>Object.hasOwn(daemonEvidence,version)?daemonEvidence[version]:null;
export const supportsCodexHook=version=>version==='0.165.0'||version==='0.167.0';
