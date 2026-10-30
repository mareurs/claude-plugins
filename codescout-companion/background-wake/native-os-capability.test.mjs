import test from 'node:test';
import assert from 'node:assert/strict';
import {createClaudeAdapter} from './adapters/claude-code.mjs';
test('unmeasuredNativeWindowsClaudeIsDisabled',async()=>{
 const descriptor=Object.getOwnPropertyDescriptor(process,'platform');
 Object.defineProperty(process,'platform',{value:'win32'});
 try{
  const a=createClaudeAdapter({engine:'v1',adapters:{claudeCode:{enabled:true}},bindings:{claudeCode:{hostVersion:'2.1.312'}}});
  assert.equal((await a.capability()).supported,false);await a.close();
 }finally{Object.defineProperty(process,'platform',descriptor);}
});
