import { verifyHostedFixture } from "./hosted-fixture.ts";
verifyHostedFixture(
  `
interface Item{value:number}
function absent():number[]|undefined{return undefined;}
export function run():number{
 const values=[2,4,3,4];let calls=0;
 if(values.findLast((v,i,a):boolean=>{calls++;return v===4&&a===values;})!==4||calls!==1)return 1;
 if(values.findLastIndex(v=>v===4)!==3||values.findLastIndex(v=>v===7)!==-1)return 2;
 const empty:number[]=[];if(empty.findLast(()=>true)!==undefined||empty.findLastIndex(()=>true)!==-1)return 3;
 const sparse:(number|undefined)[]=[];sparse.length=4;sparse[1]=9;
 let order=0;calls=0;
 if(sparse.findLast((v,i):boolean=>{order=order*10+i;calls++;return false;})!==undefined||order!==3210||calls!==4)return 4;
 if(sparse.findLastIndex(v=>v===undefined)!==3)return 5;
 const mutated=[1,2,3];calls=0;
 if(mutated.findLastIndex((v,i,a):boolean=>{calls++;if(i===2){a.length=1;a.push(7,8,9);}return v===7;})!==1||calls!==2)return 6;
 const shrinking=[1,2,3];calls=0;
 if(shrinking.findLastIndex((v,i,a):boolean=>{calls++;if(i===2)a.length=0;return v===undefined;})!==1||calls!==2)return 7;
 const strings=["a","","b"];if(strings.findLast(v=>v)!=="b"||strings.findLastIndex(v=>v==="")!==1)return 8;
 const flags=[true,false];if(flags.findLast(v=>v===false)!==false)return 9;
 const item:Item={value:2};const objects=[{value:1},item];if(objects.findLast(v=>v!==undefined&&v.value===2)!==item)return 10;
 if(absent()?.findLast(()=>true)!==undefined||absent()?.findLastIndex(()=>true)!==undefined)return 11;
 let caught=0;try{values.findLast((v):boolean=>{throw 17;});}catch(e){if(e===17)caught=1;}if(caught!==1)return 12;
 const payloads=[NaN,-0];if(1/(payloads.findLast(v=>v===0)??1)!==-Infinity)return 13;
 return 42;
}`,
  "find-last",
);
