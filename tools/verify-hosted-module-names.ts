import assert from "node:assert/strict";
import { createSourceText } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import type { SourceModule } from "@tint/typescript/modules/model";
import { verifyHostedFixture } from "./hosted-fixture.ts";
function module(
  id: string,
  text: string,
  dependencies: readonly [string, string][] = [],
): SourceModule {
  const bytes = new TextEncoder().encode(text),
    source = createSourceText(bytes, bytes.length);
  assert.ok(source.ok);
  const parsed = parseModule(source.value);
  assert.ok(parsed.ok, JSON.stringify(parsed));
  return { id, module: parsed.value, dependencies: new Map(dependencies) };
}
const dep = 'const value:number=42;export {value as "*"};';
const bridge = 'export {"*" as "x-y"} from "dep";';
verifyHostedFixture(
  `
import {"x-y" as compiledValue} from "bridge";
import {createSourceText} from "source";
import {parseModule,type Module} from "syntax";
import {linkModules} from "linking";
import type { SourceModule } from "@tint/typescript/modules/model";
function parse(text:string):Module {
 const bytes=new TextEncoder().encode(text),source=createSourceText(bytes,bytes.length);
 if(!source.ok)throw 91;
 const parsed=parseModule(source.value);if(!parsed.ok)throw 92;
 return parsed.value;
}
export function run():number {
 const dependencies=new Map<string,string>();dependencies.set("dep","dep");
 const modules:SourceModule[]=[
  {id:"dep",module:parse(${JSON.stringify(dep)}),dependencies:new Map<string,string>()},
  {id:"bridge",module:parse(${JSON.stringify(bridge)}),dependencies}
 ];
 const linked=linkModules(modules,"bridge",[]);if(!linked.ok)return 1;
 const star=linked.value.exports.find(e=>e!==undefined&&e.module==="dep"&&e.name==="*");
 const alias=linked.value.exports.find(e=>e!==undefined&&e.module==="bridge"&&e.name==="x-y");
 if(star===undefined||alias===undefined||star.linkedName!==alias.linkedName)return 2;
 const ns=parse('export * as ns from "dep";').statements[0];
 if(ns===undefined||ns.kind!=="export")return 3;
 const bindings=ns.declaration.bindings;if(bindings===undefined)return 4;
 const binding=bindings[0];if(binding===undefined||!binding.namespace)return 5;
 return compiledValue;
}`,
  "module-names",
  [
    ["bridge", "bridge"],
    ["source", "packages/source/src/text.ts"],
    ["syntax", "packages/typescript/src/syntax/index.ts"],
    ["linking", "packages/ts-native/src/modules/index.ts"],
    [
      "@tint/typescript/modules/model",
      "packages/typescript/src/modules/model.ts",
    ],
  ],
  [module("dep", dep), module("bridge", bridge, [["dep", "dep"]])],
);
