import { verifyHostedFixture } from "./hosted-fixture.ts";

// Captured variables accessed in loops are promoted to slots there (see
// packages/ir/src/optimization/cell-promotion.ts). Every exit must write the
// value back (break, return and throw inside loops, nested loops), and a
// loop calling a closure over the cell must keep reading and writing the
// cell itself, since the closure observes and changes it.
verifyHostedFixture(
  `
export function run():number {
 let work=0;
 const budget=():number=>work;           // observes work
 const bump=():void=>{work+=10;};        // changes work
 // A plain counted loop with nested loops.
 for(let i=0;i<100;i++)for(let j=0;j<10;j++)work++;
 if(budget()!==1000)return 1;
 // Calls to a closure over the cell inside the loop see each update.
 let seen=0;
 for(let i=0;i<5;i++){work++;seen+=budget();}
 if(seen!==5015||work!==1005)return 2;
 for(let i=0;i<3;i++){bump();work++;}
 if(work!==1038)return 3;
 // Early return from inside the loop writes back.
 const find=(limit:number):number=>{for(let i=0;i<1000;i++){work++;if(i===limit)return i;}return -1;};
 if(find(7)!==7||work!==1046)return 4;
 // A throw inside the loop writes back before leaving.
 try{for(let i=0;;i++){work+=2;if(i===4)throw "stop";}}catch(e){}
 if(work!==1056)return 5;
 // Break out of nested loops.
 outer:for(let i=0;i<10;i++){for(let j=0;j<10;j++){work++;if(j===3&&i===2)break outer;}}
 if(work!==1056+24)return 6;
 // A read-only loop.
 let total=0;
 for(let i=0;i<10;i++)total+=work;
 return total===10800&&budget()===1080?42:7;
}
`,
  "loop-cells",
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
