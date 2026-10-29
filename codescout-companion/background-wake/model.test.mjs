import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
let api;
const url = new URL('./model.mjs', import.meta.url);
try { api = await import(url); } catch (e) { if (e.code !== 'ERR_MODULE_NOT_FOUND' || e.url !== url.href) throw e; }
const subject = () => { assert.ok(api, 'wake model is not implemented'); return api; };
const job = { recordPath:join(tmpdir(),'wake-model','4242-a1b2c3d4-bg_00000001.json'),schema:1,serverPid:4242,serverToken:'a1b2c3d4',handle:'@bg_00000001' };
const target = { harness:'codex',profileRoot:join(tmpdir(),'wake-model-profile'),hostInstanceId:'daemon-1',environmentId:'linux:local',sessionId:'session-1',runtimeGeneration:'generation-1',origin:'root' };
const request = () => ({version:1,job:{...job},target:{...target},sourceEventId:'tool-1'});

test('sameHandleDifferentServer', () => { const {jobKey}=subject(); assert.notEqual(jobKey(job),jobKey({...job,recordPath:'/probe/records/4242-deadbeef-bg_00000001.json',serverToken:'deadbeef'})); });
test('sameJobDifferentProfile', () => { const {bindingKey}=subject(); assert.notEqual(bindingKey(target),bindingKey({...target,profileRoot:'/probe/another-profile'})); });
test('sameProfileDifferentEnvironment', () => { const {bindingKey}=subject(); assert.notEqual(bindingKey(target),bindingKey({...target,environmentId:'wsl:Ubuntu'})); });
test('eachTargetDimensionDiscriminates', () => { const {bindingKey}=subject(); for(const key of ['harness','hostInstanceId','sessionId','runtimeGeneration']) assert.notEqual(bindingKey(target),bindingKey({...target,[key]:'another'}),key); });
test('separatorsDoNotAlias', () => { const {bindingKey}=subject(); assert.notEqual(bindingKey({...target,sessionId:'a|b',runtimeGeneration:'c'}),bindingKey({...target,sessionId:'a',runtimeGeneration:'b|c'})); });
test('heartbeatDoesNotEqualTerminal', () => { const {eventId}=subject(); assert.notEqual(eventId(job,target,'terminal',0),eventId(job,target,'heartbeat',1)); assert.notEqual(eventId(job,target,'heartbeat',1),eventId(job,target,'heartbeat',2)); assert.equal(eventId(job,target,'terminal',0),eventId({...job},{...target},'terminal',0)); });
test('unknownRecordSchemaRejected', () => { const {validateWatchRequest}=subject(); const r=request();r.job.schema=2;assert.throws(()=>validateWatchRequest(r),/schema/i); });
test('untrustedTargetRejected', () => { const {validateWatchRequest}=subject();const r=request();r.target.origin='model';assert.throws(()=>validateWatchRequest(r),/origin/i); });
test('recordIdentityMustMatchProvidedPath', () => { const {validateWatchRequest}=subject();for(const [key,value] of [['serverPid',9999],['serverToken','deadbeef'],['handle','@bg_00000002']]) {const r=request();r.job[key]=value;assert.throws(()=>validateWatchRequest(r),/record|identity/i,key);} });
test('relativeAndEscapingPathsRejected', () => {const {validateWatchRequest}=subject();const r=request();r.job.recordPath='relative.json';assert.throws(()=>validateWatchRequest(r),/absolute/i);});
test('validRequestKeepsExplicitIdentity', () => { const {validateWatchRequest}=subject();const result=validateWatchRequest(request());assert.deepEqual(result,request()); });
test('envelopeAttributesMachineEventAndOmitsSecrets', () => { const {eventId,formatDeliveryEvent}=subject();const event={version:1,eventId:eventId(job,target,'terminal',0),kind:'terminal',sequence:0,job,target,payload:{state:'exited',exitCode:7,durationMs:1000,command:'SECRET_COMMAND',stdout:'SECRET_OUTPUT'}};const text=formatDeliveryEvent(event);assert.match(text,/codescout background job/i);assert.match(text,/exited 7/);assert.match(text,/event/i);assert.ok(!text.includes('SECRET'));assert.match(text,/@bg_00000001/); });
test('generationLossNeverRecommendsReusedHandle',()=>{const {eventId,formatDeliveryEvent}=subject();const text=formatDeliveryEvent({version:1,eventId:eventId(job,target,'tracking-lost',0),kind:'tracking-lost',sequence:0,job,target,payload:{reason:'server-ended-unknown'}});assert.match(text,/unknown|invalid/i);assert.ok(!text.includes('tail -50'));});
