import {
  prepareCollectionRuntimes,
  runtimeFunctionIds,
} from "@tint/ts-native/runtime";
import { checkClosureModule } from "@tint/typescript/checker";
import { runtimeSources } from "@tint/compiler/cli";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseModule,
  parseScript,
  type Statement,
} from "@tint/typescript/syntax";
import { createSourceTextView } from "@tint/source/text";
import { workspaceModules } from "./workspace-sources.ts";
import { bindModule } from "@tint/typescript/binding";
import {
  createManagedSurfaceAnchors,
  resolveManagedSurfaceAnchors,
  materializeManagedSurfaceTable,
  readManagedSurfaceDirectory,
  type ManagedSurfaceTypeEntry,
  createManagedSurfaceDirectory,
  deriveManagedSurfacePhysicalFacts,
  resolveManagedSurfaceSelections,
  planManagedSurfaceContracts,
  planManagedSurfaceRuntimes,
  createManagedRuntimeAnchors,
  resolveManagedRuntimeNames,
  canonicalizeManagedSurfaceTypes,
  serializeManagedSurfaceTypes,
  prepareManagedSurfaceTable,
  normalizeManagedSurfaceApplications,
  adaptManagedSurfaceEntry,
  managedDirectCallDeclarations,
  prepareManagedRuntimeEntries,
  type ManagedSurfaceSelection,
  type ManagedSurfacePhysicalFacts,
} from "@tint/compiler/native";
import {
  linkModules,
  specializeModule,
  prepareNativeGlobals,
  type LinkedExport,
} from "@tint/ts-native/modules";
import {
  lowerScript,
  scriptRuntimeImports,
  scriptRuntimeSurface,
} from "@tint/js-engine/lowering";

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

test("Script surface instantiations match the real linked export namespaces and arities", () => {
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
  dependencies.set(
    "native-encoding",
    "packages/foundation/src/text/text-encoding/index.ts",
  );
  const imports = [
      ...scriptRuntimeImports(
        { start: 0, end: 0 },
        true,
        true,
        true,
        "all",
        true,
        true,
        false,
        true,
        false,
        true,
        true,
        true,
      ),
    ],
    entry = "runtime-surface-fixture";
  imports.push({
    start: 0,
    end: 0,
    specifier: "native-encoding",
    specifierSpan: { start: 0, end: 0 },
    bindings: [],
    typeOnly: false,
  });
  const runtimes = runtimeSources();
  for (const runtime of runtimes) {
    dependencies.set(runtime.module, runtime.module);
    imports.push({
      start: 0,
      end: 0,
      specifier: runtime.module,
      specifierSpan: { start: 0, end: 0 },
      bindings: [],
      typeOnly: false,
    });
  }
  const modules = [...workspaceModules([...dependencies.values()])];
  modules.push({
    id: entry,
    module: {
      start: 0,
      end: 0,
      imports,
      statements: imports.map((declaration) => ({
        start: 0,
        end: 0,
        kind: "import",
        declaration,
      })),
    },
    dependencies,
  });
  const linked = linkModules(modules, entry, globals, {
    evaluation: "instance",
  });
  assert.ok(linked.ok, JSON.stringify(linked));
  let functions = 0,
    types = 0,
    genericFunctions = 0,
    genericTypes = 0;
  const surface = scriptRuntimeSurface();
  const values: ManagedSurfaceSelection[] = [],
    typeExports: ManagedSurfaceSelection[] = [];
  for (const item of surface) {
    const module = dependencies.get(item.specifier);
    assert.ok(module);
    const exported: LinkedExport | undefined =
      linked.value.exports.find(
        (exported) =>
          exported.module === module &&
          exported.name === item.name &&
          exported.namespace === "value",
      ) ??
      linked.value.exports.find(
        (exported) =>
          exported.module === module &&
          exported.name === item.name &&
          exported.namespace === "type",
      );
    assert.ok(exported, item.name);
    const declaration: Statement | undefined =
      linked.value.module.statements.find(
        (statement) =>
          (statement.kind === "function" ||
            statement.kind === "interface" ||
            statement.kind === "type-alias") &&
          statement.name === exported.linkedName,
      );
    assert.ok(declaration, item.name);
    assert.ok(
      declaration.kind === "function" ||
        declaration.kind === "interface" ||
        declaration.kind === "type-alias",
    );
    const selection: ManagedSurfaceSelection = {
      module,
      name: item.name,
      typeArguments: item.typeArguments.map((argument) =>
        argument === "unknown"
          ? { kind: "keyword", name: "unknown" }
          : { kind: "export", name: argument },
      ),
    };
    (exported.namespace === "value" ? values : typeExports).push(selection);
    const arity: number = declaration.typeParameters?.length ?? 0;
    assert.equal(item.typeArguments.length, arity, item.name);
    if (exported.namespace === "value") {
      assert.equal(declaration.kind, "function");
      functions++;
      if (arity > 0) genericFunctions++;
    } else {
      types++;
      if (arity > 0) genericTypes++;
    }
    for (const argument of item.typeArguments)
      if (argument !== "unknown")
        assert.ok(
          surface.some((entry) => entry.name === argument),
          argument,
        );
  }
  assert.deepEqual(
    { functions, types, genericFunctions, genericTypes },
    { functions: 117, types: 26, genericFunctions: 30, genericTypes: 11 },
  );
  const bound = bindModule(linked.value.module, globals);
  assert.ok(bound.ok, JSON.stringify(bound));
  const constructors = ["TextEncoder", "TextDecoder"].map((global) => {
    const exported = linked.value.exports.find(
      (item) =>
        item.module === dependencies.get("native-encoding") &&
        item.name === "createNative" + global &&
        item.namespace === "value",
    );
    assert.ok(exported);
    return { global, factory: exported.linkedName };
  });
  const normalized = prepareNativeGlobals(
    linked.value.module,
    bound.value,
    constructors,
  );
  assert.ok(normalized.ok, JSON.stringify(normalized));
  const rebound = bindModule(normalized.value, globals);
  assert.ok(rebound.ok, JSON.stringify(rebound));
  const selections = resolveManagedSurfaceSelections(
    linked.value,
    rebound.value,
    values,
    typeExports,
  );
  assert.ok(selections.ok, JSON.stringify(selections));
  assert.equal(selections.value.roots.length, 30);
  const specialized = specializeModule(normalized.value, rebound.value, {
    roots: selections.value.roots,
    maxSpecializations: 4096,
  });
  assert.ok(specialized.ok, JSON.stringify(specialized));
  const table = prepareManagedSurfaceTable(
    specialized.value.module,
    selections.value,
    specialized.value.roots,
    "$ScriptSurface",
    "$ScriptTable",
  );
  assert.ok(table.ok, JSON.stringify(table));
  assert.equal(table.value.surface.entries.length, 117);
  assert.equal(table.value.surface.types.length, 26);
  const canonical = canonicalizeManagedSurfaceTypes(table.value.surface);
  assert.ok(canonical.ok, JSON.stringify(canonical));
  const registryEntries = scriptRuntimeSurface();
  const instantiations = new Map(
    registryEntries.map((entry) => [entry.name, entry.typeArguments]),
  );
  const approvedSpecifiers = new Set(
    registryEntries.map((entry) => entry.specifier),
  );
  const samples = [
    "function f(a,b){return [a,b,function(){return a;}];}var r=f(1,2);r.length;f.call(null,...r);",
    'var o={a:1,b:"x"};var n=0;for(var k in o){n++;}try{throw new TypeError("t");}catch(e){n+=1;}n;',
    'var g=(x)=>x*2;var arr=[1,2,3].map(g);typeof arr;arr[0]===2?"y":"n";',
  ];
  const erased: number[] = [];
  for (const text of samples) {
    const parsed = parseScript(createSourceTextView(text));
    assert.ok(parsed.ok);
    const lowered = lowerScript(parsed.value, text);
    assert.ok(lowered.ok);
    const normalized = normalizeManagedSurfaceApplications(
      lowered.value,
      approvedSpecifiers,
      instantiations,
      canonical.value,
    );
    assert.ok(normalized.ok, JSON.stringify(normalized));
    erased.push(normalized.value.erased);
    const adapted = adaptManagedSurfaceEntry(
      normalized.value.module,
      "execute",
      [...approvedSpecifiers],
      canonical.value,
    );
    assert.ok(adapted.ok, JSON.stringify(adapted));
    const checkedEntry = checkClosureModule(adapted.value.module);
    assert.ok(checkedEntry.ok, JSON.stringify(checkedEntry));
    const declaration = checkedEntry.value.module.statements.find(
      (statement) =>
        statement.kind === "function" && statement.name === adapted.value.entry,
    );
    assert.ok(declaration);
    const wrapper = checkedEntry.value.bindings.functions.find(
      (fn) => fn.node === declaration,
    );
    assert.ok(wrapper);
    const proof = managedDirectCallDeclarations(checkedEntry.value, wrapper.id);
    assert.ok(proof.ok, JSON.stringify(proof));
    assert.deepEqual(
      proof.value.map(
        (id) =>
          checkedEntry.value.bindings.bindings.find(
            (binding) =>
              binding.kind === "function" &&
              binding.node === checkedEntry.value.bindings.functions[id]?.node,
          )?.name,
      ),
      ["execute"],
    );

    const twice = normalizeManagedSurfaceApplications(
      normalized.value.module,
      approvedSpecifiers,
      instantiations,
      canonical.value,
    );
    assert.ok(twice.ok);
    assert.equal(twice.value.erased, 0);
  }
  assert.deepEqual(erased, [33, 36, 24]);

  const wire = serializeManagedSurfaceTypes(canonical.value);
  assert.ok(wire.ok, JSON.stringify(wire));
  assert.equal(wire.value.table, "$T0");
  assert.equal(wire.value.entries[0]?.local, "$helper0");
  const contracts = planManagedSurfaceContracts(table.value.surface);
  assert.ok(contracts.ok, JSON.stringify(contracts));
  const census = planManagedSurfaceRuntimes(contracts.value);
  assert.ok(census.ok, JSON.stringify(census));
  // Module graph lists and import-name Sets include three referrer caches.
  // The caches share one LoadedModuleRequest list class (eight operations).
  // Tail dispatch and exported tail helpers add array aliases while reusing
  // the existing list providers. Async module entry adds one callback alias
  // and signature class. Parsed-unit template ownership adds one TemplateSite
  // list provider with its eight operations. Owner-agent asynchronous waits add
  // one PendingAtomicWait list and its eight operations.
  // Error stack snapshots retain one additional optional-string frame list.
  // Decorator evaluation records add a ClassDecorator list provider and aliases
  // for the independently ordered method, field and class initializer queues.
  // Agent caller reflection reuses one depth-indexed callee slot list.
  assert.equal(census.value.anchors.length, 111);
  assert.equal(census.value.collections.length, 52);
  assert.deepEqual(
    ["list", "set", "map"].map(
      (kind) =>
        census.value.collections.filter((row) => row.kind === kind).length,
    ),
    [44, 2, 6],
  );
  assert.equal(
    census.value.collections.reduce(
      (sum, row) => sum + row.operations.length,
      0,
    ),
    438,
  );

  assert.ok(
    contracts.value.records.some(
      (group) =>
        group.alias === wire.value.table ||
        group.aliases.includes(wire.value.table),
    ),
  );
  for (const entry of contracts.value.surface.entries) {
    assert.equal(entry.type.kind, "named");
    if (entry.type.kind !== "named") continue;
    const name = entry.type.name;
    assert.ok(
      contracts.value.signatures.some(
        (group) => group.alias === name || group.aliases.includes(name),
      ),
      entry.name,
    );
  }

  const facts = deriveManagedSurfacePhysicalFacts(canonical.value, {
    modules: workspaceModules(runtimes.map((runtime) => runtime.module)),
    runtimes,
    globals,
  });
  assert.ok(facts.ok, JSON.stringify(facts));
  assert.equal(facts.value.runtimes.length, 54);
  assert.equal(
    new Set(
      facts.value.runtimes.flatMap((provider) =>
        provider.operations.map((operation) =>
          JSON.stringify([operation.parameters, operation.returnType]),
        ),
      ),
    ).size,
    43,
  );

  assert.equal(
    facts.value.runtimes.reduce((sum, row) => sum + row.operations.length, 0),
    461,
  );
  assert.ok(
    facts.value.runtimes.every((row) =>
      row.operations.every((operation) => operation.returnType !== undefined),
    ),
  );

  assert.equal(
    facts.value.records.length,
    contracts.value.records.reduce(
      (count, group) => count + 1 + group.aliases.length,
      0,
    ),
  );
  assert.equal(
    facts.value.signatures.length,
    contracts.value.signatures.reduce(
      (count, group) => count + 1 + group.aliases.length,
      0,
    ),
  );
  const physicalFacts: ManagedSurfacePhysicalFacts = facts.value;
  for (const group of contracts.value.records) {
    const expected: ManagedSurfacePhysicalFacts["records"][number] | undefined =
      physicalFacts.records.find((entry) => entry.alias === group.alias);
    assert.ok(expected, group.alias);
    for (const alias of group.aliases)
      assert.deepEqual(
        facts.value.records.find((entry) => entry.alias === alias)?.layout,
        expected.layout,
        alias,
      );
  }
  for (const group of contracts.value.signatures) {
    const expected:
      ManagedSurfacePhysicalFacts["signatures"][number] | undefined =
      physicalFacts.signatures.find((entry) => entry.alias === group.alias);
    assert.ok(expected, group.alias);
    for (const alias of group.aliases) {
      const actual:
        ManagedSurfacePhysicalFacts["signatures"][number] | undefined =
        physicalFacts.signatures.find((entry) => entry.alias === alias);
      assert.ok(actual, alias);
      assert.deepEqual(actual.parameters, expected.parameters, alias);
      assert.equal(actual.returnType, expected.returnType, alias);
    }
  }

  const directory = createManagedSurfaceDirectory(
    "script-runtime",
    canonical.value,
    facts.value,
  );
  assert.ok(directory.ok, JSON.stringify(directory));

  assert.equal(
    directory.value.directory.records.length,
    contracts.value.records.length,
  );
  assert.equal(
    directory.value.directory.signatures.length,
    contracts.value.signatures.length,
  );
  const helperFree = directory.value.directory.signatures.filter(
    (entry) => entry.function >= canonical.value.entries.length,
  );
  assert.deepEqual(
    directory.value.witnesses,
    helperFree.map((entry) => entry.alias),
  );
  assert.equal(
    new Set(directory.value.witnesses).size,
    directory.value.witnesses.length,
  );
  const functionValues: readonly unknown[] = Array.from(
    {
      length: canonical.value.entries.length + directory.value.witnesses.length,
    },
    () => () => undefined,
  );
  let domains = 0,
    descriptors = 0,
    signatures = 0;
  const read = readManagedSurfaceDirectory(
    {
      directory: directory.value.directory,
      table: undefined,
      entries: new Float64Array(
        directory.value.directory.runtimes.flatMap((provider) =>
          provider.operations.flatMap((_, index) => [
            0x400004 + index * 4,
            0x500000 + index * 128,
          ]),
        ),
      ),
      functions: functionValues,
      records: new Float64Array(
        directory.value.directory.records.map(
          (_, index) => 0x100000 + index * 1024,
        ),
      ),
    },
    "script-runtime",
    {
      domain: () => {
        domains++;
        return 17;
      },
      descriptor: (_value: unknown) => {
        descriptors++;
        return 0x200000;
      },
      signature: (value: unknown) => {
        signatures++;
        return 0x300000 + functionValues.indexOf(value) * 128;
      },
    },
  );
  assert.ok(read.ok, JSON.stringify(read));
  assert.deepEqual(read.value.directory, directory.value.directory);
  assert.equal(domains, 2);
  assert.equal(descriptors, 1 + directory.value.directory.signatures.length);
  assert.equal(signatures, directory.value.directory.signatures.length);
  assert.equal(
    read.value.records.length,
    directory.value.directory.records.length,
  );

  const anchors = createManagedSurfaceAnchors(
    normalized.value,
    selections.value,
    canonical.value,
    "$ScriptDemand",
  );
  assert.ok(anchors.ok, JSON.stringify(anchors));
  // Exercise context selection over the full vocabulary, including equivalent
  // aliases which must select the same first runtime specialization.
  const collections = createManagedRuntimeAnchors(
    census.value,
    "$ScriptDemand",
  );
  assert.ok(collections.ok);
  const collectionNames = collections.value.anchors.map(
    (anchor) => anchor.name,
  );
  assert.equal(collectionNames.length, 111);
  const collectionModule = {
    ...anchors.value.module,
    statements: [
      ...anchors.value.module.statements,
      ...collections.value.declarations,
    ],
  };
  const anchorBound = bindModule(collectionModule, globals);
  assert.ok(anchorBound.ok);
  const anchored = specializeModule(collectionModule, anchorBound.value, {
    maxSpecializations: 4096,
  });
  assert.ok(anchored.ok, JSON.stringify(anchored));
  const anchorChecked = checkClosureModule(anchored.value.module);
  assert.ok(anchorChecked.ok, JSON.stringify(anchorChecked));
  const helpers = new Map<string, string>();
  for (const exported of linked.value.exports) {
    const runtime = runtimes.find(
      (runtime) => runtime.module === exported.module,
    );
    if (runtime !== undefined && exported.namespace === "value")
      helpers.set(runtime.namespace + ":" + exported.name, exported.linkedName);
  }
  let finalValues: readonly ManagedSurfaceTypeEntry[] = [];
  let collectionOperations: string[][] = [];
  const prepared = prepareCollectionRuntimes(
    collectionModule,
    anchorChecked.value,
    helpers,
    globals,
    (module, context) => {
      const names = resolveManagedRuntimeNames(
        context,
        census.value,
        collections.value,
      );
      if (!names.ok) return names;
      assert.equal(names.value.providers.length, 54);
      assert.equal(names.value.targets.length, 405);
      const exported = prepareManagedRuntimeEntries(
        names.value,
        facts.value.runtimes,
        "$ScriptRuntime",
      );
      assert.ok(exported.ok, JSON.stringify(exported));
      assert.equal(exported.value.slots.length, 461);
      assert.equal(exported.value.stubs.declarations.length, 448);
      assert.equal(
        new Set(exported.value.slots.map((slot) => slot.entry)).size,
        405,
      );
      assert.equal(
        new Set(exported.value.slots.map((slot) => slot.signature)).size,
        43,
      );

      assert.equal(
        names.value.providers.reduce(
          (sum, provider) => sum + provider.targets.length,
          0,
        ),
        461,
      );
      assert.deepEqual(
        names.value.providers.slice(-2).map((provider) => provider.key.kind),
        ["primitive", "number-text"],
      );
      collectionOperations = collections.value.anchors.map((anchor) => [
        ...names.value.providers[anchor.provider]!.targets,
      ]);
      const resolved = resolveManagedSurfaceAnchors(
        module,
        anchors.value.entries,
      );
      if (!resolved.ok) return resolved;
      finalValues = resolved.value;
      const table = materializeManagedSurfaceTable(
        module,
        anchors.value.entries,
        canonical.value,
        "$ScriptFinalTable",
      );
      return table.ok ? { ok: true, value: table.value.module } : table;
    },
  );
  assert.ok(prepared.ok, JSON.stringify(prepared));
  const importIds = runtimeFunctionIds(prepared.value.options);
  assert.equal(importIds.length, new Set(importIds).size);
  for (const name of new Set(collectionOperations.flat())) {
    const declaration = prepared.value.checked.module.statements.find(
      (statement) => statement.kind === "function" && statement.name === name,
    );
    assert.ok(declaration, name);
    const binding = prepared.value.checked.bindings.functions.find(
      (fn) => fn.node === declaration,
    );
    assert.ok(binding, name);
    assert.ok(importIds.includes(binding.id), name);
  }
  assert.equal(finalValues.length, 117);
  assert.equal(collectionOperations.length, 111);
  assert.equal(
    new Set(collectionOperations.map((names) => JSON.stringify(names))).size,
    45,
  );
  assert.equal(new Set(collectionOperations.flat()).size, 382);
  for (const name of new Set(collectionOperations.flat()))
    assert.ok(
      prepared.value.checked.module.statements.some(
        (statement) => statement.kind === "function" && statement.name === name,
      ),
      name,
    );
  const anchorNames = new Set(
    anchors.value.entries.map((entry) => entry.anchor),
  );
  assert.ok(
    !prepared.value.checked.module.statements.some(
      (statement) =>
        statement.kind === "function" && anchorNames.has(statement.name),
    ),
  );
  for (const value of finalValues)
    assert.equal(
      prepared.value.checked.module.statements.filter(
        (statement) =>
          statement.kind === "function" && statement.name === value.local,
      ).length,
      1,
      value.name,
    );

  assert.equal(
    new Set(specialized.value.specializations.map((item) => item.name)).size,
    specialized.value.specializations.length,
  );
});
