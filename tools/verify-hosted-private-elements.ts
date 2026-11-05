import { verifyHostedFixture } from "./hosted-fixture.ts";

verifyHostedFixture(
  `
import {
 createObject,preventExtensions,ownKeys,createPrivateName,hasPrivateElement,
 addPrivateField,addPrivateMethod,addPrivateAccessor,getPrivateElement,setPrivateElement,
 type ObjectHooks,
} from "object";
export function run():number {
 const object=createObject<string,number>(undefined);
 const child=createObject<string,number>(object);
 const name=createPrivateName("x"),other=createPrivateName("x");
 let calls=0,receiverSeen=0,valueSeen=0;
 const hooks:ObjectHooks<number>={undefinedValue:0,sameValue:(a,b):boolean=>a===b,call:(callee,receiver,args):number=>{
   calls++;receiverSeen=receiver;
   if(callee===11)return 42;
   const value=args[0];valueSeen=value===undefined?0:value;return 0;
 }};
 preventExtensions<string,number>(object);
 if(addPrivateField<string,number>(object,name,41)!=="none")return 1;
 if(addPrivateField<string,number>(object,name,99)!=="type")return 2;
 if(!hasPrivateElement<string,number>(object,name)||hasPrivateElement<string,number>(object,other)||hasPrivateElement<string,number>(child,name))return 3;
 if(ownKeys<string,number>(object,(key):number=>-1).length!==0)return 4;
 if(setPrivateElement<string,number>({value:7,object},name,42,hooks)!=="none")return 5;
 if(getPrivateElement<string,number>({value:7,object},name,hooks).value!==42)return 6;
 if(getPrivateElement<string,number>({value:8,object:child},name,hooks).error!=="type")return 7;
 if(addPrivateField<string,number>(child,name,19)!=="none")return 8;
 const method=createPrivateName("m"),accessor=createPrivateName("a"),writeOnly=createPrivateName("w");
 if(addPrivateMethod<string,number>(object,method,17)!=="none")return 9;
 if(setPrivateElement<string,number>({value:7,object},method,0,hooks)!=="type")return 10;
 if(getPrivateElement<string,number>({value:7,object},method,hooks).value!==17)return 11;
 if(addPrivateAccessor<string,number>(object,accessor,11,12)!=="none")return 12;
 if(getPrivateElement<string,number>({value:7,object},accessor,hooks).value!==42||calls!==1||receiverSeen!==7)return 13;
 if(setPrivateElement<string,number>({value:7,object},accessor,19,hooks)!=="none"||calls!==2||valueSeen!==19)return 14;
 if(addPrivateAccessor<string,number>(object,writeOnly,undefined,12)!=="none")return 15;
 if(getPrivateElement<string,number>({value:7,object},writeOnly,hooks).error!=="type"||calls!==2)return 16;
 if(getPrivateElement<string,number>({value:7,object:undefined},name,hooks).error!=="type")return 17;
 if(setPrivateElement<string,number>({value:7,object:undefined},name,0,hooks)!=="type")return 18;
 for(let i=0;i<20000;i++){
   const temporary=createObject<string,number>(undefined);
   addPrivateField<string,number>(temporary,createPrivateName("temporary"),i);
 }
 if(getPrivateElement<string,number>({value:7,object},name,hooks).value!==42||getPrivateElement<string,number>({value:8,object:child},name,hooks).value!==19)return 19;
 return 42;
}
`,
  "private-elements",
  [["object", "packages/js-runtime/src/objects/index.ts"]],
);
