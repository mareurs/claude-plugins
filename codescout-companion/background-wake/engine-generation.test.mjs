import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {withStore} from './test-support.mjs';
import {registerWatch} from './watch-map.mjs';
import {runWatch} from './engine.mjs';
import {formatDeliveryEvent} from './model.mjs';
test('supersededGenerationNeverRecommendsReusedHandle',()=>withStore(async({event,store,platform,profileRoot})=>{
 const request={version:1,sourceEventId:'old',job:event.job,target:event.target};
 await registerWatch(request,platform);
 const newer={...request,sourceEventId:'new',job:{...event.job,recordPath:join(profileRoot,'4243-b1b2c3d4-bg_00000001.json'),serverPid:4243,serverToken:'b1b2c3d4'}};
 await registerWatch(newer,platform);
 await writeFile(event.job.recordPath,JSON.stringify({schema:1,state:'running',server_pid:4242,handle:event.job.handle,started_at:new Date().toISOString()}));
 const calls=[];const adapter={capability:async()=>({supported:true}),validateTarget:async()=>({supported:true}),close:async()=>{},deliver:async(e,observe)=>{calls.push(e);await observe({state:'completed',eventId:e.eventId,attemptId:e.attemptId,correlation:{turnId:'ours'}});return {kind:'finished'};}};
 let now=1000;
 await runWatch(request,{store,platform:{...platform,processStatus:async()=>'alive'},adapter,clock:{now:()=>now,sleep:async(ms)=>{now+=ms;}},policy:{deadlineMs:10,pollMs:10}});
 assert.equal(calls[0].kind,'tracking-lost');assert.doesNotMatch(formatDeliveryEvent(calls[0]),/tail -50/);
},{ensure:false}));
