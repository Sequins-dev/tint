import { test } from "node:test";
import assert from "node:assert/strict";
import { createSourceText, createSourceTextView } from "@tint/source/text";
import {
  parseModule,
  type Module,
  type Statement,
} from "@tint/typescript/syntax";
import { checkClosureModule } from "@tint/typescript/checker";
import * as compiler from "../src/native/index.ts";

function checked(text: string) {
  const bytes = new TextEncoder().encode(text);
  const source = createSourceText(bytes, bytes.length);
  assert.ok(source.ok);
  const parsed = parseModule(source.value);
  assert.ok(parsed.ok, JSON.stringify(parsed));
  const result = checkClosureModule(parsed.value);
  assert.ok(result.ok, JSON.stringify(result));
  return result.value;
}
const source = `interface Link {readonly value:number;readonly next:Link|undefined;}
function add(a:number,b:number):number{return a+b;}
function keep(value:Link):Link{return value;}
function list(values:unknown[]):unknown[]{return values;}`;

test("managed surface declarations preserve recursive records and function/list types", () => {
  assert.equal(typeof compiler.reifyManagedSurfaceTypes, "function");
  const original = checked(source);
  const result = compiler.reifyManagedSurfaceTypes(
    original,
    [
      { name: "add", local: "add" },
      { name: "keep", local: "keep" },
      { name: "list", local: "list" },
    ],
    "$Surface",
  );
  assert.ok(result.ok, JSON.stringify(result));
  assert.equal(result.value.entries.length, 3);
  const table = result.value.table;
  const span = { start: 0, end: 0 };
  const module: Module = {
    ...span,
    imports: [],
    statements: [
      ...result.value.declarations,
      {
        ...span,
        kind: "function",
        name: "run",
        exported: true,
        parameters: [{ ...span, name: "table", type: table }],
        returnType: { ...span, kind: "named", name: "number" },
        body: {
          ...span,
          kind: "block",
          statements: [
            {
              ...span,
              kind: "return",
              expression: {
                ...span,
                kind: "call",
                callee: {
                  ...span,
                  kind: "member",
                  object: { ...span, kind: "identifier", name: "table" },
                  property: "add",
                },
                typeArguments: [],
                arguments: [
                  { ...span, kind: "number", value: 19, raw: "19" },
                  { ...span, kind: "number", value: 23, raw: "23" },
                ],
              },
            },
          ],
        },
      },
    ],
  };
  const verified = checkClosureModule(module);
  assert.ok(verified.ok, JSON.stringify(verified));
  const prepared = compiler.prepareNativeFunctionEntry(module, "run");
  assert.ok(prepared.ok, JSON.stringify(prepared));
  assert.equal(prepared.value.fn.parameters.length, 1);
  assert.equal(original.types.length, checked(source).types.length);
});

test("managed surface type export rejects ambiguous, missing and nonfunction entries", () => {
  const original = checked(source + "\nconst count=42;");
  for (const entries of [
    [{ name: "x", local: "missing" }],
    [{ name: "x", local: "count" }],
    [
      { name: "x", local: "add" },
      { name: "x", local: "keep" },
    ],
  ])
    assert.equal(
      compiler.reifyManagedSurfaceTypes(original, entries, "$Surface").ok,
      false,
    );
  for (const prefix of ["", "1Surface", "a-b", "a b", "a\0", "é"])
    assert.equal(
      compiler.reifyManagedSurfaceTypes(original, [], prefix).ok,
      false,
    );
});

test("managed surface requests share ordinary generic specialization and checked type identities", () => {
  assert.equal(typeof compiler.prepareManagedSurfaceTypes, "function");
  const model = checked(source);
  const keep = model.bindings.bindings.find(
    (binding) => binding.name === "keep",
  );
  assert.ok(keep);
  const keepType = model.types[model.bindingTypes[keep.id]!];
  assert.ok(keepType?.kind === "function");
  const link = keepType.parameters[0]!;
  const number = model.types.findIndex((type) => type.kind === "number");
  assert.ok(number >= 0);
  const generic = checked(
    "function anchor(value:number):number{return value;}",
  ).module;
  const bytes = new TextEncoder().encode(
    "function identity<T>(value:T):T{return value;}function list<T>(values:T[]):T[]{return values;}",
  );
  const text = createSourceText(bytes, bytes.length);
  assert.ok(text.ok);
  const parsed = parseModule(text.value);
  assert.ok(parsed.ok);
  const result = compiler.prepareManagedSurfaceTypes(
    parsed.value,
    model.types,
    [
      { name: "numberIdentity", local: "identity", typeArguments: [number] },
      { name: "linkIdentity", local: "identity", typeArguments: [link] },
      { name: "links", local: "list", typeArguments: [link] },
      { name: "alias", local: "identity", typeArguments: [number] },
    ],
    "$Surface",
    ["undefined"],
  );
  assert.ok(result.ok, JSON.stringify(result));
  assert.equal(result.value.surface.entries.length, 4);
  assert.equal(
    result.value.surface.entries[0]?.local,
    result.value.surface.entries[3]?.local,
  );
  assert.notEqual(
    result.value.surface.entries[0]?.local,
    result.value.surface.entries[1]?.local,
  );
  assert.ok(
    result.value.checked.module.statements.every(
      (statement) =>
        statement?.kind !== "function" ||
        (statement.typeParameters?.length ?? 0) === 0,
    ),
  );
  assert.equal(
    compiler.prepareManagedSurfaceTypes(
      generic,
      model.types,
      [{ name: "missing", local: "missing", typeArguments: [] }],
      "$Surface",
      ["undefined"],
    ).ok,
    false,
  );
  assert.equal(
    compiler.prepareManagedSurfaceTypes(
      parsed.value,
      model.types,
      [{ name: "bad", local: "identity", typeArguments: [model.types.length] }],
      "$Surface",
      ["undefined"],
    ).ok,
    false,
  );
});

test("named type exports use the checked graph and remain separate from value exports", () => {
  const model = checked(source + "\ntype LinkAlias=Link;");
  assert.equal(typeof model.typeNames?.get, "function");
  assert.equal(model.typeNames.get("Link"), model.typeNames.get("LinkAlias"));
  const result = compiler.reifyManagedSurfaceTypes(
    model,
    [{ name: "same", local: "keep" }],
    "$Surface",
    [
      { name: "same", local: "Link" },
      { name: "Alias", local: "LinkAlias" },
    ],
  );
  assert.ok(result.ok, JSON.stringify(result));
  assert.equal(result.value.types.length, 2);
  assert.deepEqual(result.value.types[0]?.type, result.value.types[1]?.type);
  assert.equal(
    compiler.reifyManagedSurfaceTypes(model, [], "$Surface", [
      { name: "x", local: "Missing" },
    ]).ok,
    false,
  );
  assert.equal(
    compiler.reifyManagedSurfaceTypes(model, [], "$Surface", [
      { name: "x", local: "Link" },
      { name: "x", local: "LinkAlias" },
    ]).ok,
    false,
  );
});

test("surface factories expose the concrete helper values through ordinary module compilation", () => {
  assert.equal(typeof compiler.createManagedSurfaceFactory, "function");
  const bytes = new TextEncoder().encode(
    "let calls:number=0;function identity<T>(value:T):T{calls++;return value;}function count():number{return calls;}",
  );
  const text = createSourceText(bytes, bytes.length);
  assert.ok(text.ok);
  const library = parseModule(text.value);
  assert.ok(library.ok);
  const prepared = compiler.prepareManagedSurfaceTypes(
    library.value,
    [{ kind: "number" }],
    [
      { name: "identity", local: "identity", typeArguments: [0] },
      { name: "count", local: "count", typeArguments: [] },
    ],
    "$Surface",
    ["undefined"],
  );
  assert.ok(prepared.ok, JSON.stringify(prepared));
  const originalLength = prepared.value.checked.module.statements.length;
  const factory = compiler.createManagedSurfaceFactory(
    prepared.value,
    "createSurface",
  );
  assert.ok(factory.ok, JSON.stringify(factory));
  assert.equal(prepared.value.checked.module.statements.length, originalLength);
  const stubBytes = new TextEncoder().encode(
    "export function run():number{const first=createSurface();const second=createSurface();if(first.identity!==second.identity)return 1;if(first.identity(42)!==42||second.count()!==1)return 2;return 42;}",
  );
  const stubText = createSourceText(stubBytes, stubBytes.length);
  assert.ok(stubText.ok);
  const stub = parseModule(stubText.value);
  assert.ok(stub.ok);
  const module = {
    ...factory.value.checked.module,
    statements: [
      ...factory.value.checked.module.statements,
      ...stub.value.statements,
    ],
  };
  const compiled = compiler.compileArm64Program({
    modules: [{ id: "surface", module, dependencies: new Map() }],
    entry: "surface",
    exports: ["run"],
    start: "run",
    runtimes: [],
  });
  assert.ok(compiled.ok, JSON.stringify(compiled));
  assert.ok(compiled.value.native.code.length > 0);
  assert.equal(
    compiler.createManagedSurfaceFactory(prepared.value, "count").ok,
    false,
  );
  assert.equal(
    compiler.createManagedSurfaceFactory(prepared.value, "1factory").ok,
    false,
  );
});

test("surface reflectors are checked unbound declarations with concrete helper types", () => {
  assert.equal(typeof compiler.createManagedSurfaceReflectors, "function");
  const model = checked(
    "function add(a:number,b:number):number{return a+b;}function count():number{return 0;}",
  );
  const surface = compiler.reifyManagedSurfaceTypes(
    model,
    [
      { name: "add", local: "add" },
      { name: "count", local: "count" },
    ],
    "$Surface",
  );
  assert.ok(surface.ok);
  const result = compiler.createManagedSurfaceReflectors(
    surface.value,
    "$Reflect",
  );
  assert.ok(result.ok, JSON.stringify(result));
  assert.equal(result.value.signatures.length, 2);
  assert.ok(result.value.functionBrand);
  const descriptor = result.value.checked.module.statements.find(
    (statement) =>
      statement.kind === "function" &&
      statement.name === result.value.tableDescriptor,
  );
  assert.ok(descriptor?.kind === "function");
  assert.equal(descriptor.parameters.length, 2);
  assert.deepEqual(descriptor.parameters[1]?.type, surface.value.table);
  assert.ok(descriptor.body.kind === "block");
  assert.ok(
    descriptor.body.statements.every((statement) => statement.kind === "throw"),
  );
  for (let index = 0; index < result.value.signatures.length; index++) {
    const reflected: { readonly name: string; readonly function: string } =
      result.value.signatures[index]!;
    const declaration: Statement | undefined =
      result.value.checked.module.statements.find(
        (statement) =>
          statement.kind === "function" &&
          statement.name === reflected.function,
      );
    assert.ok(declaration?.kind === "function");
    assert.deepEqual(
      declaration.parameters[0]?.type,
      surface.value.entries[index]?.type,
    );
  }
  assert.equal(
    compiler.createManagedSurfaceReflectors(surface.value, "bad-name").ok,
    false,
  );
  const bad = { ...surface.value, declarations: model.module.statements };
  assert.equal(
    compiler.createManagedSurfaceReflectors(bad, "$Reflect").ok,
    false,
  );
});

test("reflector roles reject table/function type confusion", () => {
  const model = checked("function value():number{return 42;}");
  const surface = compiler.reifyManagedSurfaceTypes(
    model,
    [{ name: "value", local: "value" }],
    "$Surface",
  );
  assert.ok(surface.ok);
  const unknown = { start: 0, end: 0, kind: "named" as const, name: "unknown" };
  assert.equal(
    compiler.createManagedSurfaceReflectors(
      { ...surface.value, table: unknown },
      "$Reflect",
    ).ok,
    false,
  );
  const entries = surface.value.entries.map((entry) => ({
    ...entry,
    type: surface.value.table,
  }));
  assert.equal(
    compiler.createManagedSurfaceReflectors(
      { ...surface.value, entries },
      "$Reflect",
    ).ok,
    false,
  );
  assert.equal(
    compiler.prepareManagedSurfaceTypes(
      model.module,
      model.types,
      [{ name: "value", local: "value", typeArguments: [0] }],
      "$Surface",
      ["undefined"],
    ).ok,
    false,
  );
});

test("each reflector owns distinct parameter bindings", () => {
  const model = checked("function add(value:number):number{return value;}");
  const surface = compiler.reifyManagedSurfaceTypes(
    model,
    [{ name: "add", local: "add" }],
    "$Surface",
  );
  assert.ok(surface.ok);
  const result = compiler.createManagedSurfaceReflectors(
    surface.value,
    "$Reflect",
  );
  assert.ok(result.ok);
  const observed = result.value.checked;
  for (const statement of observed.module.statements) {
    if (statement.kind !== "function") continue;
    const fn = observed.bindings.functions.find((fn) => fn.node === statement);
    assert.ok(fn);
    for (const parameter of statement.parameters) {
      const binding = observed.bindings.bindings.find(
        (binding) => binding.node === parameter,
      );
      assert.ok(binding);
      assert.equal(binding.owner, fn.id, statement.name);
    }
  }
});

test("surface reflectors cover reachable recursive records and callback identities", () => {
  const model =
    checked(`interface Link {readonly value:number;readonly next:Link|undefined;}
function visit(value:Link, callback:(node:Link)=>number):number{return callback(value);}`);
  const surface = compiler.reifyManagedSurfaceTypes(
    model,
    [{ name: "visit", local: "visit" }],
    "$Surface",
  );
  assert.ok(surface.ok);
  const result = compiler.createManagedSurfaceReflectors(
    surface.value,
    "$Reflect",
  );
  assert.ok(result.ok);
  const observed = result.value;
  assert.ok(observed.recordDescriptors.length >= 2);
  assert.ok(observed.typeSignatures.length >= 2);
  assert.ok(
    observed.recordDescriptors.some(
      (entry) => entry.function === observed.tableDescriptor,
    ),
  );
  for (const declaration of surface.value.declarations) {
    if (declaration.kind !== "type-alias") continue;
    const type = observed.checked.typeNames.get(declaration.name);
    assert.notEqual(type, undefined);
    const resolved = observed.checked.types[type!];
    const entries =
      resolved?.kind === "object"
        ? observed.recordDescriptors
        : resolved?.kind === "function"
          ? observed.typeSignatures
          : [];
    if (resolved?.kind !== "object" && resolved?.kind !== "function") continue;
    const reflected = entries.find((entry) => entry.name === declaration.name);
    assert.ok(reflected, declaration.name);
    const fn = observed.checked.module.statements.find(
      (statement) =>
        statement.kind === "function" && statement.name === reflected.function,
    );
    assert.ok(fn?.kind === "function");
    const witness = fn.parameters[resolved.kind === "object" ? 1 : 0];
    assert.deepEqual(witness?.type, {
      start: 0,
      end: 0,
      kind: "named",
      name: declaration.name,
    });
  }
});

test("surface declaration interchange roundtrips without compiler object identities", () => {
  const model = checked(
    "interface Link{readonly value:number;readonly next:Link|undefined;}function keep(value:Link):Link{return value;}",
  );
  const described = compiler.reifyManagedSurfaceTypes(
    model,
    [{ name: "keep", local: "keep" }],
    "$Surface",
    [{ name: "Link", local: "Link" }],
  );
  assert.ok(described.ok);
  const serialized = compiler.serializeManagedSurfaceTypes(described.value);
  assert.ok(serialized.ok, JSON.stringify(serialized));
  const restored = compiler.restoreManagedSurfaceTypes(
    JSON.parse(JSON.stringify(serialized.value)),
  );
  assert.ok(restored.ok, JSON.stringify(restored));
  const repeated = compiler.serializeManagedSurfaceTypes(restored.value);
  assert.deepEqual(repeated, serialized);
  const source = parseModule(
    createSourceTextView(
      'import {keep,type Link} from "runtime";export function execute(value:Link):Link{return keep(value);}',
    ),
  );
  assert.ok(source.ok);
  const adapted = compiler.adaptManagedSurfaceEntry(
    source.value,
    "execute",
    "runtime",
    restored.value,
  );
  assert.ok(adapted.ok);
  assert.ok(
    compiler.prepareNativeFunctionEntry(
      adapted.value.module,
      adapted.value.entry,
    ).ok,
  );
});
test("surface interchange rejects version drift, executable declarations and mismatched roots", () => {
  const model = checked("function add(value:number):number{return value;}");
  const described = compiler.reifyManagedSurfaceTypes(
    model,
    [{ name: "add", local: "add" }],
    "$Surface",
  );
  assert.ok(described.ok);
  const serialized = compiler.serializeManagedSurfaceTypes(described.value);
  assert.ok(serialized.ok);
  assert.equal(
    compiler.restoreManagedSurfaceTypes({ ...serialized.value, version: 2 }).ok,
    false,
  );
  assert.equal(
    compiler.restoreManagedSurfaceTypes({
      ...serialized.value,
      declarations: serialized.value.declarations + "const executed=42;",
    }).ok,
    false,
  );
  assert.equal(
    compiler.restoreManagedSurfaceTypes({
      ...serialized.value,
      table: "missing",
    }).ok,
    false,
  );
  assert.equal(
    compiler.restoreManagedSurfaceTypes({
      ...serialized.value,
      entries: serialized.value.entries.map((entry) => ({
        ...entry,
        type: serialized.value.table,
      })),
    }).ok,
    false,
  );
  assert.equal(
    compiler.restoreManagedSurfaceTypes({
      ...serialized.value,
      entries: [...serialized.value.entries, ...serialized.value.entries],
    }).ok,
    false,
  );
  assert.equal(
    compiler.restoreManagedSurfaceTypes({ ...serialized.value, entries: [] })
      .ok,
    false,
  );
  assert.equal(
    compiler.restoreManagedSurfaceTypes({
      ...serialized.value,
      entries: serialized.value.entries.map((entry) => ({
        ...entry,
        name: "other",
      })),
    }).ok,
    false,
  );
  assert.equal(
    compiler.restoreManagedSurfaceTypes({
      ...serialized.value,
      declarations:
        serialized.value.declarations + "type Other=(value:string)=>string;",
      entries: serialized.value.entries.map((entry) => ({
        ...entry,
        type: "Other",
      })),
    }).ok,
    false,
  );
});

test("metadata witness factories cover callback types without implementing helpers", () => {
  const model = checked(
    "interface Link{readonly value:number;readonly next:Link|undefined;}function visit(value:Link,callback:(value:Link)=>number):number{return callback(value);}",
  );
  const described = compiler.reifyManagedSurfaceTypes(
    model,
    [{ name: "visit", local: "visit" }],
    "$Surface",
  );
  assert.ok(described.ok);
  const wire = compiler.serializeManagedSurfaceTypes(described.value);
  assert.ok(wire.ok);
  const surface = compiler.restoreManagedSurfaceTypes(wire.value);
  assert.ok(surface.ok);
  const result = compiler.createManagedSurfaceWitnessFactory(
    surface.value,
    "$Witness",
  );
  assert.ok(result.ok, JSON.stringify(result));
  const observed = result.value;
  assert.ok(observed.entries.length >= 2);
  const native = compiler.compileArm64Program({
    modules: [
      {
        id: "witnesses",
        module: observed.checked.module,
        dependencies: new Map(),
      },
    ],
    entry: "witnesses",
    exports: [observed.factory],
    runtimes: [],
  });
  assert.ok(native.ok, JSON.stringify(native));
  for (const entry of observed.entries) {
    const declaration = observed.checked.module.statements.find(
      (statement) =>
        statement.kind === "function" && statement.name === entry.function,
    );
    assert.ok(declaration?.kind === "function");
    assert.ok(declaration.body.kind === "block");
    assert.ok(
      declaration.body.statements.every(
        (statement) => statement.kind === "throw",
      ),
    );
  }
  assert.equal(
    compiler.createManagedSurfaceWitnessFactory(surface.value, "bad-prefix").ok,
    false,
  );
});

test("surface metadata includes instance-free identity stubs for every reachable record", () => {
  const model = checked(
    "interface Link{readonly value:number;readonly next:Link|undefined;}function keep(value:Link):Link{return value;}",
  );
  const surface = compiler.reifyManagedSurfaceTypes(
    model,
    [{ name: "keep", local: "keep" }],
    "$Surface",
  );
  assert.ok(surface.ok);
  const reflectors = compiler.createManagedSurfaceReflectors(
    surface.value,
    "$Identity",
  );
  assert.ok(reflectors.ok);
  const observed = reflectors.value;
  assert.ok(Array.isArray(observed.recordIdentities));
  assert.deepEqual(
    observed.recordIdentities.map((entry) => entry.name),
    observed.recordDescriptors.map((entry) => entry.name),
  );
  for (const identity of observed.recordIdentities) {
    const fn = observed.checked.module.statements.find(
      (statement) =>
        statement.kind === "function" && statement.name === identity.function,
    );
    assert.ok(fn?.kind === "function");
    assert.equal(fn.parameters.length, 1);
    assert.deepEqual(fn.parameters[0]?.type, {
      start: 0,
      end: 0,
      kind: "union",
      members: [
        { start: 0, end: 0, kind: "named", name: identity.name },
        { start: 0, end: 0, kind: "named", name: "undefined" },
      ],
    });
    assert.equal(fn.body.kind, "block");
    if (fn.body.kind === "block")
      assert.equal(fn.body.statements[0]?.kind, "throw");
  }
});
