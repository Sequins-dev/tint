import { readFileSync } from "node:fs";
import { verifyHostedFixture } from "./hosted-fixture.ts";
const numberSource = JSON.stringify(
  readFileSync("packages/foundation/src/collections/number-list.ts", "utf8"),
);
const sparseSource = JSON.stringify(
  readFileSync("packages/foundation/src/collections/sparse-list.ts", "utf8"),
);
verifyHostedFixture(
  `
import {createSourceTextView} from "source";
import {parseModule,syntaxHash,type Module} from "syntax";
import {bindModule} from "binding";
import {checkClosureModule,type CheckedClosures} from "checker";
import {linkModules,specializeModule} from "modules";
import {prepareCollectionRuntimes,type RuntimeBindingContext} from "runtimes";
import {reifyManagedSurfaceTypes,planManagedSurfaceContracts,planManagedSurfaceRuntimes,resolveManagedRuntimeNames,type ManagedRuntimeAnchorPlan} from "compiler";
function parse(text:string):Module {const parsed=parseModule(createSourceTextView(text));if(!parsed.ok)throw "PARSE";return parsed.value;}
function functionId(checked:CheckedClosures,name:string):number {
 for(const statement of checked.module.statements){
  if(statement===undefined||statement.kind!=="function"||statement.name!==name)continue;
  const hash=syntaxHash(statement);
  for(const fn of checked.bindings.functions){
   if(fn!==undefined&&fn.node.start===statement.start&&fn.node.end===statement.end&&syntaxHash(fn.node)===hash)return fn.id;
  }
 }
 return -1;
}
export function run():number {
 const globals=["undefined","Number","Math","Float64Array","Uint8Array"];
 const dependencies=new Map<string,string>();dependencies.set("numbers","number-list");dependencies.set("sparse","sparse-list");
 const linked=linkModules([
  {id:"number-list",module:parse(${numberSource}),dependencies:new Map<string,string>()},
  {id:"sparse-list",module:parse(${sparseSource}),dependencies:new Map<string,string>()},
  {id:"app",module:parse('import "numbers";import "sparse";export function anchor(numbers:number[],words:string[]):void{numbers.push(1);words.push("x");}export function numberAnchor(numbers:number[]):number{return numbers.length;}export function wordAnchor(words:string[]):number{return words.length;}'),dependencies}
 ],"app",globals,{evaluation:"instance"});if(!linked.ok)return 1;
 const bound=bindModule(linked.value.module,globals);if(!bound.ok)return 2;
 const specialized=specializeModule(linked.value.module,bound.value);if(!specialized.ok)return 3;
 const checked=checkClosureModule(specialized.value.module);if(!checked.ok)return 4;
 const helpers=new Map<string,string>();let anchor="",numberAnchor="",wordAnchor="";
 for(const item of linked.value.exports){if(item===undefined)throw "EXPORT";if(item.namespace==="value")helpers.set(item.module+":"+item.name,item.linkedName);if(item.module==="app"&&item.name==="anchor")anchor=item.linkedName;if(item.module==="app"&&item.name==="numberAnchor")numberAnchor=item.linkedName;if(item.module==="app"&&item.name==="wordAnchor")wordAnchor=item.linkedName;}
 if(anchor===""||numberAnchor===""||wordAnchor==="")return 5;
 const schema=checkClosureModule(parse('function schema(numbers:number[],words:string[]):number{return 0;}'));if(!schema.ok)return 15;
 const surface=reifyManagedSurfaceTypes(schema.value,[{name:"schema",local:"schema"}],"$Schema");if(!surface.ok)return 16;
 const contracts=planManagedSurfaceContracts(surface.value);if(!contracts.ok)return 17;
 const census=planManagedSurfaceRuntimes(contracts.value);if(!census.ok||census.value.anchors.length!==2)return 18;
 const numericAlias=census.value.anchors[0],wordsAlias=census.value.anchors[1];if(numericAlias===undefined||wordsAlias===undefined)return 19;
 const subjects:ManagedRuntimeAnchorPlan={declarations:[],anchors:[{name:numberAnchor,alias:numericAlias.alias,provider:numericAlias.provider},{name:wordAnchor,alias:wordsAlias.alias,provider:wordsAlias.provider}]};
 let saved:RuntimeBindingContext|undefined=undefined;
 let numeric:string|undefined=undefined,words:string|undefined=undefined;
 let calls=0;
 const prepared=prepareCollectionRuntimes(linked.value.module,checked.value,helpers,globals,(module,context)=>{
  calls=calls+1;saved=context;
  const selected=resolveManagedRuntimeNames(context,census.value,subjects);if(!selected.ok)return selected;
  if(selected.value.providers.length!==2||selected.value.targets.length!==16)return {ok:false,error:"CENSUS_SELECTION"};
  const numbers=context.collection({function:anchor,parameter:0});if(!numbers.ok||numbers.value.kind!=="list")return {ok:false,error:"NUMBER_LOOKUP"};
  numeric=numbers.value.operations.get("create");
  const strings=context.collection({function:anchor,parameter:1});if(!strings.ok||strings.value.kind!=="list")return {ok:false,error:"STRING_LOOKUP"};
  words=strings.value.operations.get("read");
  if(context.collection({function:anchor,parameter:2}).ok)return {ok:false,error:"INVALID_PARAMETER"};
  if(context.primitives()!==undefined||context.numberText()!==undefined)return {ok:false,error:"UNLINKED_HELPERS"};
  return {ok:true,value:module};
 });
 if(!prepared.ok||calls<1)return 6;
 const last=saved,numericName=numeric,wordName=words;if(last===undefined||numericName===undefined||wordName===undefined)return 7;
 if(last.collection({function:anchor,parameter:0}).ok)return 8;
 if(numericName!==helpers.get("number-list:createNumberList"))return 9;
 const lists=prepared.value.options.lists;if(lists===undefined)return 10;
 const numericList=lists.find(list=>list!==undefined&&list.element==="number"),stringList=lists.find(list=>list!==undefined&&list.element==="string");
 if(numericList===undefined||stringList===undefined)return 11;
 if(functionId(prepared.value.checked,numericName)!==numericList.runtime.create)return 12;
 if(functionId(prepared.value.checked,wordName)!==stringList.runtime.read)return 13;
 helpers.delete("number-list:readNumberList");
 const missing=prepareCollectionRuntimes(linked.value.module,checked.value,helpers,globals,(module,context)=>{
   context.collection({function:anchor,parameter:0});return {ok:true,value:module};
 });
 if(missing.ok||missing.error!=="missing runtime helper: number-list:readNumberList")return 14;
 return 42;
}`,
  "runtime-binding-context",
  [
    ["source", "packages/source/src/text.ts"],
    ["syntax", "packages/typescript/src/syntax/index.ts"],
    ["binding", "packages/typescript/src/binding/index.ts"],
    ["checker", "packages/typescript/src/checker/index.ts"],
    ["modules", "packages/ts-native/src/modules/index.ts"],
    ["runtimes", "packages/ts-native/src/runtime/index.ts"],
    ["compiler", "packages/compiler/src/native/index.ts"],
  ],
  [],
  [],
  [],
  {
    runtimeEntry: "initializeGenerationalRuntime",
    managedBytes: 67108864,
    allocationCapacity: 1048576,
    rootCapacity: 16384,
    stackBytes: 16777216,
  },
);
