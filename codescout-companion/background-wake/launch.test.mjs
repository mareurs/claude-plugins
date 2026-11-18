import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {withStore} from './test-support.mjs';
import {runCli} from './cli.mjs';
test('launchRefusesUnverifiedNativeOriginBeforeSpawning',()=>withStore(async({profileRoot,platform})=>{
 await writeFile(join(profileRoot,'codescout-wake.json'),JSON.stringify({version:1,engine:'v1',profileRoot,environmentId:process.platform,stateDir:platform.stateDir,pythonArgv:[process.platform==='win32'?'python':'python3'],adapters:{claudeCode:{enabled:false},codex:{enabled:true,endpoint:'unix:///missing'}}}));
 const r=await runCli(['launch','--profile',profileRoot,'--environment',process.platform,'--harness','codex'],{input:'{}'});
 assert.equal(r.state,'unsupported');assert.equal(r.ok,false);
}));
