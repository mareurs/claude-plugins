import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {withStore} from './test-support.mjs';
import {registerWatch,watchMapKey,readCurrentWatch} from './watch-map.mjs';
test('watchRegistrationHonorsAnAlreadyHeldNativeLock',()=>withStore(async({event,platform,options})=>{
 const lock=join(platform.stateDir,'map-'+watchMapKey(event.target,event.job.handle)+'.lock');
 const child=spawn(options.pythonArgv[0],[...options.pythonArgv.slice(1),'-X','utf8','-I',fileURLToPath(new URL('./lock-holder.fixture.py',import.meta.url)),lock],{stdio:['pipe','pipe','pipe']});
 const timer=setTimeout(()=>child.kill(),8000);
 try{
  const [ready]=await once(child.stdout,'data');assert.match(String(ready),/LOCKED/);
  const request={version:1,sourceEventId:'lock-probe',job:event.job,target:event.target};
  const blocked=await registerWatch(request,platform);assert.equal(blocked.ok,false,blocked.reason);
  assert.equal(await readCurrentWatch(event.target,event.job.handle,platform),null);
  const exited=once(child,'exit');child.stdin.end('\n');await exited;
  assert.equal((await registerWatch(request,platform)).ok,true);
 }finally{clearTimeout(timer);child.kill();}
}));
