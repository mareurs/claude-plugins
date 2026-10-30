import test from 'node:test';
import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {withStore} from './test-support.mjs';
import {readCurrentWatch,watchMapKey} from './watch-map.mjs';

test('concurrentGenerationsRetainBothRegistrationsAndOneCurrentIndex',()=>withStore(async({event,platform,options,profileRoot})=>{
 const first={version:1,sourceEventId:'a',job:event.job,target:event.target};
 const second={...first,sourceEventId:'b',job:{...event.job,recordPath:join(profileRoot,'4243-b1b2c3d4-bg_00000001.json'),serverPid:4243,serverToken:'b1b2c3d4'}};
 const children=[first,second].map(request=>{
  const child=fork(fileURLToPath(new URL('./map-register.fixture.mjs',import.meta.url)),[],{stdio:['ignore','ignore','pipe','ipc']});
  let readyResolve,doneResolve,doneReject;const ready=new Promise(r=>readyResolve=r),done=new Promise((r,j)=>{doneResolve=r;doneReject=j;});
  let error='';child.stderr.on('data',b=>error+=b);
  child.on('message',m=>{if(m.kind==='ready')readyResolve();if(m.kind==='done')doneResolve(m.result);});
  child.on('error',doneReject);child.on('exit',code=>{if(code)doneReject(Error(error||'register child failed'));});
  return {child,ready,done,request};
 });
 const timer=setTimeout(()=>children.forEach(({child})=>child.kill()),12000);
 try{
  await Promise.all(children.map(c=>c.ready));
  children.forEach(c=>c.child.send({kind:'go',options,request:c.request}));
  const results=await Promise.all(children.map(c=>c.done));assert.ok(results.every(r=>r.ok),JSON.stringify(results));
  const index=await platform.readStateJson('map-'+watchMapKey(event.target,event.job.handle)+'.json');
  assert.equal(index.retired.length,1);
  const current=await readCurrentWatch(event.target,event.job.handle,platform);
  assert.ok([first.job.recordPath,second.job.recordPath].includes(current.job.recordPath));
 }finally{clearTimeout(timer);children.forEach(({child})=>child.kill());}
}));
