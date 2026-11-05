import { verifyHostedFixture } from "./hosted-fixture.ts";
verifyHostedFixture(
  `
import {createSourceTextView} from "source";
import {parseModule} from "syntax";
import {checkClosureModule} from "checker";
import {managedDirectCallDeclarations,reifyManagedSurfaceTypes,adaptManagedSurfaceEntry} from "compiler";
function count(text:string):number {
 const parsed=parseModule(createSourceTextView(text));if(!parsed.ok)return -1;
 const checked=checkClosureModule(parsed.value);if(!checked.ok)return -2;
 const root=checked.value.bindings.functions[0];if(root===undefined)return -3;
 const result=managedDirectCallDeclarations(checked.value,root.id);if(!result.ok)return -4;
 if(managedDirectCallDeclarations(checked.value,999).ok)return -5;
 return result.value.length;
}
export function run():number {
 if(count('function wrapper():number{function first(n:number):number{return n===0?42:first(n-1);}function second():number{return first(2);}return second();}')!==2)return 1;
 if(count('function wrapper():number{function execute():number{return 42;}const record={scriptOrModule:execute};return record.scriptOrModule();}')!==0)return 2;
 if(count('function wrapper():number{function execute():number{return 42;}function take(f:()=>number):number{return f();}return take(execute);}')!==1)return 3;
 if(count('function wrapper():()=>number{return ()=>42;}')!==0)return 4;
 const schema=parseModule(createSourceTextView('interface Box{readonly value:number;}function read(box:Box):number{return box.value;}function add(a:number,b:number):number{return a+b;}'));if(!schema.ok)return 5;
 const checkedSchema=checkClosureModule(schema.value);if(!checkedSchema.ok)return 6;
 const surface=reifyManagedSurfaceTypes(checkedSchema.value,[{name:"read",local:"read"},{name:"add",local:"add"}],"$Surface",[{name:"Box",local:"Box"}]);if(!surface.ok)return 7;
 const source=parseModule(createSourceTextView('import {read} from "objects";import {add} from "values";import {Box} from "types";export function execute(box:Box):number{return add(read(box),23);}'));if(!source.ok)return 8;
 const adapted=adaptManagedSurfaceEntry(source.value,"execute",["objects","values","types"],surface.value);if(!adapted.ok)return 9;
 const checkedEntry=checkClosureModule(adapted.value.module);if(!checkedEntry.ok)return 10;
 const declaration=checkedEntry.value.module.statements.find(statement => statement!==undefined&&statement.kind==="function"&&statement.name===adapted.value.entry);
 if(declaration===undefined)return 11;
 const wrapper=checkedEntry.value.bindings.functions.find(fn => fn!==undefined&&fn.node===declaration);if(wrapper===undefined)return 12;
 const proof=managedDirectCallDeclarations(checkedEntry.value,wrapper.id);if(!proof.ok||proof.value.length!==1)return 13;
 if(adaptManagedSurfaceEntry(source.value,"execute",["objects","values"],surface.value).ok)return 14;
 return 42;
}`,
  "managed-closure-uses",
  [
    ["source", "packages/source/src/text.ts"],
    ["syntax", "packages/typescript/src/syntax/index.ts"],
    ["checker", "packages/typescript/src/checker/index.ts"],
    ["compiler", "packages/compiler/src/native/index.ts"],
  ],
);
