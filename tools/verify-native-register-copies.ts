import { verifyHostedFixture } from "./hosted-fixture.ts";

// A monomorphic record walk keeps the field/copy/branch pattern observed in
// native compiler profiles, without compiler algorithms or allocation in the loop.
verifyHostedFixture(
  `interface Link { readonly index:number; readonly next:Link|undefined; }
function find(node:Link|undefined,index:number):Link|undefined {
 while(node!==undefined){if(node.index===index)return node;node=node.next;}return undefined;
}
export function run():number {
 let head:Link|undefined=undefined;
 for(let n=7;n>=0;n--)head={index:n,next:head};
 let sum=0,key=0;
 for(let n=0;n<20000000;n++){
  const found=find(head,key);if(found===undefined)return 1;
  sum+=found.index;key++;if(key===8)key=0;
 }
 if(sum!==70000000)return 2;
 return 42;
}`,
  "register-copies",
);
