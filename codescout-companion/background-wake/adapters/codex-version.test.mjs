import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as compatibility from '../compatibility.mjs';
import {withProtocol} from './protocol-fixture.mjs';
import {endpointIdentity} from './codex-client.mjs';
import {createCodexAdapter} from './codex.mjs';

test('daemon version parser accepts a leading version independently of the first client name',()=>{
 assert.equal(typeof compatibility.parseCodexDaemonVersion,'function');
 for(const [input,expected] of [
  ['codex-tui/0.167.0 (Linux)','0.167.0'],
  ['codescout_wake_probe_primary/0.167.0 (Linux)','0.167.0'],
  ['third-party.client+integration/0.169.0 (Linux) unknown (codex-tui; 1)','0.169.0'],
  ['custom/1.2.3','1.2.3'],
 ])assert.equal(compatibility.parseCodexDaemonVersion(input),expected,input);
});

test('daemon version parser rejects malformed or non-leading versions',()=>{
 assert.equal(typeof compatibility.parseCodexDaemonVersion,'function');
 for(const input of [
  undefined,null,0,{},'', '/0.167.0',' /0.167.0','custom client/0.167.0',
  ' custom/0.167.0','custom/path/0.167.0','custom/0.167','custom/0.167.0.1',
  'custom/0.167.0evil','custom/0.167.0-beta.01','custom/0.167.0+build..1',
  'custom/00.167.0','custom/0.0167.0','custom/0.167.00',
  'custom/0.167.0\nother/0.169.0','custom/0.167.0\r','custom\u0000/0.167.0',
 ])assert.equal(compatibility.parseCodexDaemonVersion(input),null,JSON.stringify(input));
});

for(const [declared,userAgent,supported] of [
 ['0.167.0','codex-tui/0.167.0 (fixture)',true],
 ['0.167.0','issue14_first_originator/0.167.0 (fixture) unknown (codex-tui; 1)',true],
 ['0.160.0','codescout_wake_probe_primary/0.160.0 (fixture)',true],
 ['0.167.0','custom/0.160.0 (fixture)',false],
 ['0.167.0','custom/0.167.0evil',false],
 ['0.167.0','custom/0.167.0.1',false],
 ['0.167.0',null,false],
 ['0.169.0','custom/0.169.0 (fixture)',true],
 ['0.169.0-alpha.11.1+build','custom/0.169.0-alpha.11.1+build (fixture)',true],
 ['0.169.0+build','custom/0.169.0 (fixture)',false],
])test(`adapter declared ${declared}, userAgent ${JSON.stringify(userAgent)}: supported=${supported}`,async()=>{
 let fixtureRoot;
 await withProtocol(async({root,endpoint,messages})=>{
  fixtureRoot=root;
  const {generation}=await endpointIdentity(endpoint);
  const adapter=createCodexAdapter({engine:'v1',profileRoot:root,adapters:{codex:{enabled:true,endpoint}},bindings:{codex:{hostInstanceId:generation,runtimeGeneration:generation}},capabilities:{codex:{daemonVersion:declared,subscription:'resume-loaded',callbackPreserved:true}}});
  try{
   const result=await adapter.capability();
   assert.equal(result.supported,supported,result.reason);
   if(supported&&declared.startsWith('0.169.0')){assert.equal(messages.some(m=>m.method==='initialize'),true);assert.equal(result.evidenceRef,null);assert.match(result.reason,/configured.*callback.*proof/i);}
  }finally{await adapter.close();}
 },{reply:m=>m.method==='initialize'?{result:{codexHome:fixtureRoot,userAgent,platformOs:'linux'}}:undefined});
});

for(const version of ['0.160.0','0.167.0'])test(`daemon ${version} evidence reference resolves to its actual native summary`,async()=>{
 const reference=compatibility.codexDaemonEvidence(version);
 assert.equal(typeof reference,'string');
 const location=new URL(reference,new URL('../../',import.meta.url));
 const evidence=JSON.parse(await readFile(location,'utf8'));
 assert.equal(evidence.daemonVersion,version);
 assert.equal(evidence.synthetic,false);
 assert.equal(evidence.captureKind,'native-protocol-summary');
 assert.ok(location.hash,'reference must name an evidence identifier');
 assert.equal(evidence.id,location.hash.slice(1));
});

test('newer eligible daemon versions do not gain historical evidence',()=>{
 assert.equal(compatibility.codexDaemonEvidence('0.169.0'),null);
 assert.equal(compatibility.supportsCodexHook('0.169.0'),true);
});

test('adapter refuses an independently mismatched runtime generation before initialize',()=>withProtocol(async({root,endpoint,messages})=>{
 const {generation}=await endpointIdentity(endpoint);
 const adapter=createCodexAdapter({engine:'v1',profileRoot:root,adapters:{codex:{enabled:true,endpoint}},bindings:{codex:{hostInstanceId:generation,runtimeGeneration:'another-runtime-generation'}},capabilities:{codex:{daemonVersion:'0.160.0',subscription:'resume-loaded',callbackPreserved:true}}});
 try{
  const result=await adapter.capability();
  assert.equal(result.supported,false,'matching hostInstanceId must not hide a stale runtimeGeneration');
  assert.match(result.reason,/generation/);
  assert.equal(messages.some(m=>m.method==='initialize'),false,'generation mismatch must be refused before connecting');
 }finally{await adapter.close();}
}));

for(const failure of ['missing-proof','false-callback','wrong-subscription','profile','host-generation','runtime-generation','adapter-disabled','missing-enablement','legacy-engine'])test(`newer daemon retains ${failure} guard`,async()=>{
 let fixtureRoot;
 await withProtocol(async({root,endpoint,messages})=>{
  fixtureRoot=root;
  const {generation}=await endpointIdentity(endpoint);
  const config={engine:'v1',profileRoot:root,adapters:{codex:{enabled:true,endpoint}},bindings:{codex:{hostInstanceId:generation,runtimeGeneration:generation}},capabilities:{codex:{daemonVersion:'0.169.0',subscription:'resume-loaded',callbackPreserved:true}}};
  if(failure==='adapter-disabled')config.adapters.codex.enabled=false;
  if(failure==='missing-enablement')delete config.adapters.codex.enabled;
  if(failure==='legacy-engine')config.engine='legacy';
  if(failure==='missing-proof')delete config.capabilities.codex;
  if(failure==='false-callback')config.capabilities.codex.callbackPreserved=false;
  if(failure==='wrong-subscription')config.capabilities.codex.subscription='other';
  if(failure==='host-generation')config.bindings.codex.hostInstanceId='other';
  if(failure==='runtime-generation')config.bindings.codex.runtimeGeneration='other';
  const adapter=createCodexAdapter(config);
  try{
   const result=await adapter.capability();
   assert.equal(result.supported,false);
   assert.match(result.reason,failure==='profile'?/another Codex profile/:failure.endsWith('generation')?/generation/:['adapter-disabled','missing-enablement','legacy-engine'].includes(failure)?/disabled/:/callback preservation/);
   assert.equal(messages.some(m=>m.method==='initialize'),failure==='profile');
  }finally{await adapter.close();}
 },{reply:m=>m.method==='initialize'?{result:{codexHome:failure==='profile'?'/tmp':fixtureRoot,userAgent:'custom/0.169.0 (fixture)',platformOs:'linux'}}:undefined});
});
