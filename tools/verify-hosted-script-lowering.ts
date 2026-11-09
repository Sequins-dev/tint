import { verifyHostedFixture } from "./hosted-fixture.ts";
import { scriptRuntimeSurface } from "@tint/js-engine/lowering";
// The native surface must equal the Node-hosted one: derive the expected counts
// from the same definition rather than pinning a count that drifts with it.
const hostSurface = scriptRuntimeSurface();
const hostGenericEntries = hostSurface.filter(
  (entry) => entry !== undefined && entry.typeArguments.length > 0,
).length;
verifyHostedFixture(
  `
import {createSourceText} from "source";
import {parseScript,parseStrictScript,parseModule,bindingIdentifiers,rewriteModule,type Expression} from "syntax";
import {lowerScript,lowerStrictScript,lowerSourceTextModule,scriptRuntimeSurface} from "lowering";
export function run():number {
 const bytes=new TextEncoder().encode("let template=\`value: \${42}\`;debugger;class Box{#secret=42;#read(){return this.#secret;}get #value(){return this.#secret;}set #value(v){this.#secret=v;}static{this.z=42;}x=42;static y=42;constructor(){this.x=42;}m(){this.#value=42;return this.#read();}has(o){return #secret in o;}get value(){return this.x;}set value(v){this.x=v;}}new Box()?.m?.();delete null?.x;class Child extends Box{constructor(){let target=new.target;super();this.target=target;}m(){return super.m();}}new Child().m();function C(x){this.x=x;this.target=()=>new.target;}new C(42) instanceof C;function f(x=42,...rest){return ()=>x;}const collect=(...items)=>items;collect(42);let o={x:42,f(){return this.x;}};o.f();o['x']+=1;o['f']();f()();switch(1){case 1:let s=42;s;break;default:19;}for(let i=0;i<3;i++){if(i===1)continue;}while(false){}do{break;}while(true);var x=1+2;x++;++x;x+=1;x&&=42;let y=84/2;~x;-x;x=y;typeof missing;typeof x;!null;!!this;!x;false && missing;null ?? x;true ? (false || x) : missing;if(true){let z=x;z;}else missing;nativeIdentity(x);this.nativeIdentity(x);(this.nativeReceiver)();(0,this.nativeReceiver)();this.missing;this.x=42;(this.x)=x;x;try{throw 42;}catch(e){e;}finally{x=42;}throw 42;");
 const source=createSourceText(bytes,bytes.length);if(!source.ok)return 1;
 const parsed=parseStrictScript(source.value);if(!parsed.ok)return 2;
 const result=lowerStrictScript(parsed.value);if(!result.ok)return 3;
 if(result.value.imports.length!==3)return 4;
 const entry=result.value.statements.find((node)=>node!==undefined&&node.kind==="function");
 if(entry===undefined||entry.kind!=="function"||entry.name!=="execute")return 5;
 const body=entry.body;if(body.kind!=="block")return 6;
 const realm=body.statements[0];if(realm===undefined||realm.kind!=="variable")return 34;
 const realmPattern=realm.declarations[0];if(realmPattern===undefined)return 34;const realmBindings=bindingIdentifiers(realmPattern),realmBinding=realmBindings[0];if(realmBindings.length!==1||realmBinding===undefined||realmBinding.name!=="$errors")return 34;
 const entered=body.statements[1];if(entered===undefined||entered.kind!=="return")return 25;
 const invocation=entered.expression;if(invocation===undefined||invocation.kind!=="call")return 26;
 const action=invocation.arguments[2];if(action===undefined||action.kind!=="arrow")return 27;
 const actionBody=action.body;if(actionBody.kind!=="block")return 28;
 const guarded=actionBody.statements[0];if(guarded===undefined||guarded.kind!=="try"||guarded.body.statements.length<10||guarded.handler===undefined)return 7;
 const taggedBytes=new TextEncoder().encode("function tag(parts,x){return x;}tag\`a\${42}b\`;let x=2 ** 3 ** 2;x **= -2;let {a=42,b:{c=1}={},[x]:d,...rest}={};try{throw {};}catch({x=42,y=x,...rest}){y;}for(const {length:n,...chars} in {abc:1}){n;}function pattern({a=42,b=a}={},...{length:n}){return b+n;}pattern();let assigned,remaining;({x:assigned=42,...remaining}={});for({length:assigned} in {abc:1}){}for(const {x=42} of [{},{}]){if(x)break;}for(let item of [1,2]){continue;}for(const [first=42,,last=first,...remainingValues] of [[1,2,3]]){}[assigned,...remaining]=[1,2];[[assigned]]=[[42]];const [[deep],{x:[nested]}]=[[1],{x:[2]}];function bindingParam([x]=[]){return x;}try{}catch([caught]){}42 instanceof {[Symbol.hasInstance](value){return true;}};const spread=[1,...[2,3],,];pattern(...spread);new C(...spread);for(assigned of [1,2]){}for({x:assigned=42} of [{}]){}outer:inner:for(const x of [1,2]){try{while(true){continue outer;}}finally{42;}}done:{break done;}");
 const taggedSource=createSourceText(taggedBytes,taggedBytes.length);if(!taggedSource.ok)return 8;
 const taggedParsed=parseStrictScript(taggedSource.value);if(!taggedParsed.ok)return 9;
 const taggedResult=lowerStrictScript(taggedParsed.value);if(!taggedResult.ok)return 10;
 const invalidBytes=new TextEncoder().encode("tag"+String.fromCharCode(96)+String.fromCharCode(92)+"x"+String.fromCharCode(96)+";");
 const invalidSource=createSourceText(invalidBytes,invalidBytes.length);if(!invalidSource.ok)return 11;
 const invalidParsed=parseStrictScript(invalidSource.value);if(!invalidParsed.ok)return 12;
 const invalidResult=lowerStrictScript(invalidParsed.value);if(!invalidResult.ok)return 13;
 const generatorBytes=new TextEncoder().encode("function* g(){yield;yield* [1];outer:while(true){yield 42;break outer;}}const f=function*(){};class C{*m(){yield 1;}static *#m(){yield 2;}}");
 const generatorSource=createSourceText(generatorBytes,generatorBytes.length);if(!generatorSource.ok)return 14;
 const generatorParsed=parseStrictScript(generatorSource.value);if(!generatorParsed.ok)return 15;
 const generatorFunction=generatorParsed.value.statements[0];if(generatorFunction===undefined||generatorFunction.kind!=="function"||generatorFunction.generator!==true)return 16;
 const generatorLowered=lowerStrictScript(generatorParsed.value);if(!generatorLowered.ok)return 17;
 const parameterBytes=new TextEncoder().encode("function*g(x=yield 1){}");
 const parameterSource=createSourceText(parameterBytes,parameterBytes.length);if(!parameterSource.ok)return 18;
 if(parseStrictScript(parameterSource.value).ok)return 19;
 const sequentialBytes=new TextEncoder().encode("function*g(a=42){const x=yield a;if(x){yield* [x];}else yield 19;for(let n=0;n<3;n++){yield n;if(n)break;}try{yield x;}catch(e){yield* [e];}finally{yield 19;}for(const n of [1,2])yield n;switch(x){case 1:yield 1;case 2:yield 2;break;default:yield 42;}return x;}class C{*#m(){yield 1;return 42;}m(){return this.#m();}}const i=g();i.next();i.next(42);");
 const sequentialSource=createSourceText(sequentialBytes,sequentialBytes.length);if(!sequentialSource.ok)return 20;
 const sequentialParsed=parseStrictScript(sequentialSource.value);if(!sequentialParsed.ok)return 21;
 if(!lowerStrictScript(sequentialParsed.value).ok)return 22;
 const typedBytes=new TextEncoder().encode("const f=(value:number):Box<number>=>({value});const nested=():Box<Box<number>>=>value;const comparison=a < Box < T >>> value;");
 const typedSource=createSourceText(typedBytes,typedBytes.length);if(!typedSource.ok)return 23;
 if(!parseModule(typedSource.value).ok)return 24;
 const withBytes=new TextEncoder().encode("function*g(){with({x:42}){yield x;return ()=>x;}}with({f(){return this;}}){(f)();}");
 const withSource=createSourceText(withBytes,withBytes.length);if(!withSource.ok)return 29;
 const withParsed=parseScript(withSource.value);if(!withParsed.ok)return 30;
 if(!lowerScript(withParsed.value).ok)return 31;
 if(parseStrictScript(withSource.value).ok)return 32;
 const surface=scriptRuntimeSurface();if(surface.length!==${hostSurface.length})return 33;
 if(surface.filter(entry=>entry!==undefined&&entry.typeArguments.length>0).length!==${hostGenericEntries})return 34;
 const context=surface.find(entry=>entry!==undefined&&entry.name==="runScriptContext");if(context===undefined||context.typeArguments[0]!=="ScriptCompletionRecord")return 35;
 const binding=surface.find(entry=>entry!==undefined&&entry.name==="setMutableBinding");if(binding===undefined||binding.typeArguments.length!==1||binding.typeArguments[0]!=="unknown")return 36;
 const moduleBytes=new TextEncoder().encode("export const result=42;export async function f(){await result;}export default class C{}");
 const moduleSource=createSourceText(moduleBytes,moduleBytes.length);if(!moduleSource.ok)return 60;
 const moduleParsed=parseModule(moduleSource.value);if(!moduleParsed.ok)return 61;
 const moduleResult=lowerSourceTextModule(moduleParsed.value);if(!moduleResult.ok)return 62;
 const moduleEntry=moduleResult.value.statements.find(node=>node!==undefined&&node.kind==="function");
 if(moduleEntry===undefined||moduleEntry.kind!=="function"||moduleEntry.name!=="create"||moduleEntry.parameters.length!==3)return 63;
 if(!moduleResult.value.imports.some(entry=>entry!==undefined&&entry.specifier==="@tint/js-runtime/modules"))return 64;
 if(moduleResult.value.imports.some(entry=>entry!==undefined&&entry.bindings.some(binding=>binding!==undefined&&binding.imported==="createLoweredAsyncSourceModule")))return 90;
 const awaitPrograms:readonly string[]=["export const value=await 42;","for await(const x of xs){x;}","await using resource=x;","class C{[await key](){return 1;}}","try{await f();}finally{await g();}","var value;for await (value of [await await await await await await await await await await await await await await await 'value']){await await await await await await await await await await await await await await await 'value';break;}for await (var value of [await await await await await await await await await await await await await await await 'value']){await await await await await await await await await await await await await await await 'value';break;}for await (let value of [await await await await await await await await await await await await await await await 'value']){await await await await await await await await await await await await await await await 'value';break;}","var value;for (value in [await await await await await await await await await await await await await await await 'value']){await await await await await await await await await await await await await await await 'value';break;}for (var value in [await await await await await await await await await await await await await await await 'value']){await await await await await await await await await await await await await await await 'value';break;}for (let value in [await await await await await await await await await await await await await await await 'value']){await await await await await await await await await await await await await await await 'value';break;}","var value;for (value of [await await await await await await await await await await await await await await await 'value']){await await await await await await await await await await await await await await await 'value';break;}for (var value of [await await await await await await await await await await await await await await await 'value']){await await await await await await await await await await await await await await await 'value';break;}for (let value of [await await await await await await await await await await await await await await await 'value']){await await await await await await await await await await await await await await await 'value';break;}","await 0;await 0;await 0;await 0;await 0;await 0;await 0;await 0;await 0;await 0;await 0;await 0;await 0;await 0;await 0;await 0;await 0;await 0;await 0;await 0;await 0;await 0;await 0;await 0;await 0;await 0;await 0;await 0;await 0;await 0;await 0;await 0;await 0;await 0;await 0;await 0;await 0;await 0;await 0;await 0;await 0;await 0;await 0;await 0;await 0;await 0;await 0;await 0;await 0;await 0;await 0;await 0;await 0;await 0;await 0;await 0;await 0;await 0;await 0;await 0;await 0;await 0;await 0;await 0;await 0;await 0;await 0;await 0;await 0;await 0;await 0;await 0;await 0;await 0;await 0;await 0;await 0;await 0;await 0;await 0;await 0;await 0;await 0;await 0;await 0;await 0;await 0;await 0;await 0;await 0;await 0;await 0;await 0;await 0;await 0;await 0;await 0;await 0;await 0;await 0;"];
 let awaitIndex=0;for(const text of awaitPrograms){if(text===undefined)throw "MODULE_AWAIT_INPUT_INVARIANT";const bytes=new TextEncoder().encode(text),source=createSourceText(bytes,bytes.length);if(!source.ok)return 91;const parsed=parseModule(source.value);if(!parsed.ok)return 92;const lowered=lowerSourceTextModule(parsed.value,text);if(awaitIndex++>=8){if(lowered.ok||lowered.error.code!=="LIMIT")return 99;continue;}if(!lowered.ok)return 93;if(!lowered.value.imports.some(entry=>entry!==undefined&&entry.bindings.some(binding=>binding!==undefined&&binding.imported==="createLoweredAsyncSourceModule")))return 94;}
 const moduleEvalPrograms:readonly string[]=["let value=40;eval(\\"value+2\\");","export function read(){return eval(\\"value\\");}let value=42;","let value=40;await 0;eval(\\"value+2\\");","class C{#value=40;read(){return eval(\\"this.#value+2\\");}}"];
 for(const text of moduleEvalPrograms){if(text===undefined)throw "MODULE_EVAL_INPUT_INVARIANT";const bytes=new TextEncoder().encode(text),source=createSourceText(bytes,bytes.length);if(!source.ok)return 101;const parsed=parseModule(source.value);if(!parsed.ok)return 102;const lowered=lowerSourceTextModule(parsed.value,text);if(!lowered.ok)return 103;const found:{value:boolean}={value:false};rewriteModule(lowered.value,{expression:(node:Expression,_original:Expression):Expression=>{if(node.kind==="call"){const callee=node.callee;if(callee.kind==="identifier"&&(callee.name==="callEvalCandidate"||callee.name==="callEvalTailCandidate"))found.value=true;}return node;}});if(!found.value)return 104;}
 const nameText="var fn;(fn)=function(){};fn=(function(){});",nameBytes=new TextEncoder().encode(nameText),nameSource=createSourceText(nameBytes,nameBytes.length);if(!nameSource.ok)return 95;const nameParsed=parseScript(nameSource.value);if(!nameParsed.ok)return 96;const nameLowered=lowerScript(nameParsed.value,nameText);if(!nameLowered.ok)return 97;
 const names:{empty:number;inferred:number}={empty:0,inferred:0};
 rewriteModule(nameLowered.value,{expression:(node:Expression,_original:Expression):Expression=>{if(node.kind==="call"){const callee=node.callee;if(callee.kind==="identifier"&&callee.name==="propertyFunctionName"){const value=node.arguments[0];if(value!==undefined&&value.kind==="string"){if(value.value==="")names.empty++;if(value.value==="fn")names.inferred++;}}}return node;}});
 if(names.empty!==1||names.inferred!==1)return 98;
 return 42;
}`,
  "script-lowering",
  [
    ["source", "packages/source/src/text.ts"],
    ["syntax", "packages/typescript/src/syntax/index.ts"],
    ["lowering", "packages/js-engine/src/lowering/index.ts"],
  ],
  [],
  [],
  [],
  {
    // Expanded continuation ASTs keep both input and copied syntax live.
    managedBytes: 16777216,
    // Generational forwarding metadata must cover the enlarged semispace.
    allocationCapacity: 262144,
    // This compiler workload recursively lowers a large AST. The current
    // statement handler has a 156 KB frame; the runtime-fixture 1 MB default
    // cannot hold its nested compiler calls. Test262 budgets are separate.
    stackBytes: 16777216,
  },
);
