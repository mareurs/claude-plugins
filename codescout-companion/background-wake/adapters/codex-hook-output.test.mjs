import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {writeFile,readdir,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {withStore} from '../test-support.mjs';
import {createPlatform} from '../platform-node.mjs';
import {withProtocol} from './protocol-fixture.mjs';
import {endpointIdentity} from './codex-client.mjs';

const cli=fileURLToPath(new URL('../cli.mjs',import.meta.url));
function invoke(profile,input,command='launch'){
 return new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,[cli,command,'--profile',profile,'--environment',process.platform,'--harness','codex'],{stdio:['pipe','pipe','pipe']});
  let stdout='',stderr='';
  const timeout=setTimeout(()=>{child.kill();reject(new Error('CLI timed out'));},10000);
  child.stdout.on('data',b=>{stdout+=b;});child.stderr.on('data',b=>{stderr+=b;});
  child.once('error',e=>{clearTimeout(timeout);reject(e);});
  child.once('close',status=>{clearTimeout(timeout);resolve({status,stdout,stderr});});
  child.stdin.end(JSON.stringify(input));
 });
}
function nativeInput(root,response){
 return {hook_event_name:'PostToolUse',tool_name:'mcp__codescout__run_command',tool_use_id:'native-hook-test',session_id:'session',cwd:root,tool_input:{command:'true'},tool_response:{content:[{type:'text',text:JSON.stringify(response)}]}};
}
async function configure(root,endpoint){
 const {generation}=await endpointIdentity(endpoint);
 const config={version:1,engine:'v1',profileRoot:root,environmentId:process.platform,stateDir:join(root,'state'),pythonArgv:['python3'],adapters:{claudeCode:{enabled:false},codex:{enabled:true,endpoint}},bindings:{codex:{hostVersion:'0.165.0',hostInstanceId:generation,runtimeGeneration:generation}},capabilities:{codex:{daemonVersion:'0.160.0',subscription:'resume-loaded',callbackPreserved:true}}};
 await writeFile(join(root,'codescout-wake.json'),JSON.stringify(config));return config;
}

test('disabledLaunchIsSilentSuccessfulHookNoop',()=>withStore(async({profileRoot})=>{
 const result=await invoke(profileRoot,{});
 assert.equal(result.status,0);assert.equal(result.stdout,'');assert.equal(result.stderr,'');
}));
test('foregroundLaunchIsSilentAndNeverSends',()=>withProtocol(async({root,endpoint,messages})=>{
 await configure(root,endpoint);
 const result=await invoke(root,nativeInput(root,{exit_code:0,stdout:''}));
 assert.equal(result.status,0);assert.equal(result.stdout,'');assert.equal(result.stderr,'');
 assert.equal(messages.filter(m=>m.method==='turn/start').length,0);
}));
test('launchedHookIsSilentButDetachedDeliveryStillCompletes',()=>withProtocol(async({root,endpoint,messages})=>withStore(async({event})=>{
 const config=await configure(root,endpoint);
 const stateDir=createPlatform(config).stateDir;
 await writeFile(event.job.recordPath,JSON.stringify({schema:1,server_pid:4242,handle:event.job.handle,state:'exited',exit_code:7}));
 const result=await invoke(root,nativeInput(root,{output_id:event.job.handle,record:event.job.recordPath}));
 // Observe the side effect before checking stdout: swallowing the launcher cannot pass.
 const until=Date.now()+8000;let receipt;
 while(Date.now()<until){
  let names=[];try{names=(await readdir(stateDir)).filter(n=>/^[a-f0-9]{64}\.json$/.test(n));}catch(e){if(e.code!=='ENOENT')throw e;}
  for(const name of names){receipt=JSON.parse(await readFile(join(stateDir,name),'utf8'));if(receipt.state==='completed')break;}
  if(receipt?.state==='completed')break;
  await new Promise(r=>setTimeout(r,20));
 }
 assert.equal(receipt?.state,'completed');assert.equal(messages.filter(m=>m.method==='turn/start').length,1);
 assert.equal(result.status,0);assert.equal(result.stdout,'');assert.equal(result.stderr,'');
}),{reply:(m,s)=>{
 if(m.method!=='turn/start')return;
 s.send(JSON.stringify({id:m.id,result:{turn:{id:'ours',items:[]}}}));
 s.send(JSON.stringify({method:'item/completed',params:{threadId:'session',turnId:'ours',item:{id:'output',type:'functionCallOutput',name:'codescout_background_job',output:m.params.toolOutput.output}}}));
 s.send(JSON.stringify({method:'turn/completed',params:{threadId:'session',turn:{id:'ours',status:'completed'}}}));return false;
}}));
test('launchConfigurationFailureStillReportsFailureWithoutJsonStdout',()=>withStore(async({profileRoot})=>{
 await writeFile(join(profileRoot,'codescout-wake.json'),'{broken');
 const result=await invoke(profileRoot,{});
 assert.equal(result.status,1);assert.equal(result.stdout,'');assert.match(result.stderr,/background-wake: command failed/);
}));
test('doctorRetainsMachineReadableJson',()=>withStore(async({profileRoot})=>{
 const result=await invoke(profileRoot,{},'doctor');
 assert.equal(result.status,0);assert.equal(JSON.parse(result.stdout).engine,'legacy');
}));
