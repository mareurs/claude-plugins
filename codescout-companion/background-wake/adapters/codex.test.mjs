import test from 'node:test';
import assert from 'node:assert/strict';
import {withProtocol,boundTarget,bindEvent} from './protocol-fixture.mjs';
import {withStore} from '../test-support.mjs';
import {eventId} from '../model.mjs';
let api;try{api=await import('./codex.mjs');}catch(e){if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;}
const subject=()=>{assert.ok(api,'Codex adapter missing');return api;};
async function configOf(root,endpoint,event){
 const {endpointIdentity}=await import('./codex-client.mjs');
 const {generation}=await endpointIdentity(endpoint);
 const config={engine:'v1',profileRoot:root,environmentId:'linux',adapters:{codex:{enabled:true,endpoint}},bindings:{codex:{hostVersion:'0.165.0',hostInstanceId:generation,runtimeGeneration:generation}},capabilities:{codex:{daemonVersion:'0.160.0',subscription:'resume-loaded',callbackPreserved:true}}};
 if(event)Object.assign(event,bindEvent(event,config));
 return config;
}
test('rootProofRequired',()=>withStore(async({platform,event,profileRoot})=>{
 const config={engine:'v1',profileRoot,environmentId:'linux',adapters:{codex:{enabled:true}},bindings:{codex:{hostVersion:'0.165.0',hostInstanceId:'fixture',runtimeGeneration:'fixture'}}};
 const raw={session_id:'session',agent_id:'child',cwd:profileRoot,tool_use_id:'call',hook_event_name:'PostToolUse',tool_name:'mcp__codescout__run_command',tool_response:{content:[{text:JSON.stringify({output_id:event.job.handle,record:event.job.recordPath})}]}};
 assert.equal(await subject().normalizeCodexWatch(raw,config,platform),null);
}));
test('wrongDaemonSameSessionRejected',()=>withProtocol(async({endpoint,root,messages})=>{
 const config=await configOf(root,endpoint);config.profileRoot=root+'/other';
 const adapter=subject().createCodexAdapter(config);assert.equal((await adapter.capability()).supported,false);await adapter.close();
 assert.equal(messages.some(m=>m.method==='turn/start'),false);
}));
test('changedEndpointGenerationRejected',()=>withProtocol(async({endpoint,root})=>{
 const config=await configOf(root,endpoint);config.bindings.codex.hostInstanceId='other';
 const adapter=subject().createCodexAdapter(config);assert.equal((await adapter.capability()).supported,false);await adapter.close();
}));
test('notLoadedThreadDeclined',()=>withProtocol(async({endpoint,root,messages})=>{
 const adapter=subject().createCodexAdapter(await configOf(root,endpoint));
 assert.equal((await adapter.validateTarget({target:boundTarget(await configOf(root,endpoint),'missing')})).supported,false);await adapter.close();
 assert.equal(messages.some(m=>m.method==='thread/resume'),false);
}));
test('toolOutputAndActiveTurnCorrelateExactEvent',()=>withProtocol(async({endpoint,root,messages,connections,broadcast})=>{
 await withStore(async({event})=>{
  const config=await configOf(root,endpoint,event);const adapter=subject().createCodexAdapter(config,{completionTimeoutMs:300});
  const bound={...event,attemptId:'attempt',target:{...event.target,profileRoot:root}};
  bound.eventId=eventId(bound.job,bound.target,bound.kind,bound.sequence);
  const request={target:bound.target};assert.equal((await adapter.validateTarget(request)).supported,true);
  const evidence=[];const delivery=adapter.deliver(bound,e=>evidence.push(e));
  await new Promise(r=>setTimeout(r,20));
  const sent=messages.find(m=>m.method==='turn/start');assert.deepEqual(sent.params.input,[]);assert.equal(sent.params.toolOutput.name,'codescout_background_job');
  broadcast({method:'turn/completed',params:{threadId:'session',turn:{id:'foreign',status:'completed'}}});
  broadcast({method:'item/completed',params:{threadId:'session',turnId:'active',item:{id:'foreign-item',type:'functionCallOutput',name:'codescout_background_job',output:'another event'}}});
  broadcast({method:'item/completed',params:{threadId:'session',turnId:'active',item:{id:'output',type:'functionCallOutput',name:'codescout_background_job',output:sent.params.toolOutput.output}}});
  broadcast({method:'turn/completed',params:{threadId:'session',turn:{id:'active',status:'completed'}}});
  assert.equal((await delivery).kind,'finished');assert.deepEqual(evidence.map(e=>e.state),['accepted','continuation_observed','completed']);
  assert.equal(evidence.filter(e=>e.state==='completed').length,1);await adapter.close();
 });
},{reply:m=>m.method==='turn/start'?{result:{turn:{id:'active',status:'inProgress',items:[]}}}:undefined}));
test('acceptedReplyThenDisconnectIsNotRetryable',()=>withProtocol(async({endpoint,root,messages})=>{
 await withStore(async({event})=>{
  const adapter=subject().createCodexAdapter(await configOf(root,endpoint,event),{completionTimeoutMs:300});
  await adapter.validateTarget({target:event.target});const evidence=[];
  const result=await adapter.deliver({...event,attemptId:'attempt'},e=>evidence.push(e));
  assert.equal(result.kind,'unknown');assert.equal(evidence[0].state,'accepted');assert.equal(messages.filter(m=>m.method==='turn/start').length,1);await adapter.close();
 });
},{reply:(m,s)=>{if(m.method==='turn/start'){s.send(JSON.stringify({id:m.id,result:{turn:{id:'ours',items:[]}}}));setTimeout(()=>s.terminate(),5);return false;}}}));
test('closedTargetBeforeSendIsPreSendFailure',()=>withProtocol(async({endpoint,root,messages})=>{
 await withStore(async({event})=>{
  const adapter=subject().createCodexAdapter(await configOf(root,endpoint,event));await adapter.validateTarget({target:event.target});
  const result=await adapter.deliver({...event,target:{...event.target,sessionId:'missing'},attemptId:'attempt'},()=>{});
  assert.equal(result.kind,'pre-send-failure');assert.equal(messages.some(m=>m.method==='turn/start'),false);await adapter.close();
 });
}));
