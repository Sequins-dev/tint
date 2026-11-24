import { verifyHostedFixture } from "./hosted-fixture.ts";
const objects = "packages/js-runtime/src/objects/index.ts";
// Native portability of evaluator orchestration with injected AOT host hooks.
// This fixture does not compile/publish machine code or establish conformance;
// the separate managed-Script fixture covers real native compilation/execution.
// Global declaration admission must reject conflicting Scripts before compile.
verifyHostedFixture(
  `
import {createScriptEvaluator,type ScriptEvaluator} from "evaluator";
import {type ErrorRealm,type ScriptRecord,type ScriptPropertyKey,type ScriptCompletionRecord,type ObjectHooks,createObject,createErrorRealm,installErrorIntrinsics,scriptSameValue,callObjectValue,viewObjectValue,preventExtensions,type OrdinaryObject} from "objects";
import {createGlobalEnvironment,type GlobalEnvironment} from "global";
import {createMutableBinding} from "records";
interface State{domain:number;compiles:number;invokes:number;fail:boolean;bad:boolean;first:ScriptRecord|undefined;done:ScriptCompletionRecord|undefined;fault:string;}
interface Fixture{readonly state:State;readonly realm:ErrorRealm;readonly object:OrdinaryObject<ScriptPropertyKey,unknown>;readonly global:GlobalEnvironment<ScriptPropertyKey,unknown>;readonly evaluate:ScriptEvaluator;}
function make():Fixture{
 const object=createObject<ScriptPropertyKey,unknown>(undefined);
 const hooks:ObjectHooks<unknown>={undefinedValue:undefined,sameValue:(a,b):boolean=>scriptSameValue(a,b),call:(callee,receiver,args):unknown=>{const result=callObjectValue(callee,receiver,args,object);if(result.error!=="none")throw "FIXTURE_CALL";return result.value;}};
 const realm=createErrorRealm(object,hooks);installErrorIntrinsics(object,realm,hooks);
 const global=createGlobalEnvironment<ScriptPropertyKey,unknown>(object,object,object,(name:string):ScriptPropertyKey=>name,hooks);
 const table:{readonly value:number}={value:42};
 const state:State={domain:17,compiles:0,invokes:0,fail:false,bad:false,first:undefined,done:{error:"none",value:42},fault:""};
 const evaluate=createScriptEvaluator({realm,global},{domain:():number=>state.domain,storage:{domain:17,publish:(bytes:Uint8Array):number|undefined=>{throw "EVALUATOR_PUBLISH";}},table:():unknown=>table,compile:(module,shape)=>{state.compiles++;return state.fail?{ok:false,stage:"emit"}:{ok:true,address:4096};},invoke:(address,frame):unknown=>{state.invokes++;if(address!==4096||frame.$imports!==table||frame.$argument0!==global||frame.$argument1.realm!==realm||frame.$argument1.kind!=="script"||frame.$argument1.hostDefined!==undefined)state.bad=true;const first=state.first;if(first===undefined)state.first=frame.$argument1;else if(first===frame.$argument1)state.bad=true;return state.done;},completion:(value):ScriptCompletionRecord|undefined=>value===state.done?state.done:undefined,fault:(reason):void=>{state.fault=reason;}});
 return {state,realm,object,global,evaluate};
}
function rejects(f:Fixture,source:string,kind:string):boolean{try{f.evaluate(source);return false;}catch(error){const object=viewObjectValue(error,f.realm.objectPrototype);return object!==undefined&&object.prototype===f.realm.prototypes.get(kind)&&f.state.compiles===0&&f.state.invokes===0&&!f.realm.unsupported;}}
function churn():void{for(let i=0;i<1024;i++){const words=new Uint32Array(8192);words[0]=i;if(words[0]!==i)throw "CHURN";}}
export function run():number{
 const a=make();if(a.evaluate("40 + 2;")!==42||a.state.compiles!==1||a.state.invokes!==1||a.state.bad)return 60;
 const first=a.state.first;if(first===undefined)return 61;
 churn();a.state.done={error:"none",value:19};if(a.evaluate("18 + 1;")!==19||a.state.compiles!==2||a.state.invokes!==2||a.state.bad||a.state.first!==first)return 62;
 a.state.done={error:"throw",value:42};let thrown=false;try{a.evaluate("throw 42;");}catch(error){thrown=error===42;}if(!thrown||a.realm.unsupported)return 63;
 let syntax=false;try{a.evaluate("var");}catch(error){const object=viewObjectValue(error,a.realm.objectPrototype);syntax=object!==undefined&&object.prototype===a.realm.prototypes.get("syntax");}if(!syntax||a.state.compiles!==3||a.realm.unsupported)return 64;
 let unsupported=false;try{a.evaluate(19);}catch(error){unsupported=error===undefined;}if(!unsupported||!a.realm.unsupported)return 65;
 try{a.evaluate("40 + 2;");return 66;}catch(error){if(error!==undefined)return 67;}if(a.state.compiles!==3)return 68;
 const b=make();b.state.fail=true;try{b.evaluate("40 + 2;");return 69;}catch(error){if(error!==undefined)return 70;}if(!b.realm.unsupported||b.state.invokes!==0)return 71;
 const c=make();c.state.domain=18;try{c.evaluate("var");return 72;}catch(error){if(error!==undefined)return 73;}if(c.state.compiles!==0)return 74;
 const d=make();d.state.done={error:"invalid",value:undefined};try{d.evaluate("40 + 2;");return 75;}catch(error){if(error!==undefined)return 76;}if(d.state.fault!=="completion-kind"||!d.realm.unsupported)return 77;
 const e=make();preventExtensions<ScriptPropertyKey,unknown>(e.object);if(!rejects(e,"var fresh;","type"))return 78;if(!rejects(e,"var x; function g() {}","type"))return 79;
 const f=make();createMutableBinding<unknown>(f.global.lexical,"taken",false);if(!rejects(f,"var x; let taken;","syntax"))return 80;if(!rejects(f,"var x; var taken;","syntax"))return 81;
 const g=make();if(g.evaluate("var v; let l; function h() {}")!==42||g.state.compiles!==1||g.state.invokes!==1)return 82;
 return 42;
}
`,
  "script-evaluator",
  [
    ["evaluator", "packages/js-engine/src/script-evaluation.ts"],
    ["objects", objects],
    ["global", "packages/js-runtime/src/environments/global/index.ts"],
    ["records", "packages/js-runtime/src/environments/records/index.ts"],
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
    runtimeEntry: "initializeGenerationalRuntime",
    managedBytes: 67108864,
    allocationCapacity: 1048576,
    stackBytes: 16777216,
  },
);
