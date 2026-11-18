import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {withProtocol} from '../codescout-companion/background-wake/adapters/protocol-fixture.mjs';
import {probeCodexCallbacks} from './probe-codex-wake-callbacks.mjs';

for(const prefix of ['codex-tui','issue14_first_originator'])test(`callback probe accepts same-version daemon first initialized by ${prefix}`,async()=>{
 let fixtureRoot,primarySocket;
 await withProtocol(async({root,endpoint,messages})=>{
  fixtureRoot=root;
  const result=await probeCodexCallbacks({endpoint,profileRoot:root,expectedVersion:'0.167.0',allowModelCall:true,timeoutMs:2000});
  assert.equal(result.supported,true,result.reason);
  assert.equal(result.daemonVersion,'0.167.0');
  assert.deepEqual(result.callbacksAfterSecondaryClose,{attached:true,turnCompleted:true,originalTool:1,originalPermission:1,secondaryCallbacks:0});
  assert.equal(messages.filter(m=>m.method==='thread/start').length,1);
  assert.equal(messages.filter(m=>m.method==='turn/start').length,1);
  assert.ok(messages.some(m=>m.method==='thread/archive'));
  assert.deepEqual(messages.find(m=>m.id==='approval')?.result,{decision:'decline'});
 },{reply:(m,socket)=>{
  if(m.method==='initialize')return {result:{codexHome:fixtureRoot,userAgent:prefix+'/0.167.0 (fixture)',platformOs:'linux'}};
  if(m.method==='thread/start')return {result:{thread:{id:'session'}}};
  if(m.method==='turn/start'){primarySocket=socket;socket.send(JSON.stringify({method:'turn/started',params:{threadId:'session',turn:{id:'probe-turn',status:'inProgress'}}}));return {result:{turn:{id:'probe-turn'}}};}
  if(m.method==='thread/resume')socket.once('close',()=>primarySocket.send(JSON.stringify({id:'tool',method:'item/tool/call',params:{threadId:'session',turnId:'probe-turn',tool:'wake_probe',arguments:{}}})));
  if(m.id==='tool'){
   assert.equal(m.result.success,true);
   socket.send(JSON.stringify({id:'approval',method:'item/commandExecution/requestApproval',params:{threadId:'session',turnId:'probe-turn',command:'printf wake-probe'}}));
   return false;
  }
  if(m.id==='approval'){
   socket.send(JSON.stringify({method:'turn/completed',params:{threadId:'session',turn:{id:'probe-turn',status:'completed'}}}));
   return false;
  }
 }});
});

for(const userAgent of ['custom/0.160.0 (fixture)','custom/0.167.0evil','custom/0.167.0.1',null])test(`callback probe refuses mismatched or malformed userAgent ${JSON.stringify(userAgent)} before thread creation`,async()=>{
 let fixtureRoot;
 await withProtocol(async({root,endpoint,messages})=>{
  fixtureRoot=root;
  await assert.rejects(probeCodexCallbacks({endpoint,profileRoot:root,expectedVersion:'0.167.0',allowModelCall:true,timeoutMs:1000}),/observed daemon version differs/);
  assert.equal(messages.some(m=>m.method==='thread/start'),false);
  assert.equal(messages.some(m=>m.method==='turn/start'),false);
 },{reply:m=>m.method==='initialize'?{result:{codexHome:fixtureRoot,userAgent,platformOs:'linux'}}:undefined});
});

test('callback probe refuses another existing profile before creating or archiving a thread',async()=>{
 let fixtureRoot;
 await withProtocol(async({root,endpoint,messages})=>{
  fixtureRoot=root;
  const requestedProfile=join(root,'requested-profile');
  await mkdir(requestedProfile);
  await assert.rejects(probeCodexCallbacks({endpoint,profileRoot:requestedProfile,expectedVersion:'0.167.0',allowModelCall:true,timeoutMs:1000}),/endpoint belongs to another profile/);
  assert.equal(messages.some(m=>m.method==='thread/start'),false);
  assert.equal(messages.some(m=>m.method==='turn/start'),false);
  assert.equal(messages.some(m=>m.method==='thread/archive'),false);
 },{reply:m=>m.method==='initialize'?{result:{codexHome:fixtureRoot,userAgent:'issue14_first_originator/0.167.0 (fixture)',platformOs:'linux'}}:undefined});
});

for(const version of ['0.169.0','0.169.0-alpha.11.1+build.000'])test(`callback probe accepts full newer version ${version}`,async()=>{
 let fixtureRoot;
 await withProtocol(async({root,endpoint,messages})=>{
  fixtureRoot=root;
  await assert.rejects(probeCodexCallbacks({endpoint,profileRoot:root,expectedVersion:version,allowModelCall:true,timeoutMs:1000}),/create probe thread: probe thread was not created/);
  assert.equal(messages.some(m=>m.method==='thread/start'),true);
 },{reply:m=>m.method==='initialize'?{result:{codexHome:fixtureRoot,userAgent:'custom/'+version+' (fixture)',platformOs:'linux'}}:undefined});
});
