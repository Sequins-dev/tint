import { verifyHostedFixture } from "./hosted-fixture.ts";
verifyHostedFixture(
  `function flags(a:number,b:number):number{let mask=0;if(a===b)mask+=1;if(a!==b)mask+=2;if(a==b)mask+=4;if(a!=b)mask+=8;if(a<b)mask+=16;if(a>b)mask+=32;if(a<=b)mask+=64;if(a>=b)mask+=128;return mask;}
function identity(a:{value:number}|undefined,b:{value:number}|undefined):number{if(a===b)return 1;return 0;}
function bool(a:boolean,b:boolean):number{if(a!==b)return 1;return 0;}
function saved(a:number,b:number):boolean{const result=a<b;const other=a>b;return result&&!other;}
function churn():void{for(let i=0;i<3000;i++){const bytes=new Uint32Array(64);bytes[0]=i;}}
export function run():number{const values=[NaN,-Infinity,-1,-0,0,1,Infinity];for(let i=0;i<values.length;i++){const a=values[i];if(a===undefined)return 1;for(let j=0;j<values.length;j++){const b=values[j];if(b===undefined)return 2;let expected=10;if(a===a&&b===b){if(i===j||(i===3&&j===4)||(i===4&&j===3))expected=197;else if(i<j)expected=90;else expected=170;}if(flags(a,b)!==expected)return 3;}}
const first={value:42},second={value:42};if(identity(first,first)!==1||identity(first,second)!==0||identity(first,undefined)!==0||identity(undefined,undefined)!==1)return 4;
if(bool(true,false)!==1||bool(false,false)!==0||bool(false,true)!==1||bool(true,true)!==0)return 5;
churn();if(identity(first,first)!==1||first.value!==42||!saved(-1,1)||saved(NaN,1)||saved(1,1)||saved(Infinity,-Infinity))return 6;return 42;}`,
  "comparison-branches",
  [],
  [],
  [],
  [],
  {
    runtimeEntry: "initializeCopyingRuntime",
    managedBytes: 524288,
    allocationCapacity: 32768,
    rootCapacity: 4096,
    stackBytes: 1048576,
  },
);
