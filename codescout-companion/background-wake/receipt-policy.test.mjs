import test from 'node:test';
import assert from 'node:assert/strict';
import {withStore,ownerA} from './test-support.mjs';
test('declineRecordsUnsupportedWithoutSendIntent',()=>withStore(async({transact})=>{
  const r=await transact('decline',{result:{kind:'unsupported',reason:'closed target'}});
  assert.equal(r.ok,true,r.reason);assert.equal(r.receipt.state,'unsupported');assert.equal(r.receipt.sendIntentAtMs,undefined);
}));
test('sendBudgetPersistsAcrossNewOwners',()=>withStore(async({transact})=>{
  for(let i=0;i<4;i++){
    assert.equal((await transact('claim',{ownerToken:ownerA,attemptId:String(i),leaseMs:30000})).ok,true);
    assert.equal((await transact('begin-send',{ownerToken:ownerA,attemptId:String(i)})).ok,true);
    assert.equal((await transact('evidence',{attemptId:String(i),result:{kind:'pre-send-failure'}})).ok,true);
  }
  assert.equal((await transact('claim',{ownerToken:ownerA,attemptId:'fifth',leaseMs:30000})).ok,false);
}));
