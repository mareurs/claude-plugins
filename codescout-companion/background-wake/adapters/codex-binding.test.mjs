import test from 'node:test';
import assert from 'node:assert/strict';
import {withProtocol} from './protocol-fixture.mjs';
import {createCodexAdapter} from './codex.mjs';
import {endpointIdentity} from './codex-client.mjs';
test('everyEventTargetDimensionMustMatchVerifiedConfiguration',()=>withProtocol(async({root,endpoint,messages})=>{
 const {generation}=await endpointIdentity(endpoint);
 const config={engine:'v1',profileRoot:root,environmentId:'linux',adapters:{codex:{enabled:true,endpoint}},bindings:{codex:{hostInstanceId:generation,runtimeGeneration:generation}},capabilities:{codex:{daemonVersion:'0.160.0',subscription:'resume-loaded',callbackPreserved:true}}};
 const valid={harness:'codex',profileRoot:root,environmentId:'linux',hostInstanceId:generation,runtimeGeneration:generation,origin:'root',sessionId:'session'};
 for(const [field,value] of Object.entries({harness:'claude-code',profileRoot:root+'/foreign',environmentId:'wsl',hostInstanceId:'foreign',runtimeGeneration:'old',origin:'child'})){
  const adapter=createCodexAdapter(config);
  const result=await adapter.validateTarget({target:{...valid,[field]:value}});
  assert.equal(result.supported,false,field);await adapter.close();
 }
 assert.equal(messages.some(m=>m.method==='thread/resume'||m.method==='turn/start'),false);
 const adapter=createCodexAdapter(config);assert.equal((await adapter.validateTarget({target:valid})).supported,true);await adapter.close();
}));
