import { primitiveOperations } from "@tint/ts-native/runtime";
import { verifyHostedFixture } from "./hosted-fixture.ts";
const primitives = primitiveOperations
  .map((name, index) => name + ":" + (100 + index))
  .join(",");
verifyHostedFixture(
  `
import {runtimeFunctionIds} from "runtime";
import type {ModuleEntryOptions} from "lowering";
export function run():number {
 const options:ModuleEntryOptions = {
  lists:[{element:901,runtime:{create:0,read:1,write:2,push:3,length:4,has:5,delete:6,resize:7,sort:8}},{element:902,runtime:{create:0,read:1,write:2,push:3,length:4}}],
  sets:[{element:903,runtime:{create:9,has:10,add:11,delete:12,clear:13,size:14,iterator:{create:15,advance:16,read:17},clone:18}}],
  maps:[{key:904,value:905,runtime:{create:19,get:20,has:21,set:22,delete:23,clear:24,size:25,iterator:{create:26,advance:27,key:28,value:29}}}],
  primitives:{${primitives}}, numberToString:30, numberFromString:31,
  importedFunctions:[906],recordBindings:[{function:907,operation:"identity"}]
 };
 const ids=runtimeFunctionIds(options);if(ids.length!==53)return 1;
 for(let i=0;i<30;i++){if(ids[i]!==i)return 2;}
 for(let i=0;i<21;i++){if(ids[30+i]!==100+i)return 3;}
 if(ids[51]!==30||ids[52]!==31)return 4;
 if(runtimeFunctionIds({}).length!==0)return 5;
 const shared=runtimeFunctionIds({numberToString:0,numberFromString:0});
 if(shared.length!==1||shared[0]!==0)return 6;
 return 42;
}`,
  "runtime-function-ids",
  [
    ["runtime", "packages/ts-native/src/runtime/index.ts"],
    ["lowering", "packages/ts-native/src/closure/lowering/index.ts"],
  ],
);
