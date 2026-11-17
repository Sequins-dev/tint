import { nativeFixtureTarget } from "./native-host-target.ts";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NativeImageRunner } from "./test262-native-process.ts";
import { workspaceModules } from "./workspace-sources.ts";
import { projectRoots, projectBuildRequest } from "@tint/compiler/cli";
import { createSourceText } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import { buildMacOSProgram } from "@tint/compiler/build";
const bytes = new TextEncoder()
  .encode(`import {createTypeSystem,type Type} from "@tint/typescript/types";
import {createSourceText} from "@tint/source/text";
import {parseModule} from "@tint/typescript/syntax";
import {resolveInterfaceTypes} from "interfaces";
import {checkClosureModule} from "closures";
import {write} from "file-host";
function resolve(text:string):number {
 const bytes=new TextEncoder().encode(text), source=createSourceText(bytes,bytes.length);
 if(!source.ok)return 6;
 const parsed=parseModule(source.value);
 if(!parsed.ok)return 7;
 const resolved=resolveInterfaceTypes(parsed.value);
 if(!resolved.ok){write(2,new TextEncoder().encode(resolved.error.message+"\\n"));return 8;}
 const checked=checkClosureModule(parsed.value);
 if(!checked.ok){write(2,new TextEncoder().encode(checked.error.message+"\\n"));return 9;}
 return 42;
}
export function run():number{
 const types:Type[]=[{kind:"number"},{kind:"boolean"},{kind:"undefined"},{kind:"string"},{kind:"Uint32Array"},{kind:"void"},{kind:"Uint8Array"},{kind:"Uint16Array"},{kind:"Float64Array"},{kind:"null"},{kind:"ArrayBuffer"},{kind:"TypeError"},{kind:"RangeError"}];
 if(!createTypeSystem(types).ok)return 1;
 types.push({kind:"union",members:[0,2]});
 if(!createTypeSystem(types).ok)return 2;
 types.push({kind:"function",parameters:[0],minimumArguments:1,result:13});
 if(!createTypeSystem(types).ok)return 3;
 types.push({kind:"object",properties:[{name:"allocate",type:14,readonly:true}]});
 if(!createTypeSystem(types).ok)return 4;
 if(resolve("const a=4;const b=8;function f(flag:boolean):number{return (flag?a:b)|16;}")!==42)return 10;
 if(resolve("function f(flag:boolean):4|8{const a:4=4;const b:8=8;const result=flag?a:b;return result;}")!==42)return 11;
 if(resolve('function accept(v:"day"|"week"):number{return 1;}function f(v:string):number{if(v!=="day"&&v!=="week")return 0;return accept(v);}')!==42)return 12;
 if(resolve('function accept(v:42):number{return v;}function f(v:number):number{if(42===v)return accept(v);return 0;}')!==42)return 13;
 if(resolve(${JSON.stringify("function f(value:number):number{if(" + Array.from({ length: 80 }, (_, i) => "value===" + i).join("||") + ")return value;return 0;}")})!==42)return 14;
 return resolve(${JSON.stringify(readFileSync("packages/native-runtime/src/allocators/region/index.ts", "utf8"))});
}`);
const source = createSourceText(bytes, bytes.length);
assert.ok(source.ok);
const parsed = parseModule(source.value);
assert.ok(parsed.ok, JSON.stringify(parsed));
const modules = [...workspaceModules(projectRoots())];
modules.push({
  id: "fixture",
  module: parsed.value,
  dependencies: new Map([
    ["@tint/typescript/types", "packages/typescript/src/types/index.ts"],
    ["@tint/source/text", "packages/source/src/text.ts"],
    ["@tint/typescript/syntax", "packages/typescript/src/syntax/index.ts"],
    ["interfaces", "packages/typescript/src/checker/interfaces.ts"],
    ["closures", "packages/typescript/src/checker/closures.ts"],
    ["file-host", "packages/native-runtime/src/intrinsics/fs.ts"],
  ]),
});
const built = buildMacOSProgram({
  target: nativeFixtureTarget(),
  ...projectBuildRequest(modules, () => {}),
  entry: "fixture",
  start: "run",
  managedBytes: 67108864,
  // Generational forwarding metadata must cover every semispace allocation unit.
  allocationCapacity: 1048576,
  rootCapacity: 65536,
  stackBytes: 16777216,
  identifier: "tint-hosted-checker",
  debugSymbols: process.env.TINT_DEBUG_SYMBOLS === "1",
});
assert.ok(built.ok, JSON.stringify(built));
const directory = mkdtempSync(join(tmpdir(), "tint-hosted-checker-")),
  path = join(directory, "checker");
writeFileSync(path, built.value, { mode: 0o755 });
console.log(path);
if (process.env.TINT_BUILD_ONLY !== "1")
  try {
    const runner = new NativeImageRunner(built.value, 60000);
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        const outcome = runner.run();
        assert.deepEqual(
          outcome,
          { kind: "completed" },
          JSON.stringify(outcome),
        );
      }
    } finally {
      runner.close();
    }
    console.log(
      "Verified native type graph validation, numeric conditional joins, and closure checking of the allocator source twice.",
    );
  } finally {
    if (process.env.TINT_KEEP_NATIVE !== "1")
      rmSync(directory, { recursive: true, force: true });
  }
