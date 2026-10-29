import {normalizeNativeWatch} from '../intake.mjs';
import {formatDeliveryEvent} from '../model.mjs';
export const normalizeClaudeWatch=(raw,config,platform)=>normalizeNativeWatch('claude-code',raw,config,platform);

/** asyncRewake emission cannot establish host acceptance. */
export function createClaudeAdapter(config,{emit=(text)=>new Promise((resolve,reject)=>process.stderr.write(text+'\n',error=>error?reject(error):resolve()))}={}){
  const capability=async()=>({supported:config.engine==='v1'&&config.adapters.claudeCode.enabled&&config.bindings?.claudeCode?.hostVersion==='2.1.312',reason:'Claude asyncRewake emits without correlated acknowledgement',evidenceRef:'claude-2.1.312-native-hooks'});
  return {
    capability,validateTarget:capability,
    async deliver(event){
      await emit(formatDeliveryEvent(event));
      return {kind:'emitted-unconfirmed',reason:'stderr emission; asyncRewake acceptance unobservable'};
    },
    async close(){},
  };
}
