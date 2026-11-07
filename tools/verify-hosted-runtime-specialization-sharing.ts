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
import {parseModule,type Module} from "syntax";
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
 return prepareCollectionRuntimes(linked.value.module,checked.value,helpers,globals,undefined,24,equality).ok;
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
