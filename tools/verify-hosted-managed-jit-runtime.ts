import { verifyHostedFixture } from "./hosted-fixture.ts";

verifyHostedFixture(
  `
import {declareManagedJitRuntime} from "runtime-declarations";
import {parseModule,type Statement} from "syntax";
import {createSourceTextView} from "source";
import {checkClosureModule} from "checker";
import type {SourceModule} from "module-model";
const text="export type Pair={readonly left:number};const seed:number=4;export function make(value:number):Pair{const local:number[]=[value];return {left:local[0]??seed};}function helper(value:number):number{return value+1;}";
function declarationOnly(statement:Statement|undefined):boolean{
 if(statement===undefined||statement.kind!=="function")return false;
 const body=statement.body;
 if(body.kind!=="block"||body.statements.length!==1)return false;
 const thrown=body.statements[0];
 return thrown!==undefined&&thrown.kind==="throw"&&thrown.expression.kind==="string";
}
export function run():number{
 const parsed=parseModule(createSourceTextView(text));
 if(!parsed.ok)return 1;
 const source:SourceModule={id:"provider",module:parsed.value,dependencies:new Map<string,string>()};
 const globals:string[]=["undefined"];
 for(let iteration=0;iteration<16;iteration++){
  const declared=declareManagedJitRuntime({modules:[source],runtimes:[],globals});
  const module=declared.modules[0]?.module;
  if(module===undefined||declared.modules.length!==1||declared.globals!==globals)return 2;
  if(module.statements.length!==parsed.value.statements.length)return 3;
  let functions=0;
  for(let index=0;index<module.statements.length;index++){
   const original=parsed.value.statements[index],result=module.statements[index];
   if(original===undefined||result===undefined)return 4;
   if(original.kind!=="function"){if(result!==original)return 5;continue;}
   if(result.kind!=="function"||result.name!==original.name||result.parameters!==original.parameters||result.returnType!==original.returnType||result.exported!==original.exported)return 6;
   if(!declarationOnly(result))return 7;
   functions++;
  }
  if(functions!==2||declarationOnly(parsed.value.statements[2]))return 8;
  if(!checkClosureModule(module).ok)return 9;
 }
 return 42;
}`,
  "managed-jit-runtime",
  [
    [
      "runtime-declarations",
      "packages/compiler/src/native/managed-jit-runtime.ts",
    ],
    ["syntax", "packages/typescript/src/syntax/index.ts"],
    ["source", "packages/source/src/text.ts"],
    ["checker", "packages/typescript/src/checker/index.ts"],
    ["module-model", "packages/typescript/src/modules/model.ts"],
  ],
  [],
  [],
  [],
  {
    runtimeEntry: "initializeCopyingRuntime",
    managedBytes: 33554432,
    allocationCapacity: 524288,
    rootCapacity: 4096,
    stackBytes: 16777216,
  },
);
