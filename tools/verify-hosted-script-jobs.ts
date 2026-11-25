import { verifyHostedFixture } from "./hosted-fixture.ts";

const records = process.argv.includes("--script-records");
verifyHostedFixture(
  `import {createScriptRecord,createScriptAgent,runScriptContext,enqueueScriptJob,drainScriptJobs,createErrorRealm,createObject,createSourceFunction,callObject,createGeneratorObject,type ScriptPropertyKey,type ObjectHooks,type OrdinaryObject} from "objects";
import {resumeGenerator,type GeneratorOutcome} from "generators";
export function run():number{
 const hooks:ObjectHooks<unknown>={undefinedValue:undefined,sameValue:(a,b):boolean=>a===b,call:(callee,receiver,args):unknown=>undefined};
 const agent=createScriptAgent();
 const a=createErrorRealm(createObject<ScriptPropertyKey,unknown>(undefined),hooks,undefined,agent);
 const b=createErrorRealm(createObject<ScriptPropertyKey,unknown>(undefined),hooks,undefined,agent);
 const metadata={source:"definition"};
 const definition=${records ? "createScriptRecord(a,metadata)" : '"definition"'},caller=${records ? "createScriptRecord(b,undefined)" : '"caller"'},enqueue=${records ? "createScriptRecord(a,undefined)" : '"enqueue"'},generatorSource=${records ? "createScriptRecord(a,undefined)" : '"generator"'},consumer=${records ? "createScriptRecord(b,undefined)" : '"consumer"'};
 ${records ? 'if(definition.kind!=="script"||definition.realm!==a||definition.hostDefined!==metadata||definition===enqueue)return 5;' : ""}
 const fn=runScriptContext<OrdinaryObject<ScriptPropertyKey,unknown>>(agent,{realm:a,scriptOrModule:definition},()=>createSourceFunction((receiver,args,callee,newTarget):unknown=>{
  const active=agent.activeContext;
  if(active===undefined||active.realm!==a)throw "source realm";
  return active.scriptOrModule;
 },false,a,hooks));
 const called=runScriptContext<unknown>(agent,{realm:b,scriptOrModule:caller},():unknown=>callObject<ScriptPropertyKey,unknown>(fn,undefined,[],undefined).value);
 if(called!==definition||agent.activeContext!==undefined)return 1;
 let jobs=0,reported=0;
 runScriptContext<unknown>(agent,{realm:a,scriptOrModule:enqueue},():unknown=>{
  enqueueScriptJob(agent,():void=>{
   const active=agent.activeContext;
   if(active===undefined||active.realm!==b||active.scriptOrModule!==enqueue)throw "job context";
   if(drainScriptJobs(agent,(error):void=>{throw error;})!==0)throw "nested checkpoint";
   jobs++;
  },b.executionContext);
  if(drainScriptJobs(agent,(error):void=>{throw error;})!==0)throw "active checkpoint";
  return undefined;
 });
 enqueueScriptJob(agent,():void=>{throw 42;},a.executionContext);
 enqueueScriptJob(agent,():void=>{jobs++;},undefined);
 ${records ? "for(let i=0;i<160;i++){const garbage=new Uint32Array(8192);garbage[0]=i;if(garbage[0]!==i)return 6;}if(definition.hostDefined!==metadata||definition.realm!==a)return 7;" : ""}
 const count=drainScriptJobs(agent,(error):void=>{if(agent.activeContext!==undefined||error!==42)throw "job report";reported++;});
 if(count!==3||jobs!==2||reported!==1||agent.activeContext!==undefined)return 2;
 const generator=runScriptContext<OrdinaryObject<ScriptPropertyKey,unknown>>(agent,{realm:a,scriptOrModule:generatorSource},()=>createGeneratorObject((kind,value):GeneratorOutcome<unknown> =>{
  const active=agent.activeContext;
  if(active===undefined||active.realm!==a||active.scriptOrModule!==generatorSource)throw "generator context";
  return {kind:"return",value:42};
 },a));
 const record=generator.internalExoticSlots?.internalGeneratorData;
 if(record===undefined)return 3;
 const result=runScriptContext<unknown>(agent,{realm:b,scriptOrModule:consumer},():unknown=>resumeGenerator<unknown>(record,"next",undefined,{
  undefinedValue:undefined,typeError:():unknown=>19,iteratorResult:(value,done):unknown=>{
   const active=agent.activeContext;
   if(active===undefined||active.realm!==b||active.scriptOrModule!==consumer)throw "completion context";
   return value;
  },
 }));
 if(result!==42||agent.activeContext!==undefined)return 4;
 return 42;
}`,
  records ? "script-record-jobs" : "script-jobs",
  [
    ["objects", "packages/js-runtime/src/objects/index.ts"],
    ["generators", "packages/js-runtime/src/iterators/index.ts"],
  ],
);
