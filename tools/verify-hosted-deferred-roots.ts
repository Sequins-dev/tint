import { verifyHostedFixture } from "./hosted-fixture.ts";
verifyHostedFixture(
  `function churn():void{for(let i=0;i<3000;i++){const bytes=new Uint32Array(64);bytes[0]=i;}}
function keep(value:unknown,collect:boolean):unknown{let result:unknown=value;for(let i=0;i<5000;i++){if(value===undefined)result=42;else result=value;}if(collect)churn();return result;}
function abrupt(value:unknown):unknown{try{for(let i=0;i<100;i++){if(value===undefined)return 1;}throw value;}catch(error){churn();return error;}}
function strings(value:string,count:number,collect:boolean):number{let total=0;for(let i=0;i<count;i++)total+=value.length;if(collect)churn();return value.length===8?total:-1;}
export function run():number{const object={value:42},array=new Uint32Array(4);array[0]=42;const text="abcd"+"efgh";
 if(keep(object,true)!==object||keep(array,true)!==array||abrupt(object)!==object)return 1;
 const nan=keep(NaN,true);if(nan===nan)return 2;const zero=keep(-0,true);if(1/(zero as number)!==-Infinity)return 3;
 if(strings(text,10000,false)!==80000||strings(text,10000,true)!==80000)return 4;
 if(keep(undefined,true)!==42||object.value!==42||array[0]!==42)return 5;return 42;}`,
  "deferred-roots",
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
