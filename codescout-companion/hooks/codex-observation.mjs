import {spawn as nativeSpawn,execFileSync} from 'node:child_process';
import {realpathSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {normalizeHookObservation} from './observation-contract.mjs';

const RAW_LIMIT=4*1024*1024, RECORD_LIMIT=64*1024, INPUT_TIMEOUT_MS=750, CHILD_TIMEOUT_MS=1500;
function readInput(stream){
 return new Promise(resolve=>{
  let size=0,finished=false;const chunks=[];
  const finish=value=>{if(finished)return;finished=true;clearTimeout(timer);stream.off('data',data);stream.off('end',end);stream.off('error',error);stream.pause();resolve(value);};
  const data=chunk=>{const b=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);size+=b.length;if(size>RAW_LIMIT)finish(null);else chunks.push(b);};
  const end=()=>finish(Buffer.concat(chunks)),error=()=>finish(null);
  const timer=setTimeout(()=>finish(null),INPUT_TIMEOUT_MS);
  stream.on('data',data);stream.once('end',end);stream.once('error',error);
 });
}
function ingest(spawn,codescoutPath,workspace,input){
 return new Promise(resolve=>{
  let child,finished=false,timer;
  const finish=()=>{if(finished)return;finished=true;clearTimeout(timer);resolve();};
  try{
   child=spawn(codescoutPath,['observations','ingest-hook','--workspace',workspace,'--json'],{shell:false,detached:false,stdio:['pipe','ignore','ignore'],windowsHide:true});
   child.on('error',finish);child.once('close',finish);
   child.stdin.on('error',()=>{}); // Broken pipes are observation failure, not hook failure.
   timer=setTimeout(()=>{try{child.kill('SIGKILL');}catch{}finish();},CHILD_TIMEOUT_MS);
   child.stdin.end(input);
  }catch{try{child?.kill('SIGKILL');}catch{}finish();}
 });
}
export async function runHook({event,workspace,codescoutPath='codescout',stdin=process.stdin,stdout=process.stdout,spawn=nativeSpawn}){
 try{
  const gitEnv={...process.env};
  for(const key of ['GIT_DIR','GIT_WORK_TREE','GIT_COMMON_DIR'])delete gitEnv[key];
  const checkout=execFileSync('git',['--no-optional-locks','-C',realpathSync(workspace),'rev-parse','--show-toplevel'],{env:gitEnv,timeout:200,maxBuffer:8192,stdio:['ignore','pipe','ignore']});
  const root=realpathSync(new TextDecoder('utf-8',{fatal:true}).decode(checkout).replace(/\n$/,''));
  const input=await readInput(stdin);if(input===null)return;
  const payload=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(input));
  if(payload?.hook_event_name!==undefined&&payload.hook_event_name!==event)return;
  const record=normalizeHookObservation(payload,event,root);if(record.diagnostic)return;
  const normalized=JSON.stringify(record);if(Buffer.byteLength(normalized)>RECORD_LIMIT)return;
  await ingest(spawn,codescoutPath,root,normalized);
 }catch{
  // Never echo native input, tool bodies, subprocess output or errors.
 }finally{stdout.write('{}\n');}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const options={};for(let i=2;i<process.argv.length;i+=2)options[process.argv[i]]=process.argv[i+1];
 await runHook({event:options['--event'],workspace:options['--workspace']??process.cwd(),codescoutPath:options['--codescout']??'codescout'});
}
