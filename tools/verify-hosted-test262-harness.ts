import assert from "node:assert/strict";
import { resolve } from "node:path";
import { createSourceText } from "@tint/source/text";
import { parseStrictScript } from "@tint/typescript/syntax";
import { lowerStrictScript } from "@tint/js-engine/lowering";
import type { SourceModule } from "@tint/typescript/modules/model";
import { test262Source } from "./test262-checkout.ts";
import { verifyHostedFixture } from "./hosted-fixture.ts";

// Integration evidence only: these probes are not Test262 test cases or passes.
const root = resolve(process.env.TEST262_DIR ?? ".tint-bootstrap/test262");
const scripts = ["assert.js", "sta.js"].map((name) => {
  const source = test262Source(resolve(root, "harness", name));
  console.log(JSON.stringify({ harness: name, sha256: source.sha256 }));
  return source.source;
});
scripts.push(`
assert(true);
assert.sameValue(42, 42);
assert.sameValue(NaN, NaN);
assert.notSameValue(0, -0);
assert.throws(Test262Error, function () { throw new Test262Error('probe'); });
var a = {length: 2}; a[0] = 1; a[1] = 2;
var b = {length: 2}; b[0] = 1; b[1] = 2;
assert.compareArray(a, b);
b[1] = 3; assert.sameValue(compareArray(a, b), false);
var caught = false;
try { assert(false, 'intentional failure'); }
catch (error) {
  caught = error instanceof Test262Error && error.message === 'intentional failure';
}
assert(caught, 'assertion failures must throw Test262Error');
42;
`);
const generated: SourceModule[] = scripts.map((script, index) => {
  const bytes = new TextEncoder().encode(script);
  const source = createSourceText(bytes, bytes.length);
  assert.ok(source.ok);
  const parsed = parseStrictScript(source.value);
  assert.ok(parsed.ok, JSON.stringify(parsed));
  const lowered = lowerStrictScript(parsed.value);
  assert.ok(lowered.ok, JSON.stringify(lowered));
  return {
    id: "script" + index,
    module: lowered.value,
    dependencies: new Map([
      [
        "@tint/js-runtime/environments/global",
        "packages/js-runtime/src/environments/global/index.ts",
      ],
      [
        "@tint/js-runtime/environments/records",
        "packages/js-runtime/src/environments/records/index.ts",
      ],
      ["@tint/js-runtime/objects", "packages/js-runtime/src/objects/index.ts"],
    ]),
  };
});
verifyHostedFixture(
  `
import {execute as assertions} from "script0";
import {execute as errors} from "script1";
import {execute as probe} from "script2";
import {createGlobalEnvironment} from "global";
import {createScriptRecord,type ScriptPropertyKey,createObject,createErrorRealm,installErrorIntrinsics,installGlobalProperties,callObjectValue,sameValue,type ObjectHooks} from "object";
export function run():number {
  const object=createObject<ScriptPropertyKey,unknown>(undefined);
  const hooks:ObjectHooks<unknown>={undefinedValue:undefined,sameValue:(a,b):boolean=>sameValue(a,b),call:(callee,receiver,args):unknown=>{
    const result=callObjectValue(callee,receiver,args,object);
    if(result.error!=="none")throw "HARNESS_CALL_FAILED";
    return result.value;
  }};
  installGlobalProperties(object,object,hooks);
  const global=createGlobalEnvironment<ScriptPropertyKey,unknown>(object,object,object,(name:string):ScriptPropertyKey=>name,hooks);
  const realm=createErrorRealm(createObject<ScriptPropertyKey,unknown>(undefined),hooks);
 installErrorIntrinsics(object,realm,hooks);
  if(assertions(global,createScriptRecord(realm,undefined)).error!=="none")return 1;
  if(errors(global,createScriptRecord(realm,undefined)).error!=="none")return 2;
  const result=probe(global,createScriptRecord(realm,undefined));
  if(result.error!=="none")return 3;
  return result.value===42?42:4;
}
`,
  "test262-harness",
  [
    ["global", "packages/js-runtime/src/environments/global/index.ts"],
    ["object", "packages/js-runtime/src/objects/index.ts"],
    ...generated.map((module): [string, string] => [module.id, module.id]),
  ],
  generated,
  [
    {
      module: "packages/js-runtime/src/objects/index.ts",
      name: "viewObjectValue",
      operation: "view",
    },
    {
      module: "packages/js-runtime/src/objects/index.ts",
      name: "viewSymbolValue",
      operation: "view",
    },
    {
      module: "packages/js-runtime/src/objects/index.ts",
      name: "viewBigIntValue",
      operation: "view",
    },
  ],
  [
    {
      module: "packages/js-runtime/src/objects/index.ts",
      namespace: "ordinary-object",
      retainedExports: [
        "viewObjectValue",
        "viewSymbolValue",
        "viewBigIntValue",
      ],
    },
  ],
);
