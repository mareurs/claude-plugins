#!/usr/bin/env node
import {readFile,readdir,writeFile,rename} from 'node:fs/promises';
import {join,resolve,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {loadWakeConfig} from './config.mjs';
import {createPlatform} from './platform-node.mjs';
import {createReceiptStore} from './receipt-store.mjs';
import {runWatch} from './engine.mjs';

async function readStdin(){
  let input='';
  for await(const chunk of process.stdin){input+=chunk;if(input.length>1024*1024)throw new Error('native hook input exceeds budget');}
  return input;
}

export function parseArgs(argv){
  const [command,...rest]=argv,options={};
  for(let i=0;i<rest.length;i++){
    const key=rest[i];
    if(key==='--legacy-intake-disabled'){options[key]=true;continue;}
    if(!['--profile','--environment','--event','--note','--harness'].includes(key)||!rest[i+1]||rest[i+1].startsWith('--'))throw new Error('unknown or incomplete CLI argument');
    if(options[key]!==undefined)throw new Error('duplicate CLI argument');
    options[key]=rest[++i];
  }
  if(!options['--profile']||!isAbsolute(options['--profile'])||!options['--environment'])throw new Error('explicit absolute --profile and --environment are required');
  return {command,options};
}
export function summarizeReceipt(receipt){
  if(!receipt)return null;
  const c=receipt.lastEvidence?.correlation;
  return {eventId:receipt.event.eventId,job:receipt.event.job,target:receipt.event.target,owner:receipt.ownerToken??null,attemptId:receipt.attemptId??null,state:receipt.state,sendAttempts:receipt.sendAttempts??0,evidence:receipt.lastEvidence?{kind:receipt.lastEvidence.kind??receipt.lastEvidence.state,correlation:c?Object.fromEntries(['threadId','turnId','itemId'].filter(k=>typeof c[k]==='string').map(k=>[k,c[k]])):null}:null,operatorDecision:receipt.operatorDecision?{kind:receipt.operatorDecision.kind,atMs:receipt.operatorDecision.atMs}:null};
}
async function activate(config,platform,options){
  if(!options['--legacy-intake-disabled']||!isAbsolute(config.migration?.legacyStateDir||''))return {ok:false,reason:'disable legacy intake and configure the explicit legacy mapping directory before activation'};
  const directory=config.migration.legacyStateDir;
  let entries;try{entries=await readdir(directory);}catch{return {ok:false,reason:'legacy mapping directory could not be inspected'};}
  for(const entry of entries.filter(f=>f.startsWith('map-'))){
    try{
      const record=(await readFile(join(directory,entry),'utf8')).trim();
      const pid=Number((await readFile(record+'.watch','utf8')).trim());
      if(await platform.processStatus({pid})!=='dead')return {ok:false,reason:'legacy watcher remains live or unverified; activation refused'};
    }catch(e){if(e.code!=='ENOENT')return {ok:false,reason:'legacy watcher state is unreadable'};}
  }
  await platform.privateStateRoot();
  const output={...config,engine:'v1'},path=join(config.profileRoot,'codescout-wake.json');
  const temp=path+'.'+randomUUID()+'.tmp';await writeFile(temp,JSON.stringify(output,null,2)+'\n',{flag:'wx',mode:0o600});await rename(temp,path);
  return {ok:true,engine:'v1',reason:'legacy intake explicitly disabled; mapped watchers drained; old ownership remains immutable'};
}
async function launchWatcher(raw,options,platform){
  const args=[fileURLToPath(import.meta.url),'watch','--harness','codex','--profile',options['--profile'],'--environment',options['--environment']];
  const child=platform.spawnArgv(process.execPath,args,{detached:true,stdio:['pipe','ignore','ignore']});
  child.stdin.on('error',()=>{});
  await new Promise((done,reject)=>{child.once('spawn',done);child.once('error',reject);});
  await new Promise((done,reject)=>{child.stdin.once('error',reject);child.stdin.end(JSON.stringify(raw),done);});
  child.stdin.destroy();child.unref();
  return {ok:true,state:'watch-launched',reason:'secondary watcher launched; delivery evidence will be recorded separately'};
}

export async function runCli(argv,{input}={}){
  const {command,options}=parseArgs(argv);
  const config=await loadWakeConfig({profileRoot:options['--profile'],environmentId:options['--environment']});
  const platform=createPlatform(config),store=createReceiptStore({platform,clock:{now:()=>Date.now()}});
  if(command==='activate')return activate(config,platform,options);
  if(command==='watch'||command==='launch'){
    if(options['--harness']!=='codex')throw new Error('CLI watch currently accepts only explicit --harness codex');
    if(config.engine!=='v1'||!config.adapters.codex.enabled)return {ok:false,state:'unsupported',reason:'Codex wake disabled for this profile'};
    const {normalizeCodexWatch,createCodexAdapter}=await import('./adapters/codex.mjs');
    const raw=JSON.parse(input??await readStdin());
    if(command==='launch'){
      const adapter=createCodexAdapter(config);
      try{const capability=await adapter.capability();if(!capability.supported)return {ok:false,state:'unsupported',reason:capability.reason};}
      finally{await adapter.close();}
    }
    const request=await normalizeCodexWatch(raw,config,platform);
    if(!request)return {ok:false,state:'unsupported',reason:'native event cannot register a verified root target'};
    if(command==='launch')return launchWatcher(raw,options,platform);
    return {ok:true,...await runWatch(request,{platform,store,adapter:createCodexAdapter(config)})};
  }
  const eventId=options['--event'];
  if(eventId&&!/^wake1:[a-f0-9]{64}$/.test(eventId))throw new Error('invalid --event identity');
  if(command==='doctor'){
    let storage;try{await platform.privateStateRoot();storage={ready:true,reason:'private native receipt storage available'};}catch{storage={ready:false,reason:'native receipt storage unavailable; no send permit'};}
    let codex={supported:false,reason:'Codex disabled for this profile'};
    if(config.adapters.codex.enabled){const {createCodexAdapter}=await import('./adapters/codex.mjs');const adapter=createCodexAdapter(config);try{codex=await adapter.capability();}finally{await adapter.close();}}
    const observation=eventId?await store.transact({op:'inspect',eventId}):null;
    return {ok:true,engine:config.engine,profileRoot:config.profileRoot,environmentId:config.environmentId,storage,capabilities:{claudeCode:{supported:config.adapters.claudeCode.enabled&&(config.engine==='legacy'||process.platform==='linux'),reason:config.engine==='legacy'?'legacy registration; v1 not selected':'stderr emission only; acceptance unobservable; complete native parity unverified'},codex},receipt:summarizeReceipt(observation?.receipt),retention:'stable identities and persistent locks retained; GC does not erase unresolved or completed IDs'};
  }
  if(!eventId)throw new Error('this command requires an explicit --event identity');
  if(!['reconcile','recover-pre-send','acknowledge','gc'].includes(command))throw new Error('unsupported CLI command; no generic resend exists');
  const op=command==='reconcile'?'inspect':command;
  const result=await store.transact({op,eventId,...(command==='acknowledge'?{note:options['--note']}: {})});
  return {ok:result.ok,reason:command==='reconcile'&&result.ok?'observed only; no new correlated host evidence, state unchanged':result.reason,receipt:summarizeReceipt(result.receipt)};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  runCli(process.argv.slice(2)).then(result=>{
    const hookLaunch=process.argv[2]==='launch';
    // PostToolUse owns stdout: diagnostics JSON is not a hook response.
    if(!hookLaunch)process.stdout.write(JSON.stringify(result)+'\n');
    process.exitCode=hookLaunch&&result.state==='unsupported'?0:result.ok===false?1:0;
  }).catch(()=>{process.stderr.write('background-wake: command failed; verify explicit profile, environment and configuration with doctor\n');process.exitCode=1;});
}
