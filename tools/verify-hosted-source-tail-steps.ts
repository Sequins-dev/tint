import { verifyHostedFixture } from "./hosted-fixture.ts";

verifyHostedFixture(
  `
import {createObject,createCallableObject,createErrorRealm,callObject,ensureRareSlots,type ObjectHooks,type ScriptPropertyKey} from "objects";
import {runSourceTailCallStep,requestSourceTailCall} from "source-calls";
import {createSourceExecutionContext} from "contexts";
export function run():number {
 const witness=createObject<ScriptPropertyKey,unknown>(undefined);
 const hooks:ObjectHooks<unknown>={undefinedValue:undefined,sameValue:(a,b):boolean=>a===b,call:(fn,receiver,args):unknown=>undefined};
 const realm=createErrorRealm(witness,hooks),execution=createSourceExecutionContext(realm);
 let remaining=100000,calls=0;
 const left=createCallableObject<ScriptPropertyKey,unknown>(undefined,(receiver,args):unknown=>{throw 90;});
 const right=createCallableObject<ScriptPropertyKey,unknown>(undefined,(receiver,args):unknown=>{throw 91;});
 ensureRareSlots<ScriptPropertyKey,unknown>(left).internalTailDispatch=(receiver,args)=>runSourceTailCallStep(():unknown=>{
  calls++;
  if(realm.agent.activeContext?.realm!==realm||realm.agent.activeTailCallFrame===undefined)throw 60;
  if(remaining===0)return 42;
  remaining--;
  const request=requestSourceTailCall(right,receiver,args,witness,realm);
  if(request.error!=="none")throw 61;
  return request.value;
 },execution,realm);
 ensureRareSlots<ScriptPropertyKey,unknown>(right).internalTailDispatch=(receiver,args)=>runSourceTailCallStep(():unknown=>{
  calls++;
  if(realm.agent.activeContext?.realm!==realm||realm.agent.activeTailCallFrame===undefined)throw 62;
  if(remaining===0)return 42;
  remaining--;
  return requestSourceTailCall(left,receiver,args,witness,realm).value;
 },execution,realm);
 const result=callObject<ScriptPropertyKey,unknown>(left,7,[42],undefined);
 if(result.error!=="none"||result.value!==42||calls!==100001)return 63;
 if(realm.agent.activeContext!==undefined||realm.agent.activeTailCallFrame!==undefined)return 64;
 let caught=0;
 try{runSourceTailCallStep(():unknown=>{requestSourceTailCall(left,undefined,[],witness,realm);throw 73;},execution,realm);}
 catch(error){caught=error===73?73:1;}
 if(caught!==73||realm.agent.activeContext!==undefined||realm.agent.activeTailCallFrame!==undefined)return 65;
 const nested=runSourceTailCallStep(():unknown=>{
  const owner=realm.agent.activeTailCallFrame;
  const inner=runSourceTailCallStep(():unknown=>requestSourceTailCall(left,1,[2],witness,realm).value,execution,realm);
  if(inner.kind!=="call"||realm.agent.activeTailCallFrame!==owner||owner?.pending!==undefined)throw 66;
  return 42;
 },execution,realm);
 if(nested.kind!=="return"||nested.value!==42||realm.agent.activeTailCallFrame!==undefined)return 67;
 return 42;
}
`,
  "source-tail-steps",
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
