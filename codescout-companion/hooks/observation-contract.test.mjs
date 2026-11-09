import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {canonicalJson, fingerprint, validateObservation, normalizeHookObservation} from './observation-contract.mjs';

const fixtures=JSON.parse(readFileSync(new URL('../contracts/fixtures/operation-observations-v1.json',import.meta.url)));
test('canonical fingerprints share literal cross-language vectors',()=>{
  for (const c of fixtures.canonical) {
    assert.equal(canonicalJson(c.input),c.canonical);
    assert.deepEqual(fingerprint(c.input),{domain:'canonical-json-safe-v1',digest:createHash('sha256').update(c.canonical).digest('hex')});
  }
  for (const bad of [1.5,Number.MAX_SAFE_INTEGER+1,'\ud800']) assert.throws(()=>canonicalJson(bad));
});
test('strict record decoder rejects extra bodies, bad identities and versions',()=>{
  assert.deepEqual(validateObservation(fixtures.record),fixtures.record);
  for(const patch of [{schema_version:2},{body:'secret-canary'},{sequence:-1},{caller:{...fixtures.record.caller,principal:'thread-id'}},{native_call_id:'\0'},{native_call_id:'a'.repeat(1025)},{tool:'credential-canary'}])
    assert.throws(()=>validateObservation({...fixtures.record,...patch}));
});
test('unknown root is valid and never fabricated from child',()=>{
  const r={...fixtures.record,caller:{harness:'codex',principal:null,thread_id:'child',agent_id:null}};
  assert.equal(validateObservation(r).caller.principal,null);
});
test('hook normalizer reuses native origin and preserves root vs child',()=>{
  const cwd=tmpdir();
  const r=normalizeHookObservation({session_id:'root',agent_id:'child',turn_id:'turn',cwd,tool_use_id:'call',tool_name:'mcp__codescout__create_file',tool_input:{content:'private-file-canary',path:'x'},reasoning:'private-reasoning-canary'},'PreToolUse',cwd);
  assert.deepEqual(r.caller,{harness:'codex',principal:'codex:root',thread_id:'child',agent_id:'child'});
  assert.equal(r.event,'hook-pre'); assert.equal(r.native_call_id,'call');assert.equal(r.turn_id,'turn');
  assert.equal(JSON.stringify(r).includes('private-'),false);
  assert.deepEqual(r.targets,[]);
  assert.equal(normalizeHookObservation({cwd},'PreToolUse',cwd).diagnostic,'missing-root');
  assert.equal(normalizeHookObservation({cwd,session_id:'root',agent_id:7},'PreToolUse',cwd).diagnostic,'invalid-context');
  assert.equal(normalizeHookObservation({cwd:'/somewhere-else',session_id:'root'},'PreToolUse',cwd).diagnostic,'invalid-context');
});
