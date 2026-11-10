import test from 'node:test';
import assert from 'node:assert/strict';

// Import stays passive: no host or model call without explicit CLI options.
const {assessCallbackProbe,probeCodexCallbacks}=await import('./probe-codex-wake-callbacks.mjs');
for(const [label,patch] of [['no tool',{originalTool:0}],['no approval',{originalPermission:0}],['secondary callback',{secondaryCallbacks:1}],['no attach',{attached:false}],['unfinished turn',{turnCompleted:false}]])
 test(`callback proof refuses ${label}`,()=>assert.equal(assessCallbackProbe({attached:true,turnCompleted:true,originalTool:1,originalPermission:1,secondaryCallbacks:0,...patch}).supported,false));
test('observed original tool and permission callbacks after attach and close pass',()=>assert.equal(assessCallbackProbe({attached:true,turnCompleted:true,originalTool:1,originalPermission:1,secondaryCallbacks:0}).supported,true));
test('probe requires explicit opt in before contacting a host',async()=>{
 await assert.rejects(probeCodexCallbacks({endpoint:'unix:///does-not-exist',profileRoot:'/tmp'}),/allow-model-call/);
});
