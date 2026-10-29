import {readFile,stat,realpath,statfs} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {join,resolve,isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const helper=fileURLToPath(new URL('./receipt_txn.py',import.meta.url));
const networkFs=new Set([0x6969,0xff534d42,0xfe534d42]);

export function createPlatform({profileRoot,stateDir,pythonArgv=[process.platform==='win32'?'python':'python3']}) {
  if(!isAbsolute(profileRoot)||!isAbsolute(stateDir)||!Array.isArray(pythonArgv)||!pythonArgv.length)throw new Error('explicit native profile/state and Python argv are required');
  const sandbox=process.env.CS_TEST_STATE_SANDBOX;
  const root=sandbox?join(resolve(sandbox),'background-wake',createHash('sha256').update(resolve(profileRoot)).digest('hex')):resolve(stateDir);
  const spawnArgv=(executable,args,options={})=>spawn(executable,args,{...options,shell:false,stdio:options.stdio||['pipe','pipe','pipe']});
  const invoke=(command)=>new Promise((done)=>{
    const child=spawnArgv(pythonArgv[0],[...pythonArgv.slice(1),'-X','utf8','-I',helper,'--state-dir',root]);
    let out='',err='',finished=false;
    const finish=(value)=>{if(!finished){finished=true;clearTimeout(timer);done(value);}};
    const timer=setTimeout(()=>{child.kill();finish({ok:false,receipt:null,reason:'receipt transaction timed out; no send permit'});},5000);
    child.on('error',(e)=>finish({ok:false,receipt:null,reason:e.code==='ENOENT'?'Python unavailable':`receipt helper unavailable (${e.code||'spawn'})`}));
    child.stdin.on('error',()=>{});
    child.stdout.on('data',(bytes)=>{out+=bytes;if(out.length>2*1024*1024){child.kill();finish({ok:false,receipt:null,reason:'receipt helper reply exceeds budget'});}});
    child.stderr.on('data',(bytes)=>{if(err.length<4096)err+=bytes;});
    child.on('close',(code)=>{
      if(finished)return;
      try{const value=JSON.parse(out);if(typeof value.ok!=='boolean')throw new Error('invalid reply');finish(value);}
      catch{finish({ok:false,receipt:null,reason:`receipt helper failed (${code}): ${err.slice(0,240)}`});}
    });
    child.stdin.end(JSON.stringify(command));
  });
  let ready;
  const privateStateRoot=async()=>{
    if(!ready)ready=(async()=>{
      if(Number(process.versions.node.split('.')[0])<24)throw new Error('Node 24 or newer is required');
      await realpath(profileRoot);
      const result=await invoke({op:'probe'});
      if(!result.ok)throw new Error(result.reason);
      const storage=await realpath(root);
      const fs=await statfs(storage);
      if(networkFs.has(Number(fs.type)>>>0))throw new Error('network filesystem state is unsupported');
      return root;
    })();
    return ready;
  };
  return {
    profileRoot:resolve(profileRoot),stateDir:root,spawnArgv,privateStateRoot,
    async receiptTransaction(command){try{await privateStateRoot();return await invoke(command);}catch(e){return {ok:false,receipt:null,reason:e.message};}},
    async readRecord(path){
      try{
        if((await stat(path)).size>1024*1024)return {kind:'unsupported',reason:'record exceeds read budget'};
        const record=JSON.parse(await readFile(path,'utf8'));
        if(record.schema!==1||!['running','exited','failed'].includes(record.state)||!Number.isSafeInteger(record.server_pid)||record.server_pid<=0)return {kind:'unsupported',reason:'unsupported record schema or state'};
        return {kind:'available',record};
      }catch(e){return e.code==='ENOENT'?{kind:'missing'}:{kind:'error',reason:e instanceof SyntaxError?'invalid record JSON':e.code||'record unreadable'};}
    },
    async processStatus(identity){
      const pid=identity?.pid??identity?.serverPid;
      if(!Number.isSafeInteger(pid)||pid<=0)return 'unknown';
      try{process.kill(pid,0);return 'alive';}catch(e){return e.code==='ESRCH'?'dead':'unknown';}
    },
  };
}
