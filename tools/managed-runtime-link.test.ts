import { test } from "node:test";
import assert from "node:assert/strict";
import { createSourceTextView } from "@tint/source/text";
import {
  parseModule,
  type ImportDeclaration,
  type Module,
} from "@tint/typescript/syntax";
import { bindModule } from "@tint/typescript/binding";
import { checkClosureModule } from "@tint/typescript/checker";
import { runtimeSources } from "@tint/compiler/cli";
import * as compiler from "@tint/compiler/native";
import { linkModules, specializeModule } from "@tint/ts-native/modules";
import {
  prepareCollectionRuntimes,
  runtimeFunctionIds,
} from "@tint/ts-native/runtime";
import { lowerModuleEntries } from "@tint/ts-native/closure/lowering";
import { pruneClosedModule, optimizeModule } from "@tint/ir/optimization";
import { verify } from "@tint/ir/scalar";
import {
  emitModule,
  nativeSignatureTypeCode,
} from "@tint/codegen/aarch64/scalar";
import { workspaceModules } from "./workspace-sources.ts";
import {
  managedRuntimeKeyForSurfaceType,
  describeManagedRuntimeUses,
  finalFunctionSources,
  bindManagedRuntimeImports,
} from "../packages/compiler/src/native/managed-runtime-selection.ts";
const globals = [
  "undefined",
  "NaN",
  "Infinity",
  "Array",
  "String",
  "Boolean",
  "ArrayBuffer",
  "SharedArrayBuffer",
  "DataView",
  "TextEncoder",
  "TextDecoder",
  "Number",
  "Math",
  "Atomics",
  "Map",
  "Set",
  "Uint8Array",
  "Uint16Array",
  "Uint32Array",
  "Float64Array",
  "TypeError",
  "RangeError",
];
function parse(text: string): Module {
  const parsed = parseModule(createSourceTextView(text));
  assert.ok(parsed.ok);
  return parsed.value;
}

test("real list lowering imports image helpers and links through canonical operation contracts", () => {
  const checked = checkClosureModule(
    parse(
      "type Names=readonly string[];function names(values:Names):number{return values.length;}function make():string[]{return [];}",
    ),
  );
  assert.ok(checked.ok);
  const described = compiler.reifyManagedSurfaceTypes(
    checked.value,
    [
      { name: "names", local: "names" },
      { name: "make", local: "make" },
    ],
    "$Surface",
    [{ name: "Names", local: "Names" }],
  );
  assert.ok(described.ok);
  const canonical = compiler.canonicalizeManagedSurfaceTypes(described.value);
  assert.ok(canonical.ok);
  const runtimes = runtimeSources();
  const facts = compiler.deriveManagedSurfacePhysicalFacts(canonical.value, {
    modules: workspaceModules(runtimes.map((runtime) => runtime.module)),
    runtimes,
    globals,
  });
  assert.ok(facts.ok, JSON.stringify(facts));
  const directory = compiler.createManagedSurfaceDirectory(
    "listRuntime",
    canonical.value,
    facts.value,
  );
  assert.ok(directory.ok);
  const key = managedRuntimeKeyForSurfaceType(
    directory.value.contracts,
    "Names",
  );
  assert.ok(key.ok);
  const sparse = runtimes.find(
    (runtime) => runtime.namespace === "sparse-list",
  );
  assert.ok(sparse);
  const imports: ImportDeclaration[] = [sparse.module, "jit"].map(
    (specifier) => ({
      start: 0,
      end: 0,
      specifier,
      specifierSpan: { start: 0, end: 0 },
      bindings: [],
      typeOnly: false,
    }),
  );
  const linked = linkModules(
    [
      ...workspaceModules([sparse.module]),
      {
        id: "jit",
        module: parse(
          'export function entry():number{const values:string[]=[];values.push("a");values.push("b");return values.length;}',
        ),
        dependencies: new Map<string, string>(),
      },
      {
        id: "root",
        module: {
          start: 0,
          end: 0,
          imports,
          statements: imports.map((declaration) => ({
            kind: "import" as const,
            start: 0,
            end: 0,
            declaration,
          })),
        },
        dependencies: new Map([
          [sparse.module, sparse.module],
          ["jit", "jit"],
        ]),
      },
    ],
    "root",
    globals,
    { evaluation: "instance" },
  );
  assert.ok(linked.ok, JSON.stringify(linked));
  const helpers = new Map<string, string>();
  for (const exported of linked.value.exports)
    if (exported.module === sparse.module && exported.namespace === "value")
      helpers.set(sparse.namespace + ":" + exported.name, exported.linkedName);
  const bound = bindModule(linked.value.module, globals);
  assert.ok(bound.ok);
  const specialized = specializeModule(linked.value.module, bound.value, {
    maxSpecializations: 4096,
  });
  assert.ok(specialized.ok);
  const graph = checkClosureModule(specialized.value.module);
  assert.ok(graph.ok);
  const prepared = prepareCollectionRuntimes(
    linked.value.module,
    graph.value,
    helpers,
    globals,
  );
  assert.ok(prepared.ok, JSON.stringify(prepared));
  const entryExport = linked.value.exports.find(
    (item) => item.module === "jit" && item.name === "entry",
  );
  assert.ok(entryExport);
  const declaration = prepared.value.checked.module.statements.find(
    (statement) =>
      statement.kind === "function" &&
      statement.name === entryExport.linkedName,
  );
  assert.ok(declaration);
  const entry = prepared.value.checked.bindings.functions.find(
    (fn) => fn.node === declaration,
  );
  assert.ok(entry);
  const imported = runtimeFunctionIds(prepared.value.options);
  assert.equal(imported.length, 8);
  const lowered = lowerModuleEntries(
    prepared.value.checked,
    [entry.id],
    {
      pointerSize: 8,
      wordSize: 8,
      allocationAlignment: 16,
      frameAlignment: 16,
      maxAlignment: 16,
    },
    4096,
    { ...prepared.value.options, importedFunctions: imported },
  );
  assert.ok(lowered.ok, JSON.stringify(lowered));
  const root = lowered.value.entries.indexOf(entry.id);
  assert.ok(root >= 0);
  const first = pruneClosedModule(lowered.value.module, [root]);
  assert.ok(first);
  const optimized = optimizeModule(first.module);
  const second = pruneClosedModule(optimized.module, [
    (first.functionIds[root] ?? 0) - 1,
  ]);
  assert.ok(second);
  assert.ok(verify(second.module).ok);
  assert.equal(second.module.functions.filter((fn) => fn.import).length, 3);
  assert.equal(second.module.functions.filter((fn) => !fn.import).length, 1);
  const sources = finalFunctionSources(
    lowered.value.entries,
    [first.functionIds, second.functionIds],
    second.module.functions.length,
  );
  for (const fn of second.module.functions)
    if (!fn.import) assert.equal(sources[fn.id], entry.id);
  const uses = describeManagedRuntimeUses(prepared.value.options, {
    lists: (prepared.value.options.lists ?? []).map((binding) =>
      binding.element === "string" ? key.value : undefined,
    ),
    sets: [],
    maps: [],
  });
  assert.ok(uses.ok);
  const bindings = bindManagedRuntimeImports(
    directory.value.directory,
    second.module,
    sources,
    uses.value,
  );
  assert.ok(bindings.ok, JSON.stringify(bindings));
  assert.deepEqual(
    bindings.value
      .map((binding) => Number(binding.contract.split("/").at(-1)))
      .sort((a, b) => a - b),
    [0, 3, 4],
  );
  const finalRoot =
    (second.functionIds[(first.functionIds[root] ?? 0) - 1] ?? 0) - 1;
  const emitted = emitModule(second.module, {
    closedRoots: [finalRoot],
    managedABI: { version: 1, signatures: [], functions: bindings.value },
  });
  assert.ok(emitted.ok, JSON.stringify(emitted));
  assert.equal(emitted.value.managedImports.length, 3);
  const data = directory.value.directory,
    slots = data.runtimes.reduce(
      (count, provider) => count + provider.operations.length,
      0,
    );
  const entries = new Float64Array(slots * 2);
  for (let slot = 0; slot < slots; slot++) {
    entries[slot * 2] = 0x800004 + slot * 4;
    entries[slot * 2 + 1] = 0x900000 + slot * 128;
  }
  const functions: readonly unknown[] = Array.from(
    {
      length: canonical.value.entries.length + directory.value.witnesses.length,
    },
    () => () => 42,
  );
  const read = compiler.readManagedSurfaceDirectory(
    {
      directory: data,
      table: {},
      functions,
      records: new Float64Array(
        data.records.map((_, index) => 0x4000 + index * 1024),
      ),
      entries,
    },
    "listRuntime",
    {
      domain: () => 17,
      descriptor: () => 0x1000,
      signature: (value) => 0x2000 + functions.indexOf(value) * 128,
    },
  );
  assert.ok(read.ok, JSON.stringify(read));
  let reads = 0;
  const reader = (address: number, length: number, offset: number) => {
    reads++;
    const binding = read.value.runtimes.find(
      (item) => item.address === address,
    );
    assert.ok(binding);
    if (offset === 0) return 1;
    if (offset === 8) return length;
    if (offset === 16) return binding.parameters.length;
    if (offset === 24) return nativeSignatureTypeCode(binding.returnType!);
    const type = binding.parameters[(offset - 32) / 8];
    assert.ok(type);
    return nativeSignatureTypeCode(type);
  };
  const original = emitted.value.code.slice();
  const foreign = compiler.linkManagedSurfaceModule(
    read.value,
    emitted.value,
    reader,
    18,
  );
  assert.equal(foreign.ok, false);
  assert.equal(reads, 0);
  const patched = compiler.linkManagedSurfaceModule(
    read.value,
    emitted.value,
    reader,
    17,
  );
  assert.ok(patched.ok, JSON.stringify(patched));
  assert.equal(reads, 16);
  assert.deepEqual(emitted.value.code, original);
  for (const request of emitted.value.managedImports) {
    const issued: compiler.ManagedIdentityBinding | undefined =
      read.value.runtimes.find(
        (binding) => binding.contract === request.contract,
      );
    assert.ok(issued);
    assert.equal(
      new DataView(patched.value.code.buffer).getBigUint64(
        request.offset,
        true,
      ),
      BigInt(issued.entry!),
    );
  }
});
