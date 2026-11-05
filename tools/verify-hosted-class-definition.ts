import { verifyHostedFixture } from "./hosted-fixture.ts";
verifyHostedFixture(
  `
import {buildClassDefinition} from "definition";
import {createFunctionBuilder,verify,type RecordLayout} from "ir";
export function run():number {
 const span={start:0,end:1};
 const records:readonly RecordLayout[]=[
  {byteLength:32,fields:[{offset:24,stateOffset:16,type:"reference",mutable:true}]},
  {byteLength:48,fields:[{offset:16,type:"reference",mutable:false},{offset:32,stateOffset:24,type:"reference",mutable:false}]},
  {byteLength:32,fields:[{offset:16,type:"reference",mutable:false}]},
  {byteLength:32,fields:[{offset:16,type:"reference",mutable:false},{offset:24,type:"reference",mutable:false}]},
  {byteLength:32,fields:[{offset:24,stateOffset:16,type:"reference",mutable:false}]},
 ];
 const fn=buildClassDefinition({id:0,name:"defineC",environment:3,
  prototype:{record:0,constructorField:0,methods:[]},
  state:{record:1,prototypeField:0,constructionField:1,methods:[]},
  callTarget:1,construction:{target:2,record:2,receiverField:0,entries:[]},
  statics:{target:3,record:2,receiverField:0,entries:[]},
  innerBinding:{source:0,record:4,field:0},outerBinding:{source:1,record:4,field:0},...span},records,
  [{parameters:[],returnType:"reference"},{parameters:[],returnType:"void"},{parameters:[],returnType:"reference"},{parameters:[],returnType:"void"}]);
 const call=createFunctionBuilder(1,"call",[],"void",span);call.end({kind:"trap",...span});
 const construct=createFunctionBuilder(2,"construct",[],"reference",span);
 const env=construct.next();construct.emit({kind:"closure-environment",id:env,...span});construct.end({kind:"return",value:env,...span});
 const statics=createFunctionBuilder(3,"statics",[],"void",span);statics.end({kind:"return",value:undefined,...span});
 if(!verify({records,functions:[fn,{...call.finish(),closureEnvironment:1},{...construct.finish(),closureEnvironment:2},{...statics.finish(),closureEnvironment:2}]}).ok)return 1;
 let publications=0,calls=0;
 for(const block of fn.blocks){
  if(block===undefined)throw "fixture block";
  const terminator=block.terminator;
  if(terminator.kind==="record-cell"&&terminator.record===4&&terminator.operation==="initialize")publications++;
  for(const op of block.instructions){
   if(op===undefined)throw "fixture instruction";
   if(op.kind==="call-indirect"&&op.target===3)calls++;
  }
 }
 return publications===2&&calls===1?42:2;
}
`,
  "class-definition",
  [
    [
      "definition",
      "packages/ts-native/src/closure/lowering/class-definition.ts",
    ],
    ["ir", "packages/ir/src/scalar/index.ts"],
  ],
);
