import {
  nativeFunctionByteLength,
  nativeFunctionReferenceCount,
  nativeFunctionEnvironmentOffset,
  nativeFunctionGeneralCount,
  nativeSignatureVersion,
  nativeSignatureHeaderByteLength,
  nativeSignatureParameterByteLength,
} from "@tint/abi/function";
import { nativeSignatureTypeCode } from "@tint/codegen/aarch64/scalar";
import {
  scriptRuntimeGlobals as managedScriptGlobals,
  createScriptRuntimeRequest,
  scriptEntryFrameModule,
} from "./script-runtime-request.ts";
import assert from "node:assert/strict";
import { type ImportDeclaration } from "@tint/typescript/syntax";
import type { SourceModule } from "@tint/typescript/modules/model";
import { bindModule } from "@tint/typescript/binding";
import {
  linkModules,
  prepareNativeGlobals,
  specializeModule,
  type NativeConstructor,
} from "@tint/ts-native/modules";
import { runtimeSources } from "@tint/compiler/cli";
import * as compiler from "@tint/compiler/native";
import {
  scriptRuntimeImports,
  scriptRuntimeSurface,
} from "@tint/js-engine/lowering";
import { workspaceModules } from "./workspace-sources.ts";
export { scriptRuntimeGlobals as managedScriptGlobals } from "./script-runtime-request.ts";
/** Node-only fixture. Its numeric leaves model an issued directory for emission
 * and selection tests; they are never dereferenced or executed. Native fixtures
 * obtain the same declarations and directory from their image's bind stub. */
export function createManagedScriptFixture() {
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
    ["native-encoding", "packages/foundation/src/text/text-encoding/index.ts"],
  ]);
  const imports: ImportDeclaration[] = [
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
      false,
      false,
      true,
      true,
    ),
  ];
  const append = (specifier: string) =>
    imports.push({
      start: 0,
      end: 0,
      specifier,
      specifierSpan: { start: 0, end: 0 },
      bindings: [],
      typeOnly: false,
    });
  append("native-encoding");
  const runtimes = runtimeSources();
  for (const runtime of runtimes) {
    dependencies.set(runtime.module, runtime.module);
    append(runtime.module);
  }
  dependencies.set("script-frame", scriptEntryFrameModule);
  append("script-frame");
  const modules: SourceModule[] = [
    ...workspaceModules([...dependencies.values()]),
  ];
  const root = "runtime-surface-fixture";
  modules.push({
    id: root,
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
  const linked = linkModules(modules, root, managedScriptGlobals, {
    evaluation: "instance",
  });
  assert.ok(linked.ok, JSON.stringify(linked));
  const request = createScriptRuntimeRequest({
    module: "fixture-host",
    name: "bindScript",
  });
  const values = request.values,
    types = request.types;
  const bound = bindModule(linked.value.module, managedScriptGlobals);
  assert.ok(bound.ok);
  const constructors: NativeConstructor[] = [];
  for (const global of ["TextEncoder", "TextDecoder"]) {
    const factory = linked.value.exports.find(
      (e) =>
        e.module === dependencies.get("native-encoding") &&
        e.name === "createNative" + global &&
        e.namespace === "value",
    );
    assert.ok(factory);
    constructors.push({ global, factory: factory.linkedName });
  }
  const normalized = prepareNativeGlobals(
    linked.value.module,
    bound.value,
    constructors,
  );
  assert.ok(normalized.ok, JSON.stringify(normalized));
  const rebound = bindModule(normalized.value, managedScriptGlobals);
  assert.ok(rebound.ok);
  const selected = compiler.resolveManagedSurfaceSelections(
    linked.value,
    rebound.value,
    values,
    types,
  );
  assert.ok(selected.ok, JSON.stringify(selected));
  const specialized = specializeModule(normalized.value, rebound.value, {
    roots: selected.value.roots,
    maxSpecializations: 4096,
  });
  assert.ok(specialized.ok, JSON.stringify(specialized));
  const table = compiler.prepareManagedSurfaceTable(
    specialized.value.module,
    selected.value,
    specialized.value.roots,
    "$ScriptSurface",
    "$ScriptTable",
  );
  assert.ok(table.ok, JSON.stringify(table));
  const canonical = compiler.canonicalizeManagedSurfaceTypes(
    table.value.surface,
  );
  assert.ok(canonical.ok, JSON.stringify(canonical));
  const runtime = {
    modules: workspaceModules(runtimes.map((r) => r.module)),
    runtimes,
    globals: managedScriptGlobals,
  };
  const facts = compiler.deriveManagedSurfacePhysicalFacts(
    canonical.value,
    runtime,
  );
  assert.ok(facts.ok, JSON.stringify(facts));
  const directory = compiler.createManagedSurfaceDirectory(
    "scriptRuntime",
    canonical.value,
    facts.value,
    "ScriptEntryFrame",
  );
  assert.ok(directory.ok, JSON.stringify(directory));
  const functions: unknown[] = Array.from(
    {
      length: canonical.value.entries.length + directory.value.witnesses.length,
    },
    () => () => undefined,
  );
  const entries: number[] = [];
  for (const provider of directory.value.directory.runtimes)
    for (const operation of provider.operations) {
      const slot = entries.length / 2;
      entries.push(0x400004 + slot * 4, 0x500000 + slot * 128);
    }
  const read = compiler.readManagedSurfaceDirectory(
    {
      directory: directory.value.directory,
      table: undefined,
      functions,
      records: Float64Array.from(
        directory.value.directory.records,
        (_, index) => 0x100000 + index * 1024,
      ),
      entries: Float64Array.from(entries),
    },
    "scriptRuntime",
    {
      domain: () => 17,
      descriptor: () => 0x200000,
      signature: (fn) => {
        const index = functions.indexOf(fn);
        assert.ok(index >= 0);
        return 0x300000 + index * 128;
      },
    },
  );
  assert.ok(read.ok, JSON.stringify(read));
  return {
    read: read.value,
    runtime,
    specifiers: new Set(scriptRuntimeSurface().map((item) => item.specifier)),
    instantiations: new Map(
      scriptRuntimeSurface().map((item) => [item.name, item.typeArguments]),
    ),
  };
}

/** Synthetic metadata windows for Node linking tests. These numbers model issued
 * bindings; they are never native addresses or authority to read real memory. */
export function managedScriptMemoryModel(
  read: compiler.ManagedSurfaceDirectoryRead,
) {
  const windows = new Map<number, readonly number[]>();
  const references = new Set([
    "primitive",
    "reference",
    "optional-reference",
    "optional-string",
    "string",
    "Uint8Array",
    "Uint16Array",
    "Uint32Array",
    "Float64Array",
  ]);
  for (const binding of [
    read.brand,
    ...read.signatures,
    ...read.records,
    ...read.runtimes,
  ]) {
    let words: number[];
    if (binding.role === "function-brand")
      words = [
        nativeFunctionByteLength,
        nativeFunctionReferenceCount,
        nativeFunctionEnvironmentOffset,
        nativeFunctionGeneralCount,
      ];
    else if (binding.role === "record") {
      const layout = binding.recordLayout;
      assert.ok(layout);
      const refs = layout.fields
          .filter((field) => references.has(field.type))
          .map((field) => field.offset),
        general = layout.fields
          .filter((field) => field.type === "general")
          .map((field) => field.offset);
      words = [
        layout.byteLength,
        refs.length,
        ...refs,
        general.length,
        ...general,
      ];
    } else {
      assert.ok(binding.returnType !== undefined);
      words = [
        nativeSignatureVersion,
        nativeSignatureHeaderByteLength +
          nativeSignatureParameterByteLength * binding.parameters.length,
        binding.parameters.length,
        nativeSignatureTypeCode(binding.returnType),
        ...binding.parameters.map(nativeSignatureTypeCode),
      ];
    }
    assert.equal(words.length * 8, binding.byteLength);
    assert.equal(
      compiler.managedIdentityByteLength(binding),
      binding.byteLength,
    );
    const previous = windows.get(binding.address);
    if (previous !== undefined) assert.deepEqual(previous, words);
    windows.set(binding.address, words);
  }
  const state = { reads: 0 };
  return {
    state,
    readWord: (address: number, byteLength: number, offset: number): number => {
      state.reads++;
      const words = windows.get(address);
      if (
        words === undefined ||
        words.length * 8 !== byteLength ||
        !Number.isSafeInteger(offset) ||
        offset < 0 ||
        offset % 8 !== 0
      )
        return -1;
      return words[offset / 8] ?? -1;
    },
  };
}
