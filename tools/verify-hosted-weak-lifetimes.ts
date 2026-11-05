import { verifyHostedFixture } from "./hosted-fixture.ts";
const weak = "packages/native-runtime/src/intrinsics/weak.ts",
  objects = "packages/js-runtime/src/objects/index.ts";
verifyHostedFixture(
  `import {createWeakSlot,weakSlotKey,weakSlotValue,setWeakSlotValue,clearWeakSlot} from "weak";
import {createObject,createCallableObject,createErrorRealm,createSymbolRegistry,createScriptAgent,installWeakRefIntrinsics,installFinalizationRegistryIntrinsics,constructObjectValue,callObjectValue,getProperty,viewObjectValue,clearKeptObjects,drainScriptJobs,type OrdinaryObject,type ScriptPropertyKey,type ObjectHooks} from "objects";
export function run():number{
 const root=createObject<ScriptPropertyKey,unknown>(undefined);
 const hooks:ObjectHooks<unknown>={undefinedValue:undefined,sameValue:(a,b):boolean=>a===b,call:(fn,receiver,args):unknown=>{const result=callObjectValue(fn,receiver,args,root);if(result.error!=="none")throw "call";return result.value;}};
 const agent=createScriptAgent(),realm=createErrorRealm(root,hooks,createSymbolRegistry(),agent);
 agent.weakStorage={create:(key:unknown,value:unknown,ephemeron:boolean):unknown=>createWeakSlot(key,value,ephemeron),key:(cell:unknown):unknown=>weakSlotKey(cell),value:(cell:unknown):unknown=>weakSlotValue(cell),setValue:(cell:unknown,value:unknown):void=>{setWeakSlotValue(cell,value);},clear:(cell:unknown):void=>{clearWeakSlot(cell);}};
 installWeakRefIntrinsics(root,realm,hooks);installFinalizationRegistryIntrinsics(root,realm,hooks);
 function construct(name:string,args:unknown[]):unknown{const ctor=getProperty<ScriptPropertyKey,unknown>(root,name,root,hooks),result=constructObjectValue(ctor,args,root);if(result.error!=="none")throw "construct";return result.value;}
 function method(value:unknown,name:string,args:unknown[]):unknown{const object=viewObjectValue(value,root);if(object===undefined)throw "view";const fn=getProperty<ScriptPropertyKey,unknown>(object,name,object,hooks),result=callObjectValue(fn,object,args,root);if(result.error!=="none")throw "method";return result.value;}
 function pressure():void{for(let i=0;i<50000;i++){const cell=createWeakSlot(i,undefined,false);if(weakSlotKey(cell)!==i)throw "pressure";}}
 function makeRef():unknown{return construct("WeakRef",[createObject<ScriptPropertyKey,unknown>(undefined)]);}
 function present(ref:unknown):boolean{return method(ref,"deref",[])!==undefined;}
 const ref=makeRef();pressure();if(!present(ref)||agent.keptAlive.length===0)return 1;
 clearKeptObjects(agent);pressure();if(present(ref))return 2;
 let cleaned=0;
 const callback=createCallableObject<ScriptPropertyKey,unknown>(realm.functionPrototype,(receiver,args):unknown=>{if(receiver!==undefined||args.length!==1||args[0]!==19)throw "cleanup";cleaned++;return undefined;});
 const registry=construct("FinalizationRegistry",[callback]);
 function registerOne():void{const key=createObject<ScriptPropertyKey,unknown>(undefined);method(registry,"register",[key,19,key]);}
 registerOne();pressure();if(cleaned!==0)return 3;
 let failed=false;drainScriptJobs(agent,(error):void=>{failed=true;});if(failed||cleaned!==1)return 4;
 function orphan():unknown{let owner:unknown=undefined;const callback=createCallableObject<ScriptPropertyKey,unknown>(realm.functionPrototype,(receiver,args):unknown=>owner);owner=construct("FinalizationRegistry",[callback]);return createWeakSlot(owner,undefined,false);}
 const orphanCell=orphan();pressure();if(weakSlotKey(orphanCell)!==undefined)return 5;
 clearKeptObjects(agent);if(method(registry,"unregister",[ref])!==false||agent.registries.length!==1)return 6;
 return 42;
 }`,
  "weak-lifetimes",
  [
    ["weak", weak],
    ["objects", objects],
  ],
  [],
  [
    { module: objects, name: "viewObjectValue", operation: "view" },
    { module: objects, name: "viewSymbolValue", operation: "view" },
    { module: objects, name: "viewBigIntValue", operation: "view" },
    { module: objects, name: "viewWeakRegistryOwner", operation: "view" },
  ],
  [
    { module: weak, namespace: "weak-storage" },
    {
      module: objects,
      namespace: "ordinary-object",
      retainedExports: [
        "viewObjectValue",
        "viewSymbolValue",
        "viewBigIntValue",
        "viewWeakRegistryOwner",
      ],
    },
  ],
  {
    runtimeEntry: "initializeCopyingRuntime",
    managedBytes: 2097152,
    allocationCapacity: 65536,
    rootCapacity: 8192,
    stackBytes: 2097152,
    weakBindings: [
      { module: weak, name: "createWeakSlot", operation: "new" },
      { module: weak, name: "weakSlotKey", operation: "key" },
      { module: weak, name: "weakSlotValue", operation: "value" },
      { module: weak, name: "setWeakSlotValue", operation: "set-value" },
      { module: weak, name: "clearWeakSlot", operation: "clear" },
    ],
  },
);
