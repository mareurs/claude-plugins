import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable, Writable} from 'node:stream';
import {spawn as realSpawn,execFileSync} from 'node:child_process';
import {mkdtempSync,rmSync,mkdirSync,readFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runHook} from './codex-observation.mjs';

const setup=()=>{const root=mkdtempSync(join(tmpdir(),'observation-hook-'));execFileSync('git',['init','-q',root]);return {root,close:()=>rmSync(root,{recursive:true,force:true})};};
const payload=root=>({session_id:'native-root',turn_id:'turn',cwd:root,hook_event_name:'PreToolUse',tool_name:'mcp__codescout__create_file',tool_use_id:'call',tool_input:{path:'out.txt',content:'private-body-canary'},model:'private-model-canary',reasoning:'private-reason-canary',env:{AUTH:'private-env-canary'}});
async function invoke(root,input,{event='PreToolUse',behavior='capture',...overrides}={}){
 let output='',calls=0;
 const destination=join(root,'ingress.json'), argv=join(root,'argv.json');
 const fakeSpawn=(file,args,options)=>{
  calls++;
  assert.equal(file,'/private/path with spaces/codescout');
  assert.deepEqual(args,['observations','ingest-hook','--workspace',root,'--json']);
  assert.equal(options.shell,false);
  assert.equal(options.detached,false);
  assert.deepEqual(options.stdio,['pipe','ignore','ignore']);
  const program=behavior==='hang'?'setInterval(()=>{},1000)':behavior==='crash'?'process.exit(1)':`let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>require('fs').writeFileSync(process.argv[1],s));`;
  return realSpawn(process.execPath,['-e',program,destination],options);
 };
 await runHook({event,workspace:root,codescoutPath:'/private/path with spaces/codescout',stdin:Readable.from([input]),stdout:new Writable({write(c,e,cb){output+=c;cb();}}),spawn:fakeSpawn,...overrides});
 assert.equal(output,'{}\n');
 return {calls,record:existsSync(destination)?JSON.parse(readFileSync(destination,'utf8')):null};
}
test('normalizes native and child identities without retaining private payloads',async()=>{
 const f=setup();try{
  const p=payload(f.root);p.agent_id='child';
  const r=await invoke(f.root,JSON.stringify(p));
  assert.equal(r.calls,1);assert.equal(r.record.caller.principal,'codex:native-root');
  assert.equal(r.record.caller.thread_id,'child');assert.equal(r.record.native_call_id,'call');
  assert.equal(r.record.turn_id,'turn');assert.equal(r.record.event,'hook-pre');
  assert.deepEqual(r.record.targets,[]);assert.equal(r.record.fingerprints[0].domain,'canonical-json-safe-v1');
  assert.ok(!JSON.stringify(r.record).includes('private-'));
  assert.ok(!Object.hasOwn(r.record,'observed_at_unix_ms'));
 }finally{f.close();}
});
test('post, nested Code Mode and lifecycle shapes remain observations',async()=>{
 const f=setup();try{
  for(const [event,tool,expected] of [['PostToolUse','create_file','hook-post'],['PreToolUse','code_mode','hook-pre'],['SubagentStart',null,'lifecycle'],['PostCompact',null,'lifecycle']]){
   const p=payload(f.root);p.hook_event_name=event;p.tool_name=tool? 'mcp__codescout__'+tool:undefined;p.tool_response={secret:'private-result-canary'};
   const r=await invoke(f.root,JSON.stringify(p),{event});assert.equal(r.record.event,expected);
   assert.equal(r.record.caller.thread_id,null);assert.ok(!JSON.stringify(r.record).includes('private-'));
  }
 }finally{f.close();}
});
test('malformed, oversized, missing-root and workspace-mismatch input is neutral without spawning',async()=>{
 const f=setup();try{
  const invalid=[Buffer.from('{'),Buffer.alloc(4*1024*1024+1,120),JSON.stringify({...payload(f.root),session_id:undefined}),JSON.stringify({...payload(f.root),cwd:join(f.root,'other')}),'null'];
  for(const p of invalid)assert.equal((await invoke(f.root,p)).calls,0);
  assert.equal((await invoke(f.root,JSON.stringify(payload(f.root)),{event:'InventedEvent'})).calls,0);
 }finally{f.close();}
});
test('crash, spawn error and timeout cannot change neutral output or escape deadline',async()=>{
 const f=setup();try{
  for(const behavior of ['crash','hang']){
   const start=Date.now();const r=await invoke(f.root,JSON.stringify(payload(f.root)),{behavior});
   assert.equal(r.calls,1);assert.ok(Date.now()-start<2600);
  }
  await invoke(f.root,JSON.stringify(payload(f.root)),{spawn(){throw new Error('private-error-canary');}});
 }finally{f.close();}
});
test('nonterminating stdin is bounded and never launches a child',async()=>{
 const f=setup();try{
  const start=Date.now();const r=await invoke(f.root,'',{stdin:new Readable({read(){}})});
  assert.equal(r.calls,0);assert.ok(Date.now()-start<1200);
 }finally{f.close();}
});

test('nested invocation cwd resolves to the same actual checkout',async()=>{
 const f=setup();
 try{
  const nested=join(f.root,'src','nested');mkdirSync(nested,{recursive:true});
  const r=await invoke(f.root,JSON.stringify(payload(nested)),{workspace:nested});
  assert.equal(r.calls,1);
  assert.equal(r.record.workspace,f.root);
 }finally{f.close();}
});
