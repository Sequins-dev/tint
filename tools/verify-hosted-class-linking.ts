import { verifyHostedFixture } from "./hosted-fixture.ts";

// Exercises the linker itself in native code; not class runtime conformance.
verifyHostedFixture(
  `
import {createSourceText} from "source";
import {parseModule} from "syntax";
import {bindModule} from "binding";
import {linkModules} from "linking";
import type { SourceModule } from "@tint/typescript/modules/model";
export function run():number {
 const depBytes=new TextEncoder().encode("export class Box<T>{value:T;constructor(value:T){this.value=value;}self():Box<T>{return this;}}");
 const depSource=createSourceText(depBytes,depBytes.length);if(!depSource.ok)return 1;
 const dep=parseModule(depSource.value);if(!dep.ok)return 2;
 const mainBytes=new TextEncoder().encode("import {Box as Item} from 'dep';export function make(value:number):Item<number>{return new Item<number>(value);}function scope<T>(input:T):T{switch(0){case 0:let before:T;break;default:class T{}let after:T;}let outside:T;return input;}");
 const mainSource=createSourceText(mainBytes,mainBytes.length);if(!mainSource.ok)return 3;
 const main=parseModule(mainSource.value);if(!main.ok)return 4;
 const dependencies=new Map<string,string>();dependencies.set("dep","dep");
 const modules:SourceModule[]=[{id:"dep",module:dep.value,dependencies:new Map<string,string>()},{id:"main",module:main.value,dependencies}];
 const linked=linkModules(modules,"main",[],{evaluation:"instance"});if(!linked.ok)return 5;
 const cls=linked.value.module.statements[0];if(cls===undefined||cls.kind!=="class")return 6;
 if(cls.name===cls.definition.name)return 7;
 const method=cls.definition.elements[2];if(method===undefined||method.kind!=="method")return 8;
 const result=method.returnType;if(result===undefined||result.kind!=="named"||result.name!==cls.definition.name)return 9;
 const make=linked.value.module.statements[1];if(make===undefined||make.kind!=="function")return 10;
 const made=make.returnType;if(made===undefined||made.kind!=="named"||made.name!==cls.name)return 11;
 const scope=linked.value.module.statements[2];if(scope===undefined||scope.kind!=="function")return 12;
 const body=scope.body;if(body.kind!=="block")return 13;
 const sw=body.statements[0];if(sw===undefined||sw.kind!=="switch")return 14;
 const first=sw.clauses[0],last=sw.clauses[1];if(first===undefined||last===undefined)return 15;
 const before=first.statements[0],local=last.statements[0];if(before===undefined||before.kind!=="variable"||local===undefined||local.kind!=="class")return 16;
 const decl=before.declarations[0];if(decl===undefined)return 17;
 const annotation=decl.type;if(annotation===undefined||annotation.kind!=="named"||annotation.name!==local.name)return 18;
 const bound=bindModule(linked.value.module);if(!bound.ok)return 19;
 return 42;
}
`,
  "class-linking",
  [
    ["source", "packages/source/src/text.ts"],
    ["syntax", "packages/typescript/src/syntax/index.ts"],
    ["binding", "packages/typescript/src/binding/index.ts"],
    ["linking", "packages/ts-native/src/modules/index.ts"],
    [
      "@tint/typescript/modules/model",
      "packages/typescript/src/modules/model.ts",
    ],
  ],
);
