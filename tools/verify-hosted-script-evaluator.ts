import { verifyHostedFixture } from "./hosted-fixture.ts";
const objects = "packages/js-runtime/src/objects/index.ts";
// Native portability of evaluator orchestration with injected AOT host hooks.
// This fixture does not compile/publish machine code or establish conformance;
// the separate managed-Script fixture covers real native compilation/execution.
verifyHostedFixture(
  `
import {createScriptEvaluator,type ScriptEvaluator} from "evaluator";
import {type ErrorRealm,type ScriptRecord,type ScriptPropertyKey,type ScriptCompletionRecord,type ObjectHooks,createObject,createErrorRealm,installErrorIntrinsics,scriptSameValue,callObjectValue,viewObjectValue} from "objects";
import {createGlobalEnvironment} from "global";
interface State{domain:number;compiles:number;invokes:number;fail:boolean;bad:boolean;first:ScriptRecord|undefined;done:ScriptCompletionRecord|undefined;fault:string;}
interface Fixture{readonly state:State;readonly realm:ErrorRealm;readonly evaluate:ScriptEvaluator;}
function make():Fixture{
 const object=createObject<ScriptPropertyKey,unknown>(undefined);
 const hooks:ObjectHooks<unknown>={undefinedValue:undefined,sameValue:(a,b):boolean=>scriptSameValue(a,b),call:(callee,receiver,args):unknown=>{const result=callObjectValue(callee,receiver,args,object);if(result.error!=="none")throw "FIXTURE_CALL";return result.value;}};
 const realm=createErrorRealm(object,hooks);installErrorIntrinsics(object,realm,hooks);
 const global=createGlobalEnvironment<ScriptPropertyKey,unknown>(object,object,object,(name:string):ScriptPropertyKey=>name,hooks);
 const table:{readonly value:number}={value:42};
 const state:State={domain:17,compiles:0,invokes:0,fail:false,bad:false,first:undefined,done:{error:"none",value:42},fault:""};
 const evaluate=createScriptEvaluator({realm,global},{domain:():number=>state.domain,storage:{domain:17,publish:(bytes:Uint8Array):number|undefined=>{throw "EVALUATOR_PUBLISH";}},table:():unknown=>table,compile:(module)=>{state.compiles++;return state.fail?{ok:false,stage:"emit"}:{ok:true,address:4096};},invoke:(address,frame):unknown=>{state.invokes++;if(address!==4096||frame.$imports!==table||frame.$argument0!==global||frame.$argument1.realm!==realm||frame.$argument1.kind!=="script"||frame.$argument1.hostDefined!==undefined)state.bad=true;const first=state.first;if(first===undefined)state.first=frame.$argument1;else if(first===frame.$argument1)state.bad=true;return state.done;},completion:(value):ScriptCompletionRecord|undefined=>value===state.done?state.done:undefined,fault:(reason):void=>{state.fault=reason;}});
 return {state,realm,evaluate};
}
function churn():void{for(let i=0;i<1024;i++){const words=new Uint32Array(8192);words[0]=i;if(words[0]!==i)throw "CHURN";}}
export function run():number{
 const a=make();if(a.evaluate("42;")!==42||a.state.compiles!==1||a.state.invokes!==1||a.state.bad)return 60;
 const first=a.state.first;if(first===undefined)return 61;
 churn();a.state.done={error:"none",value:19};if(a.evaluate("19;")!==19||a.state.compiles!==2||a.state.invokes!==2||a.state.bad||a.state.first!==first)return 62;
 a.state.done={error:"throw",value:42};let thrown=false;try{a.evaluate("throw 42;");}catch(error){thrown=error===42;}if(!thrown||a.realm.unsupported)return 63;
 let syntax=false;try{a.evaluate("var");}catch(error){const object=viewObjectValue(error,a.realm.objectPrototype);syntax=object!==undefined&&object.prototype===a.realm.prototypes.get("syntax");}if(!syntax||a.state.compiles!==3||a.realm.unsupported)return 64;
 let unsupported=false;try{a.evaluate(19);}catch(error){unsupported=error===undefined;}if(!unsupported||!a.realm.unsupported)return 65;
 try{a.evaluate("42;");return 66;}catch(error){if(error!==undefined)return 67;}if(a.state.compiles!==3)return 68;
 const b=make();b.state.fail=true;try{b.evaluate("42;");return 69;}catch(error){if(error!==undefined)return 70;}if(!b.realm.unsupported||b.state.invokes!==0)return 71;
 const c=make();c.state.domain=18;try{c.evaluate("var");return 72;}catch(error){if(error!==undefined)return 73;}if(c.state.compiles!==0)return 74;
 const d=make();d.state.done={error:"invalid",value:undefined};try{d.evaluate("42;");return 75;}catch(error){if(error!==undefined)return 76;}if(d.state.fault!=="completion-kind"||!d.realm.unsupported)return 77;
 return 42;
}
`,
  "script-evaluator",
  [
    ["evaluator", "packages/js-engine/src/script-evaluation.ts"],
    ["objects", objects],
    ["global", "packages/js-runtime/src/environments/global/index.ts"],
  ],
  [],
  ["viewObjectValue", "viewSymbolValue", "viewBigIntValue"].map((name) => ({
    module: objects,
    name,
    operation: "view" as const,
  })),
  [
    {
      module: objects,
      namespace: "ordinary-object",
      retainedExports: [
        "viewObjectValue",
        "viewSymbolValue",
        "viewBigIntValue",
      ],
    },
  ],
  {
    runtimeEntry: "initializeCopyingRuntime",
    managedBytes: 67108864,
    allocationCapacity: 1048576,
    stackBytes: 16777216,
  },
);
