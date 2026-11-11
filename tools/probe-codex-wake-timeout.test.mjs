import test from 'node:test';
import assert from 'node:assert/strict';
import {withProtocol} from '../codescout-companion/background-wake/adapters/protocol-fixture.mjs';
import {probeCodexCallbacks} from './probe-codex-wake-callbacks.mjs';

test('an unfinished native turn times out, is interrupted, and its own thread is archived',()=>withProtocol(async({root,endpoint,messages})=>{
 await assert.rejects(probeCodexCallbacks({endpoint,profileRoot:root,expectedVersion:'0.160.0',allowModelCall:true,timeoutMs:1000}),/timed out/);
 assert.deepEqual(messages.find(m=>m.method==='turn/interrupt')?.params,{threadId:'session',turnId:'probe-turn'});
 assert.deepEqual(messages.find(m=>m.method==='thread/archive')?.params,{threadId:'session'});
 assert.equal(messages.filter(m=>m.method==='turn/start').length,1);
},{reply:m=>{
 if(m.method==='thread/start')return {result:{thread:{id:'session'}}};
 if(m.method==='turn/start')return {result:{turn:{id:'probe-turn'}}};
}}));
