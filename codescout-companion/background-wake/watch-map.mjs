import {createHash} from 'node:crypto';
import {bindingKey,eventId,validateWatchRequest} from './model.mjs';

export const watchMapKey=(target,handle)=>createHash('sha256').update(JSON.stringify([bindingKey(target),handle])).digest('hex');
export async function registerWatch(request,platform){
  request=validateWatchRequest(request);
  const event={version:1,eventId:eventId(request.job,request.target,'terminal',0),kind:'terminal',sequence:0,job:request.job,target:request.target,payload:{}};
  return platform.receiptTransaction({op:'register-watch',eventId:event.eventId,event,request,mapKey:watchMapKey(request.target,request.job.handle)});
}
export async function readCurrentWatch(target,handle,platform){
  const value=await platform.readStateJson('map-'+watchMapKey(target,handle)+'.json');
  if(!value)return null;
  const request=validateWatchRequest(value.current??value);
  if(bindingKey(request.target)!==bindingKey(target)||request.job.handle!==handle)throw new Error('stored handle mapping differs from its binding');
  return request;
}
