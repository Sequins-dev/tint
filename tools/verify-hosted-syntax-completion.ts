import { verifyHostedFixture } from "./hosted-fixture.ts";
verifyHostedFixture(
  `
import {createSourceText,type SourceText} from "source";
import {parseScript,parseModule} from "syntax";
function source(text:string):SourceText {const bytes=new TextEncoder().encode(text);const result=createSourceText(bytes,bytes.length);if(!result.ok)throw 91;return result.value;}
export function run():number {
 if(!parseScript(source("for(var x=init() in source){}")).ok)return 1;
 if(!parseScript(source("label: function f(){}")).ok)return 2;
 if(!parseScript(source("({async 3n(){},async* 4n(){},get 5n(){}})")).ok)return 3;
 if(!parseScript(source("if(x)function f(){}")).ok)return 4;
 if(!parseScript(source("f()=1;f()++;")).ok)return 5;
 if(!parseScript(source("<!-- comment\\nlet x=010;")).ok)return 6;
 if(!parseScript(source("\\"\\\\1\\";")).ok)return 7;
 if(!parseScript(source("{using resource=value;}")).ok)return 8;
 if(!parseScript(source("for(using of=null;;){}")).ok)return 9;
 if(!parseScript(source("@decorate class C {@decorate accessor x=1;}")).ok)return 10;
 if(!parseScript(source("let \\u088f=1;")).ok)return 11;
 if(!parseModule(source("await value;for await(const x of xs){}")).ok)return 12;
 if(!parseModule(source("import.source(\\"x\\");import.defer(\\"x\\");")).ok)return 13;
 if(!parseModule(source("import source data from \\"x\\";")).ok)return 14;
 if(!parseModule(source("import defer * as ns from \\"x\\";")).ok)return 15;
 if(!parseModule(source("import data from \\"x\\" with {type:\\"json\\"};")).ok)return 16;
 if(!parseModule(source("export default async function*(){}")).ok)return 17;
 if(!parseModule(source("await using resource=value;")).ok)return 18;
 if(parseScript(source("\\"use strict\\";for(var x=1 in xs){}")).ok)return 19;
 if(parseScript(source("\\"use strict\\";label:function f(){}")).ok)return 20;
 if(parseScript(source("\\"use strict\\";010;")).ok)return 21;
 if(parseScript(source("\\"use strict\\";\\"\\\\1\\";")).ok)return 22;
 if(parseScript(source("for(let x=1 in xs){}")).ok)return 23;
 if(parseScript(source("import.meta;")).ok)return 24;
 return 42;
}`,
  "syntax-completion",
  [
    ["source", "packages/source/src/text.ts"],
    ["syntax", "packages/typescript/src/syntax/index.ts"],
  ],
);
