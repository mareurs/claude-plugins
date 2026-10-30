import test from 'node:test';
import assert from 'node:assert/strict';
import {withStore} from './test-support.mjs';
import {runWatch} from './engine.mjs';
import {formatDeliveryEvent} from './model.mjs';
test('durableTerminalOutcomeSurvivesMissingServerRecord',()=>withStore(async({event,store,platform})=>{
 let now=1000;const events=[];
 const adapter={capability:async()=>({supported:true}),validateTarget:async()=>({supported:true}),close:async()=>{},deliver:async(e,observe)=>{events.push(e);await observe({state:'completed',eventId:e.eventId,attemptId:e.attemptId,correlation:{turnId:'ours'}});return {kind:'finished'};}};
 const result=await runWatch({version:1,job:event.job,target:event.target,sourceEventId:'recovery'},{store,platform,adapter,clock:{now:()=>now,sleep:async(ms)=>{now+=ms;}},policy:{pollMs:10,recordGraceMs:30,deadlineMs:50}});
 assert.equal(result.state,'completed');assert.equal(events.length,1);assert.equal(events[0].kind,'terminal');assert.equal(events[0].payload.exitCode,0);
 assert.match(formatDeliveryEvent(events[0]),/exited 0/);assert.doesNotMatch(formatDeliveryEvent(events[0]),/tail -50/);
}));
