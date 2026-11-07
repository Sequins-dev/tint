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
import {prepareCollectionRuntimes} from "runtime";
function parse(text:string):Module{const result=parseModule(createSourceTextView(text));if(!result.ok)throw "PARSE";return result.value;}
export function run():number{
 const globals:readonly string[]=["undefined","NaN","Infinity","Number","Math","Float64Array","Uint8Array"];
 const deps=new Map<string,string>();deps.set("numbers","numbers");deps.set("lists","lists");
 const input=parse('import "numbers";import "lists";interface Item{value:number;}function anchor(a:Item[]):number{return a.length;}');
 const linked=linkModules([{id:"app",module:input,dependencies:deps},{id:"numbers",module:parse(${JSON.stringify(numbers)}),dependencies:new Map<string,string>()},{id:"lists",module:parse(${JSON.stringify(lists)}),dependencies:new Map<string,string>()}],"app",globals,{evaluation:"instance"});
 if(!linked.ok)return 1;const bound=bindModule(linked.value.module,globals);if(!bound.ok)return 2;const specialized=specializeModule(linked.value.module,bound.value);if(!specialized.ok)return 3;const checked=checkClosureModule(specialized.value.module);if(!checked.ok)return 4;
 const helpers=new Map<string,string>();for(const item of linked.value.exports){if(item===undefined)throw "EXPORT";if(item.namespace==="value")helpers.set((item.module==="numbers"?"number-list":"sparse-list")+":"+item.name,item.linkedName);}
 const added:Statement[]=[];for(let i=0;i<32;i++)added.push({start:0,end:0,kind:"function",name:"__lateHash"+i,exported:false,parameters:[],returnType:{start:0,end:0,kind:"named",name:"number"},body:{start:0,end:0,kind:"block",statements:[{start:0,end:0,kind:"return",expression:{start:0,end:0,kind:"number",value:i,raw:String(i)}}]}});
 const prepared=prepareCollectionRuntimes(linked.value.module,checked.value,helpers,globals,(module,_context)=>({ok:true,value:{...module,statements:[...module.statements,...added]}}),64);
 if(!prepared.ok)return 5;
 const hashes=new Set<number>();let count=0;
 for(const statement of prepared.value.checked.module.statements){if(statement===undefined)throw "STATEMENT";if(statement.kind!=="function")continue;const name=statement.name,body=statement.body;if(!name.startsWith("__lateHash"))continue;if(body.kind!=="block")return 6;const returned=body.statements[0];if(returned===undefined||returned.kind!=="return")return 7;const value=returned.expression;if(value===undefined||value.kind!=="number"||value.start!==0||value.end!==0||typeof value.nodeHash!=="number")return 8;hashes.add(syntaxHash(value));count++;}
 if(count!==32||hashes.size!==32)return 9;
 for(const statement of added){if(statement===undefined||statement.kind!=="function"||statement.body.kind!=="block")return 10;const returned=statement.body.statements[0];if(returned===undefined||returned.kind!=="return"||returned.expression?.nodeHash!==undefined)return 11;}
 return 42;
}`,
  "runtime-transform-hashes",
  [
    ["source", "packages/source/src/text.ts"],
    ["syntax", "packages/typescript/src/syntax/index.ts"],
    ["binding", "packages/typescript/src/binding/index.ts"],
    ["checker", "packages/typescript/src/checker/index.ts"],
    ["modules", "packages/ts-native/src/modules/index.ts"],
    ["runtime", "packages/ts-native/src/runtime/index.ts"],
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
