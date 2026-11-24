import { verifyHostedFixture } from "./hosted-fixture.ts";

verifyHostedFixture(
  `function make(value:number):()=>number{return ()=>value;}
function forward(value:number):()=>()=>number{return ()=>()=>value;}
function mutable(value:number):()=>number{return ()=>++value;}
function ownerWrite(value:number):()=>number{const read:()=>number=()=>value;value=9;return read;}
function redeclare(value:number):()=>number{const read:()=>number=()=>value;var value:number=17;return read;}
function defaulted(value:number=23):()=>number{return ()=>value;}
function later():()=>number{const read:()=>number=()=>value;const value:number=31;return read;}
export function run():number {
 const answer=make(42),negativeZero=make(-0),nan=make(0/0),middle=forward(19),count=mutable(5),changed=ownerWrite(1),redeclared=redeclare(2),fallback=defaulted(),late=later();
 const nested=middle();
 if(answer()!==42||1/negativeZero()!==-Infinity||nan()===nan()||nested()!==19)return 1;
 if(count()!==6||count()!==7||changed()!==9||redeclared()!==17||fallback()!==23||late()!==31)return 2;
 for(let i=0;i<1000;i++){const garbage=new Uint32Array(100);garbage[0]=i;if(garbage[0]!==i)return 3;}
 if(answer()!==42||1/negativeZero()!==-Infinity||nan()===nan()||nested()!==19)return 4;
 if(count()!==8||changed()!==9||redeclared()!==17||fallback()!==23||late()!==31)return 5;
 return 42;
}`,
  "value-captures",
  [],
  [],
  [],
  [],
  {
    runtimeEntry: "initializeGenerationalRuntime",
    managedBytes: 32768,
    allocationCapacity: 4096,
    rootCapacity: 4096,
    stackBytes: 1048576,
  },
);
