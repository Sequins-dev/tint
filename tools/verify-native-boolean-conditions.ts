import { verifyHostedFixture } from "./hosted-fixture.ts";

verifyHostedFixture(
  `interface Trace{count:number;}
function even(n:number):boolean{return n%2===0;}
function touch(trace:Trace):boolean{trace.count++;return true;}
function optional(value:boolean|undefined):number{if(value)return 1;return 0;}
function numeric(value:number):number{if(value)return 1;return 0;}
export function run():number{
 const trace:Trace={count:0};let sum=0;
 for(let n=0;n<100;n++){
  if(even(n))sum+=1;else sum+=2;
  if(!((even(n)&&touch(trace))||(even(n+1)&&touch(trace))))return 1;
 }
 if(sum!==150||trace.count!==100)return 2;
 if(optional(undefined)!==0||optional(false)!==0||optional(true)!==1)return 3;
 if(numeric(0)!==0||numeric(-0)!==0||numeric(NaN)!==0||numeric(1)!==1||numeric(Infinity)!==1)return 4;
 return 42;
}`,
  "boolean-conditions",
);
