import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {withStore,ownerA} from './test-support.mjs';

test('recomputedIdentityRejectsForgedEnsure',()=>withStore(async({transact,event})=>{
  const changed=structuredClone(event);changed.target.sessionId='foreign';
  assert.equal((await transact('ensure',{event:changed})).ok,false);
}));
test('foreignEventEvidenceIsRejected',()=>withStore(async({transact,event})=>{
  await transact('claim',{ownerToken:ownerA,attemptId:'a',leaseMs:30000});
  await transact('begin-send',{ownerToken:ownerA,attemptId:'a'});
  const result=await transact('evidence',{attemptId:'a',evidence:{state:'accepted',eventId:'wake1:'+'0'.repeat(64),attemptId:'a',correlation:{turnId:'foreign'}}});
  assert.equal(result.ok,false);assert.equal(result.receipt.state,'sending');
}));
test('expiredRenewalCannotResurrectOwnership',()=>withStore(async({transact})=>{
  await transact('claim',{ownerToken:ownerA,attemptId:'a',leaseMs:10});
  assert.equal((await transact('renew',{ownerToken:ownerA,attemptId:'a',nowMs:1011,leaseMs:30000})).ok,false);
}));
test('correctTokenWrongAttemptCannotSend',()=>withStore(async({transact})=>{
  await transact('claim',{ownerToken:ownerA,attemptId:'a',leaseMs:30000});
  assert.equal((await transact('begin-send',{ownerToken:ownerA,attemptId:'b'})).ok,false);
}));
test('storedTargetCorruptionCannotObtainPermit',()=>withStore(async({transact,event,platform})=>{
  const path=join(platform.stateDir,event.eventId.slice(6)+'.json');
  const record=JSON.parse(await readFile(path,'utf8'));record.event.target.sessionId='DIFFERENT-CONVERSATION';
  await writeFile(path,JSON.stringify(record));
  assert.equal((await transact('claim',{ownerToken:ownerA,attemptId:'a',leaseMs:30000})).ok,false);
}));
