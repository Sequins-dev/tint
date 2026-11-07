import { verifyHostedFixture } from "./hosted-fixture.ts";

verifyHostedFixture(
  `
function forward(position:number):number {return "aaaa".indexOf("aa",position);}
function backward(position:number):number {return "aaaa".lastIndexOf("aa",position);}
export function run():number {
 const zeros:number[]=[-0.9,-0,0,0.9,NaN];
 for(let i=0;i<zeros.length;i++) {
  const index=forward(zeros[i]??0);
  if(index!==0||1/index!==Infinity)return 1+i;
 }
 const reverseZeros:number[]=[-0.9,-0,0,0.9];
 for(let i=0;i<reverseZeros.length;i++) {
  const index=backward(reverseZeros[i]??0);
  if(index!==0||1/index!==Infinity)return 10+i;
 }
 if(forward(1.9)!==1||forward(2.9)!==2)return 20;
 if(forward(Infinity)!==-1||forward(-Infinity)!==0)return 21;
 if(backward(1.9)!==1||backward(NaN)!==2)return 22;
 if(backward(Infinity)!==2||backward(-Infinity)!==0)return 23;
 // Math.trunc itself must preserve negative zero.
 if(1/Math.trunc(-0.9)!==-Infinity)return 24;
 return 42;
}`,
  "string-search-positions",
);
