import { verifyHostedFixture } from "./hosted-fixture.ts";

verifyHostedFixture(
  `
import {createObject,createCallableObject,createErrorRealm,callObject,constructObject,installEvalIntrinsic,type ObjectHooks,type ScriptPropertyKey} from "objects";
import {createTailSourceFunction,requestSourceTailCall,runSourceTailCallStep} from "source-calls";
import {createSourceExecutionContext} from "contexts";
import {callEvalTailCandidate} from "eval-candidates";
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
  const request=callEvalTailCandidate(callee,receiver,[remaining],witness,realm,0,undefined);
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
 const intrinsic=installEvalIntrinsic(witness,realm,hooks);
 let evaluated=0;
 realm.directEvalCompiler=(source,flags,site):unknown=>{
  if(source!=="1"||flags!==1||realm.agent.activeContext?.realm!==realm||realm.agent.activeTailCallFrame?.pending!==undefined)throw 68;
  evaluated++;return 42;
 };
 const direct=runSourceTailCallStep(():unknown=>callEvalTailCandidate(intrinsic,undefined,["1"],witness,realm,1,undefined).value,execution,realm);
 if(direct.kind!=="return"||direct.value!==42||evaluated!==1)return 69;

 return 42;
}
`,
  "tail-eval-candidate",
  [
    ["objects", "packages/js-runtime/src/objects/index.ts"],
    ["source-calls", "packages/js-runtime/src/objects/functions.ts"],
    ["contexts", "packages/js-runtime/src/objects/jobs.ts"],
    ["eval-candidates", "packages/js-runtime/src/objects/global-properties.ts"],
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
