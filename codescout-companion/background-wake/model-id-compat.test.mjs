import test from 'node:test';
import assert from 'node:assert/strict';
import { jobKey, bindingKey, eventId } from './model.mjs';

// Protocol vectors were calculated independently with Python hashlib over literal
// ordered JSON arrays. These IDs are persisted in receipts and host messages.
const job={recordPath:'/probe/records/4242-a1b2c3d4-bg_00000001.json',schema:1,serverPid:4242,serverToken:'a1b2c3d4',handle:'@bg_00000001'};
const target={harness:'codex',profileRoot:'/probe/profile',hostInstanceId:'daemon-1',environmentId:'linux:local',sessionId:'session-1',runtimeGeneration:'generation-1',origin:'root'};
test('persistedVersionOneIdsRemainCompatible',()=>{
  assert.equal(jobKey(job),'e59eb501a57b01d1bae10830d9a9e9a30df9d43ed81862be40cd48fc06a1c554');
  assert.equal(bindingKey(target),'c379c3f0ff013a724916d9718bdf38caf780280cbceb9d0da2c7216d7ccbc478');
  assert.equal(eventId(job,target,'terminal',0),'wake1:023f369b15e9c408fb12bcd0a3d8a36135863fb94657b0fd1794ca192cd1f3ea');
});
