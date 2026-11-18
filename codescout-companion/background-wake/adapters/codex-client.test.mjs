import test from 'node:test';
import assert from 'node:assert/strict';
import {withProtocol} from './protocol-fixture.mjs';
let connectCodex;try{({connectCodex}=await import('./codex-client.mjs'));}catch(e){if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;}
const subject=()=>{assert.ok(connectCodex,'Codex client missing');return connectCodex;};
test('initializeBeforeRequests',()=>withProtocol(async({endpoint,messages})=>{
 const c=await subject()({endpoint,clientInfo:{name:'fixture',version:'1'}});await c.request('thread/loaded/list',{});
 assert.deepEqual(messages.map(m=>m.method),['initialize','initialized','thread/loaded/list']);await c.close();
}));
test('attachHasNoConfigurationOverrides',()=>withProtocol(async({endpoint,messages})=>{
 const c=await subject()({endpoint,clientInfo:{name:'fixture',version:'1'}});
 const unsubscribe=await c.subscribeThread('session',()=>{});assert.equal(typeof unsubscribe,'function');
 assert.deepEqual(messages.find(m=>m.method==='thread/resume').params,{threadId:'session',excludeTurns:true});
 await c.close();assert.equal(messages.filter(m=>/destroy|unload|unsubscribe|interrupt/.test(m.method)).length,0);
}));
test('notLoadedThreadNeverResumes',()=>withProtocol(async({endpoint,messages})=>{
 const c=await subject()({endpoint,clientInfo:{name:'fixture',version:'1'}});
 await assert.rejects(c.subscribeThread('missing',()=>{}),/loaded/);assert.equal(messages.some(m=>m.method==='thread/resume'),false);await c.close();
}));
test('closeOnlyClosesSecondaryConnection',()=>withProtocol(async({endpoint})=>{
 const first=await subject()({endpoint,clientInfo:{name:'first',version:'1'}});
 const second=await subject()({endpoint,clientInfo:{name:'second',version:'1'}});
 await second.close();assert.deepEqual((await first.request('thread/loaded/list',{})).data,['session']);await first.close();
}));
test('socketDisconnectRejectsPendingWithoutReplay',()=>withProtocol(async({endpoint,messages})=>{
 const c=await subject()({endpoint,clientInfo:{name:'fixture',version:'1'},requestTimeoutMs:300});
 await assert.rejects(c.request('turn/start',{threadId:'session',input:[]}),/closed|disconnect/);
 assert.equal(messages.filter(m=>m.method==='turn/start').length,1);await c.close();
},{reply:(m,s)=>{if(m.method==='turn/start'){s.terminate();return false;}}}));
