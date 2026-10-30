import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {withStore} from './test-support.mjs';
import {loadWakeConfig} from './config.mjs';
test('invalidExplicitBindingAndMigrationAreRejected',()=>withStore(async({profileRoot,platform})=>{
 const base={version:1,engine:'v1',profileRoot,environmentId:process.platform,stateDir:platform.stateDir,pythonArgv:[process.platform==='win32'?'python':'python3'],adapters:{claudeCode:{enabled:true},codex:{enabled:false}}};
 for(const extra of [{bindings:{codex:{hostVersion:'0.165.0',hostInstanceId:'',runtimeGeneration:'runtime'}}},{migration:{legacyStateDir:'relative'}},{capabilities:{codex:{callbackPreserved:'yes'}}}]){
  await writeFile(join(profileRoot,'codescout-wake.json'),JSON.stringify({...base,...extra}));
  await assert.rejects(loadWakeConfig({profileRoot,environmentId:process.platform}),/binding|migration|capabilit/i);
 }
}));
