import {readFile,writeFile,access} from 'node:fs/promises';
import {basename,join} from 'node:path';
import {createHash} from 'node:crypto';
import {bindingKey,validateWatchRequest} from './model.mjs';
import {normalizeHookContext} from '../hooks/session-context.mjs';
import {stateHome} from '../hooks/lib.mjs';
import {homedir} from 'node:os';

const exists=async(path)=>{try{await access(path);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}};
const hash=(value)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Immutable per-record engine ownership also fences a rollback to the legacy wrapper. */
export async function selectEngine(record,engine,target=null){
  const path=record+'.wake-owner.json';
  if(engine==='v1'&&(await exists(record+'.watch')||await exists(record+'.delivered')))return false;
  const owner={version:1,engine,target:target?bindingKey(target):null};
  try{await writeFile(path,JSON.stringify(owner),{flag:'wx',mode:0o600});return true;}
  catch(e){if(e.code!=='EEXIST')return false;}
  try{const previous=JSON.parse(await readFile(path,'utf8'));return previous.version===1&&previous.engine===engine&&previous.target===owner.target;}
  catch{return false;}
}

async function hasLegacyMapping(request,config){
  if(request.target.harness!=='claude-code'||!/^[A-Za-z0-9_-]+$/.test(request.target.sessionId))return false;
  const roots=new Set([join(stateHome(homedir()),'codescout-companion','wake'),config.migration?.legacyStateDir].filter(Boolean));
  for(const root of roots){
    try{
      const record=(await readFile(join(root,'map-'+request.target.sessionId+'-'+request.job.handle),'utf8')).trim();
      if(record===request.job.recordPath)return true;
    }catch(e){if(e.code!=='ENOENT')throw e;}
  }
  return false;
}

/** Only the version-measured native hook shape can register a root target. */
export async function normalizeNativeWatch(harness,raw,config,platform){
  if(process.platform!=='linux')return null;
  const name=harness==='claude-code'?'claudeCode':'codex';
  const binding=config.bindings?.[name];
  const measured=harness==='claude-code'?'2.1.312':'0.165.0';
  if(config.engine!=='v1'||!config.adapters?.[name]?.enabled||!binding||binding.hostVersion!==measured)return null;
  if(raw?.hook_event_name!=='PostToolUse'||raw.tool_name!=='mcp__codescout__run_command'||raw.agent_id!=null||!raw.tool_use_id)return null;
  if(normalizeHookContext(harness,raw,raw.cwd,binding.hostVersion).state!=='available')return null;
  const content=harness==='claude-code'?raw.tool_response:raw.tool_response?.content;
  if(!Array.isArray(content))return null;
  let response;
  try{response=JSON.parse(content.find(c=>c.type==='text'||typeof c.text==='string')?.text);}catch{return null;}
  if(!response||typeof response!=='object')return null;
  const target={harness,profileRoot:config.profileRoot,environmentId:config.environmentId,hostInstanceId:binding.hostInstanceId,sessionId:raw.session_id,runtimeGeneration:binding.runtimeGeneration,origin:'root'};
  const root=await platform.privateStateRoot();
  const mapping=(handle)=>join(root,'map-'+hash([bindingKey(target),handle])+'.json');
  if(typeof response.record==='string'&&typeof response.output_id==='string'&&!('exit_code' in response)){
    const match=basename(response.record).match(/^([1-9][0-9]*)-([a-f0-9]{8})-(bg_[a-f0-9]{8})\.json$/);
    if(!match)return null;
    let request;
    try{request=validateWatchRequest({version:1,sourceEventId:raw.tool_use_id,target,job:{recordPath:response.record,schema:1,serverPid:Number(match[1]),serverToken:match[2],handle:response.output_id}});}catch{return null;}
    if(await hasLegacyMapping(request,config)||!await selectEngine(request.job.recordPath,'v1',target))return null;
    try{await writeFile(mapping(request.job.handle),JSON.stringify(request),{flag:'wx',mode:0o600});}
    catch(e){if(e.code!=='EEXIST')return null;const old=validateWatchRequest(JSON.parse(await readFile(mapping(request.job.handle),'utf8')));if(JSON.stringify(old.job)!==JSON.stringify(request.job))return null;}
    return request;
  }
  if(!('exit_code' in response))return null;
  const handles=typeof raw.tool_input?.command==='string'?[...raw.tool_input.command.matchAll(/@bg_[a-f0-9]{8}/g)].map(m=>m[0]):[];
  if(new Set(handles).size!==1)return null;
  try{
    const request=validateWatchRequest(JSON.parse(await readFile(mapping(handles[0]),'utf8')));
    if(bindingKey(request.target)!==bindingKey(target)||!await selectEngine(request.job.recordPath,'v1',target))return null;
    return {...request,sourceEventId:raw.tool_use_id};
  }catch{return null;}
}
