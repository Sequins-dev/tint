import { verifyHostedFixture } from "./hosted-fixture.ts";
verifyHostedFixture(
  `
import {createSourceTextView} from "source";
import {parseModule,type Statement} from "syntax";
import {checkClosureModule} from "checker";
import {lowerModuleEntries} from "lowering";
import {createRuntimeEntryStubs,resolveRuntimeEntryBindings,reifyManagedSurfaceTypes,planManagedSurfaceContracts,planManagedSurfaceRuntimes,createManagedRuntimeAnchors} from "compiler";
export function run():number {
 const plan=createRuntimeEntryStubs(["first","second"],"$entry");if(!plan.ok)return 1;
 if(plan.value.declarations.length!==4)return 2;
 const parsed=parseModule(createSourceTextView('function first():number{return 19;}function second():number{return 23;}'));if(!parsed.ok)return 3;
 const statements:Statement[]=[];
 for(const statement of parsed.value.statements){if(statement===undefined)throw "statement invariant";statements.push(statement);}
 for(const statement of plan.value.declarations){if(statement===undefined)throw "stub invariant";statements.push(statement);}
 const checked=checkClosureModule({start:0,end:0,imports:[],statements});if(!checked.ok)return 4;
 const resolved=resolveRuntimeEntryBindings(checked.value,plan.value);if(!resolved.ok)return 5;
 if(resolved.value.length!==4||resolved.value[0]?.target!==0||resolved.value[2]?.target!==1)return 6;
 const lowered=lowerModuleEntries(checked.value,[0,1,2,3,4,5],{pointerSize:8,wordSize:8,allocationAlignment:16,frameAlignment:16,maxAlignment:16},4096,{functionAddressBindings:resolved.value});if(!lowered.ok)return 7;
 for(let index=2;index<6;index++){const fn=lowered.value.module.functions[index];if(fn===undefined||fn.blocks[0]?.instructions[0]?.kind!=="function-address")return 8;}
 if(createRuntimeEntryStubs(["x","x"],"$entry").ok)return 9;
 const linked=createRuntimeEntryStubs(["@6:value:10"],"$entry");if(!linked.ok||linked.value.entries[0]?.target!=="@6:value:10")return 10;
 const missing=createRuntimeEntryStubs(["missing"],"$entry");if(!missing.ok||resolveRuntimeEntryBindings(checked.value,missing.value).ok)return 11;
 const collectionParsed=parseModule(createSourceTextView('function use(a:number[],b:readonly number[],c:Map<string,number>,d:Set<number>):number{return 0;}'));if(!collectionParsed.ok)return 12;
 const collectionChecked=checkClosureModule(collectionParsed.value);if(!collectionChecked.ok)return 13;
 const surface=reifyManagedSurfaceTypes(collectionChecked.value,[{name:"use",local:"use"}],"$Surface");if(!surface.ok)return 14;
 const contracts=planManagedSurfaceContracts(surface.value);if(!contracts.ok)return 15;
 const census=planManagedSurfaceRuntimes(contracts.value);if(!census.ok)return 16;
 if(census.value.anchors.length!==4||census.value.collections.length!==3||census.value.anchors[0]?.provider!==census.value.anchors[1]?.provider)return 17;
 const first=census.value.collections[0];if(first===undefined||first.kind!=="list"||first.operations.length!==8)return 18;
 const anchorPlan=createManagedRuntimeAnchors(census.value,"$collections");if(!anchorPlan.ok||anchorPlan.value.declarations.length!==4)return 19;
 const anchorStatements:Statement[]=[];
 for(const declaration of contracts.value.surface.declarations){if(declaration===undefined)throw "alias invariant";anchorStatements.push(declaration);}
 for(const declaration of anchorPlan.value.declarations){if(declaration===undefined)throw "anchor invariant";anchorStatements.push(declaration);}
 const anchorChecked=checkClosureModule({start:0,end:0,imports:[],statements:anchorStatements});if(!anchorChecked.ok)return 20;
 const shared=createRuntimeEntryStubs(["first","second"],"$shared",[{parameters:[],returnType:"number"},{parameters:[],returnType:"number"}]);if(!shared.ok||shared.value.declarations.length!==3)return 21;
 const sharedStatements:Statement[]=[];
 for(const declaration of parsed.value.statements){if(declaration===undefined)throw "source invariant";sharedStatements.push(declaration);}
 for(const declaration of shared.value.declarations){if(declaration===undefined)throw "stub invariant";sharedStatements.push(declaration);}
 const sharedChecked=checkClosureModule({start:0,end:0,imports:[],statements:sharedStatements});if(!sharedChecked.ok)return 22;
 const sharedBindings=resolveRuntimeEntryBindings(sharedChecked.value,shared.value);if(!sharedBindings.ok||sharedBindings.value.length!==3)return 23;
 const sharedLowered=lowerModuleEntries(sharedChecked.value,[0,1,2,3,4],{pointerSize:8,wordSize:8,allocationAlignment:16,frameAlignment:16,maxAlignment:16},4096,{functionAddressBindings:sharedBindings.value});if(!sharedLowered.ok)return 24;
 return 42;
}
`,
  "runtime-entry-stubs",
  [
    ["source", "packages/source/src/text.ts"],
    ["syntax", "packages/typescript/src/syntax/index.ts"],
    ["checker", "packages/typescript/src/checker/index.ts"],
    ["lowering", "packages/ts-native/src/closure/lowering/index.ts"],
    ["compiler", "packages/compiler/src/native/index.ts"],
  ],
);
