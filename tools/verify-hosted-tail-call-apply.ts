import { verifyHostedFixture } from "./hosted-fixture.ts";

verifyHostedFixture(
  `
import {createObject,createCallableObject,createErrorRealm,callObject,constructObject,installFunctionIntrinsics,getOwnProperty,viewObjectValue,createArrayFromList,type ObjectHooks,type ScriptPropertyKey} from "objects";
import {createTailSourceFunction,requestSourceTailCall} from "source-calls";
import {createSourceExecutionContext} from "contexts";
export function run():number {
 const witness=createObject<ScriptPropertyKey,unknown>(undefined);
 const hooks:ObjectHooks<unknown>={undefinedValue:undefined,sameValue:(a,b):boolean=>a===b,call:(fn,receiver,args):unknown=>undefined};
 const realm=createErrorRealm(witness,hooks),execution=createSourceExecutionContext(realm);
 installFunctionIntrinsics(witness,realm,hooks);
 for(const method of ["call","apply"]){
  if(method===undefined)throw "TAIL_METHOD_INVARIANT";
  const descriptor=getOwnProperty<ScriptPropertyKey,unknown>(realm.functionPrototype,method);
  if(descriptor===undefined)return 60;
  const builtin=viewObjectValue(descriptor.value,witness);
  if(builtin===undefined)return 61;
  let remaining=100000,calls=0;
  const fn=createTailSourceFunction((receiver,args,callee,newTarget):unknown=>{
   calls++;
   if(remaining===0)return 42;
   remaining--;
   const values:unknown[]=method==="call"?[undefined,remaining]:[undefined,createArrayFromList([remaining],0,realm.arrayPrototype,realm,hooks)];
   const request=requestSourceTailCall(builtin,callee,values,witness,realm);
   if(request.error!=="none")throw 62;
   return request.value;
  },false,realm,hooks,"f",1);
  if(callObject<ScriptPropertyKey,unknown>(fn,undefined,[100000],undefined).value!==42||calls!==100001)return 63;
  if(realm.agent.activeContext!==undefined||realm.agent.activeTailCallFrame!==undefined)return 64;
 }
 return 42;
}
`,
  "tail-call-apply",
  [
    ["objects", "packages/js-runtime/src/objects/index.ts"],
    ["source-calls", "packages/js-runtime/src/objects/functions.ts"],
    ["contexts", "packages/js-runtime/src/objects/jobs.ts"],
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
