import {createPlatform} from './platform-node.mjs';
import {createReceiptStore} from './receipt-store.mjs';
process.send({type:'ready'});
process.once('message',async ({options,command})=>{
  try{const store=createReceiptStore({platform:createPlatform(options),clock:{now:()=>1000}});process.send({type:'result',result:await store.transact(command)});}
  catch(error){process.send({type:'error',message:error.message});}
  finally{process.disconnect();}
});
