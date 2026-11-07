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
 const caller:FunctionIR={id:0,name:"caller",exported:true,parameters:[0],slots:["number"],returnType:"number",entry:0,blocks:[{id:0,instructions:[{kind:"load",id:0,slot:0,start:0,end:0},{kind:"call",id:1,target:1,arguments:[0],start:0,end:0}],terminator:{kind:"return",value:1,start:0,end:0}}]};
 const inlineInput:ModuleIR={functions:[caller,copies(1),{...large,id:2}]};
 if(!verify(inlineInput).ok)return 7;
 const inlined=optimizeModule(inlineInput,60000);if(!verify(inlined.module).ok)return 8;
 let totalWork=0,inlines=0;for(const pass of inlined.passes){if(pass===undefined)return 9;totalWork+=pass.visited;if(pass.pass==="inline-small-functions")inlines+=pass.rewritten;}
 if(totalWork>60000||inlines!==1)return 10;
 const inlinedCaller=inlined.module.functions[0];if(inlinedCaller===undefined)return 11;
 for(const block of inlinedCaller.blocks){if(block===undefined)return 12;for(const op of block.instructions){if(op===undefined||op.kind==="call")return 13;}}
 const referenceInstructions:Instruction[]=[{kind:"load",id:0,slot:0,start:0,end:0}];
 for(let id=0;id<35;id++){referenceInstructions.push({kind:"store",slot:1,value:id,start:0,end:0});referenceInstructions.push({kind:"load",id:id+1,slot:1,start:0,end:0});}
 const referenceCaller:FunctionIR={id:0,name:"referenceCaller",exported:true,parameters:[0],slots:["reference"],returnType:"reference",entry:0,blocks:[{id:0,instructions:[{kind:"load",id:0,slot:0,start:0,end:0},{kind:"call",id:1,target:1,arguments:[0],start:0,end:0}],terminator:{kind:"return",value:1,start:0,end:0}}]};
 const referenceHelper:FunctionIR={id:1,name:"referenceCopies",exported:false,parameters:[0],slots:["reference","reference"],returnType:"reference",entry:0,blocks:[{id:0,instructions:referenceInstructions,terminator:{kind:"return",value:35,start:0,end:0}}]};
 const ordered=optimizeModule({functions:[referenceCaller,referenceHelper,{...large,id:2}]},60000);
 if(!verify(ordered.module).ok)return 14;let orderedWork=0;for(const pass of ordered.passes){if(pass===undefined)return 15;orderedWork+=pass.visited;}if(orderedWork>60000)return 16;
 const orderedCaller=ordered.module.functions[0];if(orderedCaller===undefined)return 17;for(const block of orderedCaller.blocks){if(block===undefined)return 18;for(const op of block.instructions){if(op===undefined||op.kind==="call")return 19;}}
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
