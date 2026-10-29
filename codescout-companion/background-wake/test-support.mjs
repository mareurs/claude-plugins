import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {eventId} from './model.mjs';
export const ownerA='a'.repeat(32),ownerB='b'.repeat(32);
export async function withStore(fn,{ensure=true}={}){
  const {createPlatform}=await import('./platform-node.mjs');
  const {createReceiptStore}=await import('./receipt-store.mjs');
  const profileRoot=await mkdtemp(join(tmpdir(),'wake profile-γ-'));
  try{
    const options={profileRoot,stateDir:join(profileRoot,'private state'),pythonArgv:[process.platform==='win32'?'python':'python3']};
    const platform=createPlatform(options);const store=createReceiptStore({platform,clock:{now:()=>1000}});
    const job={recordPath:join(profileRoot,'4242-a1b2c3d4-bg_00000001.json'),schema:1,serverPid:4242,serverToken:'a1b2c3d4',handle:'@bg_00000001'};
    const target={harness:'codex',profileRoot,hostInstanceId:'daemon',environmentId:process.platform,sessionId:'session',runtimeGeneration:'runtime',origin:'root'};
    const event={version:1,eventId:eventId(job,target,'terminal',0),kind:'terminal',sequence:0,job,target,payload:{state:'exited',exitCode:0}};
    const transact=(op,fields={})=>store.transact({op,eventId:event.eventId,nowMs:1000,...fields});
    if(ensure){const result=await transact('ensure',{event});assert.equal(result.ok,true,result.reason);}
    await fn({options,platform,store,event,transact,profileRoot});
  }finally{await rm(profileRoot,{recursive:true,force:true});}
}
