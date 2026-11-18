import { createHash } from 'node:crypto';
import { isAbsolute, basename, normalize } from 'node:path';

/** @typedef {{recordPath:string,schema:1,serverPid:number,serverToken:string,handle:string}} JobRef */
/** @typedef {{harness:'claude-code'|'codex',profileRoot:string,hostInstanceId:string,environmentId:string,sessionId:string,runtimeGeneration:string,origin:'root'}} TargetBinding */
/** @typedef {{version:1,job:JobRef,target:TargetBinding,sourceEventId:string}} WatchRequest */
/** @typedef {{version:1,eventId:string,kind:'terminal'|'heartbeat'|'tracking-lost',job:JobRef,target:TargetBinding,sequence:number,payload:object,attemptId?:string,handleValid?:boolean}} DeliveryEvent */
/** @typedef {{supported:boolean,reason:string,evidenceRef:string|null}} Capability */
/** @typedef {{version:1,event:DeliveryEvent,state:string,attemptId?:string,ownerToken?:string,leaseUntilMs?:number,lastEvidence?:object,lastError?:object,updatedAtMs:number}} Receipt */
/** @typedef {{state:'accepted'|'continuation_observed'|'completed',eventId:string,attemptId:string,correlation:object}} Evidence */
/** @typedef {{kind:'pre-send-failure'|'emitted-unconfirmed'|'unknown'|'finished',reason:string}} DeliveryResult */
/** @typedef {{capability:Function,validateTarget:Function,deliver:Function,close:Function}} HostAdapter */
/** @typedef {{transact:Function}} ReceiptStore */

const nonempty = (v) => typeof v === 'string' && v.trim().length > 0;
const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const hash = (parts) => createHash('sha256').update(JSON.stringify(parts)).digest('hex');
const jobFields = ['recordPath','schema','serverPid','serverToken','handle'];
const bindingFields = ['harness','profileRoot','hostInstanceId','environmentId','sessionId','runtimeGeneration','origin'];
const requiredValues = (value, fields) => {
  if (!object(value) || fields.some((key) => value[key] === undefined || value[key] === null)) throw new Error('identity fields are required');
  return fields.map((key) => value[key]);
};

export function jobKey(job) { return hash(['job-v1', ...requiredValues(job,jobFields)]); }
export function bindingKey(target) { return hash(['binding-v1', ...requiredValues(target,bindingFields)]); }
export function eventId(job,target,kind,sequence=0) {
  if (!['terminal','heartbeat','tracking-lost'].includes(kind) || !Number.isSafeInteger(sequence) || sequence < 0 || (kind !== 'heartbeat' && sequence !== 0)) throw new Error('invalid event kind or sequence');
  return `wake1:${hash(['event-v1',jobKey(job),bindingKey(target),kind,sequence])}`;
}

/** Validate supplied identity; no path or target is inferred from message contents. */
export function validateWatchRequest(value) {
  if (!object(value) || value.version !== 1 || !nonempty(value.sourceEventId)) throw new Error('unsupported watch schema or origin event');
  const {job,target}=value;
  requiredValues(job,jobFields);requiredValues(target,bindingFields);
  if (job.schema !== 1) throw new Error('unsupported record schema');
  if (!nonempty(job.recordPath) || !isAbsolute(job.recordPath) || !nonempty(target.profileRoot) || !isAbsolute(target.profileRoot)) throw new Error('identity paths must be absolute');
  if (normalize(job.recordPath)!==job.recordPath || normalize(target.profileRoot)!==target.profileRoot) throw new Error('identity paths must be normalized');
  if (!Number.isSafeInteger(job.serverPid) || job.serverPid <= 0 || !/^[a-f0-9]{8}$/.test(job.serverToken) || !/^@bg_[a-f0-9]{8}$/.test(job.handle)) throw new Error('invalid record identity');
  if (basename(job.recordPath)!==`${job.serverPid}-${job.serverToken}-${job.handle.slice(1)}.json`) throw new Error('record identity differs from provided path');
  if (!['claude-code','codex'].includes(target.harness) || target.origin!=='root') throw new Error('unsupported host or origin');
  if (bindingFields.some((key)=>!nonempty(target[key]))) throw new Error('empty target identity');
  return {version:1,job:Object.fromEntries(jobFields.map((key)=>[key,job[key]])),target:Object.fromEntries(bindingFields.map((key)=>[key,target[key]])),sourceEventId:value.sourceEventId};
}

/** Only allowlisted outcome facts enter model context; raw command/output never do. */
export function formatDeliveryEvent(event) {
  validateWatchRequest({version:1,job:event?.job,target:event?.target,sourceEventId:'delivery'});
  if(event.version!==1||event.eventId!==eventId(event.job,event.target,event.kind,event.sequence))throw new Error('invalid delivery event identity');
  const prefix=`codescout background job ${event.job.handle}`;
  const suffix=` Event ${event.eventId}.`;
  const read=event.handleValid===false?' The originating handle cannot be verified; do not read it on a replacement server.':` Read it with run_command("tail -50 ${event.job.handle}").`;
  if(event.kind==='tracking-lost')return `${prefix}: originating server/record is unavailable; job state unknown and this handle is invalid.${suffix} Do not read the handle on a replacement server.`;
  if(event.kind==='heartbeat')return `${prefix} is still recorded as running.${suffix}${event.handleValid===false?read:` Read it with run_command("tail -50 ${event.job.handle}") to continue watching.`}`;
  const p=event.payload||{};
  let outcome;
  if(p.state==='exited'){
    if(p.exitCode!==null&&!Number.isSafeInteger(p.exitCode))throw new Error('invalid job exit code');
    outcome=p.exitCode===null?'terminated by signal':`exited ${p.exitCode}`;
  }else if(p.state==='failed')outcome='failed to start or track';
  else throw new Error('terminal event requires an observed terminal state');
  const duration=Number.isFinite(p.durationMs)&&p.durationMs>=0?` after ${Math.round(p.durationMs/1000)}s`:'';
  return `${prefix} ended: ${outcome}${duration}.${suffix}${read}`;
}
