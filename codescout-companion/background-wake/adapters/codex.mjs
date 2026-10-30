import {realpath} from 'node:fs/promises';
import {normalizeNativeWatch} from '../intake.mjs';
import {formatDeliveryEvent} from '../model.mjs';
import {connectCodex,endpointIdentity} from './codex-client.mjs';
export const normalizeCodexWatch=(raw,config,platform)=>normalizeNativeWatch('codex',raw,config,platform);
const denied=(reason)=>({supported:false,reason,evidenceRef:null});
const allowed={supported:true,reason:'measured existing-thread secondary attach',evidenceRef:'codex-linux-0.160.0-callback-probe'};

/** Exact profile/socket generation and loaded thread only; no dormant-thread resume. */
export function createCodexAdapter(config,{completionTimeoutMs=15000}={}){
  let client,unsubscribe,stopWait,subscribed;
  let notifications=[];
  const capability=async()=>{
    try{
      if(config.engine!=='v1'||!config.adapters?.codex?.enabled)return denied('Codex wake is disabled for this profile');
      const proof=config.capabilities?.codex;
      if(proof?.daemonVersion!=='0.160.0'||proof?.subscription!=='resume-loaded'||proof?.callbackPreserved!==true)return denied('Codex secondary callback preservation is unverified for this version/profile');
      const identity=await endpointIdentity(config.adapters.codex.endpoint),binding=config.bindings?.codex;
      if(binding?.hostInstanceId!==identity.generation||binding?.runtimeGeneration!==identity.generation)return denied('configured daemon generation differs from endpoint');
      client??=await connectCodex({endpoint:config.adapters.codex.endpoint,clientInfo:{name:'codescout_background_wake',version:'1'},maxPayload:config.adapters.codex.maxPayloadBytes});
      if(await realpath(client.server.codexHome)!==await realpath(config.profileRoot))return denied('endpoint belongs to another Codex profile');
      if(!/^codex-tui\/0\.160\.0(?:\s|$)/.test(client.server.userAgent))return denied('daemon version lacks measured callback preservation');
      return allowed;
    }catch(e){return denied(e.message);}
  };
  const validateTarget=async(request)=>{
    const binding=config.bindings?.codex,target=request?.target;
    const expected={harness:'codex',profileRoot:config.profileRoot,environmentId:config.environmentId,hostInstanceId:binding?.hostInstanceId,runtimeGeneration:binding?.runtimeGeneration,origin:'root'};
    if(!target||Object.entries(expected).some(([key,value])=>typeof value!=='string'||target[key]!==value))return denied('event target differs from the verified profile/environment/runtime binding');
    const capabilityResult=await capability();if(!capabilityResult.supported)return capabilityResult;
    try{
      const id=request?.target?.sessionId;if(!id)return denied('exact existing thread required');
      const loaded=await client.request('thread/loaded/list',{});
      if(!loaded.data?.includes(id))return denied('target thread is not loaded');
      const read=await client.request('thread/read',{threadId:id,includeTurns:false});
      if(read.thread?.id!==id||read.thread.status?.type==='notLoaded')return denied('target thread is closed');
      if(subscribed!==id){
        unsubscribe?.();notifications=[];
        unsubscribe=await client.subscribeThread(id,m=>{if(notifications.length>=512){stopWait?.('notification budget exceeded');return;}notifications.push(m);stopWait?.();});
        subscribed=id;
      }
      return allowed;
    }catch(e){return denied(e.message);}
  };
  return {
    capability,validateTarget,
    async deliver(event,onEvidence,signal){
      const target=await validateTarget({target:event.target});
      if(!target.supported)return {kind:'pre-send-failure',reason:target.reason};
      const threadId=event.target.sessionId;
      let reply;
      try{reply=await client.request('turn/start',{threadId,input:[],toolOutput:{name:'codescout_background_job',output:formatDeliveryEvent(event)}});}
      catch(e){return {kind:'unknown',reason:e.message};}
      const turnId=reply.turn?.id;
      if(!turnId)return {kind:'unknown',reason:'turn acceptance did not identify a turn'};
      const correlation={threadId,turnId};
      await onEvidence({state:'accepted',eventId:event.eventId,attemptId:event.attemptId,correlation});
      let observed=false,completed=false,index=0,queue=Promise.resolve();
      const inspect=async()=>{
        for(;index<notifications.length;index++){
          const m=notifications[index],p=m.params||{};
          if(p.threadId!==threadId)continue;
          if(m.method==='item/completed'&&p.turnId===turnId&&p.item?.type==='functionCallOutput'&&p.item.name==='codescout_background_job'&&typeof p.item.output==='string'&&p.item.output.includes('Event '+event.eventId+'.')){
            if(!observed){observed=true;await onEvidence({state:'continuation_observed',eventId:event.eventId,attemptId:event.attemptId,correlation:{...correlation,itemId:p.item.id}});}
          }
          if(m.method==='turn/completed'&&p.turn?.id===turnId&&p.turn.status==='completed')completed=true;
        }
        if(observed&&completed){await onEvidence({state:'completed',eventId:event.eventId,attemptId:event.attemptId,correlation});return true;}
        return false;
      };
      return new Promise(resolve=>{
        let ended=false;
        const finish=(kind,reason)=>{if(ended)return;ended=true;clearTimeout(timer);removeClose();signal?.removeEventListener('abort',abort);stopWait=undefined;resolve({kind,reason});};
        const abort=()=>finish('unknown','delivery observation cancelled after acceptance');
        const removeClose=client.onClose(reason=>finish('unknown',reason));
        const timer=setTimeout(()=>finish('unknown','accepted; correlated completion was not observed'),completionTimeoutMs);
        stopWait=(reason)=>{
          if(reason){finish('unknown',reason);return;}
          queue=queue.then(async()=>{if(!ended&&await inspect())finish('finished','correlated output item and turn completed');}).catch(e=>finish('unknown',e.message));
        };
        signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();else stopWait();
      });
    },
    async close(){stopWait?.('secondary client closed');unsubscribe?.();await client?.close();},
  };
}
