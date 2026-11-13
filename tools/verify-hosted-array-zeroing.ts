import { verifyHostedFixture } from "./hosted-fixture.ts";

// Typed-array allocation zeroes the data after the header in 64-byte blocks
// and then 16-byte pairs (arrayInitializer). Every length from 0 to 70 of
// each element size must read back as zero, with neighbours intact, in
// memory that earlier garbage filled with ones: the small heap collects
// repeatedly, so allocations reuse dirty space.
verifyHostedFixture(
  `
function dirty(round:number):number{
 for(let i=0;i<200;i++){const g=new Uint32Array(64+i%9);g.fill(0xffffffff);if(g[0]!==0xffffffff)return 1;}
 return round>=0?0:1;
}
export function run():number {
 for(let round=0;round<40;round++){
  if(dirty(round)!==0)return 1;
  for(let n=0;n<=70;n++){
   const b=new Uint8Array(n),h=new Uint16Array(n),w=new Uint32Array(n),d=new Float64Array(n);
   if(b.length!==n||h.length!==n||w.length!==n||d.length!==n)return 2;
   for(let i=0;i<n;i++){
    if(b[i]!==0)return 3;
    if(h[i]!==0)return 4;
    if(w[i]!==0)return 5;
    if(d[i]!==0)return 6;
   }
   if(n>0){b[n-1]=255;h[n-1]=65535;w[n-1]=7;d[n-1]=1.5;}
   const after=new Uint32Array(3);
   if(after[0]!==0||after[1]!==0||after[2]!==0)return 7;
   if(n>0&&(b[n-1]!==255||h[n-1]!==65535||w[n-1]!==7||d[n-1]!==1.5))return 8;
  }
 }
 return 42;
}
`,
  "array-zeroing",
  [],
  [],
  [],
  [],
  {
    runtimeEntry: "initializeCopyingRuntime",
    managedBytes: 1048576,
    allocationCapacity: 65536,
    rootCapacity: 1024,
    stackBytes: 1048576,
  },
);
