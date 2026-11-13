import { verifyHostedFixture } from "./hosted-fixture.ts";

// Inline cell writes and initializations take their transfer slot from a
// register home when one is assigned. Captured numbers and references
// written by closures and by their outer function, in loops that allocate
// (so collections move the referenced objects), must read back exactly.
verifyHostedFixture(
  `
interface Box {readonly value:number}
export function run():number {
 let total=0;
 let count=0;
 let last:Box={value:-1};
 const bump=(n:number):void=>{total+=n;count++;};
 const keep=(box:Box):void=>{last=box;};
 for(let round=0;round<200;round++){
  for(let i=0;i<500;i++){
   bump(i);
   if(i%7===0)keep({value:round*1000+i});
   total=total-1+1;
  }
  if(last.value!==round*1000+497)return 1;
 }
 if(count!==100000||total!==200*(499*500/2))return 2;
 let late=0;
 const init=():void=>{late=count;};
 init();
 late=late+1;
 return late===100001?42:3;
}
`,
  "cell-writes",
  [],
  [],
  [],
  [],
  {
    runtimeEntry: "initializeGenerationalRuntime",
    managedBytes: 16777216,
    allocationCapacity: 1048576,
    rootCapacity: 1024,
    stackBytes: 1048576,
  },
);
