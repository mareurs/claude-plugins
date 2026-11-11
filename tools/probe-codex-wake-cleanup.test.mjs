import test from 'node:test';
import assert from 'node:assert/strict';
import {withProtocol} from '../codescout-companion/background-wake/adapters/protocol-fixture.mjs';
import {probeCodexCallbacks} from './probe-codex-wake-callbacks.mjs';

test('archive rejection cannot produce successful compatibility evidence',()=>{
 let primary;
 return withProtocol(async({root,endpoint})=>{
  await assert.rejects(probeCodexCallbacks({endpoint,profileRoot:root,expectedVersion:'0.160.0',allowModelCall:true,timeoutMs:2000}),/archive|cleanup/);
 },{reply:(m,socket)=>{
  if(m.method==='thread/start')return {result:{thread:{id:'session'}}};
  if(m.method==='turn/start'){primary=socket;return {result:{turn:{id:'probe-turn'}}};}
  if(m.method==='thread/resume')socket.once('close',()=>primary.send(JSON.stringify({id:'tool',method:'item/tool/call',params:{threadId:'session',turnId:'probe-turn',tool:'wake_probe'}})));
  if(m.id==='tool'){socket.send(JSON.stringify({id:'approval',method:'item/commandExecution/requestApproval',params:{threadId:'session',turnId:'probe-turn'}}));return false;}
  if(m.id==='approval'){socket.send(JSON.stringify({method:'turn/completed',params:{threadId:'session',turn:{id:'probe-turn',status:'completed'}}}));return false;}
  if(m.method==='thread/archive')return {error:{code:-32000,message:'fixture archive failure'}};
 }});
});
