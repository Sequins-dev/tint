import { verifyHostedFixture } from "./hosted-fixture.ts";
verifyHostedFixture(
  `
import {scan,parseStrictScript} from "syntax";
import {bindStrictScript} from "binding";
import {createSourceText} from "source";
export function run():number {
 const inputs:readonly string[]=["#x","#π","#𐐀","#constructor","#default","#"," # x","#1"];
 const expected:readonly string[]=["#x","#π","#𐐀","#constructor","#default","","",""];
 for(let i=0;i<inputs.length;i++){
  const text=inputs[i];if(text===undefined)throw "INPUT";
  const bytes=new TextEncoder().encode(text),source=createSourceText(bytes,bytes.length);
  if(!source.ok)return 1;
  const result=scan(source.value);
  if(i<5){
   if(!result.ok)return 2;
   const token=result.value[0];
   if(token===undefined||token.kind!=="private-identifier"||token.value!==expected[i])return 3;
   if(token.start!==0||token.end!==text.length)return 4;
  }else if(result.ok||result.error.code!=="LEXICAL_ERROR")return 5;
 }
 const programs:readonly string[]=[
  "class C{#x=42;m(o){return o.#x;}has(o){return #x in o;}}",
  "class C{get #x(){return 1;}set #x(v){}}",
  "class C{#x;m(){return class D{m(o){return o.#x;}};}}",
  "class C{#x;#x;}",
  "class C{get #x(){return 1;}static set #x(v){}}",
  "class C{m(o){return o.#missing;}}",
  "class C extends (class{m(o){return o.#x;}}){#x;}",
 ];
 for(let i=0;i<programs.length;i++){
  const text=programs[i];if(text===undefined)throw "INPUT";
  const bytes=new TextEncoder().encode(text),source=createSourceText(bytes,bytes.length);
  if(!source.ok)return 6;
  const parsed=parseStrictScript(source.value);if(!parsed.ok)return 7;
  const bound=bindStrictScript(parsed.value);if(bound.ok!==(i<3))return 8;
 }
 return 42;
}
`,
  "private-syntax",
  [
    ["syntax", "packages/typescript/src/syntax/index.ts"],
    ["source", "packages/source/src/text.ts"],
    ["binding", "packages/typescript/src/binding/index.ts"],
  ],
);
