import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { createSourceTextView } from "@tint/source/text";
import { parseModule, parseScript } from "@tint/typescript/syntax";
import { lowerScript, scriptRuntimeSurface } from "@tint/js-engine/lowering";
import { runtimeSources } from "@tint/compiler/cli";
import { prepareManagedSurfaceEntry } from "@tint/compiler/native";
import { verifyHostedFixture } from "./hosted-fixture.ts";
import { createManagedScriptFixture } from "./managed-script-fixture.ts";
import { workspaceModules, workspaceSources } from "./workspace-sources.ts";
import {
  createScriptRuntimeRequest,
  scriptEntryFrameModule,
  scriptRuntimeGlobals,
  scriptRuntimeDependencies,
} from "./script-runtime-request.ts";

const directCases = {
  local: "function f(){var v=40;eval('var w=v+2');return w}f()",
  conflict:
    "function g(){let x=1;try{eval('var x')}catch(e){return e instanceof SyntaxError}}g()",
  caught: "function h(){try{throw 1}catch(e){eval('var e=2');return e}}h()",
  receiver:
    "var o={};function k(){return eval('this')}function n(){return eval('new.target')}k.call(o)===o&&new n()===n",
  closure:
    "function m(){eval('var c=function(){return 5}');return c}var keep=m();",
  nested: "function p(){eval(\"eval('var z=7')\");return z}p()",
  thrown:
    "var t={};function q(){try{eval('throw t')}catch(e){return e===t}}q()",
};
const script =
  "var v=40;let y=2;function f(a){nativeActive();return a+v;}nativeCount();f(y);";
const fixture = createManagedScriptFixture();
const parsed = parseScript(createSourceTextView(script));
assert.ok(parsed.ok);
const lowered = lowerScript(parsed.value, script);
assert.ok(lowered.ok);
const expected = prepareManagedSurfaceEntry({
  ...fixture,
  module: lowered.value,
  entry: "execute",
});
assert.ok(expected.ok, JSON.stringify(expected));
let checksum = 2166136261;
for (const byte of expected.value.native.code)
  checksum = Math.imul(checksum ^ byte, 16777619) >>> 0;
const snapshot = workspaceSources();
const runtimes = runtimeSources();
const embedded = workspaceModules(
  runtimes.map((item) => item.module),
  snapshot,
).map((module) => {
  const input = snapshot.inputs.find((input) => input.id === module.id);
  assert.ok(input, module.id);
  return {
    id: module.id,
    text: new TextDecoder().decode(input.bytes),
    dependencies: [...module.dependencies],
  };
});
const memory = "packages/native-runtime/src/intrinsics/memory.ts";
const objects = "packages/js-runtime/src/objects/index.ts";
const host = parseModule(
  createSourceTextView(`
import type {ManagedSurfaceExport} from "contracts";
import type {ScriptCompletionRecord} from "objects";
import type {ScriptEntryFrame} from "frame";
export function bindScript():ManagedSurfaceExport{throw "MANAGED_SURFACE_UNBOUND";}
export function invoke(address:number,frame:ScriptEntryFrame):unknown{throw "UNBOUND_SCRIPT_INVOKE";}
export function completion(value:unknown):ScriptCompletionRecord|undefined{throw "UNBOUND_COMPLETION_VIEW";}
`),
);
assert.ok(host.ok);
const nativeSource = `
import {bindScript,invoke,completion} from "script-host";
import type {ScriptEntryFrame} from "frame";
import {createSourceTextView} from "source";
import {parseModule,parseScript,parseDynamicFunction,type Module} from "syntax";
import {lowerScript,lowerDynamicFunctionImplementation} from "script-lowering";
import {prepareManagedSurfaceEntry,type ManagedSurfaceEntryRequest} from "contracts";
import {createScriptEvaluator,createIndirectEvaluator,createDirectEvaluator,type ScriptEvaluationHost} from "evaluator";
import {createScriptEntryCompiler} from "script-compile";
import {readManagedSurfaceDirectory,linkManagedSurfaceModule,type RuntimeSource,type ManagedSurfaceLayoutRuntime,type ManagedIdentityBinding,type ManagedSurfaceDirectoryRead} from "contracts";
import {createEngineCodeStorage,type EngineCodeStorage} from "storage";
import type {SourceModule} from "module-model";
import {nativeValueFunctionDescriptor,nativeValueFunctionSignature,currentContextDomain,readMemoryWord,mapExecutableMemory,registerExternalMemory,writeExecutableMemory,currentRootHead} from "memory";
import {argumentCount,argumentByteLength,copyArgument} from "process";
import {type ScriptPropertyKey,type ScriptRecord,type ErrorRealm,runScriptContext,drainScriptJobs,createSymbolRegistry,installEvalIntrinsic,installEvalCompiler,installDirectEvalCompiler,callEvalCandidate,type ScriptCompletionRecord,type ObjectHooks,createObject,createCallableObject,createDataProperty,callObjectValue,getOwnProperty,viewObjectValue,createErrorRealm,createScriptRecord,installGlobalProperties,scriptSameValue,installErrorIntrinsics,installArrayIntrinsics,installObjectIntrinsics,installFunctionIntrinsics,installPrimitiveIntrinsics,installIteratorConstructor,installMapIntrinsics,installSetIntrinsics,installRegExpIntrinsics,installSymbolIntrinsics,installMathIntrinsics,installPromiseIntrinsics} from "objects";
import {type GlobalEnvironment,type DirectEvalSite,createGlobalEnvironment,createGlobalScope,createDeclarativeScope} from "global";
import {createDeclarativeEnvironment,createMutableBinding,initializeBinding,getBindingValue,hasBinding} from "records";
interface State{readonly global:GlobalEnvironment<ScriptPropertyKey,unknown>;readonly realm:ErrorRealm;count:number;seen:unknown;bad:boolean;}
function make(parent:ErrorRealm|undefined=undefined):State{
 const object=createObject<ScriptPropertyKey,unknown>(undefined);
 const hooks:ObjectHooks<unknown>={undefinedValue:undefined,sameValue:(a,b):boolean=>scriptSameValue(a,b),call:(callee,receiver,args):unknown=>{const result=callObjectValue(callee,receiver,args,object);if(result.error!=="none")throw "INVALID_FIXTURE_CALL";return result.value;}};
 installGlobalProperties(object,object,hooks);
 const global=createGlobalEnvironment<ScriptPropertyKey,unknown>(object,object,object,(name:string):ScriptPropertyKey=>name,hooks);
 const prototype=createObject<ScriptPropertyKey,unknown>(undefined);
 const realm=parent===undefined?createErrorRealm(prototype,hooks):createErrorRealm(prototype,hooks,parent.symbolRegistry,parent.agent);
 installEvalIntrinsic(object,realm,hooks);
 installErrorIntrinsics(object,realm,hooks);installArrayIntrinsics(object,realm,hooks);installObjectIntrinsics(object,realm,hooks);installFunctionIntrinsics(object,realm,hooks);installPrimitiveIntrinsics(object,realm,hooks);installIteratorConstructor(object,realm,hooks);installMapIntrinsics(object,realm,hooks);installSetIntrinsics(object,realm,hooks);installRegExpIntrinsics(object,realm,hooks);installSymbolIntrinsics(object,realm,hooks);installMathIntrinsics(object,realm,hooks,undefined);installPromiseIntrinsics(object,realm,hooks,(promise,operation):void=>{});
 const state:State={global,realm,count:0,seen:undefined,bad:false};
 createDataProperty<ScriptPropertyKey,unknown>(object,"nativeCount",createCallableObject<ScriptPropertyKey,unknown>(undefined,(receiver,args):unknown=>{state.count++;return undefined;}),hooks);
 createDataProperty<ScriptPropertyKey,unknown>(object,"nativeActive",createCallableObject<ScriptPropertyKey,unknown>(undefined,(receiver,args):unknown=>{const context=realm.agent.activeContext;if(context===undefined||context.realm!==realm)state.bad=true;else state.seen=context.scriptOrModule;return undefined;}),hooks);
 return state;
}
function parse(text:string):Module{const result=parseModule(createSourceTextView(text));if(!result.ok)throw "RUNTIME_PARSE";return result.value;}
function sameABI(left:ManagedIdentityBinding,right:ManagedIdentityBinding):boolean{if(left.returnType!==right.returnType||left.parameters.length!==right.parameters.length)return false;for(let i=0;i<left.parameters.length;i++){if(left.parameters[i]!==right.parameters[i])return false;}return true;}
function churn():void{for(let i=0;i<1024;i++){const words=new Uint32Array(8192);words[0]=i;if(words[0]!==i)throw "CHURN";}}
function verifyEvaluator(read:ManagedSurfaceDirectoryRead,table:unknown,runtime:ManagedSurfaceLayoutRuntime,storage:EngineCodeStorage):number{
 const state:{publishes:number;invokes:number;bad:boolean;last:ScriptRecord|undefined;fault:string;stage:string}={publishes:0,invokes:0,bad:false,last:undefined,fault:"",stage:""};
 const counted:EngineCodeStorage={domain:storage.domain,publish:(bytes:Uint8Array):number|undefined=>{state.publishes++;return storage.publish(bytes);}};
 const compile=createScriptEntryCompiler({read,runtime},{domain:():number=>currentContextDomain(),storage:counted,readWord:(address:number,length:number,offset:number):number=>readMemoryWord(address,length,offset)},{maxScriptCodeBytes:262144});
 const a=make(),head=currentRootHead();
 const evaluate=createScriptEvaluator({realm:a.realm,global:a.global},{domain:():number=>currentContextDomain(),storage:counted,table:():unknown=>table,compile:(module,shape)=>{const result=compile(module);state.stage=result.ok?"":result.stage;return result;},invoke:(address,frame):unknown=>{const previous=state.last;if(previous===frame.$argument1||frame.$argument0!==a.global||frame.$imports!==table)state.bad=true;state.last=frame.$argument1;state.invokes++;return invoke(address,frame);},completion:(value):ScriptCompletionRecord|undefined=>completion(value),fault:(reason):void=>{state.fault=reason;}});
 const source="var v=40;let y=2;nativeActive();nativeCount();v+y;";
 let first:unknown;
 try{first=evaluate(source);}catch(error){return state.stage==="profile"?120:state.stage==="prepare"?121:state.stage==="lower"?122:state.stage==="emit"?123:state.stage==="select"?124:state.stage==="link"?125:state.stage==="budget"?126:state.stage==="publish"?127:128;}
 if(first!==42||a.count!==1||a.bad||state.bad)return 100;
 const record=state.last;if(record===undefined||a.seen!==record||record.realm!==a.realm||record.kind!=="script"||record.hostDefined!==undefined)return 101;
 let syntax=false;try{evaluate(source);}catch(error){const object=viewObjectValue(error,a.global.object);syntax=object!==undefined&&object.prototype===a.realm.prototypes.get("syntax");}
 if(!syntax||a.count!==1||a.realm.unsupported||state.last===record)return 102;
 if(currentRootHead()!==head||a.realm.agent.activeContext!==undefined)return 103;
 churn();if(evaluate("nativeActive();nativeCount();v+y;")!==42||a.count!==2||a.bad||state.bad||a.seen!==state.last)return 104;
 const before=state.publishes;syntax=false;try{evaluate("var");}catch(error){const object=viewObjectValue(error,a.global.object);syntax=object!==undefined&&object.prototype===a.realm.prototypes.get("syntax");}
 if(!syntax||a.realm.unsupported||state.publishes!==before)return 105;
 if(currentRootHead()!==head||a.realm.agent.activeContext!==undefined)return 106;
 if(state.publishes!==3||state.invokes!==3)return 107;
 let unsupported=false;try{evaluate(7);}catch(error){unsupported=error===undefined;}if(!unsupported||!a.realm.unsupported)return 108;
 try{evaluate("42");return 109;}catch(error){if(error!==undefined)return 110;}
 if(state.publishes!==3||state.invokes!==3||state.fault!==""||state.bad)return 111;
 return 42;
}
function verifyIndirect(read:ManagedSurfaceDirectoryRead,table:unknown,runtime:ManagedSurfaceLayoutRuntime,storage:EngineCodeStorage):number{
 const state:{publishes:number;invokes:number;last:ScriptRecord|undefined;bad:boolean;fault:string;stage:string}={publishes:0,invokes:0,last:undefined,bad:false,fault:"",stage:""};
 const counted:EngineCodeStorage={domain:storage.domain,publish:(bytes:Uint8Array):number|undefined=>{state.publishes++;return storage.publish(bytes);}};
 const compile=createScriptEntryCompiler({read,runtime},{domain:():number=>currentContextDomain(),storage:counted,readWord:(address:number,length:number,offset:number):number=>readMemoryWord(address,length,offset)},{maxScriptCodeBytes:262144});
 const a=make(),b=make(a.realm),c=make(a.realm),rA=createScriptRecord(a.realm,undefined),head=currentRootHead();
 const host:ScriptEvaluationHost={domain:():number=>currentContextDomain(),storage:counted,table:():unknown=>table,compile:(module,shape)=>{const result=compile(module);state.stage=result.ok?"":result.stage;return result;},invoke:(address,frame):unknown=>{if(state.last===frame.$argument1||frame.$argument0!==b.global||frame.$imports!==table)state.bad=true;state.last=frame.$argument1;state.invokes++;return invoke(address,frame);},completion:(value):ScriptCompletionRecord|undefined=>completion(value),fault:(reason):void=>{state.fault=reason;}};
 installEvalCompiler(b.realm,createIndirectEvaluator({realm:b.realm,global:b.global},host));
 const evaluate=b.realm.evalFunction;if(evaluate===undefined)return 130;
 function evaluateFromA(text:string):unknown{return runScriptContext<unknown>(a.realm.agent,{realm:a.realm,scriptOrModule:rA},():unknown=>{const result=callObjectValue(evaluate,undefined,[text],a.global.object);if(result.error!=="none")throw "EVAL_CALL";return result.value;});}
 try{
 if(evaluateFromA("var v=40;let y=2;function f(a){nativeActive();return a+v;}nativeActive();f(y);")!==42||b.bad||b.seen!==rA||state.bad)return 131;
 const carrier=state.last;if(carrier===undefined||carrier===rA||carrier.hostDefined!==rA||carrier.realm!==b.realm)return 132;
 if(getOwnProperty<ScriptPropertyKey,unknown>(a.global.object,"v")!==undefined||getOwnProperty<ScriptPropertyKey,unknown>(b.global.object,"y")!==undefined)return 133;
 if(evaluateFromA("'use strict'; var hidden=1;function strictOnly(){};this;")!==b.global.object||getOwnProperty<ScriptPropertyKey,unknown>(b.global.object,"hidden")!==undefined)return 134;
 if(evaluateFromA("typeof y")!=="undefined"||evaluateFromA("1;{}")!==1||evaluateFromA("var q=1")!==undefined)return 135;
 const before=state.publishes;
 if(evaluateFromA("")!==undefined||evaluateFromA(" /* comment */ ")!==undefined||state.publishes!==before)return 136;
 let syntax=false;try{evaluateFromA("let dup;let dup;");}catch(error){const value=viewObjectValue(error,b.global.object);syntax=value!==undefined&&value.prototype===b.realm.prototypes.get("syntax");}if(!syntax||state.publishes!==before)return 137;
 const f=getOwnProperty<ScriptPropertyKey,unknown>(b.global.object,"f");if(f===undefined)return 138;
 churn();b.seen=undefined;const called=callObjectValue(f.value,undefined,[2],b.global.object);if(called.error!=="none"||called.value!==42||b.seen!==rA)return 139;
 if(evaluateFromA("{function annex(){return 7;}} annex();")!==7)return 140;
 if(evaluateFromA("Promise.resolve().then(()=>nativeActive()); 1;")!==1)return 141;
 b.seen=undefined;let jobError=false;drainScriptJobs(b.realm.agent,(error):void=>{jobError=true;});if(jobError||b.seen!==rA)return 142;
 if(evaluateFromA("(0,eval)('nativeActive(); 2;')")!==2||b.seen!==rA)return 143;
 let thrown=false;try{evaluateFromA("throw 7");}catch(error){thrown=error===7;}if(!thrown)return 144;
 const value={};const nonString=callObjectValue(evaluate,undefined,[value],b.global.object);if(nonString.error!=="none"||nonString.value!==value)return 145;
 if(a.realm.agent.activeContext!==undefined||currentRootHead()!==head||b.bad||state.bad||state.fault!==""||b.realm.unsupported)return 146;
 const invocations=state.invokes;let unsupported=false;try{callEvalCandidate(evaluate,undefined,["1"],b.global.object,b.realm,0,undefined);}catch(error){unsupported=error===undefined;}if(!unsupported||!b.realm.unsupported||state.invokes!==invocations||a.realm.unsupported||c.realm.unsupported)return 147;
 return 42;
 }catch(error){return state.stage==="profile"?150:state.stage==="prepare"?151:state.stage==="lower"?152:state.stage==="emit"?153:state.stage==="select"?154:state.stage==="link"?155:state.stage==="budget"?156:state.stage==="publish"?157:158;}
}
function verifyDynamicCarrier(read:ManagedSurfaceDirectoryRead,table:unknown,runtime:ManagedSurfaceLayoutRuntime,storage:EngineCodeStorage):number{
 const compile=createScriptEntryCompiler({read,runtime},{domain:():number=>currentContextDomain(),storage,readWord:(address:number,length:number,offset:number):number=>readMemoryWord(address,length,offset)},{maxScriptCodeBytes:262144});
 const a=make(),identity=createScriptRecord(a.realm,undefined),head=currentRootHead();
 function carrier(parameters:readonly string[],body:string):unknown{
  const syntax=parseDynamicFunction("normal",parameters,body);if(!syntax.ok)throw "DYNAMIC_PARSE";
  const lowered=lowerDynamicFunctionImplementation(syntax.value);if(!lowered.ok)throw "DYNAMIC_LOWER";
  const compiled=compile(lowered.value);if(!compiled.ok)throw compiled.stage;
  const result=completion(invoke(compiled.address,{$imports:table,$argument0:a.global,$argument1:createScriptRecord(a.realm,identity)}));
  if(result===undefined||result.error!=="none")throw "DYNAMIC_COMPLETION";
  return result.value;
 }
 try{
 function callCarrier(value:unknown,receiver:unknown,args:readonly unknown[]):unknown{
  const fn=viewObjectValue(value,a.global.object);if(fn===undefined||fn.internalConstruct!==undefined)throw "CARRIER_SHAPE";
  const result=callObjectValue(fn,receiver,args,a.global.object);
  if(result.error!=="none")throw "CARRIER_CALL";
  return result.value;
 }
 const fn=carrier(["a","b=2","...rest"],"nativeActive();return a+b+rest.length;");
 const first=callCarrier(fn,a.global.object,[a.global.object,undefined,39,2,1]);
 if(first!==42)return typeof first==="number"?200+first:182;
 if(a.seen!==identity)return 180;if(a.bad)return 181;
 churn();if(callCarrier(fn,a.global.object,[a.global.object,undefined,40])!==42||a.seen!==identity)return 162;
 const mapped=carrier(["a"],"arguments[0]=42;return a;");
 if(callCarrier(mapped,undefined,[a.global.object,undefined,1])!==42)return 163;
 const target=carrier([],"return new.target;");
 if(callCarrier(target,undefined,[a.global.object,a.global.object])!==a.global.object)return 164;
 const callee=carrier([],"return arguments.callee;");
 if(callCarrier(callee,undefined,[a.global.object,undefined])!==a.global.object)return 165;
 if(a.realm.agent.activeContext!==undefined||currentRootHead()!==head||a.realm.unsupported)return 166;
 return 42;
 }catch(error){return error==="profile"?170:error==="prepare"?171:error==="lower"?172:error==="emit"?173:error==="select"?174:error==="link"?175:error==="budget"?176:error==="publish"?177:178;}
}
function verifyDirect(read:ManagedSurfaceDirectoryRead,table:unknown,runtime:ManagedSurfaceLayoutRuntime,storage:EngineCodeStorage,part:number):number{
 const state={publishes:0,invokes:0,stage:"",fault:""};
 const counted:EngineCodeStorage={domain:storage.domain,publish:(bytes:Uint8Array):number|undefined=>{state.publishes++;return storage.publish(bytes);}};
 const compile=createScriptEntryCompiler({read,runtime},{domain:():number=>currentContextDomain(),storage:counted,readWord:(address:number,length:number,offset:number):number=>readMemoryWord(address,length,offset)},{maxScriptCodeBytes:262144});
 const a=make(),head=currentRootHead();let phase=180;
 function hostFor(target:State):ScriptEvaluationHost{return {domain:():number=>currentContextDomain(),storage:counted,table:():unknown=>table,compile:(module,shape)=>{const result=compile(module);state.stage=result.ok?"":result.stage;return result;},invoke:(address,frame):unknown=>{state.invokes++;if(frame.$argument0!==target.global)throw "DIRECT_FRAME_GLOBAL";return invoke(address,frame);},completion:(value):ScriptCompletionRecord|undefined=>completion(value),fault:(reason):void=>{state.fault=reason;}};}
 const service=hostFor(a),direct=createDirectEvaluator({realm:a.realm,global:a.global},service),evaluate=createScriptEvaluator({realm:a.realm,global:a.global},service);
 installEvalCompiler(a.realm,createIndirectEvaluator({realm:a.realm,global:a.global},service));installDirectEvalCompiler(a.realm,direct);
 const vars=createDeclarativeEnvironment<unknown>(undefined);createMutableBinding<unknown>(vars,"v",false);initializeBinding<unknown>(vars,"v",40);
 const variables=createDeclarativeScope<ScriptPropertyKey,unknown>(createGlobalScope<ScriptPropertyKey,unknown>(a.global),vars),identity=createScriptRecord(a.realm,undefined);
 const site:DirectEvalSite={scriptOrModule:identity,lexical:variables,variables,catches:undefined,thisValue:a.global.object,newTarget:undefined,home:undefined,derived:undefined,activeFunction:undefined,privateEnvironment:undefined};
 try{
 if(part===7){
  const result=callEvalCandidate(a.realm.evalFunction,undefined,["nativeActive();var w=v+2;w"],a.global.object,a.realm,2,site);
  if(result.error!=="none"||result.value!==42||getBindingValue<unknown>(vars,"w").value!==42||a.seen!==identity||state.invokes!==1)return 180;
  phase=181;if(direct("var isolated=1;isolated",3,site)!==1||hasBinding<unknown>(vars,"isolated"))return 181;
  phase=183;if(evaluate(${JSON.stringify(directCases.local)})!==42)return 183;
  phase=184;if(evaluate(${JSON.stringify(directCases.conflict)})!==true)return 184;
  phase=185;if(evaluate(${JSON.stringify(directCases.caught)})!==2)return 185;
  const b=make(a.realm),other=hostFor(b);installEvalCompiler(b.realm,createIndirectEvaluator({realm:b.realm,global:b.global},other));const blocked=createDirectEvaluator({realm:b.realm,global:b.global},other);const before=state.invokes;
  phase=182;let rejected=false;try{blocked("super.x",16,site);}catch(error){rejected=error===undefined;}if(!rejected||!b.realm.unsupported||state.invokes!==before)return 182;
 }else{
  phase=186;if(evaluate(${JSON.stringify(directCases.receiver)})!==true)return 186;
  phase=187;evaluate(${JSON.stringify(directCases.closure)});churn();if(evaluate("keep()")!==5)return 187;
  phase=188;if(evaluate(${JSON.stringify(directCases.nested)})!==7)return 188;
  phase=189;if(evaluate(${JSON.stringify(directCases.thrown)})!==true)return 189;
  phase=190;let rejected=false;try{direct("1",2,a.global.object);}catch(error){rejected=error===undefined;}if(!rejected||!a.realm.unsupported)return 190;
 }
 if(state.fault!==""||a.realm.agent.activeContext!==undefined||currentRootHead()!==head)return 191;
 return 42;
 }catch(error){return state.fault!==""?201:state.stage==="profile"?202:state.stage==="prepare"?203:state.stage==="lower"?204:state.stage==="emit"?205:state.stage==="select"?206:state.stage==="link"?207:state.stage==="budget"?208:state.stage==="publish"?209:phase;}
}
function selectedCase():number{if(argumentCount()!==2||argumentByteLength(1)!==1)return 0;const bytes=new Uint8Array(1);if(copyArgument(1,bytes)!==1)return 0;return (bytes[0]??48)-48;}
export function run():number{try{
 const selected=selectedCase(),exported=bindScript();
 const read=readManagedSurfaceDirectory(exported,"scriptRuntime",{domain:():number=>currentContextDomain(),descriptor:(value:unknown):number=>nativeValueFunctionDescriptor(value),signature:(value:unknown):number=>nativeValueFunctionSignature(value)});
 if(!read.ok||read.value.directory.frame!=="ScriptEntryFrame")return 60;
 let separateEqualABI=false;for(const left of read.value.signatures){if(left===undefined)throw "SIGNATURE";for(const right of read.value.signatures){if(right===undefined)throw "SIGNATURE";const same=sameABI(left,right);if(!same&&left.address===right.address)return 90;if(same&&left.address!==right.address)separateEqualABI=true;}}
 if(selected===3)return separateEqualABI?94:42;
 const storage=createEngineCodeStorage({domain:():number=>currentContextDomain(),map:(length:number):number=>mapExecutableMemory(length),register:(address:number,length:number):number=>registerExternalMemory(address,length),write:(address:number,capacity:number,offset:number,bytes:Uint8Array):number=>writeExecutableMemory(address,capacity,offset,bytes)},4194304);
 if(storage.domain!==read.value.domain)return 61;
 const modules:SourceModule[]=[];
 const sources:readonly {readonly id:string;readonly text:string;readonly dependencies:readonly (readonly string[])[]}[]=${JSON.stringify(embedded)};
 for(const source of sources){if(source===undefined)throw "SOURCE";const dependencies=new Map<string,string>();for(const pair of source.dependencies){if(pair===undefined)throw "DEPENDENCY";const specifier=pair[0],target=pair[1];if(specifier===undefined||target===undefined)throw "DEPENDENCY";dependencies.set(specifier,target);}modules.push({id:source.id,module:parse(source.text),dependencies});}
 const text=${JSON.stringify(script)},parsed=parseScript(createSourceTextView(text));if(!parsed.ok)return 62;
 const lowered=lowerScript(parsed.value,text);if(!lowered.ok)return 63;
 if(selected===1)return 42;
 const specifiers=new Set<string>(),instantiations=new Map<string,readonly string[]>();
 const vocabulary:readonly {readonly specifier:string;readonly name:string;readonly args:readonly string[]}[]=${JSON.stringify(scriptRuntimeSurface().map((item) => ({ specifier: item.specifier, name: item.name, args: item.typeArguments })))};
 for(const item of vocabulary){if(item===undefined)throw "VOCABULARY";specifiers.add(item.specifier);instantiations.set(item.name,item.args);}
 const runtimeSources:readonly RuntimeSource[]=${JSON.stringify(runtimes)};const globals:readonly string[]=${JSON.stringify(scriptRuntimeGlobals)};const runtime:ManagedSurfaceLayoutRuntime={modules,runtimes:runtimeSources,globals};
 if(selected===4)return verifyEvaluator(read.value,exported.table,runtime,storage);
 if(selected===5)return verifyIndirect(read.value,exported.table,runtime,storage);
 if(selected===6)return verifyDynamicCarrier(read.value,exported.table,runtime,storage);
 if(selected===7||selected===8)return verifyDirect(read.value,exported.table,runtime,storage,selected);
 const approvedSpecifiers:ReadonlySet<string>=specifiers;const approvedInstantiations:ReadonlyMap<string,readonly string[]>=instantiations;const request:ManagedSurfaceEntryRequest={module:lowered.value,entry:"execute",specifiers:approvedSpecifiers,instantiations:approvedInstantiations,read:read.value,runtime};const prepared=prepareManagedSurfaceEntry(request);
 if(!prepared.ok){const stage=prepared.error.stage;return stage==="profile"?64:stage==="prepare"?65:stage==="lower"?66:stage==="emit"?67:68;}
 const built=prepared.value,native=built.native;
 if(native.imports.length!==0||native.managedImports.length!==${expected.value.native.managedImports.length})return 69;
 if(native.code.length>262144)return 70;
 const observed={reads:0};const words=(address:number,length:number,offset:number):number=>{observed.reads++;return readMemoryWord(address,length,offset);};
 if(linkManagedSurfaceModule(read.value,native,words,currentContextDomain()+1).ok||observed.reads!==0)return 72;
 const missing={...native,managedImports:native.managedImports.map(item=>({...item,contract:"missing"}))};
 if(linkManagedSurfaceModule(read.value,missing,words,currentContextDomain()).ok||observed.reads!==0)return 73;
 const linked=linkManagedSurfaceModule(read.value,native,words,currentContextDomain());if(!linked.ok)return 74;
 if(selected===2){let hash=2166136261;for(const byte of native.code){hash=Math.imul(hash^byte,16777619)>>>0;}if(read.value.directory.digest!==${JSON.stringify(fixture.read.directory.digest)})return 92;if(native.code.length!==${expected.value.native.code.length}||hash!==${checksum}||built.entryOffset!==${expected.value.entryOffset})return 93;return 42;}
 const base=storage.publish(linked.value.code);if(base===undefined||base%16!==0)return 75;
 const address=base+built.entryOffset,a=make(),r1=createScriptRecord(a.realm,undefined),head=currentRootHead();
 const frame:ScriptEntryFrame={$imports:exported.table,$argument0:a.global,$argument1:r1};
 const first=completion(invoke(address,frame));if(first===undefined)return 77;if(first.error!=="none"||first.value!==42)return 76;
 if(a.realm.agent.activeContext!==undefined)return 78;if(currentRootHead()!==head)return 79;
 if(a.bad||a.seen!==r1||r1.realm!==a.realm)return 80;if(a.count!==1)return 81;
 const f=getOwnProperty<ScriptPropertyKey,unknown>(a.global.object,"f"),v=getOwnProperty<ScriptPropertyKey,unknown>(a.global.object,"v");if(f===undefined||v===undefined)return 83;
 const r2=createScriptRecord(a.realm,undefined),second=completion(invoke(address,{$imports:exported.table,$argument0:a.global,$argument1:r2}));
 if(second===undefined||second.error!=="throw")return 82;
 const error=viewObjectValue(second.value,a.global.object);if(error===undefined||error.prototype!==a.realm.prototypes.get("syntax"))return 82;
 const nextF=getOwnProperty<ScriptPropertyKey,unknown>(a.global.object,"f"),nextV=getOwnProperty<ScriptPropertyKey,unknown>(a.global.object,"v");if(a.count!==1||nextF===undefined||nextV===undefined||nextF.value!==f.value||nextV.value!==v.value)return 83;
 const invalid:readonly unknown[]=[r2,undefined];for(const table of invalid){let caught=false;try{invoke(address,{$imports:table,$argument0:a.global,$argument1:r2});}catch(error){caught=error==="MANAGED_SURFACE_TABLE";}if(!caught||a.count!==1||a.realm.agent.activeContext!==undefined||currentRootHead()!==head)return 84;}
 churn();
 const b=make(),r3=createScriptRecord(b.realm,undefined),third=completion(invoke(address,{$imports:exported.table,$argument0:b.global,$argument1:r3}));
 if(third===undefined||third.error!=="none"||third.value!==42||b.count!==1||b.bad||b.seen!==r3)return 86;
 a.seen=undefined;const callback=callObjectValue(f.value,undefined,[2],a.global.object);if(callback.error!=="none"||callback.value!==42)return 87;
 if(a.seen!==r1||a.bad||a.realm.agent.activeContext!==undefined||b.realm.agent.activeContext!==undefined||currentRootHead()!==head)return 88;
 if(r1===r2||r1===r3||r2.realm!==a.realm||r3.realm!==b.realm||a.realm===b.realm)return 85;
 return 42;
 }catch(error){return 99;}}
`;
writeFileSync(".tint-bootstrap/managed-script-fixture-source.ts", nativeSource);
verifyHostedFixture(
  nativeSource,
  "managed-script",
  [
    ["script-host", "script-host"],
    ["frame", scriptEntryFrameModule],
    ["source", "packages/source/src/text.ts"],
    ["syntax", "packages/typescript/src/syntax/index.ts"],
    ["script-lowering", "packages/js-engine/src/lowering/index.ts"],
    ["evaluator", "packages/js-engine/src/script-evaluation.ts"],
    ["script-compile", "packages/js-engine/src/native/script-compile.ts"],
    ["contracts", "packages/compiler/src/native/index.ts"],
    ["storage", "packages/js-engine/src/native/code-storage.ts"],
    ["module-model", "packages/typescript/src/modules/model.ts"],
    ["memory", memory],
    ["process", "packages/native-runtime/src/intrinsics/process.ts"],
    ["objects", objects],
    ["global", "packages/js-runtime/src/environments/global/index.ts"],
    ["records", "packages/js-runtime/src/environments/records/index.ts"],
    ...scriptRuntimeDependencies,
  ],
  [
    {
      id: "script-host",
      module: host.value,
      dependencies: new Map([
        ["contracts", "packages/compiler/src/native/index.ts"],
        ["objects", objects],
        ["frame", scriptEntryFrameModule],
      ]),
    },
  ],
  [
    { module: "script-host", name: "completion", operation: "view" },
    {
      module: "packages/js-runtime/src/environments/global/index.ts",
      name: "viewDirectEvalSite",
      operation: "view",
    },
    ...["viewObjectValue", "viewSymbolValue", "viewBigIntValue"].map(
      (name) => ({ module: objects, name, operation: "view" as const }),
    ),
  ],
  [
    {
      module: "script-host",
      namespace: "script-host-view",
      retainedExports: ["completion", "invoke"],
    },
    { module: memory, namespace: "script-memory" },
    {
      module: "packages/js-runtime/src/environments/global/index.ts",
      namespace: "global-environment",
      retainedExports: ["viewDirectEvalSite"],
    },
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
    allowJit: true,
    runtimeEntry: "initializeCopyingRuntime",
    managedBytes: 268435456,
    allocationCapacity: 8388608,
    rootCapacity: 16384,
    stackBytes: process.argv.includes("--small-stack") ? 1048576 : 16777216,
    managedSurfaces: [
      createScriptRuntimeRequest({ module: "script-host", name: "bindScript" }),
    ],
    hostBindings: [
      {
        module: memory,
        name: "nativeValueFunctionDescriptor",
        operation: "native-value-function-descriptor",
      },
      {
        module: memory,
        name: "nativeValueFunctionSignature",
        operation: "native-value-function-signature",
      },
      {
        module: memory,
        name: "currentContextDomain",
        operation: "context-domain",
      },
      { module: memory, name: "readMemoryWord", operation: "memory-read-word" },
      {
        module: memory,
        name: "mapExecutableMemory",
        operation: "executable-map",
      },
      {
        module: memory,
        name: "registerExternalMemory",
        operation: "external-memory-register",
      },
      {
        module: memory,
        name: "writeExecutableMemory",
        operation: "executable-write",
      },
      { module: memory, name: "currentRootHead", operation: "root-head" },
      {
        module: "script-host",
        name: "invoke",
        operation: "executable-call-managed",
      },
    ],
  },
);
