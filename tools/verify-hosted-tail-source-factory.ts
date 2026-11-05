import { verifyHostedFixture } from "./hosted-fixture.ts";

verifyHostedFixture(
  `
import {createObject,createCallableObject,createErrorRealm,callObject,constructObject,type ObjectHooks,type ScriptPropertyKey} from "objects";
import {createTailSourceFunction,requestSourceTailCall} from "source-calls";
import {createSourceExecutionContext} from "contexts";
export function run():number {
 const witness=createObject<ScriptPropertyKey,unknown>(undefined);
 const hooks:ObjectHooks<unknown>={undefinedValue:undefined,sameValue:(a,b):boolean=>a===b,call:(fn,receiver,args):unknown=>undefined};
 const realm=createErrorRealm(witness,hooks),execution=createSourceExecutionContext(realm);
 let remaining=100000,calls=0;
 const fn=createTailSourceFunction((receiver,args,callee,newTarget):unknown=>{
  if(newTarget!==undefined||realm.agent.activeContext?.realm!==realm)throw 60;
  calls++;
  if(remaining===0)return 42;
  remaining--;
  const request=requestSourceTailCall(callee,receiver,[remaining],witness,realm);
  if(request.error!=="none")throw 61;
  return request.value;
 },false,realm,hooks,"f",1);
 if(callObject<ScriptPropertyKey,unknown>(fn,7,[100000],undefined).value!==42||calls!==100001)return 62;
 if(realm.agent.activeContext!==undefined||realm.agent.activeTailCallFrame!==undefined)return 63;
 const primitive=createCallableObject<ScriptPropertyKey,unknown>(undefined,(receiver,args):unknown=>7);
 let constructed:unknown=undefined;
 const constructor=createTailSourceFunction((receiver,args,callee,newTarget):unknown=>{
  constructed=receiver;
  if(newTarget===undefined||callee!==newTarget)throw 64;
  return requestSourceTailCall(primitive,undefined,[],witness,realm).value;
 },true,realm,hooks,"C",0);
 const result=constructObject<ScriptPropertyKey,unknown>(constructor,[],{value:constructor,object:constructor},undefined);
 if(result.error!=="none"||result.value!==constructed)return 65;
 if(realm.agent.activeContext!==undefined||realm.agent.activeTailCallFrame!==undefined)return 66;
 return 42;
}
`,
  "tail-source-factory",
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
