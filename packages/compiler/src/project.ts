import type { BuildRequest } from "./build.ts";
import type { SourceModule } from "@tint/typescript/modules/model";
import type { RuntimeSource, NativeHostBinding } from "./native/index.ts";
export function runtimeSources(): RuntimeSource[] {
  return [
    {
      module: "packages/foundation/src/collections/number-list.ts",
      namespace: "number-list",
    },
    {
      module: "packages/foundation/src/collections/linked-map.ts",
      namespace: "linked-map",
    },
    {
      module: "packages/foundation/src/collections/number-key-map.ts",
      namespace: "number-key-map",
    },
    {
      module: "packages/foundation/src/collections/string-key-map.ts",
      namespace: "string-key-map",
    },
    {
      module: "packages/foundation/src/collections/sparse-list.ts",
      namespace: "sparse-list",
    },
    {
      module: "packages/foundation/src/collections/linked-set.ts",
      namespace: "linked-set",
    },
    {
      module: "packages/native-runtime/src/values/index.ts",
      namespace: "primitive-value",
    },
    {
      module: "packages/foundation/src/numeric/number-text/index.ts",
      namespace: "number-text",
    },
    {
      module: "packages/foundation/src/collections/indexed-sort.ts",
      namespace: "indexed-sort",
    },
    {
      module: "packages/foundation/src/collections/list-sort.ts",
      namespace: "list-sort",
    },
    {
      module: "packages/foundation/src/text/text-encoding/index.ts",
      namespace: "text-encoding",
    },
    {
      module: "packages/native-runtime/src/intrinsics/fs.ts",
      namespace: "native-fs-host",
    },
    {
      module: "packages/native-runtime/src/intrinsics/process.ts",
      namespace: "native-process",
    },
  ];
}
export function projectRoots(): string[] {
  const roots = [
    "packages/compiler/src/cli.ts",
    "packages/native-runtime/src/index.ts",
    "packages/native-runtime/src/allocators/region/index.ts",
  ];
  for (const source of runtimeSources()) {
    if (source === undefined) throw "runtime root invariant";
    roots.push(source.module);
  }
  return roots;
}
export function projectBuildRequest(
  modules: readonly SourceModule[],
  report: (stage: string) => void,
): BuildRequest {
  const fs = "packages/native-runtime/src/intrinsics/fs.ts",
    process = "packages/native-runtime/src/intrinsics/process.ts";
  const bindings: NativeHostBinding[] = [
    { module: fs, name: "openRead", operation: "open-read" },
    { module: fs, name: "openExclusive", operation: "open-exclusive" },
    { module: fs, name: "read", operation: "read" },
    { module: fs, name: "write", operation: "write" },
    { module: fs, name: "close", operation: "close" },
    { module: fs, name: "chmod", operation: "chmod" },
    { module: fs, name: "rename", operation: "rename" },
    { module: fs, name: "unlink", operation: "unlink" },
    { module: process, name: "argumentCount", operation: "argument-count" },
    {
      module: process,
      name: "argumentByteLength",
      operation: "argument-length",
    },
    { module: process, name: "copyArgument", operation: "argument-copy" },
  ];
  // Additional host services follow the supplied facade, including frozen source
  // graphs. Mandatory compiler I/O bindings remain unconditional and fail closed.
  const fileHost = modules.find(
    (module) => module !== undefined && module.id === fs,
  );
  if (
    fileHost !== undefined &&
    fileHost.module.statements.some(
      (statement) =>
        statement !== undefined &&
        statement.kind === "function" &&
        statement.name === "readlink",
    )
  )
    bindings.push({ module: fs, name: "readlink", operation: "read-link" });
  return {
    modules,
    maxSpecializations: 16384,
    denseReferenceLists: true,
    entry: "packages/compiler/src/cli.ts",
    start: "main",
    runtimes: runtimeSources(),
    hostBindings: bindings,
    allocatorModule: "packages/native-runtime/src/allocators/region/index.ts",
    runtimeModule: "packages/native-runtime/src/index.ts",
    runtimeEntry: "initializeGenerationalRuntime",
    memoryModule: "packages/native-runtime/src/intrinsics/memory.ts",
    identifier: "tint-compiler",
    // The measured emission live set exceeds 1.76 GB, excluding output storage.
    // Use the aligned uint32 extent supported by both relocation spaces. Native
    // CLI output and Node bootstrap must share this budget for stage identity.
    managedBytes: 4294966272,
    controlBytes: 65536,
    // Compiler syntax, bindings and index entries are predominantly small objects.
    // Descriptor capacity must cover their count independently of heap bytes.
    // Native self-build profiles reached the former 16M/64M caps before the
    // heap could serve the next phase; this allows 96M small allocations.
    allocationCapacity: 100663296,
    rootCapacity: 1048576,
    stackBytes: 268435456,
    report,
  };
}
