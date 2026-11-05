import { verifyHostedFixture } from "./hosted-fixture.ts";
verifyHostedFixture(
  `
import {createObject,createCallableObject,createArrayFromList,createErrorRealm,createScriptAgent,createSymbolRegistry,installArrayIntrinsics,callObjectValue,getProperty,defineOwnProperty,setPrototype,wellKnownSymbol,viewObjectValue,type ObjectHooks,type ScriptPropertyKey} from "object";
export function run():number {
 const root=createObject<ScriptPropertyKey,unknown>(undefined);
 const hooks:ObjectHooks<unknown>={undefinedValue:undefined,sameValue:(a,b):boolean=>a===b,call:(fn,receiver,args):unknown=>{const result=callObjectValue(fn,receiver,args,root);if(result.error!=="none")throw 99;return result.value;}};
 const agent=createScriptAgent(),a=createErrorRealm(root,hooks,createSymbolRegistry(),agent),b=createErrorRealm(root,hooks,a.symbolRegistry,agent);
 installArrayIntrinsics(root,a,hooks);installArrayIntrinsics(root,b,hooks);
 const foreignConstructor=b.arrayConstructor;if(foreignConstructor===undefined)return 1;
 const poison=createCallableObject<ScriptPropertyKey,unknown>(b.functionPrototype,(receiver,args):unknown=>{throw 19;});
 defineOwnProperty<ScriptPropertyKey,unknown>(foreignConstructor,wellKnownSymbol(b.symbolRegistry,"species"),{fields:4,value:undefined,writable:false,get:poison,set:undefined,enumerable:false,configurable:false},hooks);
 setPrototype<ScriptPropertyKey,unknown>(foreignConstructor,a.functionPrototype);
 const foreign=createArrayFromList([1,42],0,b.arrayPrototype,b,hooks);
 const filter=getProperty<ScriptPropertyKey,unknown>(a.arrayPrototype,"filter",a.arrayPrototype,hooks);
 const callback=createCallableObject<ScriptPropertyKey,unknown>(a.functionPrototype,(receiver,args):unknown=>args[0]===42);
 const completion=callObjectValue(filter,foreign,[callback],root);
 const result=viewObjectValue(completion.value,root);
 if(completion.error!=="none"||result===undefined||result.prototype!==a.arrayPrototype)return 2;
 if(getProperty<ScriptPropertyKey,unknown>(result,"length",result,hooks)!==1||getProperty<ScriptPropertyKey,unknown>(result,"0",result,hooks)!==42)return 3;
 if(agent.activeContext!==undefined)return 4;
 return 42;
}`,
  "array-species",
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
