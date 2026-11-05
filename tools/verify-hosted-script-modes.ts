import { verifyHostedFixture } from "./hosted-fixture.ts";
verifyHostedFixture(
  `
import {parseScript,parseStrictScript} from "syntax";
import {createSourceText} from "source";
export function run():number {
 const cases:readonly string[]=[
  'var eval=1;arguments=2;',
  'function f(a,a){return a;}',
  '"use strict";var eval=1;',
  'function f(a,a){"use strict";}',
  'function f(){"use strict";}function g(eval){}',
  'class C{m(eval){}}',
  'var let=0;let=1;let++;',
  'let let;',
  '"use strict";var x=1;',
  '({m(a,a){}});',
  'let key="m";({[key](a,a){}});',
  '({m:function(a,a){return a;}});',
  '({m(a){return function(b,b){return b;};}});',
  '({m(x=super.x){return ()=>super[x];}});',
  '({get x(){return super.x;},set x(v){super.x=v;}});',
  'class C{m(){return super.x;}x=super.x;}',
  'super.x;',
  '({m(){return function(){return super.x;};}});',
  '({m(){function f(x=super.x){} }});',
  '({[super.x](){}});',
  '({m(){return super?.x;}});',
  'class B extends A{constructor(){super();}}',
  'class B extends A{constructor(x=super()){}}',
  'class B extends A{constructor(){(()=>super())();}}',
  'class B{constructor(){super();}}',
  'class B extends A{m(){super();}}',
  'class B extends A{x=super();}',
  'class B extends A{constructor(){function f(){super();}}}',
  'function f(x=new.target){return ()=>new.target;}',
  'class C{x=new.target;static x=new.target;m(){return new.target;}}',
  'new.target;',
  '()=>new.target;',
  'class C{[new.target](){}}',
  'function f(){new.other;}',
  'class C{static{this.x=new.target;}}',
  'function f(){class C{static{return;}}}',
  'while(true){class C{static{break;}}}',
  'class C extends B{static{super();}}',
  'class C{static{function f(){return 42;}}}',
  'class C{static{await;}}',
  'class C{static{var await;}}',
  'class C{static{(()=>await);}}',
  'class C{static{function f(await){return await;}}}',
  'class C{static{class D{[await](){}}}}',
  'class C{static{class D{x=await;}}}',
 ];
 const valid:readonly boolean[]=[true,true,false,false,true,false,true,false,true,false,false,true,true,true,true,true,false,false,false,false,false,true,true,true,false,false,false,false,true,true,false,false,false,false,true,false,false,false,true,false,false,true,true,false,true];
 for(let i=0;i<cases.length;i++){
  const text=cases[i];if(text===undefined)throw "fixture source";
  const bytes=new TextEncoder().encode(text),source=createSourceText(bytes,bytes.length);
  if(!source.ok)return 1;
  const parsed=parseScript(source.value);
  if(parsed.ok!==valid[i])return 2;
  if((i===9||i===10)&&!parsed.ok&&(parsed.error.code!=="SYNTAX_ERROR"||parsed.error.message!=="duplicate parameter"))return 8;
  if(parsed.ok&&parsed.value.strict!==(i===8))return 3;
  if(i===0&&parseStrictScript(source.value).ok)return 4;
  if(i===4&&parsed.ok){
   const first=parsed.value.statements[0],second=parsed.value.statements[1];
   if(first===undefined||second===undefined)return 5;
   if(first.kind!=="function"||second.kind!=="function")return 6;
   if(first.strict!==true||second.strict!==false)return 7;
  }
 }
 return 42;
}
`,
  "script-modes",
  [
    ["syntax", "packages/typescript/src/syntax/index.ts"],
    ["source", "packages/source/src/text.ts"],
  ],
);
