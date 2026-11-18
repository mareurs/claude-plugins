import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {withStore} from './test-support.mjs';
test('actualWatchCLIConsumesNativeStdin',()=>withStore(async({profileRoot,platform})=>{
 const config={version:1,engine:'v1',profileRoot,environmentId:process.platform,stateDir:platform.stateDir,pythonArgv:[process.platform==='win32'?'python':'python3'],adapters:{claudeCode:{enabled:false},codex:{enabled:true,endpoint:'unix:///missing'}}};
 await writeFile(join(profileRoot,'codescout-wake.json'),JSON.stringify(config));
 const child=spawnSync(process.execPath,[fileURLToPath(new URL('./cli.mjs',import.meta.url)),'watch','--profile',profileRoot,'--environment',process.platform,'--harness','codex'],{input:'{}',encoding:'utf8',timeout:10000});
 assert.equal(child.status,1);assert.equal(JSON.parse(child.stdout).state,'unsupported');
}));
