import type { BuildRequest } from "./build.ts";
import {
  loadSourceGraph,
  loadSourceGraphLoader,
  requestModules,
  type LoadSourceGraphLoaderResult,
  type ModuleRequest,
  type SourceInput,
  type SourceModuleLoader,
} from "@tint/typescript/modules";
import type { SourceModule } from "@tint/typescript/modules/model";
import type { ImportMapping } from "@tint/source/resolver";
import type {
  RuntimeSource,
  NativeHostBinding,
  NativeForeignBinding,
  ForeignLibrary,
} from "./native/index.ts";
import { dynamicObjectRuntimeModule } from "./native/runtime-contracts.ts";
import {
  foreignDeclaration,
  foreignRuntimeModules,
} from "./native/foreign/index.ts";
/** Capability of the project request constructor for frozen bootstraps. */
export const projectModuleLoader: boolean = true;

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
      module: "packages/foundation/src/collections/number-number-map.ts",
      namespace: "number-number-map",
    },
    {
      module: "packages/foundation/src/collections/string-key-map.ts",
      namespace: "string-key-map",
    },
    {
      module: "packages/foundation/src/collections/string-number-map.ts",
      namespace: "string-number-map",
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
      module: "packages/foundation/src/collections/number-key-set.ts",
      namespace: "number-key-set",
    },
    {
      module: "packages/native-runtime/src/values/index.ts",
      namespace: "primitive-value",
    },
    {
      module: "packages/native-runtime/src/values/bigint.ts",
      namespace: "bigint",
    },
    {
      module: "packages/foundation/src/numeric/number-text/index.ts",
      namespace: "number-text",
    },
    {
      module: "packages/foundation/src/binary/sha256-rounds.ts",
      namespace: "sha256-rounds",
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
    {
      module: "packages/native-runtime/src/intrinsics/console.ts",
      namespace: "native-console",
    },
  ];
}
export function projectRoots(): string[] {
  const roots = [
    "packages/compiler/src/cli.ts",
    "packages/native-runtime/src/index.ts",
    "packages/native-runtime/src/allocators/region/index.ts",
    dynamicObjectRuntimeModule,
  ];
  for (const source of runtimeSources()) {
    if (source === undefined) throw "runtime root invariant";
    roots.push(source.module);
  }
  return roots;
}
/** Ordinary imports can reach the realm. Otherwise the checker must demand it. */
export function loadCompilerSourceGraph(
  inputs: readonly SourceInput[],
  mappings: readonly ImportMapping[],
): LoadSourceGraphLoaderResult {
  const roots = projectRoots();
  const initial = loadSourceGraphLoader(
    inputs,
    mappings,
    roots.filter((root) => root !== dynamicObjectRuntimeModule),
  );
  if (!initial.ok) return initial;
  const loader = initial.value;
  return {
    ok: true,
    value: {
      ids: loader.ids,
      load: loader.load,
      loadWithRoot: (root) => {
        if (!inputs.some((input) => input?.id === root)) return undefined;
        if (root === dynamicObjectRuntimeModule)
          return loadSourceGraph(inputs, mappings, roots);
        if (root !== foreignRuntimeModules.sysv) return undefined;
        const additional = loader.ids.slice();
        additional.push(root);
        return loadSourceGraph(inputs, mappings, additional);
      },
    },
  };
}
/** File operations whose leaf C calls `tint:c/libsystem` declares
 * (docs/native-ffi.md): bound as c-calls when the binding module is
 * supplied, else (frozen graphs that predate it) as host operations. */
const foreignFileOperations: readonly {
  readonly name: string;
  readonly declaration: string;
  readonly operation: "close" | "chmod" | "rename" | "unlink";
}[] = [
  { name: "close", declaration: "close", operation: "close" },
  { name: "chmod", declaration: "fchmod", operation: "chmod" },
  { name: "rename", declaration: "rename", operation: "rename" },
  { name: "unlink", declaration: "unlink", operation: "unlink" },
];
export function projectBuildRequest(
  modules: readonly SourceModule[],
  report: (stage: string) => void,
  foreignLibraries: readonly ForeignLibrary[] = [],
  moduleLoader?: SourceModuleLoader,
): BuildRequest {
  const fs = "packages/native-runtime/src/intrinsics/fs.ts",
    process = "packages/native-runtime/src/intrinsics/process.ts";
  const bindings: NativeHostBinding[] = [
    { module: fs, name: "openRead", operation: "open-read" },
    { module: fs, name: "openExclusive", operation: "open-exclusive" },
    { module: fs, name: "read", operation: "read" },
    { module: fs, name: "write", operation: "write" },
    { module: process, name: "argumentCount", operation: "argument-count" },
    {
      module: process,
      name: "argumentByteLength",
      operation: "argument-length",
    },
    { module: process, name: "copyArgument", operation: "argument-copy" },
  ];
  const foreignBindings: NativeForeignBinding[] = [];
  for (const file of foreignFileOperations) {
    if (file === undefined) throw "foreign file operation invariant";
    if (
      foreignDeclaration(
        foreignLibraries,
        "tint:c/libsystem",
        file.declaration,
      ) === undefined
    )
      bindings.push({ module: fs, name: file.name, operation: file.operation });
    else
      foreignBindings.push({
        module: fs,
        name: file.name,
        library: "tint:c/libsystem",
        declaration: file.declaration,
      });
  }
  // Additional host services follow the supplied facade, including frozen source
  // graphs. Mandatory compiler I/O bindings remain unconditional and fail closed.
  const sourceRequest: ModuleRequest = { modules, moduleLoader };
  // Hand-tuned intrinsics and build facts replace portable bodies where the
  // source defines the bound function (frozen snapshots may predate it;
  // their single compressSha256Rounds assumed the SHA-256 instructions).
  const intrinsics: NativeHostBinding[] = [
    {
      module: "packages/foundation/src/binary/sha256-rounds.ts",
      name: "compressSha256Rounds",
      operation: "sha256-rounds",
    },
    {
      module: "packages/foundation/src/binary/sha256-rounds.ts",
      name: "compressSha256RoundsWithInstructions",
      operation: "sha256-rounds",
    },
    {
      module: "packages/foundation/src/binary/sha256-rounds.ts",
      name: "sha256InstructionsAvailable",
      operation: "cpu-sha256",
    },
    { module: process, name: "targetOperatingSystem", operation: "target-os" },
    {
      module: process,
      name: "targetArchitecture",
      operation: "target-architecture",
    },
  ];
  const selected = requestModules(sourceRequest, [
    fs,
    process,
    "packages/foundation/src/binary/sha256-rounds.ts",
  ]);
  for (const intrinsic of intrinsics) {
    if (intrinsic === undefined) throw "intrinsic binding invariant";
    if (hasProjectFunction(selected, intrinsic.module, intrinsic.name))
      bindings.push(intrinsic);
  }
  if (hasProjectFunction(selected, fs, "readlink"))
    bindings.push({ module: fs, name: "readlink", operation: "read-link" });
  return {
    modules,
    moduleLoader,
    maxSpecializations: 16384,
    denseReferenceLists: true,
    entry: "packages/compiler/src/cli.ts",
    start: "main",
    runtimes: runtimeSources(),
    hostBindings: bindings,
    foreignLibraries,
    foreignBindings,
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
function hasProjectFunction(
  modules: readonly SourceModule[],
  id: string,
  name: string,
): boolean {
  const source = modules.find(
    (module) => module !== undefined && module.id === id,
  );
  return (
    source !== undefined &&
    source.module.statements.some(
      (statement) =>
        statement !== undefined &&
        statement.kind === "function" &&
        statement.name === name,
    )
  );
}
/** The compiler executable's own build: the project request plus the
 * monotonic clock its `--pass-stats` timing reads (when the source graph
 * defines it; older frozen graphs build without timing). */
export function compilerBuildRequest(
  modules: readonly SourceModule[],
  report: (stage: string) => void,
  foreignLibraries: readonly ForeignLibrary[] = [],
  moduleLoader?: SourceModuleLoader,
): BuildRequest {
  // The self-build's speed is the compiler benchmark: it must stay typed.
  const request: BuildRequest = {
    ...projectBuildRequest(modules, report, foreignLibraries, moduleLoader),
    requireTyped: true,
  };
  const clock = "packages/native-runtime/src/intrinsics/clock.ts";
  if (
    !hasProjectFunction(
      requestModules(request, [clock]),
      clock,
      "monotonicMilliseconds",
    )
  )
    return request;
  const runtimes = request.runtimes.slice(),
    hostBindings = request.hostBindings.slice();
  runtimes.push({ module: clock, namespace: "native-clock" });
  hostBindings.push({
    module: clock,
    name: "monotonicMilliseconds",
    operation: "monotonic-time",
  });
  return { ...request, runtimes, hostBindings };
}
