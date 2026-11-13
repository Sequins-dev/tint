import { verifyHostedFixture } from "./hosted-fixture.ts";

// List slices copy through the list runtime: with omitted bounds the loop
// index is the source index (an integer), and inline list writes take an
// int64 index. Slices of every bound form must keep element identity,
// stored undefined, and holes (which read back as undefined), on lists that
// span collections and grow afterwards.
verifyHostedFixture(
  `
interface Item {readonly id:number}
function ids(list:readonly (Item|undefined)[]):number{
 let total=0;
 for(let i=0;i<list.length;i++){const item=list[i];total=total*3+(item===undefined?1:item.id+2);}
 return total;
}
function idAt(list:readonly (Item|undefined)[],index:number):number{
 const item=list[index];
 return item===undefined?-100:item.id;
}
function same(a:readonly (Item|undefined)[],b:readonly (Item|undefined)[]):boolean{
 if(a.length!==b.length)return false;
 for(let i=0;i<a.length;i++)if(a[i]!==b[i])return false;
 return true;
}
function bigSlice(size:number):number{
 const big:(Item|undefined)[]=[];
 for(let i=0;i<size;i++)big.push(i%7===0?undefined:{id:i});
 const copy=big.slice();
 if(!same(copy,big)||copy.length!==size)return 1;
 copy.push({id:-2});
 if(idAt(copy,size)!==-2||big.length!==size)return 2;
 return 0;
}
export function run():number {
 let keep:(Item|undefined)[][]=[];
 for(let round=0;round<60;round++){
  const list:(Item|undefined)[]=[];
  for(let i=0;i<20+round%7;i++)list.push(i%5===3?undefined:{id:i});
  list[list.length+2]={id:99};
  const all=list.slice();
  if(!same(all,list)||ids(all)!==ids(list))return 1;
  if(all.length!==list.length||all[list.length-2]!==undefined||idAt(all,list.length-1)!==99)return 2;
  const tail=list.slice(4),mid=list.slice(2,9),back=list.slice(-3),none=list.slice(9,2);
  if(tail.length!==list.length-4||tail[0]!==list[4]||tail[tail.length-1]!==list[list.length-1])return 3;
  if(mid.length!==7||mid[0]!==list[2]||mid[6]!==list[8]||mid[1]!==undefined)return 4;
  if(back.length!==3||idAt(back,2)!==99||back[0]!==list[list.length-3])return 5;
  if(none.length!==0||list.slice(0,0).length!==0)return 6;
  all.push({id:-1});
  all[0]=undefined;
  if(idAt(list,0)!==0||all.length!==list.length+1||list.length===all.length)return 7;
  const copy:(Item|undefined)[]=[];
  for(let i=0;i<all.length;i++)copy[i]=all[i];
  if(!same(copy,all))return 8;
  keep.push(all);
  if(keep.length>8)keep=keep.slice(1);
  for(let n=0;n<4000;n++)if({id:n}.id<0)return 9;
 }
 for(let k=0;k<keep.length;k++){
  const list=keep[k];
  if(list===undefined||idAt(list,list.length-1)!==-1||list[0]!==undefined)return 10;
 }
 // Slices below and above the first-vector presize bound (65536).
 if(bigSlice(5)!==0||bigSlice(5000)!==0||bigSlice(66000)!==0)return 11;
 return 42;
}
`,
  "list-slice",
  [],
  [],
  [],
  [],
  {
    runtimeEntry: "initializeGenerationalRuntime",
    managedBytes: 67108864,
    allocationCapacity: 4194304,
    rootCapacity: 1024,
    stackBytes: 1048576,
  },
);
