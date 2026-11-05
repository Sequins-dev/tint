import { verifyHostedFixture } from "./hosted-fixture.ts";
verifyHostedFixture(
  `
import {createSourceText} from "source";
import {parseStrictScript} from "syntax";
import {collectStrictScriptDeclarations,bindStrictScript} from "binding";
import {createGlobalEnvironment,validateGlobalDeclarations,instantiateGlobalDeclarations,getGlobalBinding,type GlobalDeclarations} from "global";
import {createObject,type ObjectHooks} from "object";
function key(name:string):string{return name;}
export function run():number{
 const bytes=new TextEncoder().encode("let a; const b=1; {var nested; let local;} for(var i=0;i<1;i++){var loop;} function f(){var hidden; function inner(){} function inner(a=1, read=()=>a){var a=2; try{}catch(e){var e=2;} return read();} return inner;} function f(){}");
 const source=createSourceText(bytes,bytes.length);if(!source.ok)return 1;
 const parsed=parseStrictScript(source.value);if(!parsed.ok)return 2;
 const bound=bindStrictScript(parsed.value);if(!bound.ok)return 11;
 const root=bound.value.scopes[0];if(root===undefined||root.kind!=="script")return 12;
 const inner=bound.value.bindings.filter(binding=>binding.name==="inner");
 if(inner.length!==1)return 13;
 const binding=inner[0];if(binding===undefined||binding.kind!=="function")return 14;
 const bodies=bound.value.functions.filter(fn=>fn.parent===binding.owner);
 if(bodies.length!==2)return 15;
 const winner=bodies[1];if(winner===undefined||winner.node!==binding.node)return 16;
 const copies=winner.parameterCopies;if(copies===undefined||copies.length!==1)return 17;
 const copy=copies[0];if(copy===undefined||copy.source===copy.target)return 18;
 const parameter=bound.value.bindings[copy.source],local=bound.value.bindings[copy.target];
 if(parameter===undefined||local===undefined||parameter.kind!=="parameter"||local.kind!=="var")return 19;
 if(parameter.scope===local.scope||parameter.owner!==local.owner)return 20;
 const targets=bound.value.varInitializerTargets;if(targets===undefined||targets.length!==1)return 21;
 const target=targets[0];if(target===undefined)return 22;
 const caught=bound.value.bindings[target.binding];if(caught===undefined||caught.kind!=="catch")return 23;
 const declarations=collectStrictScriptDeclarations(parsed.value);
 if(declarations.lexical.length!==2||declarations.variables.join()!=="nested,i,loop")return 3;
 if(declarations.functions.length!==2)return 4;
 const first=declarations.functions[0],last=declarations.functions[1];
 if(first===undefined||last===undefined||first.name!=="f"||last.name!=="f")return 5;
 const hooks:ObjectHooks<number>={undefinedValue:0,sameValue:(a,b):boolean=>a===b,call:(callee,receiver,args):number=>0};
 const record=createGlobalEnvironment<string,number>(createObject<string,number>(undefined),1,1,key,hooks);
 // Function bodies are not executed in this infrastructure fixture.
 const plan:GlobalDeclarations<number>={lexical:declarations.lexical,variables:declarations.variables,functions:[]};
 if(validateGlobalDeclarations<number>(plan)!==undefined)return 6;
 if(instantiateGlobalDeclarations<string,number>(record,plan)!=="none")return 7;
 if(getGlobalBinding<string,number>(record,"a",true).error!=="reference")return 8;
 if(getGlobalBinding<string,number>(record,"nested",true).error!=="none")return 9;
 if(getGlobalBinding<string,number>(record,"local",true).error!=="reference")return 10;
 return 42;
}`,
  "script-declarations",
  [
    ["source", "packages/source/src/text.ts"],
    ["syntax", "packages/typescript/src/syntax/index.ts"],
    ["binding", "packages/typescript/src/binding/index.ts"],
    ["global", "packages/js-runtime/src/environments/global/index.ts"],
    ["object", "packages/js-runtime/src/objects/index.ts"],
  ],
);
