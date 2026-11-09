#!/usr/bin/env bash
set -euo pipefail
TASK_ROOT=$(cd "$(dirname "$0")/.." && pwd)
node --input-type=module - "$TASK_ROOT" <<'JS'
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,cpSync,writeFileSync,rmSync,readdirSync,statSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
const root=process.argv[2];
const {renderObservationHooks,inspectObservationCapability}=await import(pathToFileURL(join(root,'scripts/render-codex-observation-hooks.mjs')));
const fixture=mkdtempSync(join(tmpdir(),'stock-hook-registration-'));
const snapshot=path=>JSON.stringify(readdirSync(path,{recursive:true}).sort().map(name=>{const s=statSync(join(path,name));return [name,s.size,s.mtimeMs];}));
try{
 const profiles=['.Codex','.Codex-sdd','.Codex-kat'];
 const unrelated={hooks:{PreToolUse:[{matcher:'unrelated',hooks:[{type:'command',command:'echo existing',timeout:2}]}]},custom:'preserved'};
 for(const profile of profiles){
  const base=join(fixture,profile);const plugin=join(base,'cache','companion','source');
  mkdirSync(plugin,{recursive:true});
  cpSync(join(root,'codescout-companion','hooks'),join(plugin,'hooks'),{recursive:true});
  cpSync(join(root,'codescout-companion','contracts'),join(plugin,'contracts'),{recursive:true});
  cpSync(join(root,'codescout-companion','codex'),join(plugin,'codex'),{recursive:true});
  const before=snapshot(fixture),original=JSON.stringify(unrelated);
  const options={pluginRoot:plugin,codescoutPath:process.execPath,existingHooks:unrelated};
  const result=renderObservationHooks(options);
  assert.equal(JSON.stringify(unrelated),original);
  assert.equal(result.custom,'preserved');assert.deepEqual(result.hooks.PreToolUse[0],unrelated.hooks.PreToolUse[0]);
  assert.equal(result.hooks.PreToolUse.length,2);
  for(const [event,groups] of Object.entries(result.hooks)){
   const handler=groups.at(-1).hooks[0];assert.equal(handler.timeout,3);
   assert.ok(handler.command.includes(plugin));assert.ok(handler.command.includes('--event '+event));
  }
  assert.deepEqual(renderObservationHooks({...options,existingHooks:result}),result);
  const capability=inspectObservationCapability(options);
  assert.equal(capability.contract_version,1);assert.match(capability.adapter_sha256,/^[0-9a-f]{64}$/);
  assert.equal(capability.runtime_verified,false);assert.equal(capability.available,true);
  assert.equal(snapshot(fixture),before);
  assert.throws(()=>renderObservationHooks({...options,contractVersion:2}),/incompatible/);
  assert.throws(()=>renderObservationHooks({...options,enabled:false}),/disabled/);
  assert.throws(()=>renderObservationHooks({...options,codescoutPath:join(fixture,'missing-cli')}),/unavailable/);
  assert.equal(snapshot(fixture),before);
 }
 const quoted=join(fixture,"quoted cache '$(touch SENTINEL)'");
 cpSync(join(fixture,'.Codex','cache','companion','source'),quoted,{recursive:true});
 const escaped=renderObservationHooks({pluginRoot:quoted,codescoutPath:process.execPath});
 const invoked=spawnSync('/bin/sh',['-c',escaped.hooks.PreToolUse[0].hooks[0].command],{cwd:fixture,encoding:'utf8',timeout:3000,input:JSON.stringify({session_id:'fixture',cwd:fixture,hook_event_name:'PreToolUse',tool_name:'mcp__codescout__create_file',tool_use_id:'call',tool_input:{}})});
 assert.equal(invoked.status,0,invoked.stderr);assert.equal(invoked.stdout,'{}\n');
 assert.ok(!readdirSync(fixture).includes('SENTINEL'));
 const before=snapshot(fixture);
 assert.throws(()=>renderObservationHooks({pluginRoot:join(fixture,'.codex','missing'),codescoutPath:process.execPath}),/unavailable/);
 assert.equal(snapshot(fixture),before);
 console.log('Codex registration: three profile/cache roots, merge, capability and no-write fixtures passed');
}finally{rmSync(fixture,{recursive:true,force:true});}
JS
