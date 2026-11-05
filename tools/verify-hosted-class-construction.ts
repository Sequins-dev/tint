import { verifyHostedFixture } from "./hosted-fixture.ts";
verifyHostedFixture(
  `
import {buildClassConstruction,buildClassStaticInitialization} from "construction";
import {createFunctionBuilder,verify,type RecordLayout} from "ir";
export function run():number {
 const records:readonly RecordLayout[]=[
  {byteLength:16,fields:[]},
  {byteLength:48,fields:[{offset:24,stateOffset:16,type:"optional-number",mutable:true},{offset:40,type:"reference",mutable:false}]},
  {byteLength:32,fields:[{offset:16,type:"reference",mutable:false},{offset:24,type:"reference",mutable:false}]},
 ];
 const span={start:4,end:8};
 const b=createFunctionBuilder(1,"initializer",[],"optional-number",span);
 const value=b.next();b.emit({kind:"undefined",id:value,...span});b.end({kind:"return",value,...span});
 const initializer=b.finish();
 const fn=buildClassConstruction({id:0,name:"construct",parameters:[],environment:2,prototypeField:0,instance:1,instancePrototypeField:1,fields:[{kind:"call",field:0,entry:{field:1,target:1},...span}],...span},records,[{parameters:[],returnType:"reference"},{parameters:[],returnType:"optional-number"}]);
 if(!verify({functions:[fn,initializer],records}).ok)return 1;
 if(fn.closureEnvironment!==2||fn.returnType!=="reference")return 2;
 let allocation=false,initialize=false,call=false;
 for(const block of fn.blocks){
  if(block===undefined)throw "fixture block invariant";
  const terminator=block.terminator;
  if(terminator.kind==="record-cell"&&terminator.operation==="initialize")initialize=true;
  for(const op of block.instructions){
   if(op===undefined)throw "fixture instruction invariant";
   if(op.kind==="record-new"&&op.record===1)allocation=true;
   if(op.kind==="call-indirect"&&op.target===1&&op.receiver!==undefined)call=true;
  }
 }
 if(!(allocation&&initialize&&call))return 3;
 const statics=buildClassStaticInitialization({id:0,name:"initializeStatics",environment:2,constructorField:0,state:1,fields:[{kind:"call",field:0,entry:{field:1,target:1},...span}],...span},records,[{parameters:[],returnType:"void"},{parameters:[],returnType:"optional-number"}]);
 if(!verify({functions:[statics,initializer],records}).ok)return 4;
 if(statics.returnType!=="void")return 5;
 let state=false;
 for(const block of statics.blocks){
  if(block===undefined)throw "fixture block invariant";
  for(const op of block.instructions){
   if(op===undefined)throw "fixture instruction invariant";
   if(op.kind==="record-new")return 6;
   if(op.kind==="function-environment")state=true;
  }
 }
 return state?42:7;
}
`,
  "class-construction",
  [
    [
      "construction",
      "packages/ts-native/src/closure/lowering/class-construction.ts",
    ],
    ["ir", "packages/ir/src/scalar/index.ts"],
  ],
);
