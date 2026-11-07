import { verifyHostedFixture } from "./hosted-fixture.ts";

verifyHostedFixture(
  `import {optimizeModule} from "optimizer";
import {verify,type FunctionIR,type ModuleIR,type Instruction} from "ir";
function copies(id:number):FunctionIR {
 return {id,name:"copies"+id,exported:true,parameters:[0],slots:["number","number"],returnType:"number",entry:0,blocks:[{id:0,instructions:[{kind:"load",id:0,slot:0,start:0,end:0},{kind:"store",slot:1,value:0,start:0,end:0},{kind:"load",id:1,slot:1,start:0,end:0}],terminator:{kind:"return",value:1,start:0,end:0}}]};
}
function check(input:ModuleIR,budget:number):boolean {
 const output=optimizeModule(input,budget);
 if(!output.budgetExhausted||!verify(output.module).ok)return false;
 let visited=0;for(const pass of output.passes){if(pass===undefined)return false;visited+=pass.visited;}
 if(visited>budget)return false;
 const original=input.functions[0],first=output.module.functions[0];
 if(original===undefined||first===undefined||original.slots.length!==2||first.slots.length!==1||first.parameters[0]!==0)return false;
 const before=original.blocks[0],after=first.blocks[0];
 if(before===undefined||after===undefined||before.instructions.length!==3||after.instructions.length!==1)return false;
 const load=after.instructions[0],term=after.terminator;
 return load!==undefined&&load.kind==="load"&&load.slot===0&&load.id===0&&term.kind==="return"&&term.value===0;
}
export function run():number {
 const functions:FunctionIR[]=[];for(let id=0;id<50;id++)functions.push(copies(id));
 const input:ModuleIR={functions};if(!verify(input).ok)return 1;
 if(!check(input,200)||!check(input,500)||!check(input,750))return 2;
 const zero=optimizeModule(input,0);if(zero.module!==input||!zero.budgetExhausted)return 3;
 const instructions:Instruction[]=[];for(let id=0;id<25000;id++)instructions.push({kind:"constant",id,value:id,start:0,end:0});
 const large:FunctionIR={id:0,name:"large",exported:true,parameters:[],slots:[],returnType:"number",entry:0,blocks:[{id:0,instructions,terminator:{kind:"return",value:24999,start:0,end:0}}]};
 const oversized:ModuleIR={functions:[large,copies(1)]};
 if(!verify(oversized).ok)return 4;
 const output=optimizeModule(oversized,60000);if(!output.budgetExhausted||!verify(output.module).ok)return 5;
 const later=output.module.functions[1];if(later===undefined||later.slots.length!==1)return 6;
 return 42;
}`,
  "optimization-budget",
  [
    ["optimizer", "packages/ir/src/optimization/index.ts"],
    ["ir", "packages/ir/src/scalar/index.ts"],
  ],
  [],
  [],
  [],
  {
    runtimeEntry: "initializeCopyingRuntime",
    managedBytes: 67108864,
    allocationCapacity: 1048576,
    rootCapacity: 16384,
    stackBytes: 16777216,
  },
);
