import { test } from "node:test";
import assert from "node:assert/strict";
import { createSourceText } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import { bindModule } from "@tint/typescript/binding";
import { linkModules, specializeModule } from "@tint/ts-native/modules";
import { checkClosureModule } from "@tint/typescript/checker";
import { prepareCollectionRuntimes } from "@tint/ts-native/runtime";
import { lowerModuleEntries } from "@tint/ts-native/closure/lowering";
import { emitModule } from "@tint/codegen/aarch64/scalar";
import {
  collectionFixtureLocations,
  numericFixtureLocations,
  testWorkspaceModules,
} from "./test-workspace-modules.ts";

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
const target = {
  pointerSize: 8,
  wordSize: 8,
  allocationAlignment: 16,
  frameAlignment: 16,
  maxAlignment: 16,
} as const;

function fixture() {
  const names = [
    "number-text",
    "primitive-value",
    "sparse-list",
    "number-list",
    "linked-map",
    "linked-set",
    "list-sort",
    "indexed-sort",
    "key-index",
  ];
  const modules = testWorkspaceModules(
    names,
    undefined,
    new Map([...collectionFixtureLocations, ...numericFixtureLocations]),
  );
  const bytes = new TextEncoder().encode(
    names.map((name) => "import " + JSON.stringify(name) + ";").join("") +
      "export function run(text:string):number{return Number(text);}",
  );
  const source = createSourceText(bytes, bytes.length);
  assert.ok(source.ok);
  const parsed = parseModule(source.value);
  assert.ok(parsed.ok);
  modules.push({
    id: "main",
    module: parsed.value,
    dependencies: new Map(names.map((name) => [name, name])),
  });
  const linked = linkModules(modules, "main", globals, {
    evaluation: "instance",
  });
  assert.ok(linked.ok, JSON.stringify(linked));
  const bound = bindModule(linked.value.module, globals);
  assert.ok(bound.ok, JSON.stringify(bound));
  const specialized = specializeModule(linked.value.module, bound.value);
  assert.ok(specialized.ok, JSON.stringify(specialized));
  const checked = checkClosureModule(specialized.value.module);
  assert.ok(checked.ok, JSON.stringify(checked));
  const helpers = new Map(
    linked.value.exports
      .filter((e) => e.namespace === "value")
      .map((e) => [e.module + ":" + e.name, e.linkedName]),
  );
  const prepared = prepareCollectionRuntimes(
    linked.value.module,
    checked.value,
    helpers,
    globals,
  );
  assert.ok(prepared.ok, JSON.stringify(prepared));
  return prepared.value;
}

test("the unchanged number-text implementation and dependencies lower and emit every function", () => {
  const prepared = fixture();
  const entries = prepared.checked.bindings.functions
    .filter((f) => f.parent === undefined)
    .map((f) => f.id);
  const lowered = lowerModuleEntries(
    prepared.checked,
    entries,
    target,
    4096,
    prepared.options,
  );
  assert.ok(lowered.ok, JSON.stringify(lowered));
  const native = emitModule(lowered.value.module);
  assert.ok(native.ok, JSON.stringify(native));
});

test("Number string calls require an explicit compatible conversion helper", () => {
  const prepared = fixture();
  const checked = prepared.checked;
  const entries = checked.bindings.functions
    .filter((f) => f.parent === undefined)
    .map((f) => f.id);
  const { numberFromString, ...otherOptions } = prepared.options;
  assert.notEqual(numberFromString, undefined);
  const incompatible = prepared.options.numberToString;
  assert.ok(incompatible !== undefined);
  assert.equal(
    lowerModuleEntries(checked, entries, target, 4096, otherOptions).ok,
    false,
  );
  const result = lowerModuleEntries(
    checked,
    entries,
    target,
    4096,
    prepared.options,
  );
  assert.ok(result.ok, JSON.stringify(result));
  assert.ok(emitModule(result.value.module).ok);
  const relocated = lowerModuleEntries(
    checked,
    [...entries].reverse(),
    target,
    4096,
    prepared.options,
  );
  assert.ok(relocated.ok, JSON.stringify(relocated));
  assert.ok(emitModule(relocated.value.module).ok);
  assert.equal(
    lowerModuleEntries(checked, entries, target, 4096, {
      ...prepared.options,
      numberFromString: incompatible,
    }).ok,
    false,
  );
});
