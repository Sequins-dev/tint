import assert from "node:assert/strict";
import test from "node:test";
import { createSourceTextView } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import { bindModule } from "@tint/typescript/binding";
import { linkModules } from "@tint/ts-native/modules";
import { lowerSourceTextModule } from "@tint/js-engine/lowering";
import { workspaceModules } from "./workspace-sources.ts";
const globals = [
  "undefined",
  "NaN",
  "Infinity",
  "Array",
  "Boolean",
  "String",
  "Number",
  "Math",
  "Map",
  "Set",
  "Uint8Array",
  "Uint16Array",
  "Uint32Array",
  "Float64Array",
  "ArrayBuffer",
  "DataView",
  "TextEncoder",
  "TextDecoder",
  "TypeError",
  "RangeError",
];
const dependencies = new Map([
  ["@tint/js-runtime/modules", "packages/js-runtime/src/modules/index.ts"],
  ["@tint/js-runtime/objects", "packages/js-runtime/src/objects/index.ts"],
  [
    "@tint/js-runtime/environments/global",
    "packages/js-runtime/src/environments/global/index.ts",
  ],
  [
    "@tint/js-runtime/environments/records",
    "packages/js-runtime/src/environments/records/index.ts",
  ],
]);
test("module instantiate and execute callbacks retain distinct bindings after native linking", () => {
  const runtimes = workspaceModules([...dependencies.values()]);
  for (const text of [
    "export function f(){return 42;}",
    "export function f(tag){return tag`x`;}",
  ]) {
    const parsed = parseModule(createSourceTextView(text));
    assert.ok(parsed.ok);
    const lowered = lowerSourceTextModule(parsed.value, text);
    assert.ok(lowered.ok);
    const linked = linkModules(
      [
        ...runtimes,
        { id: "generated-module", module: lowered.value, dependencies },
      ],
      "generated-module",
      globals,
      { evaluation: "instance" },
    );
    assert.ok(linked.ok, JSON.stringify(linked));
    const rebound = bindModule(linked.value.module, globals);
    assert.ok(rebound.ok, JSON.stringify(rebound));
  }
});
