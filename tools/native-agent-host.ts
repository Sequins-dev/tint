/** Native Test262 embedding glue. Each generated module instance belongs to one
 * hosted context; raw lifecycle records are its only link to other agents. */
export function nativeAgentHostSource(
  timeoutMilliseconds: number,
  maxAgents: number,
): string {
  return `
import {createNativeAgentCluster,attachNativeAgentWorker,type NativeAgentCluster,type NativeAgentWorker} from "agents";
import {attachSharedStorage} from "shared-bytes";
import {attachNativeSharedBlockService,nativeWaiterParkingHost} from "shared-service";
import {mapMemory as mapAgentMemory,startNativeThread,joinNativeThread,hostedThreadEntry,parkNativeWord} from "memory";
import {monotonicMilliseconds} from "clock";
import {processAtomicWaitEvents,numberValue,viewBigIntValue,bigIntToString,bigIntFromString,isCallableObject} from "object";
let activeNativeWorker:NativeAgentWorker|undefined=undefined;
let rootNativeCluster:NativeAgentCluster|undefined=undefined;
let nativeWorkerLeaving=false;
let nativeSleepCell=0;
let unhandledNativeAgentRejections=0;
function trackNativeAgentRejection(operation:string):void {
 if(activeNativeWorker===undefined)return;
 unhandledNativeAgentRejections+=operation==="reject"?1:-1;
 if(unhandledNativeAgentRejections<0)throw "NATIVE_AGENT_REJECTION_TRACKING";
}
function agentSleep(milliseconds:number):void {
 const duration=milliseconds!==milliseconds||milliseconds<0?0:milliseconds;
 const until=monotonicMilliseconds()+duration;
 if(nativeSleepCell===0){nativeSleepCell=mapAgentMemory(16384);if(nativeSleepCell<=0)throw "NATIVE_AGENT_SLEEP_MAPPING";}
 while(true){
  const cluster=rootNativeCluster;if(cluster!==undefined)cluster.check();
  const remaining=until-monotonicMilliseconds();if(remaining<=0)return;
  parkNativeWord(nativeSleepCell,0,Math.max(1,Math.min(10000000,Math.ceil(remaining*1000000))));
 }
}
function nativeCluster(realm:ErrorRealm):NativeAgentCluster {
 const existing=rootNativeCluster;if(existing!==undefined)return existing;
 const service=nativeSharedBlocks(realm),waiters=service.waitRegistry;if(waiters===undefined)throw "NATIVE_AGENT_WAIT_AUTHORITY";
 const created=createNativeAgentCluster(nativeSharedMemoryHost(),nativeWaiterParkingHost(),{
 entry:hostedThreadEntry(),start:(entry:number,argument:number):number=>startNativeThread(entry,argument),
 join:(thread:number):number=>joinNativeThread(thread),now:():number=>monotonicMilliseconds()
 },service.engineId,${maxAgents},${timeoutMilliseconds},{blocks:service.registry,waiters});
 if(!created.ok)return rejectUnsupportedExecution(realm);rootNativeCluster=created.value;return created.value;
}
function installNativeAgent(host:RealmHost,api:OrdinaryObject<ScriptPropertyKey,unknown>):void {
 const realm=host.realm,hooks=host.hooks,agent=createObject<ScriptPropertyKey,unknown>(realm.objectPrototype);
 function text(value:unknown):string {
  const converted=stringValue(value,hooks,realm);if(converted.error==="unsupported")return rejectUnsupportedExecution(realm);
  if(converted.error!=="none")throw createRuntimeError(realm,"type");return converted.value;
 }
 function number(value:unknown):number {
  const converted=numberValue(value,hooks,realm);if(converted.error==="unsupported")return rejectUnsupportedExecution(realm);
  if(converted.error!=="none")throw createRuntimeError(realm,"type");return converted.value;
 }
 function method(name:string,call:(args:readonly unknown[])=>unknown):void {
  const fn=createCallableObject<ScriptPropertyKey,unknown>(realm.functionPrototype,(receiver,args):unknown=>call(args));
  createDataProperty<ScriptPropertyKey,unknown>(agent,name,fn,hooks);
 }
 method("sleep",(args):unknown=>{agentSleep(number(args[0]));return undefined;});
 method("monotonicNow",(args):unknown=>monotonicMilliseconds());
 const worker=activeNativeWorker;
 if(worker===undefined){
  method("start",(args):unknown=>{const source=text(args[0]),started=nativeCluster(realm).start(source);if(!started.ok)return rejectUnsupportedExecution(realm);return undefined;});
  method("getReport",(args):unknown=>{const cluster=rootNativeCluster;if(cluster===undefined)return null;const report=cluster.getReport();return report===undefined?null:report;});
  method("broadcast",(args):unknown=>{
   const buffer=viewObjectValue(args[0],host.object),storage=buffer===undefined?undefined:buffer.internalSharedArrayBufferData;
   if(storage===undefined)throw createRuntimeError(realm,"type");
   const service=nativeSharedBlocks(realm);if(storage.engineId!==service.engineId)throw "NATIVE_AGENT_BLOCK_AUTHORITY";
   const bigint=viewBigIntValue(args[1]);let identifier="",isBigInt=false;
   if(bigint!==undefined){const encoded=bigIntToString(bigint,10);if(encoded===undefined)throw "NATIVE_AGENT_BIGINT";identifier=encoded;isBigInt=true;}
   else {const numeric=number(args[1]);let int=Number.isFinite(numeric)?Math.trunc(numeric)%4294967296:0;if(int<0)int+=4294967296;if(int>=2147483648)int-=4294967296;identifier=String(int);}
   nativeCluster(realm).broadcast(storage.handle,identifier,isBigInt);return undefined;
  });
 }else{
  method("report",(args):unknown=>{const sent=worker.report(text(args[0]));if(!sent.ok)return rejectUnsupportedExecution(realm);return undefined;});
  method("leaving",(args):unknown=>{if(!nativeWorkerLeaving){worker.leaving();nativeWorkerLeaving=true;}return undefined;});
  method("receiveBroadcast",(args):unknown=>{
   const callback=viewObjectValue(args[0],host.object);if(!isCallableObject<ScriptPropertyKey,unknown>(callback))throw createRuntimeError(realm,"type");
   while(true){
    const message=worker.pollBroadcast();if(message===undefined){agentSleep(1);continue;}
    const attached=attachSharedStorage(nativeSharedBlocks(realm),message.block);if(!attached.ok)throw "NATIVE_AGENT_BROADCAST_BLOCK";
    const buffer=createObject<ScriptPropertyKey,unknown>(realm.sharedArrayBufferPrototype);buffer.internalSharedArrayBufferData=attached.value;
    let identifier:unknown=Number(message.identifier);if(message.bigInt){const bigint=bigIntFromString(message.identifier);if(bigint===undefined)throw "NATIVE_AGENT_BIGINT";identifier=bigint;}
    const result=callObjectValue(callback,undefined,[buffer,identifier],host.object);if(result.error!=="none")throw result.value;
    return undefined;
   }
  });
 }
 createDataProperty<ScriptPropertyKey,unknown>(api,"agent",agent,hooks);
}
export function runNativeAgent(argument:number):number {
 const attached=attachNativeAgentWorker(nativeSharedMemoryHost(),nativeWaiterParkingHost(),argument);if(!attached.ok)return 70;
 const worker=attached.value;activeNativeWorker=worker;
 try {
  const source=worker.source(),blocks=worker.sharedBlocks,waiters=worker.sharedWaiters;
  if(blocks===undefined||waiters===undefined)throw "NATIVE_AGENT_SHARED_DESCRIPTORS";
  const service=attachNativeSharedBlockService(nativeSharedMemoryHost(),blocks,nativeSharedAtomicMemoryHost(),{parking:nativeWaiterParkingHost(),now:():number=>monotonicMilliseconds(),registry:waiters});
  if(!service.ok)throw "NATIVE_AGENT_SHARED_ATTACH";sharedBlocks=service.value;
  const realms:ErrorRealm[]=[],host=createRealmHost(undefined,realms,true);installRealmHost(host,realms);worker.running();
  host.evaluate(source);checkNativeAgentRealms(realms);
  let failed=false;pumpNativeAgentJobs(host,(error):void=>{failed=true;},():boolean=>failed||nativeWorkerLeaving);if(failed||unhandledNativeAgentRejections!==0)throw "NATIVE_AGENT_JOB_FAILURE";checkNativeAgentRealms(realms);
  if(!nativeWorkerLeaving){worker.leaving();nativeWorkerLeaving=true;}return 0;
 }catch(error){worker.failed("Uncaught native agent exception");return 70;}
}
function checkNativeAgentRealms(realms:readonly ErrorRealm[]):void {
 if(scriptFaultExit()!==0)throw "NATIVE_AGENT_SCRIPT_FAULT";
 for(let i=0;i<realms.length;i++){const realm=realms[i];if(realm!==undefined&&realm.unsupported)throw "NATIVE_AGENT_UNSUPPORTED";}
}
function pumpNativeAgentJobs(host:RealmHost,reportError:(error:unknown)=>void,complete:()=>boolean):void {
 const agent=host.realm.agent;
 while(true){
  drainScriptJobs(agent,reportError,():void=>{processAtomicWaitEvents(agent,true);});
  if(complete()||agent.pendingAtomicWaits.length===0)return;
  if(processAtomicWaitEvents(agent,true)===0)agentSleep(1);
 }
}
export function finishNativeAgents():void {const cluster=rootNativeCluster;if(cluster!==undefined)cluster.joinAll();}
`;
}
