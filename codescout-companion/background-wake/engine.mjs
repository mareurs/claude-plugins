import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {eventId,jobKey,validateWatchRequest} from './model.mjs';
import {readCurrentWatch} from './watch-map.mjs';

export const defaultPolicy=Object.freeze({pollMs:1000,recordGraceMs:5000,deadlineMs:1800000,leaseMs:30000,renewMs:10000,retryDelaysMs:[1000,2000,4000]});
const realClock={now:()=>Date.now(),sleep:(ms,signal)=>delay(ms,undefined,{signal})};
const resultOf=(tx)=>({state:tx.receipt?.state||'failed',eventId:tx.receipt?.event.eventId,reason:tx.reason});

/** The store alone grants send permits; the adapter alone supplies host evidence. */
export async function runWatch(input,{store,platform,adapter,clock=realClock,signal,policy={}}){
  const request=validateWatchRequest(input);
  const p={...defaultPolicy,...policy};
  if(![p.pollMs,p.leaseMs,p.renewMs,p.deadlineMs].every(n=>Number.isSafeInteger(n)&&n>0)||p.deadlineMs>7000000||p.renewMs>=p.leaseMs)throw new Error('invalid watcher policy');
  const started=clock.now();
  let absentSince;
  const tx=(event,op,fields={})=>store.transact({op,eventId:event.eventId,nowMs:clock.now(),...fields});
  try{
    const known=await tx({eventId:eventId(request.job,request.target,'terminal',0)},'inspect');
    if(!known.ok&&known.reason!=='receipt missing')return resultOf(known);
    const restored=known.ok?known.receipt.event:null;
    let kind=restored?.kind,payload=restored?.payload,sequence=restored?.sequence??0;
    while(!restored&&!signal?.aborted){
      const observation=await platform.readRecord(request.job.recordPath);
      if(observation.kind==='available'){
        absentSince=undefined;
        const r=observation.record;
        if(r.schema!==1||r.server_pid!==request.job.serverPid||r.handle!==request.job.handle){kind='tracking-lost';payload={reason:'server generation differs'};break;}
        if(r.state==='exited'||r.state==='failed'){
          if(r.state==='exited'&&r.exit_code!==null&&!Number.isSafeInteger(r.exit_code))return {state:'unsupported',reason:'invalid job exit code'};
          const durationMs=Date.parse(r.finished_at)-Date.parse(r.started_at);
          kind='terminal';payload={state:r.state,exitCode:r.exit_code,durationMs:Number.isFinite(durationMs)&&durationMs>=0?durationMs:null};break;
        }
        if(r.state!=='running')return {state:'unsupported',reason:'unsupported job state'};
        const active=await readCurrentWatch(request.target,request.job.handle,platform);
        if(active&&jobKey(active.job)!==jobKey(request.job)){kind='tracking-lost';payload={reason:'origin handle now belongs to another server generation'};break;}
        if(await platform.processStatus(request.job)==='dead'){kind='tracking-lost';payload={reason:'originating server exited'};break;}
        if(clock.now()-started>=p.deadlineMs){
          kind='heartbeat';
          const epoch=Date.parse(r.started_at);
          if(!Number.isFinite(epoch))return {state:'unsupported',reason:'running record has no stable start time'};
          sequence=Math.max(1,Math.floor((clock.now()-epoch)/p.deadlineMs));
          payload={state:'running'};break;
        }
      }else if(observation.kind==='missing'||observation.kind==='error'){
        absentSince??=clock.now();
        if(clock.now()-absentSince>=p.recordGraceMs){kind='tracking-lost';payload={reason:'record unavailable after grace'};break;}
      }else return {state:'unsupported',reason:observation.reason};
      await clock.sleep(p.pollMs,signal);
    }
    if(signal?.aborted)return {state:'pending',reason:'watch cancelled before send'};
    const event={version:1,eventId:eventId(request.job,request.target,kind,sequence),kind,sequence,job:request.job,target:request.target,payload};
    let current=await tx(event,'ensure',{event});
    if(!current.ok)return resultOf(current);
    // Use the persisted event; subsequent observations cannot replace its outcome.
    const persisted=current.receipt.event;
    for(let retry=0;retry<=p.retryDelaysMs.length;retry++){
      if(current.receipt.state==='claimed'||current.receipt.state==='sending'){
        const recovered=await tx(event,'recover');
        if(!recovered.ok)return resultOf(current);
        current=recovered;
      }
      if(!['pending','failed'].includes(current.receipt.state)||current.receipt.state==='failed'&&!current.receipt.lastError?.safeRetry)return resultOf(current);
      const capability=await adapter.capability(request);
      const target=capability.supported?await adapter.validateTarget(request):capability;
      if(!target.supported)return resultOf(await tx(event,'decline',{result:{kind:'unsupported',reason:target.reason}}));
      const observation=await platform.readRecord(request.job.recordPath);
      const active=await readCurrentWatch(request.target,request.job.handle,platform);
      const r=observation.record;
      const handleValid=observation.kind==='available'&&r.schema===1&&r.server_pid===request.job.serverPid&&r.handle===request.job.handle&&await platform.processStatus(request.job)!=='dead'&&Boolean(active)&&jobKey(active.job)===jobKey(request.job);
      const ownerToken=randomUUID(),attemptId=randomUUID();
      current=await tx(event,'claim',{ownerToken,attemptId,leaseMs:p.leaseMs});
      if(!current.ok)return resultOf(current);
      current=await tx(event,'begin-send',{ownerToken,attemptId});
      if(!current.ok||current.receipt?.state!=='sending')return resultOf(current);
      let evidenceQueue=Promise.resolve(),evidenceFailure;
      const observe=(evidence)=>{
        const operation=evidenceQueue.then(async()=>{
          const update=await tx(event,'evidence',{attemptId,evidence});
          if(update.ok)current=update;
          else evidenceFailure=update.reason;
        });
        evidenceQueue=operation.catch(e=>{evidenceFailure=e.message;});
        return evidenceQueue;
      };
      let outcome;
      try{outcome=await adapter.deliver({...persisted,attemptId,handleValid},observe,signal);}
      catch(e){outcome={kind:'unknown',reason:e.message||'transport ended after send intent'};}
      await evidenceQueue;
      if(current.receipt.state==='sending'){
        if(!outcome||outcome.kind==='finished')outcome={kind:'unknown',reason:evidenceFailure||'delivery ended without correlated evidence'};
        const update=await tx(event,'evidence',{attemptId,result:outcome});
        if(!update.ok)return {state:'unknown',eventId:event.eventId,reason:update.reason};
        current=update;
      }
      if(current.receipt.state!=='failed'||!current.receipt.lastError?.safeRetry)return resultOf(current);
      if(retry<p.retryDelaysMs.length)await clock.sleep(p.retryDelaysMs[retry],signal);
    }
    return resultOf(await tx(event,'decline',{result:{kind:'failed',reason:'persistent send budget exhausted'}}));
  }finally{await adapter.close();}
}
