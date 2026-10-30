import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {withStore} from '../test-support.mjs';
import {normalizeClaudeWatch} from './claude-code.mjs';
test('legacyHeartbeatMapNeverUpgradesOnSpawnReplay',()=>withStore(async({event,profileRoot,platform})=>{
 const legacy=join(profileRoot,'old maps');await mkdir(legacy);await writeFile(join(legacy,'map-session-@bg_00000001'),event.job.recordPath);
 const config={engine:'v1',profileRoot,environmentId:'linux',adapters:{claudeCode:{enabled:true}},bindings:{claudeCode:{hostVersion:'2.1.312',hostInstanceId:'fixture',runtimeGeneration:'fixture'}},migration:{legacyStateDir:legacy}};
 const raw={hook_event_name:'PostToolUse',tool_name:'mcp__codescout__run_command',tool_use_id:'replayed-ack',session_id:'session',cwd:profileRoot,tool_input:{command:'@ack_x'},tool_response:[{text:JSON.stringify({record:event.job.recordPath,output_id:event.job.handle})}]};
 assert.equal(await normalizeClaudeWatch(raw,config,platform),null);
}));
