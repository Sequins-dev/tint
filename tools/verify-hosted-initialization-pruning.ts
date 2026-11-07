import { verifyHostedFixture } from "./hosted-fixture.ts";

verifyHostedFixture(
  `
import {verify,type FunctionIR,type Block} from "scalar";
const span={start:0,end:0};
function diamonds(count:number,missing:boolean):FunctionIR {
 const blocks:Block[]=[];
 for(let i=0;i<=count;i++) {
  const instructions:Block["instructions"][number][]=[{kind:"load",id:i*4,slot:0,...span}];
  if(i>0)instructions.push({kind:"load",id:i*4+1,slot:i,...span});
  blocks.push({id:i*3,instructions,terminator:i===count?{kind:"return",value:undefined,...span}:{kind:"branch",condition:i*4,consequent:i*3+1,alternate:i*3+2,...span}});
  if(i===count)break;
  for(let arm=1;arm<=2;arm++) {
   const branch:Block["instructions"][number][]=[{kind:"constant",id:i*4+arm+1,value:42,...span}];
   if(!(missing&&i===0&&arm===2))branch.push({kind:"store",slot:i+1,value:i*4+arm+1,...span});
   blocks.push({id:i*3+arm,instructions:branch,terminator:{kind:"jump",target:i*3+3,...span}});
  }
 }
 const slots:FunctionIR["slots"][number][]=["boolean"];
 for(let i=0;i<count;i++)slots.push("number");
 return {id:0,name:"diamonds",exported:true,parameters:[0],slots,returnType:"void",entry:0,blocks};
}
export function run():number {
 for(const count of [32,128]){if(count===undefined)return 6;if(!verify({functions:[diamonds(count,false)]}).ok)return 1;}
 const missing=verify({functions:[diamonds(8,true)]});
 if(missing.ok||missing.error.code!=="INITIALIZATION")return 2;
 const loop:FunctionIR={id:0,name:"loop",exported:true,parameters:[],slots:["number"],returnType:"void",entry:0,blocks:[{id:0,instructions:[{kind:"load",id:0,slot:0,...span},{kind:"constant",id:1,value:42,...span},{kind:"store",slot:0,value:1,...span}],terminator:{kind:"jump",target:0,...span}}]};
 const checkedLoop=verify({functions:[loop]});if(checkedLoop.ok||checkedLoop.error.code!=="INITIALIZATION")return 3;
 for(const before of [false,true]) {
  if(before===undefined)return 7;
  const store:Block["instructions"][number]={kind:"store",slot:0,value:0,...span};
  const call:Block["instructions"][number]={kind:"call",target:1,id:undefined,arguments:[],...span};
  const ops:Block["instructions"][number][]=[{kind:"constant",id:0,value:42,...span}];
  if(before){ops.push(store);ops.push(call);}else{ops.push(call);ops.push(store);}
  const fn:FunctionIR={id:0,name:"handler",exported:true,parameters:[],slots:["number","general"],returnType:"number",entry:0,blocks:[{id:0,instructions:ops,terminator:{kind:"return",value:0,...span},exception:{target:1,slot:1}},{id:1,instructions:[{kind:"load",id:1,slot:0,...span}],terminator:{kind:"return",value:1,...span}}]};
  const callee:FunctionIR={id:1,name:"callee",exported:false,parameters:[],slots:[],returnType:"void",entry:0,blocks:[{id:0,instructions:[],terminator:{kind:"return",value:undefined,...span}}]};
  const checked=verify({functions:[fn,callee]});if(checked.ok!==before)return 4;if(!checked.ok&&checked.error.code!=="INITIALIZATION")return 5;
 }
 return 42;
}
`,
  "initialization-pruning",
  [["scalar", "packages/ir/src/scalar/index.ts"]],
  [],
  [],
  [],
  { managedBytes: 33554432, allocationCapacity: 524288, stackBytes: 16777216 },
);
