import { verifyHostedFixture } from "./hosted-fixture.ts";
// Unbounded recursion must unwind as an exception (never a fault), leave the
// program able to catch it repeatedly, and leave normal recursion working.
// TypeScript code sees the overflow as undefined (it ignores the reserved
// payload), and its own throws of undefined are unaffected.
verifyHostedFixture(
  `
function down(n:number):number{return down(n+1)+1;}
function depth(n:number):number{return n===0?0:depth(n-1)+1;}
function wide(n:number,a:number,b:number,c:number,d:number):number{const local=[a,b,c,d];return wide(n+1,local.length,a,b,c)+(local[0]??0);}
function fail(value:unknown):number{throw value;}
export function run():number{
 let caught=0;
 for(let round=0;round<3;round++){
  try{down(0);return 1;}catch(error){if(error!==undefined)return 5;caught++;}
  try{wide(0,1,2,3,4);return 2;}catch(error){if(error!==undefined)return 6;caught++;}
  if(depth(2000)!==2000)return 3;
  try{fail(undefined);return 7;}catch(error){if(error!==undefined)return 8;caught++;}
 }
 return caught===9?42:4;
}`,
  "stack-overflow",
);
