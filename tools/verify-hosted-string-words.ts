import { verifyHostedFixture } from "./hosted-fixture.ts";
verifyHostedFixture(
  String.raw`export function run():number{
const seed="a\u0000\uD800b\uDC00c\uD83D\uDE00defghijklmnopqrstuvwx123456789";
for(let n=0;n<=32;n++){
const left=seed.slice(0,n),right=("p"+left).slice(1);
if(left!==right||left.length!==n)return 1;
for(let index=0;index<n;index++)if(left.charCodeAt(index)!==seed.charCodeAt(index)||right.charCodeAt(index)!==seed.charCodeAt(index))return 7;
for(let index=0;index<n;index++){
const wrong=left.slice(0,index)+"X"+left.slice(index+1);
if(left===wrong)return 2;
}
for(let offset=0;offset<4;offset++){
const prefix="zzzz".slice(0,offset),haystack=prefix+left+"qq";
if(!haystack.startsWith(left,offset))return 3;
if(n>0&&haystack.startsWith(left,offset+1))return 4;
}
const joined=left+right,sliced=("p"+left+"q").slice(1,n+1);
if(joined.length!==n*2||sliced!==left)return 5;
for(let index=0;index<n*2;index++)if(joined.charCodeAt(index)!==left.charCodeAt(index%n))return 6;
for(let churn=0;churn<20;churn++){const bytes=new Uint8Array(4096);bytes[0]=churn;if(bytes[0]!==churn)return 8;}
for(let index=0;index<n;index++)if(left.charCodeAt(index)!==seed.charCodeAt(index)||right.charCodeAt(index)!==seed.charCodeAt(index)||sliced.charCodeAt(index)!==seed.charCodeAt(index))return 9;
}
return 42;}`,
  "string-words",
  [],
  [],
  [],
  [],
  {
    runtimeEntry: "initializeGenerationalRuntime",
    managedBytes: 1048576,
    allocationCapacity: 65536,
    rootCapacity: 4096,
    stackBytes: 1048576,
  },
);
