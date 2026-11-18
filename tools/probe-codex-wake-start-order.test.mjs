import test from 'node:test';
import assert from 'node:assert/strict';
import {withProtocol} from '../codescout-companion/background-wake/adapters/protocol-fixture.mjs';
import {probeCodexCallbacks} from './probe-codex-wake-callbacks.mjs';

const probeOptions=({root,endpoint})=>({endpoint,profileRoot:root,expectedVersion:'0.160.0',allowModelCall:true,timeoutMs:1000});

async function withStartScenario(options,verify){
 let primary,started=false;
 const timers=[];
 try{
  await withProtocol(verify,{reply:(m,socket)=>{
   if(m.method==='thread/start')return {result:{thread:{id:'session'}}};
   if(m.method==='turn/start'){
    primary=socket;
    const emitStart=(threadId='session',turnId='probe-turn')=>{
     if(threadId==='session'&&turnId==='probe-turn')started=true;
     socket.send(JSON.stringify({method:'turn/started',params:{threadId,turn:{id:turnId,status:'inProgress'}}}));
    };
    if(options.start==='before-response')emitStart();
    else if(options.start==='wrong-thread')emitStart('foreign');
    else if(options.start==='wrong-turn')emitStart('session','foreign-turn');
    else if(options.start==='wrong-turn-late')timers.push(setTimeout(()=>emitStart('session','foreign-turn'),60));
    else if(options.start==='completed-before-start')socket.send(JSON.stringify({method:'turn/completed',params:{threadId:'session',turn:{id:'probe-turn',status:'completed'}}}));
    else if(options.start==='late')timers.push(setTimeout(emitStart,options.startDelayMs??60));
    if(options.earlyCallback)socket.send(JSON.stringify({id:'early',method:'item/commandExecution/requestApproval',params:{threadId:'session',turnId:'probe-turn',command:'printf early'}}));
    return {result:{turn:{id:'probe-turn'}}};
   }
   if(m.method==='thread/resume'){
    if(!started||options.attachError)return {error:{code:-32601,message:'list_turns is not supported yet'}};
    socket.once('close',()=>primary.send(JSON.stringify({id:'tool',method:'item/tool/call',params:{threadId:'session',turnId:'probe-turn',tool:'wake_probe',arguments:{}}})));
   }
   if(m.id==='tool'){
    assert.equal(m.result.success,true);
    socket.send(JSON.stringify({id:'approval',method:'item/commandExecution/requestApproval',params:{threadId:'session',turnId:'probe-turn',command:'printf probe'}}));
    return false;
   }
   if(m.id==='approval'){
    assert.deepEqual(m.result,{decision:'decline'});
    const complete=()=>socket.send(JSON.stringify({method:'turn/completed',params:{threadId:'session',turn:{id:'probe-turn',status:'completed'}}}));
    if(options.complete!==false){
     if(options.completionDelayMs!==undefined)timers.push(setTimeout(complete,options.completionDelayMs));
     else complete();
    }
    return false;
   }
   if(m.id==='early')return false;
   if(m.method==='thread/archive'&&options.archiveError)return {error:{code:-1,message:'archive failed'}};
  }});
 }finally{for(const timer of timers)clearTimeout(timer);}
}

test('probe waits for actual turn/started after the turn/start acceptance response',()=>withStartScenario({start:'late'},async context=>{
 const result=await probeCodexCallbacks(probeOptions(context));
 assert.equal(result.supported,true,result.reason);
 assert.deepEqual(result.callbacksAfterSecondaryClose,{attached:true,turnCompleted:true,originalTool:1,originalPermission:1,secondaryCallbacks:0});
 assert.equal(context.connections.length,2);
 assert.equal(context.messages.filter(m=>m.method==='thread/start').length,1);
 assert.equal(context.messages.filter(m=>m.method==='turn/start').length,1);
 assert.equal(context.messages.filter(m=>m.method==='thread/resume').length,1);
}));

test('a matching turn/started before the turn/start response is retained',()=>withStartScenario({start:'before-response'},async context=>{
 assert.equal((await probeCodexCallbacks(probeOptions(context))).supported,true);
}));

for(const start of ['missing','wrong-thread','wrong-turn'])test(`${start} start cannot open a secondary connection and times out with owned cleanup`,()=>withStartScenario({start},async context=>{
 await assert.rejects(probeCodexCallbacks(probeOptions(context)),/timed out/);
 assert.equal(context.connections.length,1,'no secondary may initialize before the exact owned turn starts');
 assert.equal(context.messages.some(m=>m.method==='thread/resume'),false);
 assert.deepEqual(context.messages.find(m=>m.method==='turn/interrupt')?.params,{threadId:'session',turnId:'probe-turn'});
 assert.deepEqual(context.messages.find(m=>m.method==='thread/archive')?.params,{threadId:'session'});
 assert.equal(context.messages.filter(m=>m.method==='turn/start').length,1);
}));

test('start readiness does not relax early callback rejection',()=>withStartScenario({start:'before-response',earlyCallback:true},async context=>{
 const result=await probeCodexCallbacks(probeOptions(context));
 assert.equal(result.supported,false);
 assert.match(result.callbacksAfterSecondaryClose.failure,/callback arrived before secondary close/);
 assert.ok(context.messages.find(m=>m.id==='early')?.error);
}));

test('a started turn with no completion keeps the shared timeout and owned cleanup',()=>withStartScenario({start:'before-response',complete:false},async context=>{
 await assert.rejects(probeCodexCallbacks(probeOptions(context)),/timed out/);
 assert.equal(context.connections.length,2);
 assert.equal(context.messages.filter(m=>m.method==='thread/resume').length,1);
 assert.deepEqual(context.messages.find(m=>m.method==='turn/interrupt')?.params,{threadId:'session',turnId:'probe-turn'});
 assert.deepEqual(context.messages.find(m=>m.method==='thread/archive')?.params,{threadId:'session'});
}));

test('actual resume failure after start is not retried or converted to support',()=>withStartScenario({start:'before-response',attachError:true},async context=>{
 await assert.rejects(probeCodexCallbacks(probeOptions(context)),/attach secondary: list_turns is not supported yet/);
 assert.equal(context.messages.filter(m=>m.method==='thread/resume').length,1);
 assert.equal(context.messages.filter(m=>m.method==='turn/start').length,1);
 assert.ok(context.messages.some(m=>m.method==='thread/archive'));
}));

test('archive failure remains a failed compatibility proof',()=>withStartScenario({start:'before-response',archiveError:true},async context=>{
 await assert.rejects(probeCodexCallbacks(probeOptions(context)),/probe thread archive cleanup failed/);
 assert.equal(context.messages.filter(m=>m.method==='thread/archive').length,1);
}));

test('a premature completion cannot disable the shared startup deadline',()=>withStartScenario({start:'completed-before-start'},async context=>{
 await assert.rejects(probeCodexCallbacks(probeOptions(context)),/timed out/);
 assert.equal(context.connections.length,1);
 assert.equal(context.messages.some(m=>m.method==='thread/resume'),false);
 assert.deepEqual(context.messages.find(m=>m.method==='thread/archive')?.params,{threadId:'session'});
}));


test('a wrong turn started after acceptance cannot unlock secondary attach',()=>withStartScenario({start:'wrong-turn-late'},async context=>{
 await assert.rejects(probeCodexCallbacks(probeOptions(context)),/wait for probe turn start: probe turn timed out/);
 assert.equal(context.connections.length,1);
 assert.equal(context.messages.some(m=>m.method==='thread/resume'),false);
}));

test('successful cleanup leaves no scheduled probe timeouts',async t=>withStartScenario({start:'before-response'},async context=>{
 const pending=new Set();
 const originalSet=globalThis.setTimeout,originalClear=globalThis.clearTimeout;
 t.mock.method(globalThis,'setTimeout',(callback,delay,...args)=>{
  const handle=originalSet(()=>{pending.delete(handle);callback(...args);},delay);
  pending.add(handle);
  return handle;
 });
 t.mock.method(globalThis,'clearTimeout',handle=>{
  pending.delete(handle);
  return originalClear(handle);
 });
 try{
  assert.equal((await probeCodexCallbacks(probeOptions(context))).supported,true);
  assert.equal(pending.size,0,'probe cleanup left scheduled timeouts');
 }finally{
  for(const handle of pending)originalClear(handle);
  t.mock.restoreAll();
 }
}));

test('startup time consumes the same completion budget',()=>withStartScenario({start:'late',startDelayMs:700,completionDelayMs:600},async context=>{
 await assert.rejects(probeCodexCallbacks(probeOptions(context)),/observe original callbacks: probe turn timed out/);
 assert.equal(context.connections.length,2);
 assert.equal(context.messages.filter(m=>m.method==='thread/resume').length,1);
 assert.ok(context.messages.some(m=>m.method==='thread/archive'));
}));
