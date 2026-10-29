import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,access} from 'node:fs/promises';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {withStore} from '../test-support.mjs';
let api;try{api=await import('./claude-code.mjs');}catch(e){if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;}
const wrapper=fileURLToPath(new URL('../../hooks/wake-on-job-end.mjs',import.meta.url));
async function fixture(fn){
  assert.ok(api,'Claude adapter is not implemented');
  return withStore(async({event,platform,profileRoot})=>{
    const config={version:1,engine:'v1',profileRoot,environmentId:process.platform,stateDir:platform.stateDir,pythonArgv:[process.platform==='win32'?'python':'python3'],adapters:{claudeCode:{enabled:true},codex:{enabled:false,endpoint:null}},bindings:{claudeCode:{hostVersion:'2.1.312',hostInstanceId:'fixture',runtimeGeneration:'fixture'}}};
    const raw={hook_event_name:'PostToolUse',tool_name:'mcp__codescout__run_command',tool_use_id:'call-1',session_id:event.target.sessionId,cwd:profileRoot,tool_input:{command:'@ack_x'},tool_response:[{type:'text',text:JSON.stringify({output_id:event.job.handle,record:event.job.recordPath})}]};
    await writeFile(event.job.recordPath,JSON.stringify({schema:1,handle:event.job.handle,server_pid:4242,state:'exited',exit_code:7,started_at:new Date(1000).toISOString(),finished_at:new Date(2000).toISOString()}));
    await fn({config,raw,event,platform,profileRoot});
  },{ensure:false});
}
test('ackedReplayArms',()=>fixture(async({raw,config,platform})=>{assert.ok(await api.normalizeClaudeWatch(raw,config,platform));}));
test('pendingAckDoesNotArm',()=>fixture(async({raw,config,platform})=>{raw.tool_response=[{text:'{"pending_ack":"@ack_x"}'}];assert.equal(await api.normalizeClaudeWatch(raw,config,platform),null);}));
test('subagentNeverArms',()=>fixture(async({raw,config,platform})=>{raw.agent_id='child';assert.equal(await api.normalizeClaudeWatch(raw,config,platform),null);}));
test('unmeasuredVersionNeverArms',()=>fixture(async({raw,config,platform})=>{config.bindings.claudeCode.hostVersion='future';assert.equal(await api.normalizeClaudeWatch(raw,config,platform),null);}));
test('readRearmsOnlyItsOwnMapping',()=>fixture(async({raw,config,platform})=>{
  const first=await api.normalizeClaudeWatch(raw,config,platform);assert.ok(first);
  raw.tool_input.command='tail -50 @bg_00000001';raw.tool_response=[{text:'{"exit_code":0}'}];
  assert.deepEqual((await api.normalizeClaudeWatch(raw,config,platform)).job,first.job);
  raw.session_id='foreign';assert.equal(await api.normalizeClaudeWatch(raw,config,platform),null);
}));
test('legacyAndNewNeverOwnSameJob',()=>fixture(async({raw,config,platform,event})=>{
  await writeFile(event.job.recordPath+'.watch','123');
  assert.equal(await api.normalizeClaudeWatch(raw,config,platform),null);
}));
test('exit2IsEmissionNotAcceptanceAndSnapshotSurvives',()=>fixture(async({raw,config,event,profileRoot})=>{
  await writeFile(join(profileRoot,'codescout-wake.json'),JSON.stringify(config));
  const env={...process.env,CLAUDE_PROJECT_DIR:profileRoot,CLAUDE_CONFIG_DIR:profileRoot,CODESCOUT_WAKE_ENVIRONMENT_ID:process.platform};
  const child=spawnSync(process.execPath,[wrapper],{env,input:JSON.stringify(raw),encoding:'utf8',timeout:15000});
  assert.equal(child.status,2,child.stderr);assert.match(child.stderr,/exited 7/);
  const {readdir}=await import('node:fs/promises');const entries=await readdir(config.stateDir);
  const receipts=await Promise.all(entries.filter(f=>/^[a-f0-9]{64}\.json$/.test(f)).map(f=>readFile(join(config.stateDir,f),'utf8').then(JSON.parse)));
  assert.equal(receipts.length,1);assert.equal(receipts[0].state,'sending');assert.equal(receipts[0].lastEvidence.kind,'emitted-unconfirmed');
  await assert.rejects(access(event.job.recordPath+'.delivered'));
  const duplicate=spawnSync(process.execPath,[wrapper],{env,input:JSON.stringify(raw),encoding:'utf8',timeout:15000});assert.equal(duplicate.status,0);
}));
test('deadlineCapPreserved',async()=>{const {deadlineSecsOf}=await import('../../hooks/wake-on-job-end.mjs');assert.equal(deadlineSecsOf(9000),7000);});
