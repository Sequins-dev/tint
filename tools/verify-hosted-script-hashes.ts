import { verifyHostedFixture } from "./hosted-fixture.ts";

// Exercise the generated-syntax identity/index contract in native compiler code.
verifyHostedFixture(
  `
import {createSourceText} from "source";
import {parseScript,syntaxHash,type Expression} from "syntax";
import {lowerScript} from "lowering";
import {bindModule} from "binding";
import {createKeyIndex} from "key-index";
export function run():number {
 let text="class Example{";
 for(let i=0;i<128;i++)text+="#field"+i+";";
 text+="}";
 const bytes=new TextEncoder().encode(text);
 const source=createSourceText(bytes,bytes.length);if(!source.ok)return 1;
 const parsed=parseScript(source.value);if(!parsed.ok)return 2;
 const lowered=lowerScript(parsed.value,text);if(!lowered.ok)return 3;
 const bound=bindModule(lowered.value,["undefined"]);if(!bound.ok)return 4;
 let comparisons=0;
 const index=createKeyIndex<Expression,number>(syntaxHash,(left,right)=>{comparisons++;return left===right;});
 for(let i=0;i<bound.value.references.length;i++) {
  const reference=bound.value.references[i];if(reference===undefined)return 5;
  index.set(reference.node,i);
 }
 for(let i=0;i<bound.value.references.length;i++) {
  const reference=bound.value.references[i];if(reference===undefined)return 6;
  if(index.get(reference.node)!==i)return 7;
 }
 if(comparisons>bound.value.references.length*4)return 8;
 return 42;
}
`,
  "script-hashes",
  [
    ["source", "packages/source/src/text.ts"],
    ["syntax", "packages/typescript/src/syntax/index.ts"],
    ["lowering", "packages/js-engine/src/lowering/index.ts"],
    ["binding", "packages/typescript/src/binding/index.ts"],
    ["key-index", "packages/foundation/src/collections/key-index.ts"],
  ],
  [],
  [],
  [],
  {
    managedBytes: 33554432,
    allocationCapacity: 524288,
    stackBytes: 16777216,
  },
);
