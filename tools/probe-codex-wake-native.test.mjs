import test from 'node:test';
import assert from 'node:assert/strict';
import {withProtocol} from '../codescout-companion/background-wake/adapters/protocol-fixture.mjs';
import {probeCodexCallbacks} from './probe-codex-wake-callbacks.mjs';

let primarySocket;
for(const permission of [true,false])test(`native protocol probe: approval observed=${permission}`,()=>withProtocol(async({root,endpoint,messages})=>{
 const result=await probeCodexCallbacks({endpoint,profileRoot:root,expectedVersion:'0.160.0',allowModelCall:true,timeoutMs:2000});
 assert.equal(result.supported,permission);assert.equal(result.callbacksAfterSecondaryClose.originalTool,1);assert.equal(result.callbacksAfterSecondaryClose.originalPermission,permission?1:0);
 assert.equal(messages.filter(m=>m.method==='turn/start').length,1);
 assert.ok(messages.some(m=>m.method==='thread/archive'));
 assert.deepEqual(messages.find(m=>m.id==='approval')?.result,permission?{decision:'decline'}:undefined);
 const resume=messages.find(m=>m.method==='thread/resume');assert.deepEqual(resume.params,{threadId:'session',excludeTurns:true});
},{reply:(m,socket)=>{
 if(m.method==='thread/start')return {result:{thread:{id:'session'}}};
 if(m.method==='turn/start'){
  primarySocket=socket;
  return {result:{turn:{id:'probe-turn'}}};
 }
 if(m.method==='thread/resume')socket.once('close',()=>primarySocket.send(JSON.stringify({id:'tool',method:'item/tool/call',params:{threadId:'session',turnId:'probe-turn',tool:'wake_probe',arguments:{}}})));
 if(m.id==='tool'){
  assert.equal(m.result.success,true);
  if(permission)socket.send(JSON.stringify({id:'approval',method:'item/commandExecution/requestApproval',params:{threadId:'session',turnId:'probe-turn',command:'printf wake-probe'}}));
  else socket.send(JSON.stringify({method:'turn/completed',params:{threadId:'session',turn:{id:'probe-turn',status:'completed'}}}));
  return false;
 }
 if(m.id==='approval'){
  socket.send(JSON.stringify({method:'turn/completed',params:{threadId:'session',turn:{id:'probe-turn',status:'completed'}}}));return false;
 }
}}));

test('probe refuses a different actual version before creating any thread',()=>withProtocol(async({root,endpoint,messages})=>{
 await assert.rejects(probeCodexCallbacks({endpoint,profileRoot:root,expectedVersion:'0.167.0',allowModelCall:true,timeoutMs:1000}),/version differs/);
 assert.equal(messages.some(m=>m.method==='thread/start'),false);
}));

test('callback routed to the secondary makes attach fail, never a successful proof',()=>withProtocol(async({root,endpoint})=>{
 await assert.rejects(probeCodexCallbacks({endpoint,profileRoot:root,expectedVersion:'0.160.0',allowModelCall:true,timeoutMs:1000}),/callback|closed/);
},{reply:(m,socket)=>{
 if(m.method==='thread/start')return {result:{thread:{id:'session'}}};
 if(m.method==='turn/start')return {result:{turn:{id:'probe-turn'}}};
 if(m.method==='thread/resume'){
  socket.send(JSON.stringify({id:'misrouted',method:'item/tool/call',params:{threadId:'session',tool:'wake_probe'}}));return false;
 }
 if(m.id==='misrouted')return false;
}}));
