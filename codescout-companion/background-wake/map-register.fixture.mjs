import {createPlatform} from './platform-node.mjs';
import {registerWatch} from './watch-map.mjs';
process.send({kind:'ready'});
process.on('message',async(message)=>{
 if(message.kind!=='go')return;
 try{const result=await registerWatch(message.request,createPlatform(message.options));process.send({kind:'done',result},()=>process.disconnect());}
 catch(e){process.send({kind:'done',result:{ok:false,reason:e.message}},()=>process.disconnect());}
});
