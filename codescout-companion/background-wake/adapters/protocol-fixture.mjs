import {createServer} from 'node:http';
import {WebSocketServer} from 'ws';
import {mkdtemp,rm,chmod} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

export async function withProtocol(fn,{reply}={}){
  const root=await mkdtemp(join(tmpdir(),'wake-rpc-'));
  const server=createServer();const wss=new WebSocketServer({server,perMessageDeflate:false});
  const path=join(root,'daemon.sock');const messages=[],connections=[];
  wss.on('connection',socket=>{
    connections.push(socket);socket.on('message',async(bytes)=>{
      const m=JSON.parse(bytes);messages.push(m);
      if(m.id===undefined)return;
      let result;
      if(reply){const custom=await reply(m,socket);if(custom===false)return;if(custom!==undefined){socket.send(JSON.stringify({id:m.id,...custom}));return;}}
      if(m.method==='initialize')result={codexHome:root,userAgent:'codex-tui/0.160.0 (fixture)',platformOs:'linux'};
      else if(m.method==='thread/loaded/list')result={data:['session']};
      else if(m.method==='thread/read'||m.method==='thread/resume')result={thread:{id:m.params.threadId,status:{type:'idle'}}};
      else result={};
      socket.send(JSON.stringify({id:m.id,result}));
    });
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(path,resolve);});await chmod(path,0o600);
  try{await fn({root,endpoint:'unix://'+path,messages,connections,broadcast:(m)=>connections.forEach(s=>{if(s.readyState===1)s.send(JSON.stringify(m));})});}
  finally{connections.forEach(s=>s.terminate());await new Promise(r=>wss.close(r));await new Promise(r=>server.close(r));await rm(root,{recursive:true,force:true});}
}
