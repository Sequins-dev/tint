import { verifyHostedFixture } from "./hosted-fixture.ts";
verifyHostedFixture(
  `
function absent():number[]|undefined{return undefined;}
export function run():number{
 const a:number[]=[];a.length=4;a[1]=2;a[3]=4;
 let count=0;let order=0;let sum=0;
 a.forEach((v,i,values)=>{count++;order=order*10+i;sum+=v;if(values!==a)sum=-100;});
 if(count!==2||order!==13||sum!==6)return 1;
 const mutated=[1,2,3];count=0;
 mutated.forEach((v,i,values)=>{count++;if(i===0){values.length=1;values.push(7);}if(i===1&&v!==7)count=100;});
 if(count!==2)return 2;
 const grown=[1];count=0;grown.forEach((v,i,values)=>{count++;values.push(2);return 9;});if(count!==1)return 3;
 const flags=[false,true];sum=0;flags.forEach(v=>{if(v)sum++;});if(sum!==1)return 4;
 const optional:(number|undefined)[]=[undefined];count=0;optional.forEach(v=>{if(v===undefined)count++;});if(count!==1)return 5;
 count=0;absent()?.forEach(()=>{count++;});if(count!==0)return 6;
 const typed=new Uint8Array(3);typed[0]=1;typed[1]=2;typed[2]=3;
 typed.forEach((v,i,values)=>{values[i]=v+1;});if(typed[0]!==2||typed[2]!==4)return 7;
 let caught=0;try{a.forEach(()=>{throw 17;});}catch(e){if(e===17)caught=1;}if(caught!==1)return 8;
 const empty:number[]=[];empty.forEach(()=>{throw 18;});
 const words=["a","b"];let joined="";words.forEach(v=>{joined+=v;});if(joined!=="ab")return 9;
 count=0;if(a.some(()=>{count++;})||count!==2)return 10;
 count=0;if(a.every(()=>{count++;})||count!==1)return 11;
 count=0;if(a.find(()=>{count++;})!==undefined||count!==4)return 12;
 if(a.findLastIndex(()=>{})!==-1||a.filter(()=>{}).length!==0)return 13;
 if(typed.some(()=>{})||typed.every(()=>{}))return 14;
 if(empty.some(()=>{})||!empty.every(()=>{}))return 15;
 return 42;
}`,
  "for-each",
);
