import test from 'node:test';
import assert from 'node:assert/strict';
import {withStore,ownerA,ownerB} from './test-support.mjs';
test('publicAttemptIdNeverSubstitutesForOwnerToken',()=>withStore(async({transact})=>{
  await transact('claim',{ownerToken:ownerA,attemptId:'attempt-a',leaseMs:30000});
  await transact('recover',{nowMs:31001});
  await transact('claim',{ownerToken:ownerB,attemptId:'attempt-b',leaseMs:30000,nowMs:31002});
  const denied=await transact('begin-send',{ownerToken:ownerA,attemptId:'attempt-b',nowMs:31003});
  assert.equal(denied.ok,false);
  assert.equal(denied.receipt.ownerToken,ownerB);
}));
