import test from 'node:test';
import assert from 'node:assert/strict';
import {withProtocol} from './protocol-fixture.mjs';
import {withStore} from '../test-support.mjs';
import {createCodexAdapter} from './codex.mjs';
import {endpointIdentity} from './codex-client.mjs';

async function fixture(fn,{reply}={}){
 return withProtocol(async({root,endpoint,messages,broadcast})=>withStore(async({event})=>{
  const {generation}=await endpointIdentity(endpoint);
  const config={engine:'v1',profileRoot:root,adapters:{codex:{enabled:true,endpoint}},bindings:{codex:{hostInstanceId:generation,runtimeGeneration:generation}},capabilities:{codex:{daemonVersion:'0.160.0',subscription:'resume-loaded',callbackPreserved:true}}};
  await fn({config,event,messages,broadcast});
 }),{reply});
}
test('missingCallbackProofDisablesBeforeAttach',()=>fixture(async({config,messages})=>{
 config.capabilities.codex.callbackPreserved=false;const a=createCodexAdapter(config);
 assert.equal((await a.capability()).supported,false);assert.equal(messages.length,0);await a.close();
}));
test('foreignCompletionAndForeignOutputCannotCompleteOurs',()=>fixture(async({config,event,broadcast,messages})=>{
 const a=createCodexAdapter(config,{completionTimeoutMs:80});await a.validateTarget({target:event.target});
 const evidence=[];const promise=a.deliver({...event,attemptId:'a'},e=>evidence.push(e));
 while(!messages.some(m=>m.method==='turn/start'))await new Promise(r=>setImmediate(r));
 broadcast({method:'item/completed',params:{threadId:'session',turnId:'ours',item:{id:'foreign',type:'functionCallOutput',name:'codescout_background_job',output:'Event wake1:'+'0'.repeat(64)+'.'}}});
 broadcast({method:'turn/completed',params:{threadId:'session',turn:{id:'ours',status:'completed'}}});
 assert.equal((await promise).kind,'unknown');assert.deepEqual(evidence.map(e=>e.state),['accepted']);await a.close();
},{reply:m=>m.method==='turn/start'?{result:{turn:{id:'ours',items:[]}}}:undefined}));
test('postSendDisconnectIsUnknown',()=>fixture(async({config,event,messages})=>{
 const a=createCodexAdapter(config,{completionTimeoutMs:80});await a.validateTarget({target:event.target});
 const result=await a.deliver({...event,attemptId:'a'},()=>{});
 assert.equal(result.kind,'unknown');assert.equal(messages.filter(m=>m.method==='turn/start').length,1);await a.close();
},{reply:(m,s)=>{if(m.method==='turn/start'){s.terminate();return false;}}}));
