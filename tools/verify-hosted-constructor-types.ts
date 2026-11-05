import { verifyHostedFixture } from "./hosted-fixture.ts";

// Type-contract execution in the native compiler, not a JavaScript conformance test.
verifyHostedFixture(
  `
import {createTypeSystem,type Type} from "types";
import {createSourceText} from "source";
import {parseModule} from "syntax";
import {resolveInterfaceTypes,checkClosureModule} from "checker";
import {reifyTypes} from "reify";
import {lowerModuleEntries} from "lowering";
export function run():number {
 const types:Type[]=[
  {kind:"number"},
  {kind:"unknown"},
  {kind:"object",properties:[{name:"x",type:0,readonly:false}]},
  {kind:"function",parameters:[0],result:2},
  {kind:"function",parameters:[1],result:2},
  {kind:"object",properties:[],construct:3},
  {kind:"object",properties:[],construct:4},
  {kind:"object",properties:[],call:3,construct:3},
  {kind:"object",properties:[]},
  {kind:"function",parameters:[0],receiver:2,result:0},
  {kind:"object",properties:[],call:9},
 ];
 const built=createTypeSystem(types);if(!built.ok)return 1;
 const system=built.value;
 const constructed=system.construct(5,[0]);if(!constructed.ok||constructed.value!==2)return 2;
 if(system.call(5,[0]).ok||system.construct(3,[0]).ok)return 3;
 if(!system.call(7,[0]).ok||!system.construct(7,[0]).ok)return 4;
 if(!system.assignable(6,5)||system.assignable(5,6))return 5;
 if(!system.assignable(7,5)||system.assignable(5,7))return 6;
 if(system.assignable(8,5)||system.object(5,[]).ok)return 7;
 if(!system.assignable(7,3)||system.assignable(3,7))return 8;
 if(!system.call(10,[0],2).ok||system.call(10,[0]).ok)return 9;
 if(system.construct(5,[]).ok||system.construct(5,[8]).ok||system.construct(5,[999]).ok)return 10;
 const bad=system.append({kind:"object",properties:[],construct:9});if(bad.ok)return 11;
 const plain=system.append({kind:"object",properties:[]});
 const other=system.append({kind:"object",properties:[],construct:3});
 if(!plain.ok||!other.ok)return 12;
 if(system.assignable(plain.value,other.value)||!system.construct(other.value,[0]).ok)return 13;
 const recursive:Type[]=[
  {kind:"number"}, {kind:"string"},
  {kind:"object",properties:[{name:"tag",type:0,readonly:true}],construct:3},
  {kind:"function",parameters:[],result:2},
  {kind:"object",properties:[{name:"tag",type:0,readonly:true}],construct:5},
  {kind:"function",parameters:[],result:4},
  {kind:"object",properties:[{name:"tag",type:1,readonly:true}],construct:7},
  {kind:"function",parameters:[],result:6},
 ];
 const rec=createTypeSystem(recursive);if(!rec.ok)return 14;
 if(!rec.value.assignable(2,4)||rec.value.assignable(2,6))return 15;
 const bytes=new TextEncoder().encode("interface Value{x:number;}interface Factory{new(x:number):Value;}interface Both extends Factory{(x:number):string;}type Plain=new(x:number)=>Value;");
 const source=createSourceText(bytes,bytes.length);if(!source.ok)return 16;
 const parsed=parseModule(source.value);if(!parsed.ok)return 17;
 const resolved=resolveInterfaceTypes(parsed.value,[]);if(!resolved.ok)return 18;
 const factory=resolved.value.names.get("Both"),value=resolved.value.names.get("Value");
 if(factory===undefined||value===undefined)return 19;
 const created=resolved.value.system.construct(factory,[0]);if(!created.ok||created.value!==value)return 20;
 if(!resolved.value.system.call(factory,[0]).ok)return 21;
 const emitted=reifyTypes(resolved.value.types,[factory],"RoundTrip");if(!emitted.ok)return 22;
 const restored=resolveInterfaceTypes({statements:emitted.value.declarations,imports:[],start:0,end:0},emitted.value.roots);if(!restored.ok)return 23;
 const root=emitted.value.roots[0];if(root===undefined)return 24;
 const rootId=restored.value.annotations.get(root);if(rootId===undefined)return 25;
 if(!restored.value.system.construct(rootId,[0]).ok||!restored.value.system.call(rootId,[0]).ok)return 26;
 const viewBytes=new TextEncoder().encode("function run():number{const f=():number=>42;const o:{}=f;return typeof o==='function'?42:1;}");
 const viewSource=createSourceText(viewBytes,viewBytes.length);if(!viewSource.ok)return 27;
 const viewParsed=parseModule(viewSource.value);if(!viewParsed.ok)return 28;
 const viewChecked=checkClosureModule(viewParsed.value);if(!viewChecked.ok)return 29;
 const viewLowered=lowerModuleEntries(viewChecked.value,viewChecked.value.bindings.functions.map((fn):number=>fn.id),{pointerSize:8,wordSize:8,allocationAlignment:16,frameAlignment:16,maxAlignment:16},4096);
 if(viewLowered.ok)return 30;
 if(viewLowered.error.indexOf("callable view requires a representation adapter")!==0)return 31;
 const contractBytes=new TextEncoder().encode("function run(value:{():number}):string{return typeof value;}");
 const contractSource=createSourceText(contractBytes,contractBytes.length);if(!contractSource.ok)return 32;
 const contractParsed=parseModule(contractSource.value);if(!contractParsed.ok)return 33;
 const contractChecked=checkClosureModule(contractParsed.value);if(!contractChecked.ok)return 34;
 const contractLowered=lowerModuleEntries(contractChecked.value,[0],{pointerSize:8,wordSize:8,allocationAlignment:16,frameAlignment:16,maxAlignment:16},4096);
 if(contractLowered.ok)return 35;
 return 42;
}
`,
  "constructor-types",
  [
    ["types", "packages/typescript/src/types/index.ts"],
    ["source", "packages/source/src/text.ts"],
    ["syntax", "packages/typescript/src/syntax/index.ts"],
    ["checker", "packages/typescript/src/checker/index.ts"],
    ["reify", "packages/typescript/src/reify/index.ts"],
    ["lowering", "packages/ts-native/src/closure/lowering/index.ts"],
  ],
);
