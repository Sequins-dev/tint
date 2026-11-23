import { verifyHostedFixture } from "./hosted-fixture.ts";

// Run the checker and physical storage planner natively, without claiming class execution.
verifyHostedFixture(
  `
import {createSourceText} from "source";
import {parseModule} from "syntax";
import {checkClosureModule} from "checker";
import {createRecordContracts} from "records";
import {verify} from "ir";
export function run():number {
 const bytes=new TextEncoder().encode("class Box{value:number=1;read():number{return this.value;}static count:number=1;static readCount():number{return this.count;}}function use(box:Box):number{return box.read();}function field(box:Box):number{return box.value;}function staticField(ctor:{new():Box;count:number}):number{return ctor.count;}function make(ctor:{new():Box}):Box{return new ctor();}");
 const source=createSourceText(bytes,bytes.length);if(!source.ok)return 1;
 const parsed=parseModule(source.value);if(!parsed.ok)return 2;
 const checked=checkClosureModule(parsed.value);if(!checked.ok)return 3;
 const records=createRecordContracts(checked.value,{pointerSize:8,wordSize:8,allocationAlignment:16,frameAlignment:16,maxAlignment:16},4096,(message:string):never=>{throw message;});
 const storage=records.classes[0];if(storage===undefined)return 4;
 const instance=records.records[storage.instance],prototype=records.records[storage.prototype];
 if(instance===undefined||prototype===undefined)return 5;
 const field=instance.fields[0];
 if(field===undefined||field.stateOffset!==undefined||field.deferred!==true)return 6;
 if(instance.fields[1]?.presenceOffset===undefined)return 7;
 if(prototype.fields[0]?.stateOffset===undefined)return 8;
 if(records.forType(storage.contract.instance)===storage.instance)return 9;
 const state=records.records[storage.constructorState];
 if(state===undefined||state.fields[1]?.stateOffset===undefined)return 15;
 if(state.fields[storage.constructionField]?.stateOffset===undefined)return 16;
 if(records.forType(storage.contract.constructor)!==undefined)return 17;
 let count=0,constructions=0,valid=true;
 checked.value.expressions.forEach((type:number,node):void=>{
  if(node.kind==="new"){
   records.constructClass(node,7);
   const call=records.constructors?.get(node);
   if(call===undefined||call.target!==7||call.entry.functionEnvironment!==true||call.entry.choices[0]?.record!==storage.constructorState||call.entry.choices[0]?.field!==storage.constructionField||call.entry.choices[0]?.initialized!==true)valid=false;
   constructions++;
   return;
  }
  if(node.kind!=="member")return;
  const receiver=node.object;
  if(receiver.kind!=="identifier")return;
  if(receiver.name==="ctor"){
   for(const write of [false,true]){
    if(write===undefined)throw "fixture write invariant";
    records.access(node,receiver,"count","number",write);
    const access=records.accesses.get(node);
    if(access===undefined||access.functionEnvironment!==true||access.choices.length!==1||access.choices[0]?.record!==storage.constructorState||access.choices[0]?.initialized!==true)valid=false;
   }
   count++;
   return;
  }
  if(receiver.name!=="box")return;
  records.access(node,node.object,node.property,node.property==="read"?"reference":"number",false);
  const access=records.accesses.get(node);if(access===undefined){valid=false;return;}
  let found=false;
  for(const choice of access.choices){
   if(choice===undefined||choice.record!==storage.instance)continue;
   found=true;
   if(node.property==="read"){
    if(choice.prototype?.access.choices[0]?.record!==storage.prototype)valid=false;
   }else if(choice.initialized===true)valid=false;
  }
  if(!found)valid=false;
  count++;
 });
 if(!valid||count!==3||constructions!==1)return 10;
 if(!verify({functions:[],records:records.records}).ok)return 11;
 const badBytes=new TextEncoder().encode('function f(flag:boolean):{x?:number}{return {...(flag?{x:"bad"}:{})};}');
 const badSource=createSourceText(badBytes,badBytes.length);if(!badSource.ok)return 12;
 const badParsed=parseModule(badSource.value);if(!badParsed.ok)return 13;
 if(checkClosureModule(badParsed.value).ok)return 14;
 return 42;
}
`,
  "class-records",
  [
    ["source", "packages/source/src/text.ts"],
    ["syntax", "packages/typescript/src/syntax/index.ts"],
    ["checker", "packages/typescript/src/checker/index.ts"],
    ["records", "packages/ts-native/src/closure/lowering/records.ts"],
    ["ir", "packages/ir/src/scalar/index.ts"],
  ],
);
