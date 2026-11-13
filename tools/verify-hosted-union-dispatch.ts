import { verifyHostedFixture } from "./hosted-fixture.ts";

// A field read through a structural type lowers to a chain of layout tests,
// one per object shape that can reach it; the optimizer tests the most
// allocated shape first. Reads must return each shape's own field whatever
// the order, including the least common shape and after collections.
verifyHostedFixture(
  `
type Fact =
 | {readonly kind:"plain";readonly object:number}
 | {readonly kind:"tagged";readonly tag:number;readonly object:number}
 | {readonly kind:"wide";readonly tag:number;readonly extra:number;readonly object:number};
function make(i:number):Fact{
 if(i%11===0)return {kind:"wide",tag:3,extra:i,object:i};
 if(i%5===0)return {kind:"tagged",tag:2,object:i};
 return {kind:"plain",object:i};
}
function sum(facts:readonly Fact[]):number{
 let total=0;
 for(let i=0;i<facts.length;i++){const f=facts[i];if(f!==undefined)total+=f.object;}
 return total;
}
export function run():number {
 for(let round=0;round<20;round++){
  const facts:Fact[]=[];
  let expected=0;
  for(let i=0;i<2000;i++){facts.push(make(i));expected+=i;}
  if(sum(facts)!==expected)return 1;
  const rare:Fact[]=[make(0),make(11),make(5),make(1)];
  if(sum(rare)!==17)return 2;
 }
 return 42;
}
`,
  "union-dispatch",
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
