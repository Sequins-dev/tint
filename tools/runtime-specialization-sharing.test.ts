import { test } from "node:test";
import assert from "node:assert/strict";
import {
  testWorkspaceModules,
  collectionFixtureLocations,
  numericFixtureLocations,
} from "./test-workspace-modules.ts";
import { createSourceTextView } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import { bindModule } from "@tint/typescript/binding";
import { checkClosureModule } from "@tint/typescript/checker";
import { linkModules, specializeModule } from "@tint/ts-native/modules";
import { prepareCollectionRuntimes } from "@tint/ts-native/runtime";
import { createManagedTypeContractIndex } from "@tint/compiler/native";
import type { Type } from "@tint/typescript/types";
const globals = [
  "undefined",
  "NaN",
  "Infinity",
  "Number",
  "String",
  "Math",
  "Map",
  "Set",
  "Uint8Array",
  "Float64Array",
  "Uint32Array",
];
function prepare(body: string, limit = 48) {
  const names = [
    "key-index",
    "number-list",
    "linked-map",
    "number-key-map",
    "string-key-map",
    "sparse-list",
    "linked-set",
    "primitive-value",
    "number-text",
    "indexed-sort",
    "list-sort",
  ];
  const parsed = parseModule(
    createSourceTextView(names.map((n) => `import "${n}";`).join("") + body),
  );
  assert.ok(parsed.ok);
  const modules = testWorkspaceModules(
    names,
    (text) => text,
    new Map([...collectionFixtureLocations, ...numericFixtureLocations]),
  );
  modules.push({
    id: "main",
    module: parsed.value,
    dependencies: new Map(names.map((n) => [n, n])),
  });
  const linked = linkModules(modules, "main", globals, {
    evaluation: "instance",
  });
  assert.ok(linked.ok, JSON.stringify(linked));
  const bound = bindModule(linked.value.module, globals);
  assert.ok(bound.ok);
  const source = specializeModule(linked.value.module, bound.value);
  assert.ok(source.ok);
  const checked = checkClosureModule(source.value.module);
  assert.ok(checked.ok, JSON.stringify(checked));
  const helpers = new Map(
    linked.value.exports
      .filter((e) => e.namespace === "value")
      .map((e) => [e.module + ":" + e.name, e.linkedName]),
  );
  return prepareCollectionRuntimes(
    linked.value.module,
    checked.value,
    helpers,
    globals,
    undefined,
    limit,
    (types: readonly Type[]) => {
      const index = createManagedTypeContractIndex(types);
      assert.ok(index.ok, JSON.stringify(index));
      return (left: number, right: number): boolean => {
        const result = index.value.matches(left, right);
        assert.ok(result.ok, JSON.stringify(result));
        return result.value;
      };
    },
  );
}
const left = "interface Left{value:number;next:Left|undefined;}";
test("exact recursive collection aliases share specialization work within the original budget", () => {
  const single = prepare(
    left + "function run(a:Left[]):number{return a.length;}",
  );
  assert.ok(single.ok, JSON.stringify(single));
  const both = prepare(
    left +
      "interface Right{value:number;next:Right|undefined;}function run(a:Left[],b:Right[]):number{return a.length+b.length;}",
  );
  assert.ok(both.ok, JSON.stringify(both));
});
test("collection sharing preserves ordered fields, mutability and optionality", () => {
  for (const fields of [
    "next:Right|undefined;value:number;",
    "readonly value:number;next:Right|undefined;",
    "value:number;next?:Right;",
  ]) {
    const distinct = prepare(
      left +
        `interface Right{${fields}}function run(a:Left[],b:Right[]):number{return a.length+b.length;}`,
    );
    assert.equal(distinct.ok, false, fields);
    if (!distinct.ok) assert.match(distinct.error, /specialization.*limit/);
  }
});
test("sharing receives a valid graph for a Map whose stored value is undefined", () => {
  const result = prepare(
    'function run():number{const values=new Map<string,undefined>();values.set("empty",undefined);return values.size;}',
    256,
  );
  assert.ok(result.ok, JSON.stringify(result));
});
