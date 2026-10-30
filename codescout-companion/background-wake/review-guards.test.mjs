import test from 'node:test';
import assert from 'node:assert/strict';
import {withStore,ownerA} from './test-support.mjs';
import {selectEngine} from './intake.mjs';
test('liveClaimCannotBeRecoveredByAnotherObserver',()=>withStore(async({transact})=>{
 await transact('claim',{ownerToken:ownerA,attemptId:'a',leaseMs:30000});
 const r=await transact('recover',{nowMs:1001});
 assert.equal(r.ok,false);assert.equal(r.receipt.state,'claimed');assert.equal(r.receipt.ownerToken,ownerA);
 assert.equal((await transact('begin-send',{ownerToken:ownerA,attemptId:'a',nowMs:1002})).ok,true);
}));
test('hostEvidenceRequiresPersistedSendIntent',()=>withStore(async({transact,event})=>{
 await transact('claim',{ownerToken:ownerA,attemptId:'a',leaseMs:30000});
 const r=await transact('evidence',{attemptId:'a',evidence:{state:'accepted',eventId:event.eventId,attemptId:'a',correlation:{turnId:'ours'}}});
 assert.equal(r.ok,false);assert.equal(r.receipt.state,'claimed');
}));
test('oneRecordCannotTransferToAnotherTarget',()=>withStore(async({event})=>{
 assert.equal(await selectEngine(event.job.recordPath,'v1',event.target),true);
 assert.equal(await selectEngine(event.job.recordPath,'v1',{...event.target,sessionId:'another-session'}),false);
 assert.equal(await selectEngine(event.job.recordPath,'v1',event.target),true);
}));
