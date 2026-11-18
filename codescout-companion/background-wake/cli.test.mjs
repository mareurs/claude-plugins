import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFile,mkdir,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {withStore,ownerA} from './test-support.mjs';
let cli;try{cli=await import('./cli.mjs');}catch(e){if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;}
const subject=()=>{assert.ok(cli,'CLI is not implemented');return cli;};
const script=fileURLToPath(new URL('./cli.mjs',import.meta.url));
async function fixture(fn){return withStore(async f=>{
 const config={version:1,engine:'legacy',profileRoot:f.profileRoot,environmentId:process.platform,stateDir:f.platform.stateDir,pythonArgv:[process.platform==='win32'?'python':'python3'],adapters:{claudeCode:{enabled:true},codex:{enabled:false,endpoint:null}}};
 const save=()=>writeFile(join(f.profileRoot,'codescout-wake.json'),JSON.stringify(config));await save();await fn({...f,config,save});
});}
test('nativeCLIUsesExecutableArgvWithoutBash',()=>fixture(async({profileRoot})=>{
 subject();const child=spawnSync(process.execPath,[script,'doctor','--profile',profileRoot,'--environment',process.platform],{encoding:'utf8',timeout:10000});
 assert.equal(child.status,0,child.stderr);assert.equal(JSON.parse(child.stdout).engine,'legacy');
}));
test('diagnosticsDoNotLeakTokens',()=>fixture(async({config,save,profileRoot})=>{
 config.adapters.codex={enabled:true,endpoint:'wss://user:SECRET_SENTINEL@host/?token=SECRET_SENTINEL'};await save();
 const result=await subject().runCli(['doctor','--profile',profileRoot,'--environment',process.platform]);
 assert.equal(JSON.stringify(result).includes('SECRET_SENTINEL'),false);
}));
test('recoverCannotOverrideSending',()=>fixture(async({transact,event,profileRoot})=>{
 await transact('claim',{ownerToken:ownerA,attemptId:'a',leaseMs:1});await transact('begin-send',{ownerToken:ownerA,attemptId:'a'});
 const r=await subject().runCli(['recover-pre-send','--profile',profileRoot,'--environment',process.platform,'--event',event.eventId]);
 assert.equal(r.ok,false);assert.equal((await transact('inspect',{nowMs:Date.now()})).receipt.state,'sending');
}));
test('unknownNeedsExplicitActionAndAckIsNotHostEvidence',()=>fixture(async({transact,event,profileRoot})=>{
 await transact('claim',{ownerToken:ownerA,attemptId:'a',leaseMs:1});await transact('begin-send',{ownerToken:ownerA,attemptId:'a'});
 await transact('evidence',{attemptId:'a',result:{kind:'unknown'}});
 const args=['--profile',profileRoot,'--environment',process.platform,'--event',event.eventId];
 assert.equal((await subject().runCli(['recover-pre-send',...args])).ok,false);
 const ack=await subject().runCli(['acknowledge',...args,'--note','operator inspected externally']);
 assert.equal(ack.ok,true);const stored=(await transact('inspect',{nowMs:Date.now()})).receipt;
 assert.equal(stored.state,'unknown');assert.equal(stored.operatorDecision.note,'operator inspected externally');assert.equal(stored.lastEvidence,undefined);
}));
test('gcKeepsPersistentLockFiles',()=>fixture(async({event,profileRoot,platform})=>{
 const r=await subject().runCli(['gc','--profile',profileRoot,'--environment',process.platform,'--event',event.eventId]);assert.equal(r.ok,true);
 assert.ok(await readFile(join(platform.stateDir,event.eventId.slice(6)+'.lock')));
}));
test('cannotActivateBeforeLegacyDrain',()=>fixture(async({config,save,profileRoot,event})=>{
 const legacy=join(profileRoot,'legacy');await mkdir(legacy);
 await writeFile(join(legacy,'map-session-@bg_00000001'),event.job.recordPath);await writeFile(event.job.recordPath+'.watch',String(process.pid));
 config.migration={legacyStateDir:legacy};await save();
 const result=await subject().runCli(['activate','--profile',profileRoot,'--environment',process.platform,'--legacy-intake-disabled']);
 assert.equal(result.ok,false);assert.equal(JSON.parse(await readFile(join(profileRoot,'codescout-wake.json'),'utf8')).engine,'legacy');
}));
test('reconcileDoesNotInventHostEvidence',()=>fixture(async({event,profileRoot,transact})=>{
 const result=await subject().runCli(['reconcile','--profile',profileRoot,'--environment',process.platform,'--event',event.eventId]);
 assert.equal(result.ok,true);assert.equal((await transact('inspect',{nowMs:Date.now()})).receipt.state,'pending');
}));
