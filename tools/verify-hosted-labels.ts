import { emitDarwinModule } from "./aarch64-executable.ts";
import assert from "node:assert/strict";
import { createSourceText } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import { checkModule } from "@tint/typescript/checker";
import { lowerModule } from "@tint/ts-native/scalar";

import { verifyHostedFixture } from "./hosted-fixture.ts";

// Compare native compiler output with the Node bootstrap, including label-target
// mutation and jumps through nested loops. The native fixture executes the same
// source as well, so byte parity is accompanied by a semantic check.
const program = `function labelledResult():number {
  let total=0;
  outer: for(let i=0;i<3;i++) {
    for(let j=0;j<3;j++) {
      if(j===1) continue outer;
      total++;
    }
  }
  done: { total+=39; break done; total=0; }
  return total;
}`;
const bytes = new TextEncoder().encode(program);
const source = createSourceText(bytes, bytes.length);
assert.ok(source.ok);
const parsed = parseModule(source.value);
assert.ok(parsed.ok);
const checked = checkModule(parsed.value);
assert.ok(checked.ok);
const lowered = lowerModule(checked.value);
assert.ok(lowered.ok);
const emitted = emitDarwinModule(lowered.value);
assert.ok(emitted.ok);

verifyHostedFixture(
  `import {createSourceText} from "source";
import {parseModule} from "syntax";
import {checkModule} from "checker";
import {lowerModule} from "lowering";
import {emitModule} from "emitter";
${program}
export function run():number {
 if(labelledResult()!==42)return 1;
 const bytes=new TextEncoder().encode(${JSON.stringify(program)});
 const source=createSourceText(bytes,bytes.length);if(!source.ok)return 2;
 const parsed=parseModule(source.value);if(!parsed.ok)return 3;
 const checked=checkModule(parsed.value);if(!checked.ok)return 4;
 const lowered=lowerModule(checked.value);if(!lowered.ok)return 5;
 const emitted=emitModule(lowered.value);if(!emitted.ok)return 6;
 const expected:number[]=${JSON.stringify([...emitted.value.code])};
 if(emitted.value.code.length!==expected.length)return 7;
 for(let i=0;i<expected.length;i++)if(emitted.value.code[i]!==expected[i])return 8;
 return 42;
}`,
  "labels",
  [
    ["source", "packages/source/src/text.ts"],
    ["syntax", "packages/typescript/src/syntax/index.ts"],
    ["checker", "packages/typescript/src/checker/index.ts"],
    ["lowering", "packages/ts-native/src/scalar.ts"],
    ["emitter", "packages/codegen/src/aarch64/scalar/index.ts"],
  ],
);
