import { test } from "node:test";
import assert from "node:assert/strict";
import { createSourceTextView } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import { checkClosureModule } from "@tint/typescript/checker";
import * as compiler from "../src/native/index.ts";
import { runtimeSources } from "@tint/compiler/cli";
import { workspaceModules } from "../../../tools/workspace-sources.ts";
function fixture() {
  const parsed = parseModule(
    createSourceTextView(`
 interface Field{readonly offset:number;readonly type:string;readonly mutable:boolean;readonly presenceOffset?:number;readonly stateOffset?:number;}
 interface Layout{readonly byteLength:number;readonly fields:readonly Field[];}
 interface Types{readonly version:number;readonly declarations:string;readonly table:string;readonly entries:readonly {readonly name:string;readonly local:string;readonly type:string;}[];readonly types:readonly {readonly name:string;readonly type:string;}[];}
 interface Directory{readonly version:number;readonly name:string;readonly frame:string|undefined;readonly abi:{readonly signature:number;readonly functionBrand:readonly number[];};readonly types:Types;readonly signatures:readonly {readonly alias:string;readonly aliases:readonly string[];readonly function:number;readonly parameters:readonly string[];readonly returnType:string;}[];readonly records:readonly {readonly alias:string;readonly aliases:readonly string[];readonly layout:Layout;}[];readonly runtimes:readonly {readonly kind:string;readonly element:string;readonly value:string;readonly operations:readonly {readonly operation:string;readonly parameters:readonly string[];readonly returnType:string;}[];}[];readonly digest:string;}
 interface ManagedSurfaceExport{readonly directory:Directory;readonly table:unknown;readonly functions:readonly unknown[];readonly records:Float64Array;readonly entries:Float64Array;}
 interface Link{readonly value:number;readonly next:Link|undefined;}
 export function keep(value:Link):Link{return value;}
 export function visit(value:Link,read:(value:Link)=>number):number{return read(value);}
 export function bind():ManagedSurfaceExport{throw "MANAGED_SURFACE_UNBOUND";}
 `),
  );
  assert.ok(parsed.ok);
  const checked = checkClosureModule(parsed.value);
  assert.ok(checked.ok, JSON.stringify(checked));
  const surface = compiler.reifyManagedSurfaceTypes(
    checked.value,
    [
      { name: "keep", local: "keep" },
      { name: "visit", local: "visit" },
    ],
    "$Types",
  );
  assert.ok(surface.ok);
  const canonical = compiler.canonicalizeManagedSurfaceTypes(surface.value);
  assert.ok(canonical.ok);
  const facts = compiler.deriveManagedSurfacePhysicalFacts(canonical.value, {
    modules: [],
    runtimes: [],
    globals: ["undefined"],
  });
  assert.ok(facts.ok);
  const directory = compiler.createManagedSurfaceDirectory(
    "body\uD800",
    canonical.value,
    facts.value,
  );
  assert.ok(directory.ok);
  const table = compiler.createManagedSurfaceFactory(
    { checked: checked.value, surface: surface.value },
    "$table",
  );
  assert.ok(table.ok);
  const reflectors = compiler.createManagedSurfaceReflectors(
    canonical.value,
    "$Records",
  );
  assert.ok(reflectors.ok);
  const witnesses = compiler.createManagedSurfaceWitnessFactory(
    canonical.value,
    "$Witnesses",
  );
  assert.ok(witnesses.ok);
  const records = directory.value.directory.records.map(
    (record) =>
      reflectors.value.recordIdentities.find(
        (entry) => entry.name === record.alias,
      )!.function,
  );
  const functions = directory.value.witnesses.map(
    (alias) =>
      witnesses.value.entries.find((entry) => entry.name === alias)!.function,
  );
  const generated = new Set([...records, ...functions]);
  const module = {
    ...table.value.checked.module,
    statements: [
      ...table.value.checked.module.statements,
      ...canonical.value.declarations,
      ...reflectors.value.checked.module.statements.filter(
        (statement) =>
          statement.kind === "function" && generated.has(statement.name),
      ),
      ...witnesses.value.checked.module.statements.filter(
        (statement) =>
          statement.kind === "function" && generated.has(statement.name),
      ),
    ],
  };
  assert.ok(checkClosureModule(module).ok);
  return {
    module,
    source: parsed.value,
    directory: directory.value.directory,
    records,
    functions,
  };
}
test("managed export bodies are typed syntax preserving UTF-16 directory data and existing helpers", () => {
  assert.equal(typeof compiler.materializeManagedSurfaceExport, "function");
  const { module, directory, records, functions } = fixture();
  const original = JSON.stringify(module);
  const result = compiler.materializeManagedSurfaceExport(
    module,
    "bind",
    directory,
    "$table",
    functions,
    records,
    "$Export",
  );
  assert.ok(result.ok, JSON.stringify(result));
  assert.equal(JSON.stringify(module), original);
  const checked = checkClosureModule(result.value);
  assert.ok(checked.ok, JSON.stringify(checked));
  const stub = result.value.statements.find(
    (statement) => statement.kind === "function" && statement.name === "bind",
  );
  assert.ok(stub?.kind === "function" && stub.body.kind === "block");
  assert.ok(JSON.stringify(stub.body).includes("body\\ud800"));
  assert.equal(result.value.statements.length, module.statements.length);
  const repeat = compiler.materializeManagedSurfaceExport(
    result.value,
    "bind",
    directory,
    "$table",
    functions,
    records,
    "$Export",
  );
  assert.equal(repeat.ok, false);
  if (!repeat.ok) assert.match(repeat.error, /unbound/);
  for (const [fn, table, witness, identities, prefix] of [
    ["missing", "$table", functions, records, "$Export"],
    ["keep", "$table", functions, records, "$Export"],
    ["bind", "missing", functions, records, "$Export"],
    ["bind", "$table", [], records, "$Export"],
    ["bind", "$table", functions, [], "$Export"],
    ["bind", "$table", functions, records, "invalid-name"],
  ] as const) {
    assert.equal(
      compiler.materializeManagedSurfaceExport(
        module,
        fn,
        directory,
        table,
        witness,
        identities,
        prefix,
      ).ok,
      false,
      fn,
    );
  }
});

test("compile requests publish selected application surfaces and skip empty requests exactly", () => {
  const { source } = fixture();
  const runtimes = runtimeSources().filter(
    (runtime) =>
      runtime.namespace !== "node-fs" && runtime.namespace !== "node-process",
  );
  const request = {
    modules: [
      ...workspaceModules(runtimes.map((runtime) => runtime.module)),
      { id: "app", module: source, dependencies: new Map<string, string>() },
    ],
    runtimes,
    entry: "app",
    exports: ["bind"],
  };
  const selected = {
    name: "application",
    values: [
      { module: "app", name: "keep", typeArguments: [] },
      { module: "app", name: "visit", typeArguments: [] },
    ],
    types: [],
    bind: { module: "app", name: "bind" },
  };
  const compiled = compiler.compileArm64Program({
    ...request,
    managedSurfaces: [selected],
  });
  assert.ok(compiled.ok, JSON.stringify(compiled));
  assert.equal(compiled.value.managedSurfaces?.length, 1);
  assert.equal(compiled.value.managedSurfaces?.[0]?.name, "application");
  assert.ok(
    compiled.value.serviceIdentities?.some(
      (binding) => binding.role === "function-brand",
    ),
  );
  assert.ok(
    compiled.value.serviceIdentities?.some(
      (binding) => binding.role === "record",
    ),
  );
  assert.ok(
    compiled.value.serviceIdentities?.some(
      (binding) => binding.role === "signature",
    ),
  );
  assert.match(
    compiled.value.managedSurfaces?.[0]?.digest ?? "",
    /^[a-f0-9]{64}$/,
  );
  const absent = compiler.compileArm64Program(request),
    empty = compiler.compileArm64Program({ ...request, managedSurfaces: [] });
  assert.ok(absent.ok, JSON.stringify(absent));
  assert.ok(empty.ok, JSON.stringify(empty));
  assert.deepEqual(empty.value.native, absent.value.native);
  for (const selection of [
    { ...selected, bind: { module: "app", name: "keep" } },
    { ...selected, name: "" },
    {
      ...selected,
      values: [{ module: "app", name: "missing", typeArguments: [] }],
    },
  ]) {
    const denied = compiler.compileArm64Program({
      ...request,
      managedSurfaces: [selection],
    });
    assert.equal(denied.ok, false);
    if (!denied.ok) assert.equal(denied.error.stage, "surface");
  }
});

test("generated export locals do not capture compiler-selected helper names", () => {
  const { module, directory, records, functions } = fixture();
  const renamed = {
    ...module,
    statements: module.statements.map((statement) =>
      statement.kind === "function" && statement.name === "$table"
        ? { ...statement, name: "$Export_table" }
        : statement,
    ),
  };
  const result = compiler.materializeManagedSurfaceExport(
    renamed,
    "bind",
    directory,
    "$Export_table",
    functions,
    records,
    "$Export",
  );
  assert.ok(result.ok, JSON.stringify(result));
  const checked = checkClosureModule(result.value);
  assert.ok(checked.ok, JSON.stringify(checked));
});

test("multiple surface requests isolate canonical aliases and retain unused generic instances", () => {
  const { source } = fixture();
  const extra = parseModule(
    createSourceTextView(
      'export function identity<T>(value:T):T{return value;}export function bindSecond():ManagedSurfaceExport{throw "MANAGED_SURFACE_UNBOUND";}',
    ),
  );
  assert.ok(extra.ok);
  const runtimes = runtimeSources().filter(
    (runtime) =>
      runtime.namespace !== "node-fs" && runtime.namespace !== "node-process",
  );
  const values = [
    {
      module: "app",
      name: "identity",
      typeArguments: [{ kind: "keyword", name: "number" } as const],
    },
  ];
  const selected = {
    name: "first",
    values,
    types: [],
    bind: { module: "app", name: "bind" },
  };
  const request = {
    modules: [
      ...workspaceModules(runtimes.map((runtime) => runtime.module)),
      {
        id: "app",
        module: {
          ...source,
          statements: [...source.statements, ...extra.value.statements],
        },
        dependencies: new Map<string, string>(),
      },
    ],
    runtimes,
    entry: "app",
    exports: ["bind", "bindSecond"],
    managedSurfaces: [
      selected,
      {
        ...selected,
        name: "second",
        bind: { module: "app", name: "bindSecond" },
      },
    ],
  };
  const result = compiler.compileArm64Program(request);
  assert.ok(result.ok, JSON.stringify(result));
  assert.equal(result.value.managedSurfaces?.length, 2);
  assert.notEqual(
    result.value.managedSurfaces?.[0]?.digest,
    result.value.managedSurfaces?.[1]?.digest,
  );
  const denied = compiler.compileArm64Program({
    ...request,
    managedSurfaces: [selected, { ...selected, name: "second" }],
  });
  assert.equal(denied.ok, false);
  if (!denied.ok) assert.match(denied.error.message, /duplicate surface bind/);
});

test("an empty surface plan does not traverse or copy the application syntax", async () => {
  const { prepareManagedSurfaceExports } =
    await import("../src/native/managed-aot.ts");
  const { linkModules } = await import("@tint/ts-native/modules");
  const { source } = fixture();
  const linked = linkModules(
    [{ id: "app", module: source, dependencies: new Map() }],
    "app",
    ["undefined"],
    { evaluation: "instance" },
  );
  assert.ok(linked.ok);
  let reads = 0;
  const module = {
    ...linked.value.module,
    get statements() {
      reads++;
      return linked.value.module.statements;
    },
  };
  const result = prepareManagedSurfaceExports(
    module,
    linked.value,
    [],
    [],
    [],
    new Set(),
    [],
    4096,
  );
  assert.ok(result.ok);
  assert.equal(result.value.module, module);
  assert.equal(reads, 0);
});

test("application-first collection exports survive preparation retries with canonical entries", () => {
  const { source } = fixture();
  const extra = parseModule(
    createSourceTextView(`
    export function count(values:readonly Link[]):number{return values.length;}
    export function lookup(values:ReadonlyMap<string,Link>):number{return values.size;}
    export function members(values:ReadonlySet<number>):number{return values.size;}
  `),
  );
  assert.ok(extra.ok);
  const runtimes = runtimeSources().filter(
    (runtime) =>
      runtime.namespace !== "node-fs" && runtime.namespace !== "node-process",
  );
  const request = {
    modules: [
      {
        id: "app",
        module: {
          ...source,
          statements: [...source.statements, ...extra.value.statements],
        },
        dependencies: new Map<string, string>(),
      },
      ...workspaceModules(runtimes.map((runtime) => runtime.module)),
    ],
    runtimes,
    entry: "app",
    exports: ["bind"],
    managedSurfaces: [
      {
        name: "collections",
        values: ["count", "lookup", "members"].map((name) => ({
          module: "app",
          name,
          typeArguments: [],
        })),
        types: [],
        bind: { module: "app", name: "bind" },
      },
    ],
  };
  const result = compiler.compileArm64Program(request);
  assert.ok(result.ok, JSON.stringify(result));
  const summary = result.value.managedSurfaces?.[0];
  assert.ok(summary);
  assert.equal(summary.runtimeSlots, 52);
  assert.equal(summary.runtimeTargets, 52);
  assert.ok(summary.runtimeSignatures > 0);
  const dense = compiler.compileArm64Program({
    ...request,
    denseReferenceLists: true,
  });
  assert.ok(dense.ok, JSON.stringify(dense));
  assert.deepEqual(dense.value.native, result.value.native);
});

test("surface tables box retained helpers once in the application instance", () => {
  const { source } = fixture();
  const runtimes = runtimeSources().filter(
    (runtime) =>
      runtime.namespace !== "node-fs" && runtime.namespace !== "node-process",
  );
  const result = compiler.compileArm64Program({
    modules: [
      ...workspaceModules(runtimes.map((runtime) => runtime.module)),
      { id: "app", module: source, dependencies: new Map<string, string>() },
    ],
    runtimes: [
      ...runtimes,
      { module: "app", namespace: "record-helpers", retainedExports: ["keep"] },
    ],
    entry: "app",
    exports: ["bind"],
    managedSurfaces: [
      {
        name: "application",
        values: [{ module: "app", name: "keep", typeArguments: [] }],
        types: [],
        bind: { module: "app", name: "bind" },
      },
    ],
  });
  assert.ok(result.ok, JSON.stringify(result));
});
