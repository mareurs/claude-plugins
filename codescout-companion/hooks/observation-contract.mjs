import {createHash} from 'node:crypto';
import {normalizeHookContext} from './session-context.mjs';
export const EVENTS=["request-observed","dispatch-observed","result-observed","hook-pre","hook-post","lifecycle","observer-diagnostic"];
export const OUTCOMES=["requested","dispatched","returned-success","refused","error-possible-effects","missing-terminal","unknown"];
export const DIAGNOSTICS=["missing-root","invalid-context","context-conflict","unsupported-tool","unsupported-event","incomplete-input","opaque-effects","missing-terminal","unavailable","disabled","quota","torn-record","checksum","sequence-gap","conflicting-duplicate","ambiguous-pair","incompatible-schema","checkout-mismatch","reset","unsupported-fingerprint"];
export const TOOLS=["create_file","edit_file","edit_code","run_command","read_file","symbols","grep","semantic_search","workspace","doc","memory","find_file","references","call_graph","symbol_at","get_guide","onboarding","index","execute","exec_command","shell","code_mode"];
const FIELDS=["schema_version","observed_at_unix_ms","observation_id","producer_instance","sequence","store_epoch","event","producer_kind","workspace","caller","tool","local_invocation","native_call_id","turn_id","fingerprints","targets","outcome","diagnostics"];
const object=v=>v!==null && typeof v==='object' && !Array.isArray(v);
const fail=()=>{throw new Error('invalid observation');};
const exact=(v,keys)=>{if(!object(v)||Object.keys(v).sort().join('|')!==[...keys].sort().join('|')) fail();};
function scalar(s) { if(typeof s!=='string'||[...s].some(c=>c.codePointAt(0)>=0xd800&&c.codePointAt(0)<=0xdfff)) fail(); return s; }
function text(s,max=1024) {scalar(s);if(!s.trim()||Buffer.byteLength(s)>max||/[\u0000-\u001f]/u.test(s)) fail();return s;}
const optional=(v,fn=text)=>{if(v!==null) fn(v);};
const safe=n=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=0;
const path=s=>{text(s,4096);if(!s.startsWith('/'))fail();};
const uuid=s=>{text(s);if(!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(s))fail();};
export function canonicalJson(value,depth=0){
 if(depth>32)fail();
 if(value===null)return 'null';
 if(typeof value==='boolean')return String(value);
 if(typeof value==='number'){if(!Number.isSafeInteger(value))fail();return String(value);}
 if(typeof value==='string'){
   scalar(value);return '"'+[...value].map(c=>c==='"'?'\\"':c==='\\'?'\\\\':c.codePointAt(0)<32?'\\u'+c.codePointAt(0).toString(16).padStart(4,'0'):c).join('')+'"';
 }
 if(Array.isArray(value)){if(Object.keys(value).length!==value.length)fail();return '['+value.map(v=>canonicalJson(v,depth+1)).join(',')+']';}
 if(object(value)&&Object.getPrototypeOf(value)===Object.prototype){
   const keys=Object.keys(value);keys.forEach(scalar);
   keys.sort((a,b)=>{const x=[...a],y=[...b];for(let i=0;i<Math.min(x.length,y.length);i++){const d=x[i].codePointAt(0)-y[i].codePointAt(0);if(d)return d;}return x.length-y.length;});
   return '{'+keys.map(k=>canonicalJson(k,depth+1)+':'+canonicalJson(value[k],depth+1)).join(',')+'}';
 }
 fail();
}
export function fingerprint(value){return {domain:'canonical-json-safe-v1',digest:createHash('sha256').update(canonicalJson(value)).digest('hex')};}
function validateFingerprint(v){exact(v,['domain','digest']);if(!['canonical-json-safe-v1','bytes-v1'].includes(v.domain)||! /^[0-9a-f]{64}$/.test(v.digest))fail();}
export function validateObservation(v){
 exact(v,Object.hasOwn(v,'native_cwd')?[...FIELDS,'native_cwd']:FIELDS);
 if(v.schema_version!==1||!safe(v.sequence)||!safe(v.observed_at_unix_ms))fail();
 text(v.observation_id);uuid(v.producer_instance);uuid(v.store_epoch);path(v.workspace);if(Object.hasOwn(v,'native_cwd'))optional(v.native_cwd,path);
 if(!EVENTS.includes(v.event)||!['codex-hook','codescout-server'].includes(v.producer_kind)||!OUTCOMES.includes(v.outcome))fail();
 exact(v.caller,['harness','principal','thread_id','agent_id']);if(!['codex','unknown'].includes(v.caller.harness)||(v.producer_kind==='codex-hook'&&v.caller.harness!=='codex')||(v.caller.harness==='unknown'&&['principal','thread_id','agent_id'].some(k=>v.caller[k]!==null)))fail();
 optional(v.caller.principal,s=>{text(s);if(!s.startsWith('codex:')||s.length===6)fail();});
 optional(v.caller.thread_id);optional(v.caller.agent_id);
 optional(v.tool,s=>{if(!TOOLS.includes(s))fail();});optional(v.local_invocation);optional(v.native_call_id);optional(v.turn_id);
 if(!Array.isArray(v.fingerprints)||v.fingerprints.length>4||!Array.isArray(v.targets)||v.targets.length>64||!Array.isArray(v.diagnostics)||v.diagnostics.length>32)fail();
 v.fingerprints.forEach(validateFingerprint);
 for(const t of v.targets){exact(t,['path','phase','bytes_len','fingerprint']);path(t.path);if(!['attempted','committed','uncertain'].includes(t.phase)||!safe(t.bytes_len))fail();optional(t.fingerprint,validateFingerprint);}
 if(!v.diagnostics.every(x=>DIAGNOSTICS.includes(x)))fail();
 if(Buffer.byteLength(JSON.stringify(v))>65536)fail();
 return v;
}
export function normalizeHookObservation(payload,event,workspace){
 const diagnostic=d=>({diagnostic:d});
 if(!object(payload)||payload.session_id===undefined||payload.session_id==='')return diagnostic('missing-root');
 try{
   path(payload.cwd);text(payload.session_id);if(payload.agent_id!=null)text(payload.agent_id);
   if(payload.turn_id!=null)text(payload.turn_id);if(payload.tool_use_id!=null)text(payload.tool_use_id);
   const normalized=normalizeHookContext('codex',payload,workspace);
   if(normalized.state!=='available')return diagnostic('invalid-context');
   const context=normalized.context;
   const eventKind=event==='PreToolUse'?'hook-pre':event==='PostToolUse'?'hook-post':['SessionStart','SessionEnd','Stop','SubagentStart','SubagentStop','PreCompact','PostCompact','Interrupt'].includes(event)?'lifecycle':null;
   if(!eventKind)return diagnostic('unsupported-event');
   const rawTool=typeof payload.tool_name==='string'?payload.tool_name.replace(/^mcp__codescout__/,''):null;
   const tool=TOOLS.includes(rawTool)?rawTool:null;
   const diagnostics=rawTool&&!tool?['unsupported-tool']:[];
   const fingerprints=[];
   if(Object.hasOwn(payload,'tool_input')){try{fingerprints.push(fingerprint(payload.tool_input));}catch{diagnostics.push('unsupported-fingerprint');}}
   return {schema_version:1,event:eventKind,producer_kind:'codex-hook',workspace:context.workspace,native_cwd:payload.cwd,
     caller:{harness:'codex',principal:'codex:'+context.session_id,thread_id:context.agent_id,agent_id:context.agent_id},
     tool,local_invocation:null,native_call_id:payload.tool_use_id??null,turn_id:payload.turn_id??null,
     fingerprints,targets:[],outcome:'unknown',diagnostics};
 }catch{return diagnostic('invalid-context');}
}
