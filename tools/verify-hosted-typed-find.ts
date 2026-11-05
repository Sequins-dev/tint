import { verifyHostedFixture } from "./hosted-fixture.ts";
const cases = ["Uint8Array", "Uint16Array", "Uint32Array", "Float64Array"].map(
  (type, index) => `{
 const a=new ${type}(4);a[0]=2;a[1]=7;a[2]=2;a[3]=9;
 if(a.find(v=>v===2)!==2||a.findIndex(v=>v===2)!==0||a.findLast(v=>v===2)!==2||a.findLastIndex(v=>v===2)!==2)return ${index + 1};
 if(a.find(v=>false)!==undefined||a.findLast(v=>false)!==undefined||a.findIndex(v=>false)!==-1||a.findLastIndex(v=>false)!==-1)return 5;
 let order=0;let calls=0;
 a.findLast((v,i,values):boolean=>{order=order*10+i;calls++;return values!==a;});
 if(order!==3210||calls!==4)return 6;
 a.find((v,i,values):boolean=>{if(i===0)values[1]=11;return false;});if(a.findIndex(v=>v===11)!==1)return 7;
 let hits=0;if(!a.some((v):number=>{hits++;return v===11?1:0;})||hits!==2)return 13;
 hits=0;if(a.every((v):boolean=>{hits++;return v<10;})||hits!==2)return 14;
 const empty=new ${type}(0);if(empty.some(()=>true)||!empty.every(()=>false))return 15;if(empty.find(()=>true)!==undefined||empty.findLastIndex(()=>true)!==-1)return 8;
 const view=a.subarray(1,3);if(view.findLastIndex(v=>v===2)!==1||view.find(v=>true)!==11)return 9;
 }`,
);
verifyHostedFixture(
  `
function absent():Uint8Array|undefined{return undefined;}
export function run():number{
 ${cases.join("\n")}
 const floats=new Float64Array(3);floats[0]=NaN;floats[1]=-0;floats[2]=Infinity;
 if(floats.findIndex(v=>Number.isNaN(v))!==0||1/(floats.find(v=>v===0)??1)!==-Infinity)return 10;
 if(absent()?.find(v=>true)!==undefined||absent()?.findLastIndex(v=>true)!==undefined)return 11;
 let caught=0;try{floats.findLast((v):boolean=>{throw 23;});}catch(e){if(e===23)caught=1;}if(caught!==1)return 12;
 return 42;
}`,
  "typed-find",
);
