import { readFileSync } from "node:fs";
import { verifyHostedFixture } from "./hosted-fixture.ts";
const numeric = JSON.stringify(
  readFileSync("packages/foundation/src/collections/number-list.ts", "utf8"),
);
const sparse = JSON.stringify(
  readFileSync("packages/foundation/src/collections/sparse-list.ts", "utf8"),
);
verifyHostedFixture(
  `
import {createSourceTextView} from "source";
import {parseModule,type Module} from "syntax";
import {checkClosureModule} from "checker";
import {reifyManagedSurfaceTypes,deriveManagedSurfacePhysicalFacts,prepareManagedRuntimeEntries,planManagedSurfaceContracts,planManagedSurfaceRuntimes,createManagedRuntimeAnchors,type ManagedRuntimeNamePlan,type ManagedRuntimeProviderKey,type RuntimeSource} from "compiler";
import type {SourceModule} from "modules";
function parse(text:string):Module {const result=parseModule(createSourceTextView(text));if(!result.ok)throw "PARSE";return result.value;}
export function run():number {
 const checked=checkClosureModule(parse('function schema(numbers:number[],words:string[]):number{return 0;}'));if(!checked.ok)return 1;
 const surface=reifyManagedSurfaceTypes(checked.value,[{name:"schema",local:"schema"}],"$Schema");if(!surface.ok)return 2;
 const modules:SourceModule[]=[{id:"number-list",module:parse(${numeric}),dependencies:new Map<string,string>()},{id:"sparse-list",module:parse(${sparse}),dependencies:new Map<string,string>()}];
 const runtimes:RuntimeSource[]=[{module:"number-list",namespace:"number-list"},{module:"sparse-list",namespace:"sparse-list"}];
 const globals=["undefined","Number","Math","Float64Array","Uint8Array"];
 const facts=deriveManagedSurfacePhysicalFacts(surface.value,{modules,runtimes,globals});if(!facts.ok)return 3;
 if(facts.value.runtimes.length!==2||facts.value.signatures.length===0)return 4;
 let count=0;
 for(const provider of facts.value.runtimes){
   if(provider===undefined||provider.kind!=="list"||provider.operations.length!==8||provider.element.length===0||provider.value!=="")return 5;
   for(const operation of provider.operations){if(operation===undefined||operation.operation.length===0||operation.returnType===undefined)return 6;count++;}
 }
 if(count!==16)return 7;
 const absent=deriveManagedSurfacePhysicalFacts(surface.value,{modules:[],runtimes:[],globals});if(absent.ok)return 8;
 const providers:{key:ManagedRuntimeProviderKey;targets:readonly string[]}[]=[],targets:string[]=[];
 for(let index=0;index<facts.value.runtimes.length;index++){
  const provider=facts.value.runtimes[index];if(provider===undefined)throw "provider invariant";
  const names:string[]=[],operations:string[]=[];
  for(let operation=0;operation<provider.operations.length;operation++){
   const item=provider.operations[operation];if(item===undefined)throw "operation invariant";
   const name="$target_"+index+"_"+operation;names.push(name);targets.push(name);operations.push(item.operation);
  }
  providers.push({key:{kind:provider.kind,element:provider.element,value:provider.value,operations},targets:names});
 }
 const names:ManagedRuntimeNamePlan={providers,targets};
 const entries=prepareManagedRuntimeEntries(names,facts.value.runtimes,"$entries");if(!entries.ok||entries.value.slots.length!==16||entries.value.stubs.entries.length!==16)return 9;
 const contracts=planManagedSurfaceContracts(surface.value);if(!contracts.ok)return 10;
 const census=planManagedSurfaceRuntimes(contracts.value);if(!census.ok)return 11;
 const anchors=createManagedRuntimeAnchors(census.value,"$anchors",(alias:string):string=>"$ns_"+alias);if(!anchors.ok)return 12;
 const declaration=anchors.value.declarations[0],anchor=anchors.value.anchors[0];if(declaration===undefined||declaration.kind!=="function"||anchor===undefined)return 13;
 const parameter=declaration.parameters[0];if(parameter===undefined)return 14;
 const type=parameter.type;if(type===undefined||type.kind!=="named"||type.name!=="$ns_"+anchor.alias)return 15;
 const firstNames=providers[0],firstProvider=facts.value.runtimes[0];if(firstNames===undefined||firstProvider===undefined)return 16;
 const repeated=facts.value.runtimes.slice();repeated.push(firstProvider);providers.push(firstNames);
 const shared=prepareManagedRuntimeEntries(names,repeated,"$shared");if(!shared.ok||shared.value.slots.length!==24||shared.value.stubs.entries.length!==16)return 17;
 return 42;
}
`,
  "runtime-layout",
  [
    ["source", "packages/source/src/text.ts"],
    ["syntax", "packages/typescript/src/syntax/index.ts"],
    ["checker", "packages/typescript/src/checker/index.ts"],
    ["compiler", "packages/compiler/src/native/index.ts"],
    ["modules", "packages/typescript/src/modules/model.ts"],
  ],
  [],
  [],
  [],
  {
    runtimeEntry: "initializeCopyingRuntime",
    managedBytes: 67108864,
    allocationCapacity: 1048576,
    rootCapacity: 16384,
    stackBytes: 16777216,
  },
);
