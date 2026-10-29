import {realpath,stat} from 'node:fs/promises';
import {isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
import {connect} from 'node:net';

/** A generation is pinned to the native socket inode, never just a pathname. */
export async function endpointIdentity(endpoint){
  if(process.platform!=='linux'||typeof endpoint!=='string'||!endpoint.startsWith('unix://'))throw new Error('unsupported Codex endpoint: only measured Linux Unix IPC is enabled');
  const path=endpoint.slice(7);
  if(!isAbsolute(path)||path.includes('\0'))throw new Error('absolute Unix endpoint required');
  const resolved=await realpath(path),info=await stat(resolved);
  if(!info.isSocket()||info.uid!==process.getuid()||(info.mode&0o077)!==0)throw new Error('Codex endpoint must be a private current-user socket');
  return {path:resolved,generation:createHash('sha256').update(JSON.stringify([resolved,info.dev,info.ino,info.ctimeMs])).digest('hex')};
}

/** Secondary connection only. No daemon startup, thread creation, unload or interrupt. */
export async function connectCodex({endpoint,clientInfo,signal,requestTimeoutMs=5000,maxPayload=8*1024*1024}){
  if(!Number.isSafeInteger(maxPayload)||maxPayload<1024||maxPayload>64*1024*1024)throw new Error('invalid Codex message-size budget');
  const identity=await endpointIdentity(endpoint);
  const {default:WebSocket}=await import('ws');
  const socket=new WebSocket('ws+unix:///codescout-ipc:/',{createConnection:()=>connect(identity.path),perMessageDeflate:false,followRedirects:false,handshakeTimeout:requestTimeoutMs,maxPayload});
  const pending=new Map(),listeners=new Set(),closedListeners=new Set();
  let counter=0,closed=false;
  const failure=(reason)=>{closed=true;for(const {reject,timer} of pending.values()){clearTimeout(timer);reject(new Error(reason));}pending.clear();for(const fn of closedListeners)fn(reason);};
  socket.on('error',e=>failure(e.message));
  socket.on('close',()=>failure('Codex secondary connection closed'));
  socket.on('message',bytes=>{
    let message;try{message=JSON.parse(bytes);}catch{failure('invalid Codex JSON response');socket.terminate();return;}
    if(message.id!==undefined&&!message.method){
      const item=pending.get(message.id);if(!item)return;pending.delete(message.id);clearTimeout(item.timer);
      if(message.error){const error=new Error(message.error.message||'Codex request rejected');error.code=message.error.code;item.reject(error);}else item.resolve(message.result);
    }else if(message.method&&message.id===undefined){for(const fn of listeners)fn(message);}
    else if(message.method&&message.id!==undefined){
      // A secondary wake client must never silently become the tool/approval owner.
      socket.send(JSON.stringify({id:message.id,error:{code:-32601,message:'background wake secondary client cannot serve host callbacks'}}));
      failure('host routed a primary-client callback to the wake connection');socket.close();
    }
  });
  const abort=()=>socket.terminate();
  signal?.addEventListener('abort',abort,{once:true});
  if(signal?.aborted)abort();
  const request=(method,params={})=>new Promise((resolve,reject)=>{
    if(closed||socket.readyState!==WebSocket.OPEN){reject(new Error('Codex connection closed'));return;}
    const id=++counter;
    const timer=setTimeout(()=>{pending.delete(id);reject(new Error('Codex request timed out; delivery may be unknown'));},requestTimeoutMs);
    pending.set(id,{resolve,reject,timer});
    socket.send(JSON.stringify({id,method,params}),error=>{if(error){clearTimeout(timer);pending.delete(id);reject(error);}});
  });
  const close=async()=>{signal?.removeEventListener('abort',abort);if(closed){socket.terminate();return;}socket.close();await new Promise(resolve=>{const timer=setTimeout(()=>{socket.terminate();resolve();},300);socket.once('close',()=>{clearTimeout(timer);resolve();});});};
  try{
    await new Promise((resolve,reject)=>{socket.once('open',resolve);socket.once('error',reject);});
    const server=await request('initialize',{clientInfo,capabilities:{experimentalApi:true}});
    socket.send(JSON.stringify({method:'initialized',params:{}}));
    return {
      server,identity,request,close,
      onClose(fn){closedListeners.add(fn);return ()=>closedListeners.delete(fn);},
      async subscribeThread(threadId,onEvent){
        const loaded=await request('thread/loaded/list',{});
        if(!loaded.data?.includes(threadId))throw new Error('target thread is not loaded');
        listeners.add(onEvent);
        try{
          const result=await request('thread/resume',{threadId,excludeTurns:true});
          if(result.thread?.id!==threadId)throw new Error('attach returned another thread');
          return ()=>listeners.delete(onEvent);
        }catch(e){listeners.delete(onEvent);throw e;}
      },
    };
  }catch(e){await close();throw e;}
}
