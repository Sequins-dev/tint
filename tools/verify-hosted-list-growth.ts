import { verifyHostedFixture } from "./hosted-fixture.ts";

// Reference-list growth copies the old vector into its replacement in one
// reference-vector-copy. Direct-reference lists store undefined as the
// vector itself, so the copy rebases those entries onto the replacement.
// Under the generational runtime a list tenured by earlier minors keeps
// growing while it receives young elements: the copy into a replacement
// that the collector later tenures must leave every element reachable.
verifyHostedFixture(
  `
interface Item { value: number; label: string; }
function item(i:number):Item{ return {value:i,label:"i"+String(i)}; }
function check(list:(Item|undefined)[],count:number,offset:number):number{
 if(list.length!==count)return 1;
 for(let i=0;i<count;i++){
  const entry=list[i];
  if((i+offset)%3===0){ if(entry!==undefined)return 2; }
  else if(entry===undefined||entry.value!==i+offset||entry.label!=="i"+String(i+offset))return 3;
 }
 return 0;
}
export function run():number {
 // Growth by push, with undefined entries throughout.
 const pushed:(Item|undefined)[]=[];
 for(let i=0;i<5000;i++)pushed.push(i%3===0?undefined:item(i));
 const first=check(pushed,5000,0);
 if(first!==0)return 10+first;
 // Growth by indexed writes at the end.
 const written:(Item|undefined)[]=[];
 for(let i=0;i<5000;i++)written[i]=(i+1)%3===0?undefined:item(i+1);
 const second=check(written,5000,1);
 if(second!==0)return 20+second;
 // A long-lived list grows across collections with young elements.
 const lists:(Item|undefined)[][]=[];
 for(let round=0;round<40;round++){
  const list:(Item|undefined)[]=[];
  lists.push(list);
  for(let r=0;r<lists.length;r++){
   const old=lists[r];
   if(old===undefined)return 30;
   for(let i=0;i<300;i++){const n=old.length;old.push(n%3===0?undefined:item(n));}
  }
  for(let i=0;i<20000;i++){const g=new Uint32Array(16);g[0]=i;if(g[0]!==i)return 31;}
 }
 for(let r=0;r<lists.length;r++){
  const list=lists[r];
  if(list===undefined)return 32;
  const third=check(list,(40-r)*300,0);
  if(third!==0)return 40+third;
 }
 return 42;
}
`,
  "list-growth",
  [],
  [],
  [],
  [],
  {
    runtimeEntry: "initializeGenerationalRuntime",
    managedBytes: 67108864,
    allocationCapacity: 4194304,
    rootCapacity: 1024,
    stackBytes: 4194304,
  },
);
