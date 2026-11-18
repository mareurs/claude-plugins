import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {withStore} from './test-support.mjs';
import {createPlatform} from './platform-node.mjs';
test('installedPathIsNotAnotherProfilesState',()=>withStore(async({platform,profileRoot})=>{
 const other=join(profileRoot,'other-profile');await mkdir(other);
 // Disable only the test override here so this exercises an explicitly shared configured directory.
 const saved=process.env.CS_TEST_STATE_SANDBOX;delete process.env.CS_TEST_STATE_SANDBOX;
 try{
  const own=createPlatform({profileRoot,stateDir:join(profileRoot,'shared-state')});await own.privateStateRoot();
  const foreign=createPlatform({profileRoot:other,stateDir:own.stateDir});
  await assert.rejects(foreign.privateStateRoot(),/another profile/);
 }finally{if(saved!==undefined)process.env.CS_TEST_STATE_SANDBOX=saved;}
}));
