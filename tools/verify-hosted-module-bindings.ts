import { verifyHostedFixture } from "./hosted-fixture.ts";
verifyHostedFixture(
  `
import {createSourceText} from "source";
import {parseModule} from "syntax";
import {bindJavaScriptModule} from "binding";
function outcome(text:string):string {
 const bytes=new TextEncoder().encode(text),source=createSourceText(bytes,bytes.length);
 if(!source.ok)return "source";
 const parsed=parseModule(source.value,"javascript");if(!parsed.ok)return parsed.error.code;
 const bound=bindJavaScriptModule(parsed.value);return bound.ok?"accepted":bound.error.code;
}
export function run():number {
 if(outcome("export default 1;export default 2;")!=="DUPLICATE_NAME")return 1;
 if(outcome("class F{}export default function F(){}")!=="DUPLICATE_NAME")return 2;
 if(outcome("let F;export default async function* F(){}")!=="DUPLICATE_NAME")return 3;
 if(outcome("export default function F(){F=1;}export {F};")!=="accepted")return 4;
 if(outcome("export default (function F(){});export {F};")!=="INVALID_CONTEXT")return 5;
 if(outcome("export default class C{}export {C};")!=="accepted")return 6;
 if(outcome("class C extends () => {} {}")!=="SYNTAX_ERROR")return 7;
 if(outcome("export default;")!=="SYNTAX_ERROR")return 8;
 return 42;
}
`,
  "module-bindings",
  [
    ["source", "packages/source/src/text.ts"],
    ["syntax", "packages/typescript/src/syntax/index.ts"],
    ["binding", "packages/typescript/src/binding/index.ts"],
  ],
);
