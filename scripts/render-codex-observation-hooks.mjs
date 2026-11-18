#!/usr/bin/env node
// Review-only source renderer. This never installs hooks, trusts hashes or writes profiles.
import {accessSync,constants,readFileSync,realpathSync,statSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {isAbsolute,join} from 'node:path';
import {pathToFileURL} from 'node:url';

const files=['hooks/codex-observation.mjs','hooks/observation-contract.mjs','hooks/session-context.mjs','codex/observation-hooks.json','contracts/operation-observation-v1.schema.json'];
const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
function checkedPath(path){
 if(typeof path!=='string'||!isAbsolute(path)||/[\u0000-\u001f]/u.test(path))throw new Error('observation adapter unavailable');
 return realpathSync(path);
}
function inspect(options){
 if(options.enabled===false)throw new Error('observation adapter disabled');
 if((options.contractVersion??1)!==1)throw new Error('incompatible observation contract');
 const pluginRoot=checkedPath(options.pluginRoot),codescoutPath=checkedPath(options.codescoutPath);
 accessSync(codescoutPath,constants.X_OK);if(!statSync(codescoutPath).isFile())throw new Error('observation CLI unavailable');
 const hash=createHash('sha256');
 for(const file of files){const data=readFileSync(join(pluginRoot,file));hash.update(file);hash.update(String(data.length));hash.update(data);}
 const schema=JSON.parse(readFileSync(join(pluginRoot,files.at(-1)),'utf8'));
 if(schema.properties?.schema_version?.const!==1)throw new Error('incompatible observation contract');
 return {pluginRoot,codescoutPath,adapter_sha256:hash.digest('hex')};
}
export function inspectObservationCapability(options){
 try{return {...inspect(options),contract_version:1,available:true,runtime_verified:false};}
 catch(error){return {contract_version:1,available:false,runtime_verified:false,diagnostic:/disabled|incompatible/.test(error.message)?error.message:'observation adapter unavailable'};}
}
export function renderObservationHooks(options){
 let info;try{info=inspect(options);}catch(error){throw new Error(/disabled|incompatible/.test(error.message)?error.message:'observation adapter unavailable');}
 const existing=options.existingHooks??{hooks:{}};
 if(!object(existing)||!object(existing.hooks??{}))throw new Error('incompatible existing hooks');
 const result=structuredClone(existing);result.hooks??={};
 const template=JSON.parse(readFileSync(join(info.pluginRoot,'codex/observation-hooks.json'),'utf8'));
 const command=[realpathSync(process.execPath),join(info.pluginRoot,'hooks/codex-observation.mjs'),'--codescout',info.codescoutPath].map(quote).join(' ');
 for(const [event,groups] of Object.entries(template.hooks)){
  if(result.hooks[event]!==undefined&&!Array.isArray(result.hooks[event]))throw new Error('incompatible existing hooks');
  const destination=result.hooks[event]??=[];
  for(const group of groups){
   const rendered=structuredClone(group);
   for(const handler of rendered.hooks){
    if(handler.type!=='command'||!handler.command.startsWith('__CODESCOUT_OBSERVATION_COMMAND__ '))throw new Error('incompatible observation hook template');
    handler.command=handler.command.replace('__CODESCOUT_OBSERVATION_COMMAND__',command);
    if(handler.timeout!==3)throw new Error('incompatible observation hook timeout');
   }
   if(!rendered.hooks.every(handler=>destination.some(g=>Array.isArray(g.hooks)&&g.hooks.some(h=>h.command===handler.command))))destination.push(rendered);
  }
  result.hooks[event]=destination;
 }
 return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  const args={};for(let i=2;i<process.argv.length;i++){const key=process.argv[i];if(key==='--capabilities'||key==='--disabled')args[key]=true;else args[key]=process.argv[++i];}
  const options={pluginRoot:args['--plugin-root'],codescoutPath:args['--codescout'],enabled:!args['--disabled'],contractVersion:args['--contract-version']===undefined?1:Number(args['--contract-version'])};
  if(args['--existing'])options.existingHooks=JSON.parse(readFileSync(args['--existing'],'utf8'));
  const value=args['--capabilities']?inspectObservationCapability(options):renderObservationHooks(options);
  process.stdout.write(JSON.stringify(value,null,2)+'\n');
 }catch{process.stderr.write('Cannot render observation hooks: check source paths, contract and enabled adapter.\n');process.exitCode=1;}
}
