/** All receipt reads/compare-and-writes happen in the native-lock helper. */
export function createReceiptStore({platform,clock={now:()=>Date.now()}}) {
  if(typeof platform?.receiptTransaction!=='function')throw new Error('receipt platform is required');
  return {async transact(command){
    if(!command||typeof command.op!=='string')return {ok:false,receipt:null,reason:'invalid receipt command'};
    return platform.receiptTransaction({...command,nowMs:command.nowMs??clock.now()});
  }};
}
