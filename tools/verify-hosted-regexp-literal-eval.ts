import { verifyHostedFixture } from "./hosted-fixture.ts";
const objects = "packages/js-runtime/src/objects/index.ts";
// Native evaluator fast path for programs consisting of one RegExp literal:
// direct eval, indirect eval and Script evaluation create a fresh RegExp without
// compiling, invalid literals stay early SyntaxErrors, and larger programs still
// reach compilation. The full code-unit loop mirrors the Test262 S7.8.5 families.
verifyHostedFixture(
  `
import {createDirectEvaluator,createIndirectEvaluator,createScriptEvaluator,type ScriptEvaluationHost} from "evaluator";
import {type ScriptPropertyKey,type ObjectHooks,type ErrorRealm,type OrdinaryObject,createObject,createErrorRealm,installErrorIntrinsics,installRegExpIntrinsics,scriptSameValue,callObjectValue,viewObjectValue,getProperty} from "objects";
import {createGlobalEnvironment} from "global";
interface State{compiles:number;}
function regexp(realm:ErrorRealm,value:unknown):OrdinaryObject<ScriptPropertyKey,unknown>|undefined{const object=viewObjectValue(value,realm.objectPrototype);return object!==undefined&&object.prototype===realm.regexpPrototype?object:undefined;}
function syntax(realm:ErrorRealm,action:()=>unknown):boolean{try{action();return false;}catch(error){const object=viewObjectValue(error,realm.objectPrototype);return object!==undefined&&object.prototype===realm.prototypes.get("syntax");}}
export function run():number{
 const object=createObject<ScriptPropertyKey,unknown>(undefined);
 const hooks:ObjectHooks<unknown>={undefinedValue:undefined,sameValue:(a,b):boolean=>scriptSameValue(a,b),call:(callee,receiver,args):unknown=>{const result=callObjectValue(callee,receiver,args,object);if(result.error!=="none")throw "FIXTURE_CALL";return result.value;}};
 const realm=createErrorRealm(object,hooks);installErrorIntrinsics(object,realm,hooks);installRegExpIntrinsics(object,realm,hooks);
 const global=createGlobalEnvironment<ScriptPropertyKey,unknown>(object,object,object,(name:string):ScriptPropertyKey=>name,hooks);
 const state:State={compiles:0};
 const host:ScriptEvaluationHost={domain:():number=>17,storage:{domain:17,publish:(bytes:Uint8Array):number|undefined=>{throw "PUBLISH";}},table:():unknown=>undefined,compile:(module,shape)=>{state.compiles++;return {ok:false,stage:"emit"};},invoke:(address,frame):unknown=>undefined,completion:(value)=>undefined,fault:(reason):void=>{}};
 const direct=createDirectEvaluator({realm,global},host),indirect=createIndirectEvaluator({realm,global},host),script=createScriptEvaluator({realm,global},host);
 const site={};
 const a=direct("/a[b]/gi",2,site),b=direct("/a[b]/gi;",3,site);
 const ra=regexp(realm,a),rb=regexp(realm,b);
 if(ra===undefined||rb===undefined||ra===rb)return 60;
 if(getProperty<ScriptPropertyKey,unknown>(ra,"source",a,hooks)!=="a[b]"||getProperty<ScriptPropertyKey,unknown>(ra,"flags",a,hooks)!=="gi")return 61;
 if(regexp(realm,indirect("/x/y"))===undefined||regexp(realm,script("/x/"))===undefined)return 62;
 if(!syntax(realm,():unknown=>direct("/(/",2,site))||!syntax(realm,():unknown=>direct("/a/gg",2,site)))return 63;
 if(state.compiles!==0||realm.unsupported)return 64;
 let count=0;
 for(let cu=0;cu<=0xffff;cu++){
  if(cu===0x2A||cu===0x2F||cu===0x5C||cu===0x2B||cu===0x3F||cu===0x28||cu===0x29||cu===0x5B||cu===0x5D||cu===0x7B||cu===0x7D||cu===0x0A||cu===0x0D||cu===0x2028||cu===0x2029)continue;
  const xx=String.fromCharCode(cu),value=direct("/"+xx+"/",2,site),object=regexp(realm,value);
  if(object===undefined||getProperty<ScriptPropertyKey,unknown>(object,"source",value,hooks)!==xx)return 65;
  count++;
 }
 if(count!==65521||state.compiles!==0)return 66;
 try{direct("/a/; /b/",2,site);return 67;}catch(error){if(error!==undefined)return 68;}
 return state.compiles===1&&realm.unsupported?42:69;
}
`,
  "regexp-literal-eval",
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
    managedBytes: 268435456,
    allocationCapacity: 4194304,
    stackBytes: 16777216,
  },
);
