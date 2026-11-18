import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFile,rm,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {withStore} from './test-support.mjs';
import {formatDeliveryEvent} from './model.mjs';
let runWatch;try{({runWatch}=await import('./engine.mjs'));}catch(e){if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;}
const ready={supported:true,reason:'fixture',evidenceRef:'fixture'};
async function fixture(fn){
  assert.ok(runWatch,'common engine is not implemented');
  return withStore(async({event,store,platform})=>{
    let now=1000,step=async()=>{};
    const clock={now:()=>now,sleep:async(ms)=>{now+=ms;await step(now);}};
    const request={version:1,job:event.job,target:event.target,sourceEventId:'root-call'};
    const calls=[];
    const adapter={capability:async()=>ready,validateTarget:async()=>ready,close:async()=>{},deliver:async(e,onEvidence)=>{
      calls.push(e);await onEvidence({state:'completed',eventId:e.eventId,attemptId:e.attemptId,correlation:{turnId:'ours'}});
      return {kind:'finished'};
    }};
    const record={schema:1,server_pid:4242,handle:event.job.handle,state:'exited',exit_code:0,started_at:new Date(1000).toISOString(),finished_at:new Date(2000).toISOString()};
    const write=async(changes={})=>writeFile(event.job.recordPath,JSON.stringify({...record,...changes}));
    await write();
    const policy={pollMs:10,recordGraceMs:30,deadlineMs:50,leaseMs:30000,renewMs:10000,retryDelaysMs:[1,2,4]};
    const native={...platform,processStatus:async()=>'alive'};
    const watch=()=>runWatch(request,{store,platform:native,adapter,clock,policy});
    await fn({event,store,platform:native,adapter,clock,calls,write,watch,request,policy,setStep:(fn)=>{step=fn;}});
  },{ensure:false});
}
test('terminalSuccessAndExit7Differ',()=>fixture(async({write,watch,calls,event,request,store,platform,adapter,clock,policy})=>{
  await write({exit_code:7});const result=await watch();assert.equal(result.state,'completed');
  assert.match(formatDeliveryEvent(calls[0]),/exited 7/);
  const other={...request,target:{...request.target,sessionId:'success'}};
  await write({exit_code:0});await runWatch(other,{store,platform,adapter,clock,policy});
  assert.match(formatDeliveryEvent(calls[1]),/exited 0/);assert.notEqual(calls[0].eventId,calls[1].eventId);
}));
test('signalIsNotExitZero',()=>fixture(async({write,watch,calls})=>{await write({exit_code:null});await watch();assert.match(formatDeliveryEvent(calls[0]),/signal/);}));
test('spawnFailureIsTerminal',()=>fixture(async({write,watch,calls})=>{await write({state:'failed',exit_code:null});await watch();assert.equal(calls[0].payload.state,'failed');}));
test('recordGraceThenVanished',()=>fixture(async({event,watch,calls,clock})=>{
  await rm(event.job.recordPath);await watch();assert.equal(clock.now(),1030);assert.equal(calls[0].kind,'tracking-lost');
  assert.doesNotMatch(formatDeliveryEvent(calls[0]),/tail -50/);
}));
test('recordCanAppearDuringGrace',()=>fixture(async({event,setStep,write,watch,calls})=>{
  await rm(event.job.recordPath);setStep(async()=>write({exit_code:7}));await watch();assert.equal(calls[0].payload.exitCode,7);
}));
test('serverGenerationLostInvalidatesHandle',()=>fixture(async({write,watch,calls})=>{await write({server_pid:9999});await watch();assert.equal(calls[0].kind,'tracking-lost');}));
test('knownDeadServerInvalidatesRunningRecord',()=>fixture(async({write,watch,calls,platform})=>{platform.processStatus=async()=>'dead';await write({state:'running'});await watch();assert.equal(calls[0].kind,'tracking-lost');}));
test('unknownLivenessDoesNotMeanDead',()=>fixture(async({write,watch,calls,platform})=>{platform.processStatus=async()=>'unknown';await write({state:'running'});await watch();assert.equal(calls[0].kind,'heartbeat');}));
test('heartbeatThenTerminalBothArrive',()=>fixture(async({write,watch,calls})=>{
  await write({state:'running'});await watch();await write({exit_code:7});await watch();assert.deepEqual(calls.map(e=>e.kind),['heartbeat','terminal']);assert.notEqual(calls[0].eventId,calls[1].eventId);
}));
test('rearmReadDuringTerminalDoesNotConsumeTerminal',()=>fixture(async({watch,calls})=>{
  await Promise.all([watch(),watch()]);assert.equal(calls.length,1);assert.equal(calls[0].kind,'terminal');
}));
test('terminalWinsAtHeartbeatBoundary',()=>fixture(async({write,setStep,watch,calls})=>{
  await write({state:'running'});setStep(async(now)=>{if(now>=1050)await write({exit_code:7});});
  await watch();assert.deepEqual(calls.map(e=>e.kind),['terminal']);
}));
test('onlyPreSendFailureRetries',()=>fixture(async({watch,calls,adapter})=>{
  adapter.deliver=async(e)=>{calls.push(e);return {kind:calls.length<4?'pre-send-failure':'unknown',reason:'probe'};};
  const r=await watch();assert.equal(calls.length,4);assert.equal(r.state,'unknown');
  await watch();assert.equal(calls.length,4);
}));
test('retryBudgetSurvivesNewWatcher',()=>fixture(async({watch,calls,adapter})=>{
  adapter.deliver=async(e)=>{calls.push(e);return {kind:'pre-send-failure',reason:'offline'};};
  assert.equal((await watch()).state,'failed');await watch();assert.equal(calls.length,4);
}));
test('acceptedDisconnectNeverRetries',()=>fixture(async({watch,calls,adapter})=>{
  adapter.deliver=async(e,observe)=>{calls.push(e);await observe({state:'accepted',eventId:e.eventId,attemptId:e.attemptId,correlation:{turnId:'ours'}});throw Error('disconnect');};
  assert.equal((await watch()).state,'accepted');await watch();assert.equal(calls.length,1);
}));
test('unrecordedAckDisconnectBecomesUnknown',()=>fixture(async({watch,calls,adapter})=>{
  adapter.deliver=async(e)=>{calls.push(e);throw Error('return window');};
  assert.equal((await watch()).state,'unknown');await watch();assert.equal(calls.length,1);
}));
test('unrelatedIdleIsNotEvidence',()=>fixture(async({watch,calls,adapter})=>{
  adapter.deliver=async(e,observe)=>{calls.push(e);await observe({state:'completed',eventId:'wake1:'+'0'.repeat(64),attemptId:e.attemptId,correlation:{turnId:'foreign'}});return {kind:'unknown'};};
  assert.equal((await watch()).state,'unknown');
}));
test('emittedUnconfirmedNeverRetries',()=>fixture(async({watch,calls,adapter})=>{
  adapter.deliver=async(e)=>{calls.push(e);return {kind:'emitted-unconfirmed'};};
  assert.equal((await watch()).state,'sending');await watch();assert.equal(calls.length,1);
}));
test('receiptWriteFailurePreventsDelivery',()=>fixture(async({event,platform,watch,calls})=>{
  await platform.privateStateRoot();await mkdir(join(platform.stateDir,event.eventId.slice(6)+'.json'));
  assert.equal((await watch()).state,'failed');assert.equal(calls.length,0);
}));
test('closedTargetDoesNotReopen',()=>fixture(async({watch,calls,adapter})=>{
  adapter.validateTarget=async()=>({supported:false,reason:'closed target',evidenceRef:null});
  assert.equal((await watch()).state,'unsupported');assert.equal(calls.length,0);
}));
