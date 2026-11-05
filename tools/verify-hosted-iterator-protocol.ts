import { verifyHostedFixture } from "./hosted-fixture.ts";
verifyHostedFixture(
  `
import {createObject,createCallableObject,createDataProperty,getScriptIterator,stepScriptIterator,skipScriptIterator,closeScriptIterator,createErrorRealm,wellKnownSymbol,callObjectValue,type ScriptPropertyKey,type ObjectHooks} from "object";
export function run():number {
 const root=createObject<ScriptPropertyKey,unknown>(undefined);
 const hooks:ObjectHooks<unknown>={undefinedValue:undefined,sameValue:(a,b):boolean=>a===b,call:(method,receiver,args):unknown=>{
   const result=callObjectValue(method,receiver,args,root);if(result.error!=="none")throw "CALL_ERROR";return result.value;
 }};
 const realm=createErrorRealm(root,hooks);
 const iterable=createObject<ScriptPropertyKey,unknown>(root),iterator=createObject<ScriptPropertyKey,unknown>(root);
 let calls=0,closed=0;
 const next=createCallableObject<ScriptPropertyKey,unknown>(realm.functionPrototype,(receiver,args):unknown=>{
   if(receiver!==iterator||args.length!==0)throw "NEXT_RECEIVER";
   const result=createObject<ScriptPropertyKey,unknown>(root);
   createDataProperty<ScriptPropertyKey,unknown>(result,"done",calls++>0,hooks);
   createDataProperty<ScriptPropertyKey,unknown>(result,"value",42,hooks);
   return result;
 });
 const returnMethod=createCallableObject<ScriptPropertyKey,unknown>(realm.functionPrototype,(receiver,args):unknown=>{if(receiver!==iterator||args.length!==0)throw "RETURN_RECEIVER";closed++;return createObject<ScriptPropertyKey,unknown>(root);});
 createDataProperty<ScriptPropertyKey,unknown>(iterator,"next",next,hooks);
 createDataProperty<ScriptPropertyKey,unknown>(iterator,"return",returnMethod,hooks);
 const method=createCallableObject<ScriptPropertyKey,unknown>(realm.functionPrototype,(receiver,args):unknown=>{if(receiver!==iterable)throw "ITERATOR_RECEIVER";return iterator;});
 createDataProperty<ScriptPropertyKey,unknown>(iterable,wellKnownSymbol(realm.symbolRegistry,"iterator"),method,hooks);
 const record=getScriptIterator(iterable,realm,hooks);
 createDataProperty<ScriptPropertyKey,unknown>(iterator,"next",undefined,hooks);
 const first=stepScriptIterator(record),last=stepScriptIterator(record);
 if(first.done||first.value!==42||!last.done||last.value!==undefined||calls!==2)return 1;
 if(!stepScriptIterator(record).done||calls!==2)return 2;
 closeScriptIterator(record,false);if(closed!==0)return 3;
 createDataProperty<ScriptPropertyKey,unknown>(iterator,"next",next,hooks);
 const early=getScriptIterator(iterable,realm,hooks);closeScriptIterator(early,false);closeScriptIterator(early,false);if(closed!==1)return 4;
 const badReturn=createCallableObject<ScriptPropertyKey,unknown>(realm.functionPrototype,(receiver,args):unknown=>{closed++;throw "CLOSE_FAIL";});
 createDataProperty<ScriptPropertyKey,unknown>(iterator,"return",badReturn,hooks);
 const suppressed=getScriptIterator(iterable,realm,hooks);closeScriptIterator(suppressed,true);if(closed!==2)return 5;
 let caught=false;try{closeScriptIterator(getScriptIterator(iterable,realm,hooks),false);}catch(error){caught=error==="CLOSE_FAIL";}if(!caught||closed!==3)return 6;
 calls=0;const elided=getScriptIterator(iterable,realm,hooks);skipScriptIterator(elided);if(calls!==1||elided.record.done)return 7;
 const invalid=getScriptIterator(iterable,realm,hooks);createDataProperty<ScriptPropertyKey,unknown>(iterator,"next",undefined,hooks);
 let invalidCall=false;const missing=getScriptIterator(iterable,realm,hooks);try{stepScriptIterator(missing);}catch{invalidCall=true;}
 if(!invalidCall||!missing.record.done)return 8;
 closeScriptIterator(missing,false);if(closed!==3)return 9;
 return 42;
}
`,
  "iterator-protocol",
  [["object", "packages/js-runtime/src/objects/index.ts"]],
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
