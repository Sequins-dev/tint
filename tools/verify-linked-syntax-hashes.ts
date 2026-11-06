import assert from "node:assert/strict";
import { verifyHostedFixture } from "./hosted-fixture.ts";

assert.equal(
  process.env.TINT_BUILD_ONLY,
  "1",
  "Run the retained image under LLDB",
);
verifyHostedFixture(
  `import {createSourceTextView} from "@tint/source/text";
import {parseModule,rewriteModule,type Module} from "@tint/typescript/syntax";
import {linkModules} from "@tint/ts-native/modules";
function generated(text:string):Module|undefined {
 const parsed=parseModule(createSourceTextView(text));
 if(!parsed.ok)return undefined;
 return rewriteModule(parsed.value,{
  statement:(node,original)=>({...node,start:0,end:0,nodeHash:0}),
  expression:(node,original)=>({...node,start:0,end:0,nodeHash:0}),
  type:(node,original)=>({...node,start:0,end:0,nodeHash:0})
 });
}
export function run():number {
 const dep=generated("export function add(n:number):number{return n+1;}"),
 main=generated('import {add} from "dep";export function run(n:number):number{return add(n);}');
 if(dep===undefined||main===undefined)return 1;
 const dependencies=new Map<string,string>();dependencies.set("dep","dep");
 const linked=linkModules([
  {id:"main",module:main,dependencies},
  {id:"dep",module:dep,dependencies:new Map<string,string>()}
 ],"main",[]);
 if(!linked.ok)return 2;
 const seen=new Set<number>();let count=0,valid=true;
 linked.value.origins.forEach((origin,node)=>{
  const hash=node.nodeHash;
  if(hash===undefined||seen.has(hash))valid=false;
  else seen.add(hash);
  if(origin.node.nodeHash!==undefined&&origin.node.nodeHash!==0)valid=false;
  count++;
 });
 return valid&&count>5&&seen.size===count?42:3;
}`,
  "linked-syntax-hashes",
  [
    ["@tint/source/text", "packages/source/src/text.ts"],
    ["@tint/typescript/syntax", "packages/typescript/src/syntax/index.ts"],
    ["@tint/ts-native/modules", "packages/ts-native/src/modules/index.ts"],
  ],
);
