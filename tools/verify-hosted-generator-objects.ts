import { verifyHostedFixture } from "./hosted-fixture.ts";

verifyHostedFixture(
  `import {createGeneratorObject,createSourceGeneratorFunction,createErrorRealm,createObject,getProperty,setProperty,callObjectValue,viewObjectValue,wellKnownSymbol,type GeneratorContinuation,type ScriptPropertyKey,type ObjectHooks} from "object";
import type {GeneratorOutcome} from "protocol";
export function run():number {
 const hooks:ObjectHooks<unknown>={undefinedValue:undefined,sameValue:(a,b):boolean=>a===b,call:(callee,receiver,args):unknown=>{throw "UNEXPECTED_CALL";}};
 const root=createObject<ScriptPropertyKey,unknown>(undefined);
 const realm=createErrorRealm(root,hooks);
 const yielded=createObject<ScriptPropertyKey,unknown>(root);
 let phase=0;
 const generator=createGeneratorObject((kind:string,value:unknown):GeneratorOutcome<unknown> =>{
  phase++;if(phase===1)return {kind:"yield",result:yielded};
  return {kind:"return",value};
 },realm);
 const otherRoot=createObject<ScriptPropertyKey,unknown>(undefined);
 const other=createErrorRealm(otherRoot,hooks);
 const next=getProperty<ScriptPropertyKey,unknown>(other.generatorPrototype,"next",other.generatorPrototype,hooks);
 const first=callObjectValue(next,generator,[99],root);
 if(first.error!=="none"||first.value!==yielded)return 1;
 for(let i=0;i<30000;i++){const garbage=createObject<ScriptPropertyKey,unknown>(root);if(garbage.internalExoticSlots!.internalGeneratorData!==undefined)return 11;}
 const second=callObjectValue(next,generator,[42],root);
 const result=viewObjectValue(second.value,root);
 if(second.error!=="none"||result===undefined)return 2;
 if(result.prototype!==otherRoot||getProperty<ScriptPropertyKey,unknown>(result,"value",result,hooks)!==42||getProperty<ScriptPropertyKey,unknown>(result,"done",result,hooks)!==true)return 3;
 const record=generator.internalExoticSlots?.internalGeneratorData;if(record===undefined||record.continuation!==undefined)return 4;
 const iterator=getProperty<ScriptPropertyKey,unknown>(generator,wellKnownSymbol(realm.symbolRegistry,"iterator"),generator,hooks);
 if(callObjectValue(iterator,generator,[],root).value!==generator)return 5;
 const fake=createObject<ScriptPropertyKey,unknown>(generator);
 const invalid:unknown[]=[undefined,42,realm.generatorPrototype,fake];
 let errors=0;
 for(const receiver of invalid){
  try{callObjectValue(next,receiver,[],root);}catch(error){
   const value=viewObjectValue(error,root);
   if(value===undefined||getProperty<ScriptPropertyKey,unknown>(value,"name",value,hooks)!=="TypeError")return 6;
   errors++;
  }
 }
 if(errors!==4)return 7;
 const untouched=createGeneratorObject((kind:string,value:unknown):GeneratorOutcome<unknown> =>{throw "BODY_MUST_NOT_START";},realm);
 const returnMethod=getProperty<ScriptPropertyKey,unknown>(untouched,"return",untouched,hooks);
 const early=callObjectValue(returnMethod,untouched,[19],root);
 const earlyResult=viewObjectValue(early.value,root);
 if(early.error!=="none"||earlyResult===undefined||getProperty<ScriptPropertyKey,unknown>(earlyResult,"value",earlyResult,hooks)!==19)return 8;
 const throwMethod=getProperty<ScriptPropertyKey,unknown>(untouched,"throw",untouched,hooks);
 try{callObjectValue(throwMethod,untouched,[yielded],root);return 9;}catch(error){if(error!==yielded)return 10;}
 const selected=createObject<ScriptPropertyKey,unknown>(realm.generatorPrototype);
 let initialized=0,entered=0;
 const source=createSourceGeneratorFunction((receiver:unknown,args:readonly unknown[],callee:unknown):GeneratorContinuation =>{
  initialized++;
  if(receiver!==yielded||args[0]!==42)throw "generator call arguments";
  const fn=viewObjectValue(callee,root);if(fn===undefined)throw "generator identity";
  if(!setProperty<ScriptPropertyKey,unknown>(fn,"prototype",selected,{value:fn,object:fn},hooks))throw "generator prototype update";
  return (kind:string,value:unknown):GeneratorOutcome<unknown> =>{entered++;return {kind:"return",value:args[0]};};
 },realm,hooks,"source",1,root);
 if(initialized!==0||entered!==0||source.internalConstruct!==undefined||source.internalRareSlots?.internalHomeObject!==root)return 12;
 const created=callObjectValue(source,yielded,[42],root);
 const instance=viewObjectValue(created.value,root);
 if(created.error!=="none"||instance===undefined||instance.prototype!==selected||initialized!==1||entered!==0)return 13;
 const completed=callObjectValue(next,instance,[99],root);
 const completedResult=viewObjectValue(completed.value,root);
 if(completedResult===undefined||getProperty<ScriptPropertyKey,unknown>(completedResult,"value",completedResult,hooks)!==42||entered!==1)return 14;
 if(!setProperty<ScriptPropertyKey,unknown>(source,"prototype",42,{value:source,object:source},hooks))return 15;
 const fallback=createSourceGeneratorFunction((receiver:unknown,args:readonly unknown[],callee:unknown):GeneratorContinuation =>{
  const fn=viewObjectValue(callee,root);if(fn===undefined)throw "generator identity";
  if(!setProperty<ScriptPropertyKey,unknown>(fn,"prototype",42,{value:fn,object:fn},hooks))throw "generator prototype update";
  return (kind:string,value:unknown):GeneratorOutcome<unknown> =>{return {kind:"return",value};};
 },realm,hooks);
 const fallbackResult=callObjectValue(fallback,undefined,[],root);
 const fallbackInstance=viewObjectValue(fallbackResult.value,root);
 if(fallbackInstance===undefined||fallbackInstance.prototype!==realm.generatorPrototype)return 16;
 const bad=createSourceGeneratorFunction((receiver:unknown,args:readonly unknown[],callee:unknown):GeneratorContinuation =>{throw yielded;},realm,hooks);
 try{callObjectValue(bad,undefined,[],root);return 17;}catch(error){if(error!==yielded)return 18;}
 return 42;
}`,
  "generator-objects",
  [
    ["object", "packages/js-runtime/src/objects/index.ts"],
    ["protocol", "packages/js-runtime/src/iterators/index.ts"],
  ],
  [],
  [
    {
      module: "packages/js-runtime/src/objects/index.ts",
      name: "viewObjectValue",
      operation: "view",
    },
    {
      module: "packages/js-runtime/src/objects/index.ts",
      name: "viewSymbolValue",
      operation: "view",
    },
    {
      module: "packages/js-runtime/src/objects/index.ts",
      name: "viewBigIntValue",
      operation: "view",
    },
  ],
  [
    {
      module: "packages/js-runtime/src/objects/index.ts",
      namespace: "ordinary-object",
      retainedExports: [
        "viewObjectValue",
        "viewSymbolValue",
        "viewBigIntValue",
      ],
    },
  ],
);
