import { test } from "node:test";
import assert from "node:assert/strict";
import { createSourceTextView } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import { bindModule } from "@tint/typescript/binding";
import * as service from "./native-service-source.ts";
import { compileNativeServiceUnit } from "@tint/compiler/native";
import { nativeServiceFixtureRequest } from "./native-service-fixture.ts";
function parse(text: string) {
  const result = parseModule(createSourceTextView(text));
  assert.ok(result.ok, JSON.stringify(result));
  return result.value;
}
function input(
  host = "export function seed():number{return 2;}export const locale:string='en';",
) {
  return {
    modules: [
      { id: "host", module: parse(host), dependencies: new Map() },
      {
        id: "unit",
        module: parse(
          'import {seed,locale} from "host";export interface Service{readonly next:()=>number;}let count:number=seed();function next():number{count++;return count+locale.length;}export function factory():Service{return {next};}',
        ),
        dependencies: new Map([["host", "host"]]),
      },
    ],
    entry: "unit",
    factory: "factory",
    ownedModules: new Set(["unit"]),
    globals: ["undefined", "String"],
    specifier: "service-host",
    hostImports: [{ module: "host", name: "seed", imported: "seed" }],
    hostConstants: [{ module: "host", name: "locale" }],
  };
}
test("service source isolates owned state, replaces approved host calls and retains exact types", () => {
  assert.equal(typeof service.prepareNativeServiceSource, "function");
  const result = service.prepareNativeServiceSource(input());
  assert.ok(result.ok, JSON.stringify(result));
  assert.equal(result.value.module.imports.length, 1);
  assert.equal(result.value.module.imports[0]?.specifier, "service-host");
  assert.equal(result.value.module.imports[0]?.bindings[0]?.imported, "seed");
  assert.equal(
    result.value.module.statements.some(
      (s) =>
        s.kind === "function" &&
        s.body.kind === "block" &&
        s.body.statements.some(
          (n) =>
            n.kind === "return" &&
            n.expression?.kind === "number" &&
            n.expression.value === 2,
        ),
    ),
    false,
  );
  assert.ok(bindModule(result.value.module, ["undefined"]).ok);
  assert.ok(result.value.entry.startsWith("@"));
  const compiled = compileNativeServiceUnit({
    ...nativeServiceFixtureRequest(),
    module: result.value.module,
    entry: result.value.entry,
    specifiers: new Set(["service-host"]),
  });
  assert.ok(compiled.ok, JSON.stringify(compiled));
});
test("service source rejects unapproved host values, mutable constants and nonprimitive constants", () => {
  assert.equal(typeof service.prepareNativeServiceSource, "function");
  const original = input();
  for (const request of [
    { ...original, hostImports: [] },
    { ...original, hostConstants: [] },
    input(
      "export function seed():number{return 2;}export let locale:string='en';",
    ),
    input(
      "export function seed():number{return 2;}export const locale:string=String(42);",
    ),
  ]) {
    const result = service.prepareNativeServiceSource(request);
    assert.equal(result.ok, false, JSON.stringify(result));
    assert.match(result.error, /host|constant/);
  }
});
