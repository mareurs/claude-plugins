import test from 'node:test';
import assert from 'node:assert/strict';
import * as compatibility from './compatibility.mjs';

test('Codex feature floors have no upper ceiling and compare numeric components exactly',()=>{
 for(const [name,floor,below] of [['supportsCodexHook','0.165.0','0.164.999'],['supportsCodexDaemon','0.160.0','0.159.999']]){
  assert.equal(typeof compatibility[name],'function');
  for(const version of [floor,floor+'+000.build',floor.replace(/0$/,'1')+'-alpha','0.167.1','0.168.0','0.169.0','0.169.0-alpha.11.1','1.0.0-rc.1+build','999999999999999999999999.0.0'])assert.equal(compatibility[name](version),true,name+': '+version);
  for(const version of [below,'0.9.0',floor+'-alpha.1','0.0.0'])assert.equal(compatibility[name](version),false,name+': '+version);
 }
});

test('strict Codex SemVer validation rejects malformed and ambiguous versions',()=>{
 assert.equal(typeof compatibility.isCodexVersion,'function');
 for(const version of ['0.169.0','0.169.0-alpha.11.1+build.000','1.0.0-0','1.0.0-01a'])assert.equal(compatibility.isCodexVersion(version),true,version);
 for(const version of [undefined,null,1,{},'', 'v0.169.0','0.169','00.169.0','0.0169.0','0.169.00','0.169.0evil','0.169.0.1','0.169.0-','0.169.0+','0.169.0-alpha..1','0.169.0-01','0.169.0-alpha.01','0.169.0+build..1','0.169.0\n',' 0.169.0','0.169.0 ','0.169.0/a']){
  assert.equal(compatibility.isCodexVersion(version),false,String(version));
  assert.equal(compatibility.supportsCodexHook(version),false,String(version));
  assert.equal(compatibility.supportsCodexDaemon(version),false,String(version));
 }
});

test('version evidence remains an exact historical lookup for eligible newer versions',()=>{
 assert.match(compatibility.codexDaemonEvidence('0.160.0'),/codex-linux-0\.160\.0-callback-probe$/);
 assert.match(compatibility.codexDaemonEvidence('0.167.0'),/codex-linux-0\.167\.0-callback-probe$/);
 for(const version of ['0.167.1','0.169.0','0.169.0-alpha.11.1','1.0.0']){
  assert.equal(compatibility.supportsCodexDaemon(version),true);
  assert.equal(compatibility.codexDaemonEvidence(version),null);
 }
});
