import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseDynamicFunction,
  type DynamicFunctionKind,
} from "@tint/typescript/syntax";
import * as compiler from "@tint/compiler/native";
function compile(
  body: string,
  parameters: readonly string[] = [],
  kind: DynamicFunctionKind = "normal",
  budget = 0xffffffff,
) {
  const parsed = parseDynamicFunction(kind, parameters, body);
  assert.ok(parsed.ok, JSON.stringify(parsed));
  return compiler.compileManagedGlobalAccessDynamicFunction(
    parsed.value,
    budget,
  );
}
test("managed global reader accepts decoded identifiers, grouping and inert directives", () => {
  for (const [body, name, strict] of [
    ["return planet;", "planet", false],
    ['"use strict"; ; return ((color));', "color", true],
    ['"custom directive"; return \\u0070lanet;', "planet", false],
    ["return anonymous;", "anonymous", false],
    ["return undefined;", "undefined", false],
  ] as const) {
    const result = compile(body);
    assert.ok(result.ok, JSON.stringify(result));
    assert.equal(result.value.globalName, name);
    assert.equal(result.value.strict, strict);
    assert.equal(result.value.native.linkage, "unresolved-managed");
    assert.deepEqual(result.value.parameters, ["reference"]);
    assert.equal(result.value.returnType, "general");
    assert.equal(result.value.native.managedImports.length, 2);
    const signature = result.value.native.managedImports.find(
      (x) => x.role === "signature",
    );
    assert.ok(signature);
    assert.deepEqual(signature.parameters, ["general", "number"]);
    assert.equal(signature.returnType, "general");
    assert.equal(signature.contract, result.value.readerContract);
    assert.ok(result.value.entry.offset >= 0);
  }
});
test("simple unused and sloppy duplicate formals do not select a global parameter", () => {
  for (const params of [["value"], ["x", "x"], ["$tint$reader"]]) {
    assert.ok(compile("return planet;", params).ok);
  }
  for (const params of [["planet"], ["x", "planet"], ["planet", "planet"]])
    assert.equal(compile("return planet;", params).ok, false);
});
test("managed reader rejects declarations, implicit bindings, effects, suspension and parameter initialization", () => {
  for (const body of [
    "return arguments;",
    "return this;",
    "return new.target;",
    "return planet; var planet;",
    "return planet; let planet;",
    "var local; return planet;",
    '; "late string"; return planet;',
    "planet; return planet;",
    "return planet();",
    "return planet?.color;",
    "return planet[other];",
    "return planet[0];",
    "return planet.color();",
    "return planet + 1;",
    "return;",
    "return planet; return color;",
  ])
    assert.equal(compile(body).ok, false, body);
  for (const params of [["x=1"], ["...xs"], ["{x}"], ["[x]"]])
    assert.equal(compile("return planet;", params).ok, false);
  for (const kind of ["async", "generator", "async-generator"] as const)
    assert.equal(compile("return planet;", [], kind).ok, false);
});
test("managed compilation remains eager, immutable and distinct from closed compilation", () => {
  const parsed = parseDynamicFunction("normal", [], "return planet;");
  assert.ok(parsed.ok);
  const before = structuredClone(parsed.value);
  assert.equal(compiler.compileClosedDynamicFunction(parsed.value).ok, false);
  assert.ok(
    compiler.compileManagedGlobalAccessDynamicFunction(parsed.value).ok,
  );
  assert.deepEqual(parsed.value, before);
  assert.equal(compile("return planet;", [], "normal", 8).ok, false);
  const early = parseDynamicFunction(
    "normal",
    ["x", "x"],
    '"use strict"; return planet;',
  );
  if (early.ok) {
    const result = compiler.compileManagedGlobalAccessDynamicFunction(
      early.value,
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.stage, "check");
  }
});

test("original binding identity survives synthetic-name collisions and named-expression shadows", () => {
  for (const name of ["$tint$reader", "$tint$managedGlobalAccess"]) {
    const result = compile("return " + name + ";");
    assert.ok(result.ok, JSON.stringify(result));
    assert.equal(result.value.globalName, name);
  }
  const parsed = parseDynamicFunction("normal", [], "return planet;");
  assert.ok(parsed.ok);
  const statement = parsed.value.module.statements[0]!;
  assert.equal(statement.kind, "expression");
  if (statement.kind !== "expression") return;
  const expression = statement.expression;
  assert.equal(expression.kind, "function-expression");
  if (expression.kind !== "function-expression") return;
  const named = {
    ...parsed.value,
    module: {
      ...parsed.value.module,
      statements: [
        { ...statement, expression: { ...expression, name: "planet" } },
      ],
    },
  };
  const result = compiler.compileManagedGlobalAccessDynamicFunction(named);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error.message, /local binding/);
});

test("managed reader preserves provenance and opaque effects without executing global getters", async () => {
  const { effectThrow, effectAllocate, effectInvoke, provenNoSafepoints } =
    await import("@tint/ir/scalar");
  let reads = 0;
  const name = "$tint$ManagedReaderPoisoned";
  Object.defineProperty(globalThis, name, {
    configurable: true,
    get() {
      reads++;
      throw new Error("must not execute");
    },
  });
  try {
    const parsed = parseDynamicFunction(
      "normal",
      [],
      "return ((" + name + ")); ",
    );
    assert.ok(parsed.ok);
    const result = compiler.compileManagedGlobalAccessDynamicFunction(
      parsed.value,
    );
    assert.ok(result.ok, JSON.stringify(result));
    const fn = parsed.value.module.statements[0]!;
    assert.equal(fn.kind, "expression");
    if (
      fn.kind !== "expression" ||
      fn.expression.kind !== "function-expression"
    )
      return;
    const ret = fn.expression.body.statements[0]!;
    assert.equal(ret.kind, "return");
    if (ret.kind !== "return") return;
    let identifier = ret.expression;
    while (identifier?.kind === "group") identifier = identifier.expression;
    assert.ok(identifier);
    assert.ok(
      result.value.native.sourceRanges.some(
        (span) =>
          span.start === identifier.start && span.end === identifier.end,
      ),
    );
    assert.equal(
      result.value.effects & (effectThrow | effectAllocate | effectInvoke),
      effectThrow | effectAllocate | effectInvoke,
    );
    const roots = result.value.native.roots.find(
      (root) => root.function === result.value.entry.id,
    );
    assert.ok(
      roots && roots.offsets.length > 0 && roots.generalOffsets.length > 0,
    );
    assert.equal(result.value.native.functionDescriptor, undefined);
    assert.equal(
      result.value.native.functionDescriptorImport?.role,
      "function-brand",
    );
    const imported = result.value.native.managedImports.find(
      (item) => item.role === "signature",
    );
    assert.ok(imported && imported.witness !== undefined);
    const witness = result.value.native.functions.find(
      (item) => item.id === imported.witness,
    );
    assert.ok(witness);
    assert.equal(witness.signature.parameters.length, 2);
  } finally {
    Reflect.deleteProperty(globalThis, name);
  }
  assert.equal(reads, 0);
});

test("managed global access emits explicit native reads for static property chains", () => {
  for (const [body, properties] of [
    ["return planet.color;", ["color"]],
    ['return ((planet).color)["deep"];', ["color", "deep"]],
    ['return planet["π"]["__proto__"];', ["π", "__proto__"]],
  ] as const) {
    const result = compile(body);
    assert.ok(result.ok, JSON.stringify(result));
    assert.equal(result.value.globalName, "planet");
    assert.deepEqual(result.value.properties, properties);
    const signature = result.value.native.managedImports.find(
      (x) => x.role === "signature",
    );
    assert.ok(signature);
    assert.deepEqual(signature.parameters, ["general", "number"]);
    assert.equal(signature.contract, "tint.global-access.v1");
    assert.equal(result.value.native.strings.length, 0);
    assert.ok(result.value.entry.byteLength > 0);
  }
});
