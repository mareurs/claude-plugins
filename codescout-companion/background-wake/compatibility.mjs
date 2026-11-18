// Historical measured evidence only; feature eligibility uses minimum versions below.
// Daemon evidence: contracts/fixtures/background-wake/codex-linux-secondary-evidence*.json.
// 0.167.0 native hook identity: docs/evidence/2026-11-08-stock-codex-hooks-spike.json.
const daemonEvidence=Object.freeze({
 '0.160.0':'contracts/fixtures/background-wake/codex-linux-secondary-evidence.json#codex-linux-0.160.0-callback-probe',
 '0.167.0':'contracts/fixtures/background-wake/codex-linux-secondary-evidence-0167.json#codex-linux-0.167.0-callback-probe',
});
export const codexDaemonEvidence=version=>Object.hasOwn(daemonEvidence,version)?daemonEvidence[version]:null;

const versionPattern=/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

function parseVersion(version){
 if(typeof version!=='string')return null;
 const match=version.match(versionPattern);
 if(!match||match[0]!==version||match[4]?.split('.').some(part=>/^\d+$/.test(part)&&part.length>1&&part.startsWith('0')))return null;
 return {core:match.slice(1,4),prerelease:match[4]};
}

function supportsMinimum(version,minimum){
 const parsed=parseVersion(version);
 if(!parsed)return false;
 for(let i=0;i<minimum.length;i++){
  const actual=parsed.core[i],floor=minimum[i];
  if(actual.length!==floor.length)return actual.length>floor.length;
  if(actual!==floor)return actual>floor;
 }
 return !parsed.prerelease;
}

export const isCodexVersion=version=>parseVersion(version)!==null;
export const supportsCodexDaemon=version=>supportsMinimum(version,['0','160','0']);

export const supportsCodexHook=version=>supportsMinimum(version,['0','165','0']);

/** initialize.userAgent uses the first client's originator, not a fixed Codex name. */
export function parseCodexDaemonVersion(userAgent){
 if(typeof userAgent!=='string'||/[\u0000-\u001f\u007f]/.test(userAgent))return null;
 const version=userAgent.match(/^[^\s/]+\/([^\s]+)(?:\s|$)/)?.[1];
 return isCodexVersion(version)?version:null;
}
