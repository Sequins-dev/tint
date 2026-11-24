import { verifyHostedFixture } from "./hosted-fixture.ts";
const memory = "packages/native-runtime/src/intrinsics/memory.ts";
verifyHostedFixture(
  `import {createSourceTextView} from "source";
import {parseModule} from "syntax";
import {compileClosedFunction} from "compiler";
import {mapExecutableMemory,registerExternalMemory,writeExecutableMemory,callExecutableValue} from "memory";
export function run():number {
 const parsed=parseModule(createSourceTextView("export function run(value:unknown):unknown{return 'a\\\\0\\\\ud800';}"));
 if(!parsed.ok)return 1;
 const compiled=compileClosedFunction(parsed.value,"run",65536,{literals:"permanent"});
 if(!compiled.ok||!compiled.value.requiresPermanentLiterals)return 2;
 const address=mapExecutableMemory(65536);
 if(address<=0||registerExternalMemory(address,65536)!==0)return 3;
 if(writeExecutableMemory(address,65536,0,compiled.value.native.code)!==0)return 4;
 const value=callExecutableValue(address+compiled.value.entry.offset,undefined);
 if(typeof value!=="string")return 5;
 const holder={value};
 let checksum=0;
 for(let i=0;i<32;i++){const bytes=new Uint8Array(1048576);bytes[0]=i;checksum+=bytes[0]??0;}
 if(checksum!==496||holder.value.length!==3||holder.value.charCodeAt(0)!==97||holder.value.charCodeAt(1)!==0||holder.value.charCodeAt(2)!==0xd800)return 6;
 return 42;
}`,
  "permanent-literals",
  [
    ["memory", memory],
    ["source", "packages/source/src/text.ts"],
    ["syntax", "packages/typescript/src/syntax/index.ts"],
    ["compiler", "packages/compiler/src/native/index.ts"],
  ],
  [],
  [],
  [{ module: memory, namespace: "native-memory" }],
  {
    allowJit: true,
    runtimeEntry: "initializeRuntime",
    managedBytes: 16777216,
    allocationCapacity: 1048576,
    hostBindings: [
      {
        module: memory,
        name: "mapExecutableMemory",
        operation: "executable-map",
      },
      {
        module: memory,
        name: "registerExternalMemory",
        operation: "external-memory-register",
      },
      {
        module: memory,
        name: "writeExecutableMemory",
        operation: "executable-write",
      },
      {
        module: memory,
        name: "callExecutableValue",
        operation: "executable-call-value",
      },
    ],
  },
);
