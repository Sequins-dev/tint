import { verifyHostedFixture } from "./hosted-fixture.ts";

// Parallel generational collection (packages/native-runtime/src/tracing/
// parallel.ts). A 128 MiB heap has a 16 MiB nursery, above the 4 MiB
// parallel threshold, so minor collections run on the worker pool; short-
// lived lists that survive a minor fill the 48 MiB old prefix with tenured
// garbage, so majors run on the pool too. The graph mixes records, unions,
// typed arrays with views of other arrays (whose data pointers move with
// their owners), strings, reference arrays and large arrays above the LAB
// size. Old records point at young objects through the remembered set; on
// alternate rounds thousands of such stores overflow its 1024 entries, so
// minors also scan dirty cards in parallel. Every value is checked after
// the churn.
verifyHostedFixture(
  `
interface Node { value: number; next: Node | undefined; data: Uint32Array; view: Uint32Array; label: string; extra: Node | string | undefined; }
function build(round:number,head:Node|undefined,count:number):Node|undefined{
 let current=head;
 for(let i=0;i<count;i++){
  const data=new Uint32Array(8);data[3]=round*count+i;data[7]=i;
  const view=data.subarray(2,6);
  const extra:Node|string|undefined=i%3===0?current:i%3===1?"x"+String(i):undefined;
  current={value:round*count+i,next:current,data,view,label:"n"+String(round*count+i),extra};
 }
 return current;
}
export function run():number {
 let head:Node|undefined=undefined;
 const keep:Node[]=[];
 const large:Float64Array[]=[];
 const tenured:(Node|undefined)[]=[];
 const rounds=30,count=4000;
 for(let round=0;round<rounds;round++){
  // Garbage between survivors.
  for(let i=0;i<40000;i++){const g=new Uint32Array(12);g[0]=i;if(g[0]!==i)return 1;}
  head=build(round,head,count);
  // Tenured garbage: survives the next minor, dropped two rounds later.
  tenured.push(build(round,undefined,count));
  if(tenured.length>2)tenured.shift();
  // Old records gain young referents (remembered set).
  for(let i=0;i<keep.length;i+=7){const k=keep[i];if(k!==undefined)k.extra=head;}
  if(round%2===1){
   // Overflow the remembered set: young labels in thousands of old nodes.
   let old=head,steps=0;
   while(old!==undefined&&steps<count+3000){if(steps>=count)old.label="n"+String(old.value);old=old.next;steps++;}
  }
  if(head!==undefined)keep.push(head);
  // Arrays above a LAB, kept and dropped.
  const big=new Float64Array(6000);big[5999]=round;large.push(big);
  if(large.length>8)large.shift();
 }
 let node=head,expected=rounds*count-1,seen=0;
 while(node!==undefined){
  if(node.value!==expected)return 2;
  if(node.data[3]!==expected||node.view[1]!==expected)return 3;
  if(node.view.length!==4||node.data[7]!==expected%count)return 4;
  if(node.label!=="n"+String(expected))return 5;
  const extra=node.extra,i=expected%count;
  if(i%3===1&&extra!=="x"+String(i))return 6;
  if(i%3===2&&extra!==undefined&&typeof extra==="string")return 7;
  node.view[1]=0;if(node.data[3]!==0)return 8;
  seen++;expected--;node=node.next;
 }
 if(seen!==rounds*count)return 9;
 for(let i=0;i<keep.length;i+=7){const k=keep[i];if(k===undefined||k.extra!==head)return 10;}
 for(let i=0;i<large.length;i++){const big=large[i];if(big===undefined||big[5999]!==rounds-large.length+i)return 11;}
 return 42;
}
`,
  "parallel-collection",
  [],
  [],
  [],
  [],
  {
    runtimeEntry: "initializeGenerationalRuntime",
    managedBytes: 134217728,
    allocationCapacity: 4194304,
    rootCapacity: 1024,
    stackBytes: 4194304,
  },
);
