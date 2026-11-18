import test from 'node:test';
import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {once} from 'node:events';
import {writeFile,mkdir,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {withStore,ownerA,ownerB} from './test-support.mjs';
const claim=(transact,ownerToken=ownerA,attemptId='attempt-a',nowMs=1000)=>transact('claim',{ownerToken,attemptId,nowMs,leaseMs:30000});

test('oneOfTwoClaimersWins',()=>withStore(async({options,event})=>{
  const children=[fork(new URL('./receipt-claimer.fixture.mjs',import.meta.url),[],{stdio:['ignore','ignore','pipe','ipc']}),fork(new URL('./receipt-claimer.fixture.mjs',import.meta.url),[],{stdio:['ignore','ignore','pipe','ipc']})];
  try{
    const ready=await Promise.all(children.map((child)=>once(child,'message',{signal:AbortSignal.timeout(5000)})));
    assert.deepEqual(ready.map(([m])=>m.type),['ready','ready']);
    const replies=children.map((child)=>once(child,'message',{signal:AbortSignal.timeout(5000)}));
    children.forEach((child,i)=>child.send({options,command:{op:'claim',eventId:event.eventId,ownerToken:i?ownerB:ownerA,attemptId:`attempt-${i}`,nowMs:1000,leaseMs:30000}}));
    const values=(await Promise.all(replies)).map(([m])=>{assert.equal(m.type,'result',m.message);return m.result;});
    assert.equal(values.filter((r)=>r.ok).length,1);
  }finally{for(const child of children)child.kill();}
}));
test('staleTokenCannotBeginSend',()=>withStore(async({transact})=>{
  assert.equal((await claim(transact)).ok,true);
  assert.equal((await transact('recover',{nowMs:31001})).receipt.state,'pending');
  assert.equal((await claim(transact,ownerB,'attempt-b',31001)).ok,true);
  const old=await transact('begin-send',{ownerToken:ownerA,attemptId:'attempt-a',nowMs:31002});assert.equal(old.ok,false);assert.equal(old.receipt.ownerToken,ownerB);
}));
test('staleReleasePreservesSuccessor',()=>withStore(async({transact})=>{
  await claim(transact);await transact('recover',{nowMs:31001});await claim(transact,ownerB,'attempt-b',31001);
  const result=await transact('release',{ownerToken:ownerA,attemptId:'attempt-a',nowMs:31002});assert.equal(result.ok,false);assert.equal(result.receipt.ownerToken,ownerB);
}));
test('crashAfterIntentIsUnknown',()=>withStore(async({transact})=>{
  await claim(transact);const intent=await transact('begin-send',{ownerToken:ownerA,attemptId:'attempt-a',nowMs:1001});assert.equal(intent.ok,true);assert.equal(intent.receipt.state,'sending');
  const recovered=await transact('recover',{nowMs:50000});assert.equal(recovered.receipt.state,'unknown');
  assert.equal((await claim(transact,ownerB,'attempt-b',50001)).ok,false);
}));
test('recoveryBeforeIntentIsSafe',()=>withStore(async({transact})=>{
  await claim(transact);const recovered=await transact('recover',{nowMs:31001});assert.equal(recovered.ok,true);assert.equal(recovered.receipt.state,'pending');assert.equal((await claim(transact,ownerB,'attempt-b',31002)).ok,true);
}));
test('expiredOwnerCannotObtainSendPermit',()=>withStore(async({transact})=>{
  await claim(transact);assert.equal((await transact('begin-send',{ownerToken:ownerA,attemptId:'attempt-a',nowMs:31001})).ok,false);
}));
test('writeFailureReturnsNoSendPermit',()=>withStore(async({transact,platform,event})=>{
  await claim(transact);const root=await platform.privateStateRoot();const file=join(root,event.eventId.slice(6)+'.json');
  // Replace only our own receipt path with a directory to force an actual publication failure.
  const {rename}=await import('node:fs/promises');await rename(file,file+'.saved');await mkdir(file);
  const result=await transact('begin-send',{ownerToken:ownerA,attemptId:'attempt-a',nowMs:1001});assert.equal(result.ok,false);
}));
test('unknownReceiptsSurviveGc',()=>withStore(async({transact,platform})=>{
  await claim(transact);await transact('begin-send',{ownerToken:ownerA,attemptId:'attempt-a',nowMs:1001});await transact('recover',{nowMs:50000});
  const result=await transact('gc',{nowMs:1000+30*86400000});assert.equal(result.receipt.state,'unknown');assert.ok((await readdir(await platform.privateStateRoot())).some((f)=>f.endsWith('.lock')));
}));
test('evidenceIsCorrelatedAndMonotonic',()=>withStore(async({transact,event})=>{
  await claim(transact);await transact('begin-send',{ownerToken:ownerA,attemptId:'attempt-a',nowMs:1001});
  assert.equal((await transact('evidence',{attemptId:'foreign',nowMs:1002,evidence:{state:'accepted',eventId:event.eventId,attemptId:'foreign',correlation:{turnId:'x'}}})).ok,false);
  const complete=await transact('evidence',{attemptId:'attempt-a',nowMs:1002,evidence:{state:'completed',eventId:event.eventId,attemptId:'attempt-a',correlation:{turnId:'ours'}}});assert.equal(complete.receipt.state,'completed');
  const late=await transact('evidence',{attemptId:'attempt-a',nowMs:1003,evidence:{state:'accepted',eventId:event.eventId,attemptId:'attempt-a',correlation:{turnId:'ours'}}});assert.equal(late.receipt.state,'completed');
}));
test('emissionDoesNotFabricateHostAcknowledgement',()=>withStore(async({transact})=>{
  await claim(transact);await transact('begin-send',{ownerToken:ownerA,attemptId:'attempt-a',nowMs:1001});
  const result=await transact('evidence',{attemptId:'attempt-a',nowMs:1002,result:{kind:'emitted-unconfirmed',reason:'hook exit'}});assert.equal(result.receipt.state,'sending');assert.equal(result.receipt.lastEvidence.kind,'emitted-unconfirmed');
}));
