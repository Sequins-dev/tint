import { verifyHostedFixture } from "./hosted-fixture.ts";

// Runs class declaration-contract resolution natively, not class execution.
verifyHostedFixture(
  `
import {createSourceText} from "source";
import {parseModule} from "syntax";
import {linkModules} from "linking";
import type { SourceModule } from "@tint/typescript/modules/model";
import {resolveInterfaceTypes,checkClosureModule} from "checker";
export function run():number {
 const bytes=new TextEncoder().encode("export class Box<T>{value:T;static version:number=1;constructor(value:T){this.value=value;}self():Box<T>{return this;}}type NumberBox=Box<number>;type StringBox=Box<string>;");
 const source=createSourceText(bytes,bytes.length);if(!source.ok)return 1;
 const parsed=parseModule(source.value);if(!parsed.ok)return 2;
 const modules:SourceModule[]=[{id:"main",module:parsed.value,dependencies:new Map<string,string>()}];
 const linked=linkModules(modules,"main",[],{evaluation:"instance"});if(!linked.ok)return 3;
 const resolved=resolveInterfaceTypes(linked.value.module);if(!resolved.ok)return 4;
 const classes=resolved.value.classes,system=resolved.value.system;
 if(classes.length!==2)return 5;
 for(const contract of classes){
  if(contract===undefined)return 6;
  const argument=contract.arguments[0];if(argument===undefined)return 7;
  const made=system.construct(contract.constructor,[argument]);if(!made.ok||made.value!==contract.instance)return 8;
  if(system.call(contract.constructor,[argument]).ok)return 9;
  const field=system.property(contract.instance,"value");if(!field.ok||field.value!==argument)return 10;
  const method=system.property(contract.instance,"self");if(!method.ok)return 11;
  const self=system.call(method.value,[],contract.instance);if(!self.ok||self.value!==contract.instance)return 12;
  if(system.call(method.value,[]).ok)return 13;
  const prototype=system.property(contract.constructor,"prototype");if(!prototype.ok||prototype.value!==contract.prototype)return 14;
  if(system.property(contract.prototype,"value").ok)return 23;
  const parent=system.property(contract.prototype,"constructor");if(!parent.ok||parent.value!==contract.constructor)return 24;
  if(system.property(contract.instance,"version").ok||system.property(contract.constructor,"value").ok)return 15;
 }
 const callBytes=new TextEncoder().encode("interface V{x:number;}function run(C:new(f:(x:number)=>number)=>V):number{return new C((x)=>x+1).x;}");
 const callSource=createSourceText(callBytes,callBytes.length);if(!callSource.ok)return 16;
 const callParsed=parseModule(callSource.value);if(!callParsed.ok)return 17;
 const callChecked=checkClosureModule(callParsed.value);if(!callChecked.ok)return 18;
 const badBytes=new TextEncoder().encode("function run(C:()=>number):number{return new C();}");
 const badSource=createSourceText(badBytes,badBytes.length);if(!badSource.ok)return 19;
 const badParsed=parseModule(badSource.value);if(!badParsed.ok)return 20;
 const badChecked=checkClosureModule(badParsed.value);if(badChecked.ok)return 21;
 if(badChecked.error.message!=="callee must have a construct signature")return 22;
 return 42;
}
`,
  "class-contracts",
  [
    ["source", "packages/source/src/text.ts"],
    ["syntax", "packages/typescript/src/syntax/index.ts"],
    ["linking", "packages/ts-native/src/modules/index.ts"],
    [
      "@tint/typescript/modules/model",
      "packages/typescript/src/modules/model.ts",
    ],
    ["checker", "packages/typescript/src/checker/index.ts"],
  ],
);
