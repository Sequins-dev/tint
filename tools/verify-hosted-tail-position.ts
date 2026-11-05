import { verifyHostedFixture } from "./hosted-fixture.ts";

verifyHostedFixture(
  `
import {createSourceTextView} from "text";
import {parseScript} from "syntax";
import {collectTailCalls} from "tail-positions";
export function run():number {
 const bodies=["return f();","return a()?b():c()&&d();","try{return a();}catch(e){return b();}","try{return a();}finally{return b();}","for(const x of xs){return f();}","using x=resource;return f();","{using x=resource;}return f();","return f()?.x;","return f?.();"];
 const counts=[1,2,1,1,0,0,1,0,1];
 for(let i=0;i<bodies.length;i++){
  const body=bodies[i],expected=counts[i];
  if(body===undefined||expected===undefined)return 60;
  const parsed=parseScript(createSourceTextView("function f(){"+body+"}"));
  if(!parsed.ok)return 61;
  const fn=parsed.value.statements[0];
  if(fn===undefined||fn.kind!=="function")return 62;
  const block=fn.body;
  if(block.kind!=="block")return 62;
  if(collectTailCalls(block,{strict:true}).size!==expected)return 63;
  if(collectTailCalls(block,{strict:false}).size!==0)return 64;
  if(collectTailCalls(block,{strict:true,async:true}).size!==0)return 65;
  if(collectTailCalls(block,{strict:true,generator:true}).size!==0)return 66;
 }
 return 42;
}
`,
  "tail-position",
  [
    ["text", "packages/source/src/text.ts"],
    ["syntax", "packages/typescript/src/syntax/index.ts"],
    ["tail-positions", "packages/js-engine/src/lowering/tail-position.ts"],
  ],
);
