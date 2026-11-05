import { verifyHostedFixture } from "./hosted-fixture.ts";
verifyHostedFixture(
  `
import {createSourceTextView} from "text";
import {parseEvalScript,parseScript,type EvalScriptContext} from "syntax";
import {bindEvalScript,bindScript} from "binding";
const none:EvalScriptContext={strict:false,newTarget:false,superProperty:false,superCall:false};
const all:EvalScriptContext={strict:false,newTarget:true,superProperty:true,superCall:true};
function parses(text:string,context:EvalScriptContext):boolean{return parseEvalScript(createSourceTextView(text),context).ok;}
function binds(text:string,privateEnvironment:boolean,field:boolean):boolean{
 const parsed=parseEvalScript(createSourceTextView(text),{strict:field,newTarget:false,superProperty:false,superCall:false});
 if(!parsed.ok)return false;
 return bindEvalScript(parsed.value,{privateEnvironment,fieldInitializer:field}).ok;
}
export function run():number{
 if(parses("new.target",none)||!parses("new.target",{strict:false,newTarget:true,superProperty:false,superCall:false}))return 60;
 if(parses("super.x",none)||!parses("()=>super.x",{strict:false,newTarget:false,superProperty:true,superCall:false}))return 61;
 if(parses("super()",none)||!parses("()=>super()",{strict:false,newTarget:false,superProperty:false,superCall:true}))return 62;
 if(parses("return 1",all)||parses("break",all)||parses("await 1",all)||parses("yield 1",all))return 63;
 if(!parses("var await=1;await",all)||!parses("var yield=1;yield",all)||!parses("1 <!-- comment",all))return 64;
 if(parses("with(o){}",{strict:true,newTarget:false,superProperty:false,superCall:false})||parses("010",{strict:true,newTarget:false,superProperty:false,superCall:false}))return 65;
 if(parses("(function(){super.x})",all)||!parses("(function(){return new.target})",none))return 66;
 if(!binds("this.#x",true,false)||binds("this.#x",false,false))return 67;
 if(binds("()=>arguments",false,true)||!binds("(function(){return arguments})",false,true)||!binds("arguments",false,false))return 68;
 const annex=parseScript(createSourceTextView("{function g(){}}this.#x;g;"));
 if(!annex.ok)return 69;
 const bound=bindEvalScript(annex.value,{privateEnvironment:true,fieldInitializer:false});
 if(!bound.ok)return 69;
 const externalNames=bound.value.externalPrivateNames;
 if(externalNames===undefined||externalNames[0]!=="#x")return 69;
 const copies=bound.value.annexFunctionCopies;
 if(copies===undefined||copies.length!==1)return 69;
 for(const source of ["let x=1;x","class C{#x;m(){return this.#x}}","{function f(){}}f"]){
  if(source===undefined)throw "EVAL_CONTEXT_INPUT_INVARIANT";
  const a=parseScript(createSourceTextView(source)),b=parseEvalScript(createSourceTextView(source),none);
  if(!a.ok||!b.ok)return 70;
  const ordinary=bindScript(a.value),evaluated=bindEvalScript(b.value,{privateEnvironment:false,fieldInitializer:false});
  if(!ordinary.ok||!evaluated.ok||ordinary.value.bindings.length!==evaluated.value.bindings.length)return 70;
 }
 return 42;
}`,
  "eval-context",
  [
    ["text", "packages/source/src/text.ts"],
    ["syntax", "packages/typescript/src/syntax/index.ts"],
    ["binding", "packages/typescript/src/binding/index.ts"],
  ],
  [],
  [],
  [],
  { managedBytes: 67108864, allocationCapacity: 1048576 },
);
