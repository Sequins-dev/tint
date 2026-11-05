import { verifyHostedFixture } from "./hosted-fixture.ts";
verifyHostedFixture(
  `
import {createSourceText} from "source";
import {parseModule,rewriteModule} from "syntax";
import {bindModule} from "binding";
import {createTypeSystem,type Type} from "types";
import {checkClosureModule} from "checker";
export function run():number {
 const text="interface Context {x:number;} type Callback=(this:Context,value:number)=>number; this; const top=()=>this; function outer(){this; const nested=()=>()=>this; const object={method(){return ()=>this;}}; function inner(){return this;} }";
 const bytes=new TextEncoder().encode(text);
 const source=createSourceText(bytes,bytes.length);if(!source.ok)return 1;
 const parsed=parseModule(source.value);if(!parsed.ok)return 2;
 const alias=parsed.value.statements[1];
 if(alias===undefined||alias.kind!=="type-alias")return 11;
 const contract=alias.type;
 if(contract.kind!=="function"||contract.receiver?.kind!=="named"||contract.parameters.length!==1)return 12;
 const bound=bindModule(rewriteModule(parsed.value,{hashes:true}));if(!bound.ok)return 3;
 const refs=bound.value.receiverReferences;
 if(refs.length!==6||refs[0]?.owner!==undefined||refs[1]?.owner!==undefined||refs[2]?.owner!==1||refs[3]?.owner!==1||refs[4]?.owner!==4||refs[5]?.owner!==6)return 4;
 const functions=bound.value.functions;
 if(functions.length!==7||functions[0]?.receiver!==undefined||functions[1]?.receiver!==1||functions[2]?.receiver!==1||functions[3]?.receiver!==1||functions[4]?.receiver!==4||functions[5]?.receiver!==4||functions[6]?.receiver!==6)return 5;
 const types:Type[]=[{kind:"number"},{kind:"undefined"},{kind:"object",properties:[{name:"x",type:0,readonly:true}]},{kind:"object",properties:[]},{kind:"function",parameters:[0],result:0,receiver:2},{kind:"function",parameters:[0],result:0,receiver:3},{kind:"function",parameters:[0],result:0}];
 const system=createTypeSystem(types);if(!system.ok)return 6;
 if(!system.value.call(4,[0],2).ok||system.value.call(4,[0],3).ok||system.value.call(4,[0]).ok)return 7;
 if(!system.value.assignable(5,4)||system.value.assignable(4,5)||!system.value.assignable(6,4)||system.value.assignable(4,6))return 8;
 const appended=system.value.append({kind:"function",parameters:[0],result:0,receiver:1});if(!appended.ok)return 9;
 if(system.value.assignable(4,appended.value)||!system.value.call(appended.value,[0],1).ok)return 10;
 const bodyBytes=new TextEncoder().encode("interface C{x:number;} function read(this:C):number{return this.x;} function close(this:C):()=>number{return ()=>this.x;} interface O{x:number;read(this:C):number;} function run(o:O):number{return o.read()+(o.read)()+o['read']();}");
 const bodySource=createSourceText(bodyBytes,bodyBytes.length);if(!bodySource.ok)return 13;
 const bodySyntax=parseModule(bodySource.value);if(!bodySyntax.ok)return 14;
 const checked=checkClosureModule(bodySyntax.value);if(!checked.ok||checked.value.receiverTypes.size!==2)return 15;
 return 42;
}`,
  "receiver-binding",
  [
    ["source", "packages/source/src/text.ts"],
    ["syntax", "packages/typescript/src/syntax/index.ts"],
    ["binding", "packages/typescript/src/binding/index.ts"],
    ["types", "packages/typescript/src/types/index.ts"],
    ["checker", "packages/typescript/src/checker/index.ts"],
  ],
);
