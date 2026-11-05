import { verifyHostedFixture } from "./hosted-fixture.ts";

verifyHostedFixture(
  `import {createCallableObject,createConstructorObject,callObject,constructObject,createBoundFunction,createObject,setPrototype,type ObjectExecutionContext} from "objects";
export function run():number{
 let active=0,caught=0;
 const context:ObjectExecutionContext<unknown>={run:(action:()=>unknown):unknown=>{
  const prior=active;active=1;
  try{return action();}finally{active=prior;}
 }};
 const other:ObjectExecutionContext<unknown>={run:(action:()=>unknown):unknown=>{
  const prior=active;active=2;
  try{return action();}finally{active=prior;}
 }};
 const inner=createCallableObject<string,unknown>(undefined,(receiver,args):unknown=>active,other);
 const fn=createConstructorObject<string,unknown>(undefined,(receiver,args):unknown=>{
  if(active!==1)throw 19;
  if(callObject<string,unknown>(inner,undefined,[],undefined).value!==2||active!==1)throw 23;
  return active;
 },(args,newTarget):unknown=>{if(active!==1)throw 19;return 42;},context);
 if(callObject<string,unknown>(fn,undefined,[],undefined).value!==1||active!==0)return 1;
 if(constructObject<string,unknown>(fn,[],{object:fn,value:fn},undefined).value!==42||active!==0)return 2;
 const bound=createBoundFunction<string,unknown>(fn,undefined,[],undefined,(object):unknown=>object,(a,b):boolean=>a===b);
 setPrototype<string,unknown>(bound,createObject<string,unknown>(undefined));
 if(callObject<string,unknown>(bound,undefined,[],undefined).value!==1||active!==0)return 3;
 const throwing=createCallableObject<string,unknown>(undefined,(receiver,args):unknown=>{if(active!==1)throw 19;throw 42;},context);
 try{callObject<string,unknown>(throwing,undefined,[],undefined);return 4;}catch(error){if(error===42)caught++;}
 if(caught!==1||active!==0)return 5;
 return 42;
}`,
  "call-context",
  [["objects", "packages/js-runtime/src/objects/index.ts"]],
);
