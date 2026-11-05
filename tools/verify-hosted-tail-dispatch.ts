import { verifyHostedFixture } from "./hosted-fixture.ts";

verifyHostedFixture(
  `
import {createCallableObject,callObject} from "object";
import type {ObjectCallDispatch} from "operations";
export function run():number {
 let calls=0,legacy=0;
 const left=createCallableObject<string,number>(undefined,(receiver,args):number=>{legacy++;return -1;});
 const right=createCallableObject<string,number>(undefined,(receiver,args):number=>{legacy++;return -2;});
 left.internalTailDispatch=(receiver,args):ObjectCallDispatch<string,number>=>{
  calls++;
  const n=args[0];
  if(receiver!==42||n===undefined)throw 60;
  if(n===0)return {kind:"return",value:7};
  return {kind:"call",target:right,receiver,arguments:[n-1]};
 };
 right.internalTailDispatch=(receiver,args):ObjectCallDispatch<string,number>=>{
  calls++;
  const n=args[0];
  if(receiver!==42||n===undefined)throw 61;
  if(n===0)return {kind:"return",value:7};
  return {kind:"call",target:left,receiver,arguments:[n-1]};
 };
 const result=callObject<string,number>(left,42,[100000],0);
 if(result.error!=="none"||result.value!==7||calls!==100001||legacy!==0)return 62;
 let caught=0;
 const throwing=createCallableObject<string,number>(undefined,(receiver,args):number=>{throw 73;});
 right.internalTailDispatch=(receiver,args):ObjectCallDispatch<string,number>=>({kind:"call",target:throwing,receiver,arguments:args});
 try{callObject<string,number>(left,42,[1],0);}catch(error){caught=error===73?73:1;}
 if(caught!==73)return 63;
 if(callObject<string,number>(left,42,[0],0).value!==7)return 64;
 return 42;
}
`,
  "tail-dispatch",
  [
    ["object", "packages/js-runtime/src/objects/index.ts"],
    ["operations", "packages/js-runtime/src/objects/operations.ts"],
  ],
);
