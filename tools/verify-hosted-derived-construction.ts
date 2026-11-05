import { verifyHostedFixture } from "./hosted-fixture.ts";
verifyHostedFixture(
  `
import {createObject,createConstructorObject,createDerivedConstruction,getDerivedThis,constructSuper,finishDerivedConstruction,type ObjectHooks} from "object";
export function run():number {
 let calls=0,fields=0,targetSeen=0;
 const instance=createObject<string,number>(undefined);
 const base=createConstructorObject<string,number>(undefined,(receiver,args):number=>0,(args,target):number=>{calls++;targetSeen=target;return calls===1?42:43;});
 const context=createDerivedConstruction<string,number>({value:9,object:base},0,(receiver):void=>{fields++;});
 const read=():number=>getDerivedThis<string,number>(context).error==="reference"?-1:getDerivedThis<string,number>(context).value;
 if(read()!==-1)return 1;
 if(constructSuper<string,number>(context,undefined,[],0).error!=="type"||read()!==-1)return 2;
 const result=constructSuper<string,number>(context,base,[7],0);
 if(result.error!=="none"||result.value!==42||read()!==42||targetSeen!==9||fields!==1)return 3;
 if(constructSuper<string,number>(context,base,[],0).error!=="reference"||calls!==2||fields!==1||read()!==42)return 4;
 const hooks:ObjectHooks<number>={undefinedValue:0,sameValue:(a,b):boolean=>a===b,call:(callee,receiver,args):number=>0};
 if(finishDerivedConstruction<string,number>(context,{value:0,object:undefined},hooks).value!==42)return 5;
 if(finishDerivedConstruction<string,number>(context,{value:1,object:undefined},hooks).error!=="type")return 6;
 const second=createDerivedConstruction<string,number>({value:9,object:base},0,(receiver):void=>{throw 17;});
 if(finishDerivedConstruction<string,number>(second,{value:0,object:undefined},hooks).error!=="reference")return 7;
 if(finishDerivedConstruction<string,number>(second,{value:19,object:instance},hooks).value!==19)return 8;
 let caught=0;try{constructSuper<string,number>(second,base,[],0);}catch(error){caught=error===17?17:1;}
 if(caught!==17||getDerivedThis<string,number>(second).value!==43)return 9;
 return 42;
}
`,
  "derived-construction",
  [["object", "packages/js-runtime/src/objects/index.ts"]],
);
