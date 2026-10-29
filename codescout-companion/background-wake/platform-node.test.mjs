import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,mkdir,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
let api;const url=new URL('./platform-node.mjs',import.meta.url);
try{api=await import(url);}catch(e){if(e.code!=='ERR_MODULE_NOT_FOUND'||e.url!==url.href)throw e;}
const subject=()=>{assert.ok(api,'platform operations are not implemented');return api;};
async function fixture(fn){const root=await mkdtemp(join(tmpdir(),'wake space-γ-'));try{await fn(root);}finally{await rm(root,{recursive:true,force:true});}}
const platform=(api,root,extra={})=>api.createPlatform({profileRoot:root,stateDir:join(root,'private'),pythonArgv:[process.platform==='win32'?'python':'python3'],...extra});
test('permissionErrorIsNotDead',async(t)=>{const api=subject();await fixture(async(root)=>{t.mock.method(process,'kill',()=>{throw Object.assign(new Error('denied'),{code:'EPERM'});});assert.equal(await platform(api,root).processStatus({pid:123}),'unknown');});});
test('missingPythonDisablesEngine',async()=>{const api=subject();await fixture(async(root)=>{await assert.rejects(platform(api,root,{pythonArgv:[join(root,'missing-python')]}).privateStateRoot(),/python|unavailable/i);});});
test('spacesAndUnicodeRoundTrip',async()=>{const api=subject();await fixture(async(root)=>{const p=platform(api,root);const child=p.spawnArgv(process.execPath,['-e','process.stdout.write(process.argv[1])','value with space γ']);let output='';child.stdout.on('data',(b)=>{output+=b;});const [code]=await once(child,'exit');assert.equal(code,0);assert.equal(output,'value with space γ');const dir=await p.privateStateRoot();assert.ok(dir);if(process.platform!=='win32')assert.equal((await stat(dir)).mode&0o077,0);});});
test('recordReadsDistinguishMissingMalformedAndTerminal',async()=>{const api=subject();await fixture(async(root)=>{const p=platform(api,root);const file=join(root,'record.json');assert.equal((await p.readRecord(file)).kind,'missing');await writeFile(file,'{bad');assert.equal((await p.readRecord(file)).kind,'error');await writeFile(file,JSON.stringify({schema:1,state:'exited',server_pid:4242,handle:'@bg_00000001',exit_code:7}));const value=await p.readRecord(file);assert.equal(value.kind,'available');assert.equal(value.record.exit_code,7);});});
test('unsupportedRecordSchemaIsNotGuessed',async()=>{const api=subject();await fixture(async(root)=>{const file=join(root,'record.json');await writeFile(file,JSON.stringify({schema:99,state:'exited',server_pid:4242}));assert.equal((await platform(api,root).readRecord(file)).kind,'unsupported');});});
