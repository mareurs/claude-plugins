import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {withStore} from '../test-support.mjs';
const wrapper=fileURLToPath(new URL('../../hooks/wake-on-job-end.mjs',import.meta.url));
const invoke=(raw,env)=>new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,[wrapper],{env,stdio:['pipe','pipe','pipe']});let stderr='';
  const timer=setTimeout(()=>{child.kill();reject(Error('wrapper timeout'));},15000);
  child.stderr.on('data',b=>stderr+=b);child.on('error',reject);child.on('close',code=>{clearTimeout(timer);resolve({code,stderr});});child.stdin.end(JSON.stringify(raw));
});
test('heartbeatRearmAndConcurrentTerminalsStayIndependent',()=>withStore(async({platform,profileRoot})=>{
  const config={version:1,engine:'v1',profileRoot,environmentId:process.platform,stateDir:platform.stateDir,pythonArgv:[process.platform==='win32'?'python':'python3'],adapters:{claudeCode:{enabled:true},codex:{enabled:false}},bindings:{claudeCode:{hostVersion:'2.1.312',hostInstanceId:'fixture',runtimeGeneration:'fixture'}}};
  await writeFile(join(profileRoot,'codescout-wake.json'),JSON.stringify(config));
  const env={...process.env,CLAUDE_PROJECT_DIR:profileRoot,CLAUDE_CONFIG_DIR:profileRoot,CODESCOUT_WAKE_ENVIRONMENT_ID:process.platform,CODESCOUT_WAKE_DEADLINE_SECS:'0.05',CODESCOUT_WAKE_POLL_MS:'10'};
  const raw=(n,read=false)=>({session_id:'session',cwd:profileRoot,hook_event_name:'PostToolUse',tool_name:'mcp__codescout__run_command',tool_use_id:'call-'+n,tool_input:{command:read?'tail -50 @bg_0000000'+n:'@ack_x'},tool_response:[{text:JSON.stringify(read?{exit_code:0}:{output_id:'@bg_0000000'+n,record:join(profileRoot,process.pid+'-a1b2c3d4-bg_0000000'+n+'.json')})}]});
  const write=(n,state,exit)=>writeFile(join(profileRoot,process.pid+'-a1b2c3d4-bg_0000000'+n+'.json'),JSON.stringify({schema:1,handle:'@bg_0000000'+n,server_pid:process.pid,state,exit_code:exit,started_at:new Date().toISOString(),finished_at:new Date().toISOString()}));
  await write(1,'running',null);
  const heartbeat=await invoke(raw(1),env);assert.equal(heartbeat.code,2);assert.match(heartbeat.stderr,/running/);
  await write(1,'exited',7);await write(2,'exited',0);
  const results=await Promise.all([invoke(raw(1,true),env),invoke(raw(2),env)]);
  assert.deepEqual(results.map(r=>r.code),[2,2]);assert.match(results[0].stderr,/exited 7/);assert.match(results[1].stderr,/exited 0/);
  config.engine='legacy';await writeFile(join(profileRoot,'codescout-wake.json'),JSON.stringify(config));
  assert.equal((await invoke(raw(2),env)).code,0,'rollback cannot adopt a v1-owned job');
},{ensure:false}));
