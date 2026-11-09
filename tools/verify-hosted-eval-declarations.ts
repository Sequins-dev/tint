import { verifyHostedFixture } from "./hosted-fixture.ts";
verifyHostedFixture(
  `
import {createObject,getOwnProperty,preventExtensions,type ObjectHooks} from "objects";
import {createDeclarativeEnvironment,createMutableBinding,initializeBinding,hasBinding,getBindingValue,deleteBinding,bindingCount} from "records";
import {createGlobalEnvironment,instantiateEvalDeclarations,instantiateDirectEvalDeclarations,createGlobalScope,createDeclarativeScope,type DirectEvalCatch,createGlobalVarBinding,deleteGlobalBinding} from "global";
const hooks:ObjectHooks<number>={undefinedValue:0,sameValue:(a:number,b:number):boolean=>a===b,call:(callee:number,receiver:number,args:readonly number[]):number=>0};
export function run():number{
 const object=createObject<string,number>(undefined),record=createGlobalEnvironment<string,number>(object,1,1,(name:string):string=>name,hooks),lexical=createDeclarativeEnvironment<number>(0);
 createMutableBinding<number>(record.lexical,"blocked",false);
 let made=0;
 if(instantiateEvalDeclarations<string,number>(record,lexical,{lexical:[{name:"fresh",constant:false}],variables:["blocked"],functions:[{name:"fn",instantiate:():number=>{made++;return 7;}}]},false)!=="syntax")return 60;
 if(made!==0||hasBinding<number>(lexical,"fresh")||getOwnProperty<string,number>(object,"fn")!==undefined)return 61;
 if(instantiateEvalDeclarations<string,number>(record,lexical,{lexical:[{name:"local",constant:true}],variables:["fn","v","v"],functions:[{name:"fn",instantiate:():number=>{made++;return 1;}},{name:"fn",instantiate:():number=>{made++;if(getBindingValue<number>(lexical,"local").error!=="reference")return 99;return 42;}}]},false)!=="none")return 62;
 const fn=getOwnProperty<string,number>(object,"fn"),v=getOwnProperty<string,number>(object,"v");
 if(fn===undefined||fn.value!==42||!fn.configurable||v===undefined||!v.configurable||made!==1)return 63;
 for(let i=0;i<1024;i++){const bytes=new Uint32Array(8192);bytes[0]=i;if(bytes[0]!==i)return 64;}
 if(!deleteGlobalBinding<string,number>(record,"fn"))return 65;
 const strict=createDeclarativeEnvironment<number>(0);preventExtensions<string,number>(object);
 if(instantiateEvalDeclarations<string,number>(record,strict,{lexical:[],variables:["blocked","w"],functions:[{name:"blocked",instantiate:():number=>42}]},true)!=="none")return 66;
 if(getBindingValue<number>(strict,"blocked").value!==42||getBindingValue<number>(strict,"w").value!==0||!deleteBinding<number>(strict,"blocked")||getOwnProperty<string,number>(object,"blocked")!==undefined)return 67;
 const absent={name:"absent",admitted:true};
 if(instantiateEvalDeclarations<string,number>(record,createDeclarativeEnvironment<number>(0),{lexical:[],variables:[],functions:[],annexFunctions:[absent]},false)!=="none"||absent.admitted)return 68;
 if(instantiateEvalDeclarations<string,number>(record,createDeclarativeEnvironment<number>(0),{lexical:[],variables:["absent"],functions:[]},false)!=="type")return 69;
 const local=createDeclarativeEnvironment<number>(0),root=createGlobalScope<string,number>(record),variables=createDeclarativeScope<string,number>(root,local);
 const middle=createDeclarativeEnvironment<number>(0),fresh=createDeclarativeEnvironment<number>(0);createMutableBinding<number>(middle,"blocked",false);
 const outer=createDeclarativeScope<string,number>(variables,middle),site=createDeclarativeScope<string,number>(outer,fresh);
 let localMade=0;
 if(instantiateDirectEvalDeclarations<string,number>(site,variables,undefined,{lexical:[{name:"fresh",constant:false}],variables:["blocked"],functions:[{name:"f",instantiate:():number=>{localMade++;return 42;}}]},false)!=="syntax"||localMade!==0||bindingCount<number>(local)!==0||bindingCount<number>(fresh)!==0)return 70;
 const catches:DirectEvalCatch<number>={record:middle,outer:undefined};
 if(instantiateDirectEvalDeclarations<string,number>(site,variables,catches,{lexical:[{name:"tdz",constant:true}],variables:["blocked","v"],functions:[{name:"f",instantiate:():number=>{localMade++;return 1;}},{name:"f",instantiate:():number=>{localMade++;return getBindingValue<number>(fresh,"tdz").error==="reference"?42:99;}}]},false)!=="none")return 71;
 if(localMade!==1||getBindingValue<number>(local,"f").value!==42||getBindingValue<number>(local,"blocked").value!==0||!deleteBinding<number>(local,"f")||!deleteBinding<number>(local,"v"))return 72;
 const blocked={name:"blocked",admitted:true},admitted={name:"admitted",admitted:false};
 if(instantiateDirectEvalDeclarations<string,number>(createDeclarativeScope<string,number>(outer,createDeclarativeEnvironment<number>(0)),variables,undefined,{lexical:[],variables:[],functions:[],annexFunctions:[blocked,admitted]},false)!=="none"||blocked.admitted||!admitted.admitted||hasBinding<number>(local,"blocked")!==true||!hasBinding<number>(local,"admitted"))return 73;
 createMutableBinding<number>(local,"keep",false);initializeBinding<number>(local,"keep",19);
 const strictFresh=createDeclarativeEnvironment<number>(0);
 if(instantiateDirectEvalDeclarations<string,number>(createDeclarativeScope<string,number>(outer,strictFresh),variables,undefined,{lexical:[],variables:["blocked"],functions:[]},true)!=="none"||getBindingValue<number>(strictFresh,"blocked").value!==0)return 74;
 for(let i=0;i<1024;i++){const bytes=new Uint32Array(8192);bytes[0]=i;if(bytes[0]!==i)return 75;}
 if(getBindingValue<number>(local,"keep").value!==19||deleteBinding<number>(local,"keep")||getBindingValue<number>(local,"admitted").value!==0)return 76;
 return 42;
}`,
  "eval-declarations",
  [
    ["objects", "packages/js-runtime/src/objects/index.ts"],
    ["records", "packages/js-runtime/src/environments/records/index.ts"],
    ["global", "packages/js-runtime/src/environments/global/index.ts"],
  ],
  [],
  [],
  [],
  { managedBytes: 67108864, allocationCapacity: 1048576 },
);
