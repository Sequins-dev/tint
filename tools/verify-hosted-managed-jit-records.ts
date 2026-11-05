import { verifyHostedFixture } from "./hosted-fixture.ts";
verifyHostedFixture(
  `
import {createSourceTextView} from "source";
import {parseModule} from "syntax";
import {checkClosureModule} from "checker";
import {createFunctionBuilder,type RecordLayout} from "ir";
import type {LoweredManagedJitProgram} from "program";
import {bindManagedJitRecords,type ManagedJitRecordSurface} from "records";
export function run():number{
 const parsed=parseModule(createSourceTextView("interface A{readonly value:number;}interface B{value:number;}"));if(!parsed.ok)return 1;
 const checked=checkClosureModule(parsed.value);if(!checked.ok)return 2;
 const a=checked.value.typeNames.get("A"),b=checked.value.typeNames.get("B");if(a===undefined||b===undefined)return 3;
 const aliases=new Map<string,number>();aliases.set("$A",a);aliases.set("$B",b);
 const types:(number|undefined)[]=[];for(let i=0;i<checked.value.types.length;i++)types.push(undefined);types[a]=0;
 const layout:RecordLayout={byteLength:32,fields:[{offset:24,type:"number",mutable:true}]};
 const builder=createFunctionBuilder(0,"test",[],"void");builder.end({start:0,end:0,kind:"return",value:undefined});
 const lowered:LoweredManagedJitProgram={module:{records:[layout],functions:[builder.finish()]},entry:0,sources:[],entries:[],recordTypes:types,signatureTypes:undefined,functionMaps:[],recordMaps:[]};
 const surface:ManagedJitRecordSurface={name:"test",digest:"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",records:[{alias:"$A",aliases:[],layout},{alias:"$B",aliases:[],layout}]};
 const program={checked:checked.value,aliasTypes:aliases};
 const first=bindManagedJitRecords(program,lowered,surface,["$A"]);if(!first.ok||first.value.length!==1||first.value[0]?.witness!==0)return 4;
 types[b]=0;
 const ambiguous=bindManagedJitRecords(program,lowered,surface,[]);if(ambiguous.ok||!ambiguous.error.includes("record serves several"))return 5;
 if(bindManagedJitRecords(program,lowered,surface,["$A"]).ok)return 6;
 const observing=createFunctionBuilder(0,"observe",[],"void");observing.emit({start:0,end:0,kind:"record-descriptor-address",id:observing.next(),record:0});observing.end({start:0,end:0,kind:"return",value:undefined});
 const exposed={...lowered,module:{records:[layout],functions:[observing.finish()]}};
 if(bindManagedJitRecords(program,exposed,surface,[]).ok)return 7;
 types[a]=undefined;
 const readonlySurface:ManagedJitRecordSurface={name:"test",digest:surface.digest,records:[{alias:"$A",aliases:[],layout}]};
 const unbound=bindManagedJitRecords(program,lowered,readonlySurface,[]);
 if(unbound.ok||!unbound.error.includes("surface mutability contract"))return 8;
 types[b]=undefined;types[a]=0;
 if(!bindManagedJitRecords(program,lowered,readonlySurface,["$A"]).ok)return 9;
 return 42;
}`,
  "managed-jit-records",
  [
    ["source", "packages/source/src/text.ts"],
    ["syntax", "packages/typescript/src/syntax/index.ts"],
    ["checker", "packages/typescript/src/checker/index.ts"],
    ["ir", "packages/ir/src/scalar/index.ts"],
    ["program", "packages/compiler/src/native/managed-jit-program.ts"],
    ["records", "packages/compiler/src/native/managed-jit-records.ts"],
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
