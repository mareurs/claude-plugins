import {createRequire} from 'node:module';
import {connect} from 'node:net';
import {mkdtemp,realpath,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {connectCodex,endpointIdentity} from '../codescout-companion/background-wake/adapters/codex-client.mjs';

const require=createRequire(new URL('../codescout-companion/package.json',import.meta.url));
const WebSocket=require('ws');

export function assessCallbackProbe(observed){
 const supported=observed.attached===true&&observed.turnCompleted===true&&
  Number.isSafeInteger(observed.originalTool)&&observed.originalTool>0&&
  Number.isSafeInteger(observed.originalPermission)&&observed.originalPermission>0&&
  observed.secondaryCallbacks===0&&!observed.failure;
 return {supported,reason:supported?'original tool and permission callbacks preserved after secondary attach and close':'callback preservation not established'};
}

async function primaryClient(endpoint,onMessage,timeoutMs){
 const identity=await endpointIdentity(endpoint);
 const socket=new WebSocket('ws+unix:///codescout-ipc:/',{createConnection:()=>connect(identity.path),perMessageDeflate:false,followRedirects:false,handshakeTimeout:timeoutMs,maxPayload:8388608});
 const pending=new Map();let counter=0,closed=false;
 const fail=()=>{closed=true;for(const p of pending.values()){clearTimeout(p.timer);p.reject(new Error('primary connection closed'));}pending.clear();};
 socket.on('error',fail);socket.on('close',fail);
 socket.on('message',bytes=>{
  let m;try{m=JSON.parse(bytes);}catch{fail();return;}
  if(m.id!==undefined&&!m.method){const p=pending.get(m.id);if(!p)return;pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(new Error('native request rejected: '+m.error.code)):p.resolve(m.result);return;}
  onMessage(m,(result)=>socket.send(JSON.stringify({id:m.id,result})),()=>socket.send(JSON.stringify({id:m.id,error:{code:-32601,message:'unsupported probe callback'}})));
 });
 await new Promise((ok,no)=>{socket.once('open',ok);socket.once('error',no);});
 const request=(method,params={})=>new Promise((ok,no)=>{
  if(closed||socket.readyState!==WebSocket.OPEN){no(new Error('primary connection closed'));return;}
  const id=++counter;const timer=setTimeout(()=>{pending.delete(id);no(new Error('native request timed out'));},timeoutMs);
  pending.set(id,{resolve:ok,reject:no,timer});socket.send(JSON.stringify({id,method,params}));
 });
 try{
  const server=await request('initialize',{clientInfo:{name:'codescout_wake_probe_primary',version:'1'},capabilities:{experimentalApi:true}});
  socket.send(JSON.stringify({method:'initialized'}));
  return {server,request,close(){socket.terminate();fail();}};
 }catch(e){socket.terminate();fail();throw e;}
}

/** Opt-in native model call. Creates and archives only its own probe thread. */
export async function probeCodexCallbacks({endpoint,profileRoot,expectedVersion,allowModelCall=false,model,timeoutMs=90000}){
 if(!allowModelCall)throw new Error('explicit --allow-model-call is required');
 if(!endpoint||!profileRoot||!/^\d+\.\d+\.\d+$/.test(expectedVersion||''))throw new Error('explicit endpoint, profile and expected version are required');
 if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1000||timeoutMs>120000)throw new Error('timeout must be between 1000 and 120000 ms');
 const observed={attached:false,turnCompleted:false,originalTool:0,originalPermission:0,secondaryCallbacks:0};
 let primary,secondary,threadId,turnId,notify,completionTimer,secondaryClosed=false,stage='connect primary';
 const directory=await mkdtemp(join(tmpdir(),'codex-wake-callback-probe-'));
 const started=Date.now();
 try{
  primary=await primaryClient(endpoint,(m,reply,reject)=>{
   const p=m.params||{};
   if(m.id!==undefined){
    if(p.threadId!==threadId){observed.failure='callback targeted another thread';reject();return;}
    if(m.method==='item/tool/call'&&p.tool==='wake_probe'&&secondaryClosed){observed.originalTool++;reply({contentItems:[{type:'inputText',text:'Dynamic callback observed by the primary client. Finish with DONE.'}],success:true});}
    else if(m.method==='item/commandExecution/requestApproval'&&secondaryClosed){observed.originalPermission++;reply({decision:'decline'});}
    else{observed.failure=secondaryClosed?'unexpected primary callback':'callback arrived before secondary close';reject();}
   }else if(m.method==='turn/completed'&&p.threadId===threadId){
    if(!turnId||p.turn?.id===turnId){observed.turnCompleted=p.turn?.status==='completed';notify?.();}
   }
  },Math.min(timeoutMs,10000));
  const actual=primary.server.userAgent?.match(/^codex-tui\/(\d+\.\d+\.\d+)(?:\s|$)/)?.[1];
  if(actual!==expectedVersion)throw new Error('observed daemon version differs from expected version');
  if(await realpath(primary.server.codexHome)!==await realpath(profileRoot))throw new Error('endpoint belongs to another profile');
  stage='create probe thread';
  const thread=await primary.request('thread/start',{
   cwd:directory,approvalPolicy:'on-request',approvalsReviewer:'user',sandbox:'read-only',...(model?{model}:{}),
   config:{'features.hooks':false,model_reasoning_effort:'low'},
   baseInstructions:'You are running a bounded callback-routing test in an empty temporary directory. Do not read files, use network, spawn subagents, or modify anything. Follow the requested two tool calls exactly.',
   developerInstructions:'First call exec_command with cmd="printf wake-probe", sandbox_permissions="require_escalated", justification="Callback-routing probe". This harmless command must request host approval; do not execute without escalation or retry a denial. Only after the host denies that command, call wake_probe once with {}. Then answer DONE. Do not answer DONE before both required tool calls. If exec_command is unavailable, answer UNAVAILABLE and stop.',
   dynamicTools:[{type:'function',name:'wake_probe',description:'Required first callback in the compatibility probe.',inputSchema:{type:'object',properties:{},additionalProperties:false}}],
  });
  threadId=thread.thread?.id;if(!threadId)throw new Error('probe thread was not created');
  const completion=new Promise((ok,no)=>{completionTimer=setTimeout(()=>no(new Error('probe turn timed out')),Math.max(1,timeoutMs-(Date.now()-started)));notify=ok;});
  completion.catch(()=>{});
  // A newly created thread has no resumable rollout until its first turn starts.
  stage='start the single probe turn';
  const turn=await primary.request('turn/start',{threadId,input:[{type:'text',text:'Run exactly these steps: (1) exec_command with cmd=printf wake-probe and sandbox_permissions=require_escalated, justification=Callback-routing probe; (2) after host denial, wake_probe({}); (3) DONE. Do not skip the actual approval request. Do not substitute the dynamic tool for the shell command. No other work.'}]});
  turnId=turn.turn?.id;if(!turnId)throw new Error('probe turn was not accepted');
  stage='attach secondary';
  secondary=await connectCodex({endpoint,clientInfo:{name:'codescout_wake_probe_secondary',version:'1'}});
  secondary.onClose(reason=>{if(reason.includes('primary-client callback')){observed.secondaryCallbacks++;observed.failure='callback routed to secondary';}});
  await secondary.subscribeThread(threadId,()=>{});observed.attached=true;
  await secondary.close();secondaryClosed=true;secondary=null;
  stage='observe original callbacks';
  if(observed.turnCompleted)notify();
  await completion;
  return {version:1,synthetic:false,captureKind:'native-protocol-summary',daemonVersion:actual,subscription:'resume-loaded',callbacksAfterSecondaryClose:observed,...assessCallbackProbe(observed),limitations:['native root/child hook envelopes and automatic wake delivery are separate checks']};
 }catch(e){throw new Error(`${stage}: ${e.message}`,{cause:e});}
 finally{
  clearTimeout(completionTimer);
  await secondary?.close();
  if(threadId&&primary){
   if(turnId&&!observed.turnCompleted)await primary.request('turn/interrupt',{threadId,turnId}).catch(()=>{});
   await primary.request('thread/archive',{threadId}).catch(()=>{observed.cleanupFailed=true;});
  }
  primary?.close();await rm(directory,{recursive:true,force:true});
  if(observed.cleanupFailed)throw new Error('probe thread archive cleanup failed; compatibility proof is incomplete');
 }
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2);
 if(args.includes('--help'))console.log('Usage: node tools/probe-codex-wake-callbacks.mjs --endpoint unix:///... --profile /... --expected-version X.Y.Z --allow-model-call [--timeout-ms 90000] [--model MODEL]');
 else{
  const options={};let invalid=false;
  for(let i=0;i<args.length;i++){
   if(args[i]==='--allow-model-call'){options.allowModelCall=true;continue;}
   const key={'--endpoint':'endpoint','--profile':'profileRoot','--expected-version':'expectedVersion','--timeout-ms':'timeoutMs','--model':'model'}[args[i]];
   if(!key||!args[i+1]){invalid=true;break;}options[key]=key==='timeoutMs'?Number(args[++i]):args[++i];
  }
  if(invalid){console.error('Invalid probe options; use --help');process.exitCode=2;}
  else probeCodexCallbacks(options).then(result=>{console.log(JSON.stringify(result,null,2));process.exitCode=result.supported?0:1;}).catch(e=>{console.error('Native callback probe failed; no compatibility evidence established. '+e.message);process.exitCode=1;});
 }
}
