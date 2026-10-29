import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const url=new URL('./config.mjs',import.meta.url);let api;
try{api=await import(url);}catch(e){if(e.code!=='ERR_MODULE_NOT_FOUND'||e.url!==url.href)throw e;}
const subject=()=>{assert.ok(api,'wake configuration is not implemented');return api;};
async function fixture(fn){const dir=await mkdtemp(join(tmpdir(),'wake-config-'));try{await fn(dir);}finally{await rm(dir,{recursive:true,force:true});}}
const config=(dir)=>({version:1,engine:'v1',profileRoot:dir,environmentId:'linux:local',stateDir:join(dir,'state'),pythonArgv:['python3'],adapters:{claudeCode:{enabled:true},codex:{enabled:true,endpoint:'unix:///probe/daemon.sock'}}});
async function save(dir,value){await writeFile(join(dir,'codescout-wake.json'),JSON.stringify(value));}
test('missingConfigPreservesLegacy',async()=>{const {loadWakeConfig}=subject();await fixture(async(dir)=>{const value=await loadWakeConfig({profileRoot:dir,environmentId:'linux:local'});assert.equal(value.engine,'legacy');assert.equal(value.adapters.codex.enabled,false);});});
test('wrongEnvironmentRejected',async()=>{const {loadWakeConfig}=subject();await fixture(async(dir)=>{await save(dir,{...config(dir),environmentId:'wsl:Ubuntu'});await assert.rejects(loadWakeConfig({profileRoot:dir,environmentId:'linux:local'}),/environment/i);});});
test('wrongProfileRejected',async()=>{const {loadWakeConfig}=subject();await fixture(async(dir)=>{await save(dir,{...config(dir),profileRoot:join(dir,'other')});await assert.rejects(loadWakeConfig({profileRoot:dir,environmentId:'linux:local'}),/profile/i);});});
test('malformedConfigDoesNotSilentlyDowngrade',async()=>{const {loadWakeConfig}=subject();await fixture(async(dir)=>{await writeFile(join(dir,'codescout-wake.json'),'{broken');await assert.rejects(loadWakeConfig({profileRoot:dir,environmentId:'linux:local'}),/configuration|JSON/i);});});
test('explicitConfigPreservesEndpointWithoutShellParsing',async()=>{const {loadWakeConfig}=subject();await fixture(async(dir)=>{const value=config(dir);value.pythonArgv=['/path with space/python','-I'];await save(dir,value);const loaded=await loadWakeConfig({profileRoot:dir,environmentId:'linux:local'});assert.deepEqual(loaded.pythonArgv,value.pythonArgv);assert.equal(loaded.adapters.codex.endpoint,value.adapters.codex.endpoint);});});
test('unsupportedSchemaAndNonAbsoluteStateRejected',async()=>{const {loadWakeConfig}=subject();await fixture(async(dir)=>{for(const patch of [{version:2},{stateDir:'relative'},{pythonArgv:[]},{engine:'guess'}]){await save(dir,{...config(dir),...patch});await assert.rejects(loadWakeConfig({profileRoot:dir,environmentId:'linux:local'}));}});});
