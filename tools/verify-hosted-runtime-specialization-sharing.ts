import { readFileSync } from "node:fs";
import { verifyHostedFixture } from "./hosted-fixture.ts";
const numbers = readFileSync(
    "packages/foundation/src/collections/number-list.ts",
    "utf8",
  ),
  lists = readFileSync(
    "packages/foundation/src/collections/sparse-list.ts",
    "utf8",
  );
verifyHostedFixture(
  `import {createSourceTextView} from "source";
import {parseModule,syntaxHash,type Module,type Statement} from "syntax";
import {bindModule} from "binding";
import {checkClosureModule} from "checker";
import {linkModules,specializeModule} from "modules";
import {prepareCollectionRuntimes,type RuntimeTypeEquivalenceFactory} from "runtime";
import {createManagedTypeContractIndex} from "compiler";
import type {Type} from "types";
function parse(text:string):Module{const parsed=parseModule(createSourceTextView(text));if(!parsed.ok)throw "PARSE";return parsed.value;}
function check(fields:string,sharing:boolean):boolean{
 const globals:readonly string[]=["undefined","NaN","Infinity","Number","Math","Float64Array","Uint8Array"];
 const input=parse('import "numbers";import "lists";interface Left{value:number;next:Left|undefined;}interface Right{'+fields+'}function run(a:Left[],b:Right[]):number{return a.length+b.length;}');
 const deps=new Map<string,string>();deps.set("numbers","numbers");deps.set("lists","lists");
 const linked=linkModules([{id:"app",module:input,dependencies:deps},{id:"numbers",module:parse(${JSON.stringify(numbers)}),dependencies:new Map<string,string>()},{id:"lists",module:parse(${JSON.stringify(lists)}),dependencies:new Map<string,string>()}],"app",globals,{evaluation:"instance"});
 if(!linked.ok)throw "LINK";const bound=bindModule(linked.value.module,globals);if(!bound.ok)throw "BIND";
 const specialized=specializeModule(linked.value.module,bound.value);if(!specialized.ok)throw "SPECIALIZE";
 const checked=checkClosureModule(specialized.value.module);if(!checked.ok)throw "CHECK";
 const helpers=new Map<string,string>();for(const item of linked.value.exports){if(item===undefined)throw "EXPORT";if(item.namespace==="value")helpers.set((item.module==="numbers"?"number-list":"sparse-list")+":"+item.name,item.linkedName);}
 let equality:RuntimeTypeEquivalenceFactory|undefined=undefined;
 if(sharing)equality=(types:readonly Type[]):((left:number,right:number)=>boolean)=>{const index=createManagedTypeContractIndex(types);return(left:number,right:number):boolean=>{if(!index.ok)return false;const result=index.value.matches(left,right);return result.ok&&result.value;};};
 const added:Statement[]=[];for(let i=0;i<32;i++)added.push({start:0,end:0,kind:"function",name:"__lateHash"+i,exported:false,parameters:[],returnType:{start:0,end:0,kind:"named",name:"number"},body:{start:0,end:0,kind:"block",statements:[{start:0,end:0,kind:"return",expression:{start:0,end:0,kind:"number",value:i,raw:String(i)}}]}});
 const prepared=prepareCollectionRuntimes(linked.value.module,checked.value,helpers,globals,(module,_context)=>{const statements:Statement[]=[];for(const original of module.statements){if(original===undefined)throw "SOURCE_STATEMENT";statements.push(original);}for(const extra of added){if(extra===undefined)throw "ADDED_STATEMENT";statements.push(extra);}const value:Module={...module,statements};return{ok:true,value};},24,equality);
 if(prepared.ok){const hashes=new Set<number>();let count=0;for(const statement of prepared.value.checked.module.statements){if(statement===undefined)throw "STATEMENT";if(statement.kind!=="function")continue;const name=statement.name,body=statement.body;if(!name.startsWith("__lateHash"))continue;if(body.kind!=="block")throw "BODY";const returned=body.statements[0];if(returned===undefined||returned.kind!=="return")throw "RETURN";const value=returned.expression;if(value===undefined||value.kind!=="number"||value.start!==0||value.end!==0||typeof value.nodeHash!=="number")throw "LATE_HASH";hashes.add(syntaxHash(value));count++;}if(count!==32||hashes.size!==32)throw "HASH_COLLISION";}
 return prepared.ok;
}
export function run():number{
 const same="value:number;next:Right|undefined;";
 if(check(same,false))return 1;
 if(!check(same,true))return 2;
 if(check("next:Right|undefined;value:number;",true))return 3;
 if(check("readonly value:number;next:Right|undefined;",true))return 4;
 if(check("value:number;next?:Right;",true))return 5;
 return 42;
}`,
  "runtime-specialization-sharing",
  [
    ["source", "packages/source/src/text.ts"],
    ["syntax", "packages/typescript/src/syntax/index.ts"],
    ["binding", "packages/typescript/src/binding/index.ts"],
    ["checker", "packages/typescript/src/checker/index.ts"],
    ["modules", "packages/ts-native/src/modules/index.ts"],
    ["runtime", "packages/ts-native/src/runtime/index.ts"],
    ["compiler", "packages/compiler/src/native/index.ts"],
    ["types", "packages/typescript/src/types/index.ts"],
  ],
  [],
  [],
  [],
  {
    managedBytes: 268435456,
    allocationCapacity: 8388608,
    stackBytes: 16777216,
    rootCapacity: 16384,
  },
);
