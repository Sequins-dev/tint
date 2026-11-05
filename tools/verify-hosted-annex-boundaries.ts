import { verifyHostedFixture } from "./hosted-fixture.ts";
verifyHostedFixture(
  `import {createSourceText} from "source";
import {parseScript} from "syntax";
import {validateJavaScriptBindings,bindScript} from "binding";
export function run():number {
 for(const text of ["if(true)function f(){}","var f=0;if(true)function f(){}","if(false)function f(){}else function g(){}"]){
  const bytes=new TextEncoder().encode(text),source=createSourceText(bytes,bytes.length);if(!source.ok)return 1;
  const parsed=parseScript(source.value);if(!parsed.ok)return 2;
  if(validateJavaScriptBindings(parsed.value,"script")!==undefined)return 3;
  const bound=bindScript(parsed.value);if(bound.ok)return 4;if(bound.error.code!=="UNSUPPORTED")return 5;
 }
 for(const text of ["function f(){}label:function g(){}",'"use strict";{function f(){}}']){
  const bytes=new TextEncoder().encode(text),source=createSourceText(bytes,bytes.length);if(!source.ok)return 6;
  const parsed=parseScript(source.value);if(!parsed.ok)return 7;
  if(!bindScript(parsed.value).ok)return 8;
 }
 return 42;
 }`,
  "annex-boundaries",
  [
    ["source", "packages/source/src/text.ts"],
    ["syntax", "packages/typescript/src/syntax/index.ts"],
    ["binding", "packages/typescript/src/binding/index.ts"],
  ],
  [],
  [],
  [],
  { managedBytes: 67108864, allocationCapacity: 1048576 },
);
