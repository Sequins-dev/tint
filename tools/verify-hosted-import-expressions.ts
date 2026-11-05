import { verifyHostedFixture } from "./hosted-fixture.ts";
verifyHostedFixture(
  `
import {createSourceText,type SourceText} from "source";
import {parseScript,parseModule,rewriteModule} from "syntax";
import {bindScript} from "binding";
import {lowerScript} from "lowering";
function source(text:string):SourceText {const bytes=new TextEncoder().encode(text);const result=createSourceText(bytes,bytes.length);if(!result.ok)throw 91;return result.value;}
export function run():number {
 const parsed=parseScript(source('import(specifier, options);'));
 if(!parsed.ok)return 1;
 const statement=parsed.value.statements[0];
 if(statement===undefined||statement.kind!=="expression")return 2;
 const expression=statement.expression;
 if(expression.kind!=="import-call"||expression.options===undefined)return 3;
 const bound=bindScript(parsed.value);if(!bound.ok||bound.value.references.length!==2)return 4;
 const lowered=lowerScript(parsed.value);if(lowered.ok||lowered.error.code!=="UNSUPPORTED")return 5;
 const module=parseModule(source('function f(){return import.meta.url;}'),"javascript");if(!module.ok)return 6;
 if(parseScript(source('import.meta;')).ok)return 7;
 if(parseScript(source('import(...args);')).ok)return 8;
 if(parseScript(source('new import("x");')).ok)return 9;
 if(!parseScript(source('import("x",{with:{type:"json"}},);')).ok)return 10;
 const rewritten=rewriteModule(parsed.value,{});
 if(rewritten.statements.length!==1)return 11;
 return 42;
}`,
  "import-expressions",
  [
    ["source", "packages/source/src/text.ts"],
    ["syntax", "packages/typescript/src/syntax/index.ts"],
    ["binding", "packages/typescript/src/binding/index.ts"],
    ["lowering", "packages/js-engine/src/lowering/index.ts"],
  ],
);
