import type { ExecutionPlan } from "./test262-execution.ts";

const syntaxModule = "packages/typescript/src/syntax/index.ts";
const bindingModule = "packages/typescript/src/binding/index.ts";
const sourceModule = "packages/source/src/text.ts";

/** The test text is data in the native image. It is never parsed as part of the
 * bootstrap host or executed, even if the native parser incorrectly accepts it. */
export function nativeSyntaxHost(plan: ExecutionPlan): string {
  return nativeSyntaxVerdictSource(
    new TextEncoder().encode(plan.source),
    plan.goal,
  );
}
export function nativeSyntaxVerdictSource(
  bytes: Uint8Array,
  goal: ExecutionPlan["goal"],
): string {
  return `import {createSourceText} from "source";
import {parseScript,parseModule} from "syntax";
import {validateJavaScriptBindings} from "binding";
export function run():number {
 const data:number[]=[${Array.from(bytes).join(",")}];
 const bytes=new Uint8Array(data.length);
 for(let i=0;i<data.length;i++)bytes[i]=data[i]??0;
 const source=createSourceText(bytes,bytes.length);
 if(!source.ok)return 10;
 const parsed=${goal === "module" ? 'parseModule(source.value,"javascript")' : "parseScript(source.value)"};
 if(!parsed.ok){
  if(parsed.error.code==="SYNTAX_ERROR"||parsed.error.code==="LEXICAL_ERROR")return 40;
  return 10;
 }
 const error=validateJavaScriptBindings(parsed.value,"${goal}");
 if(error===undefined)return 42;
 if(error.code==="DUPLICATE_NAME"||error.code==="INVALID_CONTEXT")return 40;
 return 10;
}`;
}

export const nativeSyntaxDependencies = new Map([
  ["syntax", syntaxModule],
  ["binding", bindingModule],
  ["source", sourceModule],
]);
