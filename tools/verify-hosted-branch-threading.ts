import { verifyHostedFixture } from "./hosted-fixture.ts";

// Inlined boolean helpers (`&&`/`||` chains) carry their result in a slot
// that the caller's branch reloads; branch threading makes the comparisons
// branch directly and skips retests whose outcome a predecessor decided.
// Every combination of operands, short-circuit ordering (side effects in
// later operands must not run) and negated uses must keep their results.
verifyHostedFixture(
  `
interface Span {readonly lo:number; readonly hi:number; readonly exact:boolean}
function same(a:Span,b:Span):boolean{
 return a.exact===b.exact&&a.lo===b.lo&&a.hi===b.hi;
}
function either(a:Span,b:Span):boolean{
 return a.lo===b.hi||a.hi===b.lo||!a.exact;
}
let probes=0;
function probe(value:boolean):boolean{probes++;return value;}
export function run():number {
 const spans:Span[]=[];
 for(let lo=0;lo<3;lo++)
  for(let hi=0;hi<3;hi++){
   spans.push({lo:lo,hi:hi,exact:true});
   spans.push({lo:lo,hi:hi,exact:false});
  }
 let matches=0, alternatives=0, changed=0, guarded=0;
 for(let i=0;i<spans.length;i++)
  for(let j=0;j<spans.length;j++){
   const a=spans[i], b=spans[j];
   if(a===undefined||b===undefined)return 1;
   const equal=same(a,b);
   if(equal)matches++;
   if(!same(a,b))changed++;
   if(either(a,b))alternatives++;
   if(same(a,b)&&probe(true))guarded++;
   if(equal!==(i===j))return 2;
  }
 if(matches!==18||changed!==306)return 3;
 if(probes!==18||guarded!==18)return 4;
 return alternatives===252?42:5;
}
`,
  "branch-threading",
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
