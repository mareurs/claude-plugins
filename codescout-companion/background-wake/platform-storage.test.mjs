import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
import {join} from 'node:path';
import {withStore} from './test-support.mjs';
test('filesystemProbeChecksResolvedReceiptStorage',()=>withStore(async({platform})=>{
  const original=fs.statfs;const seen=[];
  fs.statfs=async(path)=>{seen.push(path);return {type:path===platform.stateDir?0x6969:0xef53};};
  syncBuiltinESMExports();
  try{
    const {createPlatform}=await import('./platform-node.mjs');
    const p=createPlatform({profileRoot:platform.profileRoot,stateDir:platform.stateDir});
    await assert.rejects(p.privateStateRoot(),/network filesystem/);
    assert.ok(seen.includes(platform.stateDir));
  }finally{fs.statfs=original;syncBuiltinESMExports();}
}));
