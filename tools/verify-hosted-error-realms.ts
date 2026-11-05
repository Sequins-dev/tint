import { verifyHostedFixture } from "./hosted-fixture.ts";
verifyHostedFixture(
  `
import {createObject,createConstructorObject,createArrayFromList,createErrorRealm,createScriptAgent,createSymbolRegistry,installErrorIntrinsics,installArrayIntrinsics,constructObject,createDataProperty,viewObjectValue,type ObjectHooks,type ScriptPropertyKey} from "object";
export function run():number {
 const root=createObject<ScriptPropertyKey,unknown>(undefined);
 const hooks:ObjectHooks<unknown>={undefinedValue:undefined,sameValue:(a,b):boolean=>a===b,call:(fn,receiver,args):unknown=>undefined};
 const agent=createScriptAgent(),a=createErrorRealm(root,hooks,createSymbolRegistry(),agent),b=createErrorRealm(root,hooks,a.symbolRegistry,agent);
 installErrorIntrinsics(root,a,hooks);installArrayIntrinsics(root,a,hooks);
 const target=createConstructorObject<ScriptPropertyKey,unknown>(b.functionPrototype,(receiver,args):unknown=>undefined,(args,newTarget):unknown=>root);
 createDataProperty<ScriptPropertyKey,unknown>(target,"prototype",42,hooks);
 const type=a.constructors.get("type");if(type===undefined)return 1;
 const first=constructObject<ScriptPropertyKey,unknown>(type,[],{object:target,value:target},undefined);
 const error=viewObjectValue(first.value,root);
 if(error===undefined||error.prototype!==b.prototypes.get("type"))return 2;
 // AggregateError uses the foreign intrinsic too, while iterating in its constructor realm.
 const aggregate=a.constructors.get("aggregate");if(aggregate===undefined)return 3;
 const input=createArrayFromList([],0,a.arrayPrototype,a,hooks);
 const second=constructObject<ScriptPropertyKey,unknown>(aggregate,[input],{object:target,value:target},undefined);
 const aggregated=viewObjectValue(second.value,root);
 if(aggregated===undefined||aggregated.prototype!==b.prototypes.get("aggregate"))return 4;
 if(agent.activeContext!==undefined)return 5;
 return 42;
}`,
  "error-realms",
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
