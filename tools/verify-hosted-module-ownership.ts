import assert from "node:assert/strict";
import { createSourceTextView } from "@tint/source/text";
import { parseModule, rewriteModule } from "@tint/typescript/syntax";
import { bindModule } from "@tint/typescript/binding";
import { prepareModuleInstance } from "@tint/ts-native/modules";
import { verifyHostedFixture } from "./hosted-fixture.ts";
const parsed = parseModule(
  createSourceTextView(
    "let count=40;function helper():number{return 1;}function run():number{return ++count+helper();}",
  ),
);
assert.ok(parsed.ok);
const generated = rewriteModule(parsed.value, {
  statement: (node) => ({ ...node, start: 0, end: 0, nodeHash: 0 }),
  expression: (node) => ({ ...node, start: 0, end: 0, nodeHash: 0 }),
  type: (node) => ({ ...node, start: 0, end: 0, nodeHash: 0 }),
});
const bound = bindModule(generated);
assert.ok(bound.ok);
const prepared = prepareModuleInstance(
  generated,
  bound.value,
  [{ name: "run", local: "run" }],
  ["helper"],
);
assert.ok(prepared.ok, JSON.stringify(prepared));
verifyHostedFixture(
  `import {${prepared.value.initializer.name} as initialize} from "generated";
export function run():number{
 const first=initialize(),second=initialize();
 if(first.run()!==42||first.run()!==43||second.run()!==42)return 1;
 for(let i=0;i<640;i++){const garbage=new Uint32Array(8192);garbage[0]=i;if(garbage[0]!==i)return 2;}
 if(first.run()!==44||second.run()!==43)return 3;
 return 42;
}`,
  "module-ownership",
  [["generated", "generated"]],
  [{ id: "generated", module: prepared.value.module, dependencies: new Map() }],
  [],
  [{ module: "generated", namespace: "generated-ownership" }],
  {
    runtimeEntry: "initializeGenerationalRuntime",
    managedBytes: 8388608,
    allocationCapacity: 262144,
    rootCapacity: 4096,
    stackBytes: 8388608,
  },
);
