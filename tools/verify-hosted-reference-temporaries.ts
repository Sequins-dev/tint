import { verifyHostedFixture } from "./hosted-fixture.ts";

verifyHostedFixture(
  `interface Link { readonly value:number; readonly next:Link|undefined; }
function read(link:Link):number { const next=link.next;return next===undefined?link.value:next.value; }
function nextOrSelf(link:Link):Link { const next=link.next;return next===undefined?link:next; }
function churn(value:number):number { for(let i=0;i<100;i++){const garbage=new Uint32Array(40);garbage[0]=i;if(garbage[0]!==i)return -1;}return value; }
function afterArgumentAllocation(link:Link,value:number):boolean { return link.value===value; }
export function run():number {
 const leaf:Link={value:11,next:undefined},head:Link={value:31,next:leaf};
 for(let i=0;i<20;i++){
  if(read(head)!==11||read(leaf)!==11)return 1;
  if(!afterArgumentAllocation(nextOrSelf(head),churn(11)))return 2;
  const held=head.next;if(held===undefined)return 3;
  if(churn(42)!==42||held.value!==11||head.value!==31)return 4;
 }
 const bytes=new Uint32Array(64);bytes[0]=42;
 for(let i=0;i<20;i++)if(churn(42)!==42||bytes[0]!==42)return 5;
 if(read(head)!==11||head.next!==leaf)return 6;
 return 42;
}`,
  "reference-temporaries",
  [],
  [],
  [],
  [],
  {
    runtimeEntry: "initializeCopyingRuntime",
    managedBytes: 32768,
    allocationCapacity: 4096,
    rootCapacity: 4096,
    stackBytes: 1048576,
  },
);
