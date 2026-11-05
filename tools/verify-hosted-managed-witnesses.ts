import { verifyHostedFixture } from "./hosted-fixture.ts";
verifyHostedFixture(
  `import {createSourceTextView} from "source";
import {parseModule} from "syntax";
import {prepareNativeFunctionEntry} from "compiler";
import {emitModule} from "emitter";
export function run():number{
 const parsed=parseModule(createSourceTextView("function unused(value:number):number{const nested=():number=>19;return nested();}interface Left{readonly left:number;}interface Right{readonly right:number;}type ReadLeft=(value:Left)=>unknown;type LeftAlias=ReadLeft;type ReadRight=(value:Right)=>unknown;interface Frame{readonly first:ReadLeft;readonly second:ReadRight;}export function entry(frame:Frame,left:Left,right:Right):unknown{const result=frame.first(left);frame.second(right);return result;}"));if(!parsed.ok)return 1;
 const prepared=prepareNativeFunctionEntry(parsed.value,"entry",{signatureTypes:true,recordTypes:true});if(!prepared.ok)return 2;
 const signatures=prepared.value.signatureTypes;if(signatures===undefined)return 3;
 const left=signatures.find(item=>item!==undefined&&item.name==="ReadLeft"),right=signatures.find(item=>item!==undefined&&item.name==="ReadRight"),alias=signatures.find(item=>item!==undefined&&item.name==="LeftAlias");
 if(left===undefined||right===undefined||alias===undefined)return 4;
 if(left.witness===right.witness||left.witness!==alias.witness)return 5;
 const native=emitModule(prepared.value.module,{managedABI:{version:1,functionBrand:{name:"brand",contract:"tint.function.v1"},signatures:[{name:"left",contract:"test.read-left.v1",witness:left.witness,parameters:["reference"],returnType:"general"},{name:"right",contract:"test.read-right.v1",witness:right.witness,parameters:["reference"],returnType:"general"}]}});if(!native.ok)return 6;
 const first=native.value.managedImports.find(item=>item!==undefined&&item.name==="left"),second=native.value.managedImports.find(item=>item!==undefined&&item.name==="right");
 if(first===undefined||second===undefined||first.offset===second.offset||first.witness===second.witness)return 7;
 if(first.parameters[0]!=="reference"||second.parameters[0]!=="reference"||first.returnType!==second.returnType)return 8;
 return 42;
}`,
  "managed-witnesses",
  [
    ["source", "packages/source/src/text.ts"],
    ["syntax", "packages/typescript/src/syntax/index.ts"],
    ["compiler", "packages/compiler/src/native/index.ts"],
    ["emitter", "packages/codegen/src/aarch64/scalar/index.ts"],
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
