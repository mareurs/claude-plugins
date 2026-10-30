import { readFile, realpath } from 'node:fs/promises';
import { isAbsolute, join, normalize } from 'node:path';
const nonempty=(v)=>typeof v==='string'&&v.trim().length>0;
const object=(v)=>v!==null&&typeof v==='object'&&!Array.isArray(v);

/** Read only the explicitly selected profile; malformed config never silently changes mode. */
export async function loadWakeConfig({profileRoot,environmentId}) {
  if(!nonempty(profileRoot)||!isAbsolute(profileRoot)||!nonempty(environmentId))throw new Error('absolute profile and explicit environment are required');
  const profile=await realpath(profileRoot);
  let value;
  try{value=JSON.parse(await readFile(join(profile,'codescout-wake.json'),'utf8'));}
  catch(error){
    if(error.code==='ENOENT')return {version:1,engine:'legacy',profileRoot:profile,environmentId,stateDir:join(profile,'codescout-wake-state'),pythonArgv:[process.platform==='win32'?'python':'python3'],adapters:{claudeCode:{enabled:true},codex:{enabled:false,endpoint:null}},bindings:{},capabilities:{},migration:null};
    throw new Error('wake configuration could not be read');
  }
  if(!object(value)||value.version!==1||!['legacy','v1'].includes(value.engine))throw new Error('unsupported wake configuration schema or engine');
  if(!nonempty(value.profileRoot)||!isAbsolute(value.profileRoot)||normalize(value.profileRoot)!==normalize(profile))throw new Error('configuration belongs to another profile');
  if(value.environmentId!==environmentId)throw new Error('configuration belongs to another environment');
  if(!nonempty(value.stateDir)||!isAbsolute(value.stateDir)||normalize(value.stateDir)!==value.stateDir)throw new Error('configuration stateDir must be absolute and normalized');
  if(!Array.isArray(value.pythonArgv)||!value.pythonArgv.length||!value.pythonArgv.every(nonempty))throw new Error('configuration requires executable/argument array for Python');
  const adapters=value.adapters;
  if(!object(adapters)||!object(adapters.claudeCode)||!object(adapters.codex)||typeof adapters.claudeCode.enabled!=='boolean'||typeof adapters.codex.enabled!=='boolean')throw new Error('configuration requires explicit adapter switches');
  if(adapters.codex.enabled&&(!nonempty(adapters.codex.endpoint)||!/^(unix|ws|wss):/.test(adapters.codex.endpoint)))throw new Error('configuration needs an explicit supported Codex endpoint');
  const bindings=value.bindings??{},capabilities=value.capabilities??{},migration=value.migration??null;
  if(!object(bindings)||Object.values(bindings).some(b=>!object(b)||!['hostVersion','hostInstanceId','runtimeGeneration'].every(k=>nonempty(b[k]))))throw new Error('invalid explicit host binding');
  if(!object(capabilities)||capabilities.codex!==undefined&&(!object(capabilities.codex)||typeof capabilities.codex.callbackPreserved!=='boolean'))throw new Error('invalid capability evidence');
  if(migration!==null&&(!object(migration)||!nonempty(migration.legacyStateDir)||!isAbsolute(migration.legacyStateDir)))throw new Error('invalid migration state directory');
  const maxPayload=adapters.codex.maxPayloadBytes??8*1024*1024;
  if(!Number.isSafeInteger(maxPayload)||maxPayload<1024||maxPayload>64*1024*1024)throw new Error('invalid Codex message-size budget');
  return {version:1,engine:value.engine,profileRoot:profile,environmentId,stateDir:value.stateDir,pythonArgv:[...value.pythonArgv],adapters:{claudeCode:{enabled:adapters.claudeCode.enabled},codex:{enabled:adapters.codex.enabled,endpoint:adapters.codex.endpoint??null,maxPayloadBytes:maxPayload}},bindings,capabilities,migration};
}
