import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFile,readdir,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {withProtocol} from './protocol-fixture.mjs';
import {endpointIdentity} from './codex-client.mjs';
import {withStore} from '../test-support.mjs';
import {createPlatform} from '../platform-node.mjs';
import {runCli} from '../cli.mjs';
test('detachedHookLaunchProducesDurableReceipt',()=>withProtocol(async({root,endpoint,messages})=>withStore(async({event})=>{
 const {generation}=await endpointIdentity(endpoint);
 const config={version:1,engine:'v1',profileRoot:root,environmentId:process.platform,stateDir:join(root,'state'),pythonArgv:['python3'],adapters:{claudeCode:{enabled:false},codex:{enabled:true,endpoint}},bindings:{codex:{hostVersion:'0.165.0',hostInstanceId:generation,runtimeGeneration:generation}},capabilities:{codex:{daemonVersion:'0.160.0',subscription:'resume-loaded',callbackPreserved:true}}};
 await writeFile(join(root,'codescout-wake.json'),JSON.stringify(config));
 await writeFile(event.job.recordPath,JSON.stringify({schema:1,server_pid:4242,handle:event.job.handle,state:'exited',exit_code:7}));
 const input=JSON.stringify({hook_event_name:'PostToolUse',tool_name:'mcp__codescout__run_command',tool_use_id:'origin',session_id:'session',cwd:root,tool_input:{command:'@ack_x'},tool_response:{content:[{type:'text',text:JSON.stringify({output_id:event.job.handle,record:event.job.recordPath})}]}});
 const result=await runCli(['launch','--profile',root,'--environment',process.platform,'--harness','codex'],{input});
 assert.equal(result.state,'watch-launched');
 const state=createPlatform(config).stateDir;const until=Date.now()+8000;let receipt;
 while(Date.now()<until){
  const names=(await readdir(state)).filter(n=>/^[a-f0-9]{64}\.json$/.test(n));
  if(names.length){receipt=JSON.parse(await readFile(join(state,names[0]),'utf8'));if(receipt.state==='completed')break;}
  await new Promise(r=>setTimeout(r,20));
 }
 assert.equal(receipt?.state,'completed');assert.equal(messages.filter(m=>m.method==='turn/start').length,1);
}),{reply:(m,s)=>{if(m.method!=='turn/start')return;
 s.send(JSON.stringify({id:m.id,result:{turn:{id:'ours',items:[]}}}));
 s.send(JSON.stringify({method:'item/completed',params:{threadId:'session',turnId:'ours',item:{id:'output',type:'functionCallOutput',name:'codescout_background_job',output:m.params.toolOutput.output}}}));
 s.send(JSON.stringify({method:'turn/completed',params:{threadId:'session',turn:{id:'ours',status:'completed'}}}));
 return false;
}}));
