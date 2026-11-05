import { verifyHostedFixture } from "./hosted-fixture.ts";
verifyHostedFixture(
  `import {createSourceText} from "source";
import {parseModule} from "syntax";
import {checkClosureModule} from "checker";
import {lowerModuleEntries} from "lowering";
export function run():number {
 const bytes=new TextEncoder().encode("function run(n:number):number{const object={value:19,add:function(this:{value:number},n:number):number{return this.value+n;}};return object.add(23);}");
 const source=createSourceText(bytes,bytes.length);if(!source.ok)return 1;
 const parsed=parseModule(source.value);if(!parsed.ok)return 2;
 const checked=checkClosureModule(parsed.value);if(!checked.ok)return 3;
 const lowered=lowerModuleEntries(checked.value,[0],{pointerSize:8,wordSize:8,allocationAlignment:16,frameAlignment:16,maxAlignment:16},4096);
 if(!lowered.ok)throw lowered.error;
 let calls=0,receivers=0;
 for(const fn of lowered.value.module.functions){
  if(fn===undefined)return 7;
  if(fn.receiverSlot!==undefined)receivers++;
  for(const block of fn.blocks){if(block===undefined)return 8;for(const op of block.instructions){if(op===undefined)return 9;
   if(op.kind==="call-indirect"){if(op.receiver===undefined)return 5;calls++;}
  }}
 }
 return calls===1&&receivers===1?42:6;
}`,
  "receiver-lowering",
  [
    ["source", "packages/source/src/text.ts"],
    ["syntax", "packages/typescript/src/syntax/index.ts"],
    ["checker", "packages/typescript/src/checker/index.ts"],
    ["lowering", "packages/ts-native/src/closure/lowering/index.ts"],
  ],
);
