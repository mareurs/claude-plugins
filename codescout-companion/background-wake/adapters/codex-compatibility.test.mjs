import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {withProtocol} from './protocol-fixture.mjs';
import {withStore} from '../test-support.mjs';
import {createCodexAdapter,normalizeCodexWatch} from './codex.mjs';
import {endpointIdentity} from './codex-client.mjs';



for(const [declared,observed,accepted] of [
 ['0.160.0','0.160.0',true],['0.167.0','0.167.0',true],
 ['0.168.0','0.168.0',false],['0.167.0','0.160.0',false],
 ['0.160.0','0.167.0',false],['0.160.0','0.160.0evil',false],
])test(`daemon declared ${declared}, observed ${observed}: ${accepted?'supported':'refused'}`,async()=>{
 let fixtureRoot;
 await withProtocol(async({root,endpoint})=>{
  fixtureRoot=root;
  const {generation}=await endpointIdentity(endpoint);
  const adapter=createCodexAdapter({engine:'v1',profileRoot:root,adapters:{codex:{enabled:true,endpoint}},bindings:{codex:{hostInstanceId:generation,runtimeGeneration:generation}},capabilities:{codex:{daemonVersion:declared,subscription:'resume-loaded',callbackPreserved:true}}});
  try{const result=await adapter.capability();assert.equal(result.supported,accepted,result.reason);
   if(accepted)assert.match(result.evidenceRef,new RegExp(declared.replaceAll('.','\\.')));
  }finally{await adapter.close();}
 },{reply:m=>m.method==='initialize'?{result:{codexHome:fixtureRoot,userAgent:`codex-tui/${observed} (fixture)`,platformOs:'linux'}}:undefined});
});

for(const [hostVersion,child,accepted] of [['0.165.0',false,true],['0.167.0',false,true],['0.167.0',true,false],['0.168.0',false,false]])
 test(`native intake ${hostVersion}, child=${child}: ${accepted?'registers':'refuses'}`,()=>withStore(async({event,platform,profileRoot})=>{
  const config={engine:'v1',profileRoot,environmentId:'linux',adapters:{codex:{enabled:true}},bindings:{codex:{hostVersion,hostInstanceId:'fixture',runtimeGeneration:'fixture'}}};
  const raw={hook_event_name:'PostToolUse',tool_name:'mcp__codescout__run_command',tool_use_id:'call-version-test',session_id:'session',cwd:profileRoot,tool_input:{command:'test'},tool_response:{content:[{type:'text',text:JSON.stringify({output_id:event.job.handle,record:event.job.recordPath})}]},...(child?{agent_id:'child'}:{})};
  await writeFile(event.job.recordPath,JSON.stringify({schema:1,handle:event.job.handle,server_pid:4242,state:'exited',exit_code:0}));
  assert.equal(Boolean(await normalizeCodexWatch(raw,config,platform)),accepted);
 },{ensure:false}));
