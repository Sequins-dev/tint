import { verifyHostedFixture } from "./hosted-fixture.ts";
verifyHostedFixture(
  `
import {createSourceTextView} from "source";
import {parseModule} from "syntax";
import {checkClosureModule} from "checker";
import {lowerModuleEntries} from "lowering";
import type {TargetDataLayout} from "layout";
import {verify,summarizeEffects,instructionEffects,provenDirectOnlyFunctions,effectAllocate,effectThrow,type ModuleIR,type FunctionIR} from "ir";
import {optimizeModule,pruneClosedModule} from "optimizer";
import {emitModule} from "emitter";
export function run():number {
 const parsed=parseModule(createSourceTextView("function helper(value:number):number{const hidden:unknown[]=[];function nested():number{return hidden.length;}return value+nested();}export function run():number{return helper(42);}"));if(!parsed.ok)return 1;
 const checked=checkClosureModule(parsed.value);if(!checked.ok)return 2;
 const graph=checked.value;
 if(graph.bindings.functions.length!==3)return 3;
 const helper=graph.bindings.functions[0],nested=graph.bindings.functions[1],main=graph.bindings.functions[2];if(helper===undefined||nested===undefined||main===undefined)return 4;
 if(helper.parent!==undefined||nested.parent!==helper.id||main.parent!==undefined)return 5;
 const target:TargetDataLayout={pointerSize:8,wordSize:8,allocationAlignment:16,frameAlignment:16,maxAlignment:16};
 if(lowerModuleEntries(graph,[main.id,helper.id],target,4096).ok)return 6;
 const imported=lowerModuleEntries(graph,[main.id],target,4096,{importedFunctions:[helper.id]});if(!imported.ok)return 7;
 const module=imported.value.module;
 if(!verify(module).ok||module.functions.length!==2)return 8;
 const declaration=module.functions[1];if(declaration===undefined||declaration.import!==true||declaration.blocks.length!==0||declaration.parameters.length!==1||declaration.slots[0]!=="number"||declaration.returnType!=="number")return 9;
 const effects=summarizeEffects(module);if(effects===undefined)return 10;
 const callerEffects=effects[0],importEffects=effects[1];if(callerEffects===undefined||importEffects===undefined)return 11;
 if((callerEffects&effectAllocate)!==effectAllocate||(callerEffects&effectThrow)!==effectThrow||(importEffects&effectAllocate)!==effectAllocate)return 12;
 const optimized=optimizeModule(module);if(optimized.budgetExhausted||!verify(optimized.module).ok)return 13;
 const pruned=pruneClosedModule(optimized.module,[0]);if(pruned===undefined||pruned.module.functions.length!==2||!verify(pruned.module).ok)return 14;
 const retained=pruned.module.functions[1];if(retained===undefined||retained.import!==true||retained.blocks.length!==0)return 15;
 const emitted=emitModule(pruned.module);if(emitted.ok||!emitted.error.message.includes("function-entry"))return 16;
 if(lowerModuleEntries(graph,[main.id],target,4096,{importedFunctions:[helper.id,helper.id]}).ok)return 17;
 if(lowerModuleEntries(graph,[main.id],target,4096,{importedFunctions:[nested.id]}).ok)return 18;
 const addressFunctions:FunctionIR[]=module.functions.slice();addressFunctions.push({id:2,name:"address",exported:true,parameters:[],slots:[],returnType:"number",entry:0,blocks:[{id:0,instructions:[{kind:"function-address",id:0,target:0,part:"entry",start:0,end:0}],terminator:{kind:"return",value:0,start:0,end:0}}]});
 const address:ModuleIR={...module,functions:addressFunctions};
 const boundParsed=parseModule(createSourceTextView('function callee(value:number):number{return value;}function entry():number{const hidden:unknown[]=[];function nested():number{return hidden.length;}return nested();}function signature():number{throw "UNBOUND";}'));if(!boundParsed.ok)return 25;
 const boundChecked=checkClosureModule(boundParsed.value);if(!boundChecked.ok)return 26;
 const boundGraph=boundChecked.value;
 const addressLowered=lowerModuleEntries(boundGraph,[0,1,3],target,4096,{functionAddressBindings:[{function:1,target:0,part:"entry"},{function:3,target:0,part:"signature"}]});
 if(!addressLowered.ok||!verify(addressLowered.value.module).ok||addressLowered.value.module.functions.length!==3)return 27;
 const boundEntry=addressLowered.value.module.functions[1],boundSignature=addressLowered.value.module.functions[2];if(boundEntry===undefined||boundSignature===undefined)return 28;
 const entryBlock=boundEntry.blocks[0],signatureBlock=boundSignature.blocks[0];if(entryBlock===undefined||signatureBlock===undefined)return 29;
 const entryOp=entryBlock.instructions[0],signatureOp=signatureBlock.instructions[0];if(entryOp===undefined||signatureOp===undefined||entryOp.kind!=="function-address"||signatureOp.kind!=="function-address"||entryOp.target!==0||signatureOp.target!==0||entryOp.part!=="entry"||signatureOp.part!=="signature")return 30;
 if(lowerModuleEntries(boundGraph,[0,1,3],target,4096,{functionAddressBindings:[{function:1,target:0,part:"entry"}],importedFunctions:[0]}).ok)return 31;
 if(!verify(address).ok)return 19;
 const addressFunction=address.functions[2];if(addressFunction===undefined)return 20;
 const addressBlock=addressFunction.blocks[0];if(addressBlock===undefined)return 21;
 const addressOperation=addressBlock.instructions[0];if(addressOperation===undefined||instructionEffects(addressOperation)!==0)return 22;
 const direct=provenDirectOnlyFunctions(address,[2]);if(direct===undefined||direct[0]!==0)return 23;
 const addressPruned=pruneClosedModule(address,[2]);if(addressPruned===undefined||addressPruned.module.functions.length!==3||!verify(addressPruned.module).ok)return 24;
 return 42;
}`,
  "imported-functions",
  [
    ["source", "packages/source/src/text.ts"],
    ["syntax", "packages/typescript/src/syntax/index.ts"],
    ["checker", "packages/typescript/src/checker/index.ts"],
    ["lowering", "packages/ts-native/src/closure/lowering/index.ts"],
    ["layout", "packages/ts-native/src/closure/layout.ts"],
    ["ir", "packages/ir/src/scalar/index.ts"],
    ["optimizer", "packages/ir/src/optimization/index.ts"],
    ["emitter", "packages/codegen/src/aarch64/scalar/index.ts"],
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
