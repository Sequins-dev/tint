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
import type { NativeTarget } from "@tint/platform/target";
import type {
  RuntimeSource,
  NativeHostBinding,
  NativeForeignBinding,
  ForeignLibrary,
} from "./native/index.ts";
import {
  dynamicObjectRuntimeModule,
  isOptionalBuiltinRuntimeModule,
  optionalBuiltinRuntimes,
} from "./native/runtime-contracts.ts";
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
      module: "packages/foundation/src/collections/compact-map.ts",
      namespace: "compact-map",
    },
    {
      module: "packages/foundation/src/collections/compact-number-map.ts",
      namespace: "compact-number-map",
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
      module: "packages/foundation/src/collections/compact-set.ts",
      namespace: "compact-set",
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
      module: "packages/foundation/src/numeric/number-string-cache.ts",
      namespace: "number-string-cache",
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
      module: "packages/foundation/src/text/latin1.ts",
      namespace: "latin1",
    },
    {
      module: "packages/foundation/src/text/utf8.ts",
      namespace: "utf8",
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
  for (const source of optionalBuiltinRuntimes) {
    if (source === undefined) throw "optional builtin root invariant";
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
  const cliThreaded = "packages/compiler/src/cli-threaded.ts";
  const workersEnabled = mappings.some(
    (mapping) =>
      mapping !== undefined &&
      mapping.specifier === "@tint/platform/parallel-host" &&
      mapping.target !== "packages/platform/src/parallel-host.ts",
  );
  if (
    workersEnabled &&
    inputs.some((input) => input !== undefined && input.id === cliThreaded)
  )
    roots.push(cliThreaded);
  const initial = loadSourceGraphLoader(
    inputs,
    mappings,
    roots.filter(
      (root) =>
        root !== dynamicObjectRuntimeModule &&
        !isOptionalBuiltinRuntimeModule(root),
    ),
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
        if (
          root === dynamicObjectRuntimeModule ||
          isOptionalBuiltinRuntimeModule(root)
        )
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
    process = "packages/native-runtime/src/intrinsics/process.ts",
    latin1 = "packages/foundation/src/text/latin1.ts",
    utf8 = "packages/foundation/src/text/utf8.ts",
    numberStrings = "packages/foundation/src/numeric/number-string-cache.ts";
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
    { module: latin1, name: "latin1Text", operation: "string-from-latin1" },
    { module: latin1, name: "copyLatin1", operation: "string-copy-latin1" },
    {
      module: latin1,
      name: "asciiEndOfText",
      operation: "string-ascii-prefix",
    },
    {
      module: latin1,
      name: "asciiEndOfBytes",
      operation: "bytes-ascii-prefix",
    },
    {
      module: latin1,
      name: "asciiUppercase",
      operation: "string-ascii-upper",
    },
    {
      module: latin1,
      name: "asciiLowercase",
      operation: "string-ascii-lower",
    },
    { module: utf8, name: "utf8ByteLength", operation: "string-utf8-length" },
    { module: utf8, name: "writeUTF8", operation: "string-write-utf8" },
    {
      module: utf8,
      name: "writeUTF8Bytes",
      operation: "string-write-utf8-bytes",
    },
    { module: utf8, name: "utf8Text", operation: "string-from-utf8" },
    {
      module: utf8,
      name: "utf8WholeText",
      operation: "string-from-utf8-whole",
    },
    {
      module: numberStrings,
      name: "numberStringCached",
      operation: "number-string-cached",
    },
    {
      module: numberStrings,
      name: "cacheNumberString",
      operation: "number-string-cache",
    },
    {
      module: numberStrings,
      name: "cachedArrayIndex",
      operation: "string-index-cached",
    },
    {
      module: numberStrings,
      name: "cacheArrayIndex",
      operation: "string-index-cache",
    },
  ];
  const selected = requestModules(sourceRequest, [
    fs,
    process,
    "packages/foundation/src/binary/sha256-rounds.ts",
    latin1,
    utf8,
    numberStrings,
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
function hasParallelWorkerLibraries(
  foreignLibraries: readonly ForeignLibrary[],
): boolean {
  if (
    foreignDeclaration(
      foreignLibraries,
      "tint:c/worker-thread-host",
      "pipe",
    ) === undefined
  )
    return false;
  return (
    foreignDeclaration(foreignLibraries, "tint:c/darwin-reactor", "kqueue") !==
      undefined ||
    foreignDeclaration(
      foreignLibraries,
      "tint:c/linux-reactor",
      "epoll_create1",
    ) !== undefined
  );
}

/** Specialize workspace import mappings for the target compiler executable so
 * AArch64 targets bind their OS-specific worker reactor and native worker
 * runner while x86-64/Node targets keep the portable stubs. */
export function compilerMappingsForTarget(
  mappings: readonly ImportMapping[],
  target: NativeTarget,
  foreignLibraries: readonly ForeignLibrary[],
): ImportMapping[] {
  const enableWorkers =
    target.arch === "aarch64" && hasParallelWorkerLibraries(foreignLibraries);
  const parallelHostTarget =
    target.os === "linux"
      ? "packages/platform/src/linux/parallel-host.ts"
      : "packages/platform/src/darwin/parallel-host.ts";
  const result: ImportMapping[] = [];
  for (const mapping of mappings) {
    if (mapping === undefined) throw "compiler mapping invariant";
    if (enableWorkers && mapping.specifier === "@tint/platform/parallel-host") {
      result.push({
        packageId: mapping.packageId,
        specifier: mapping.specifier,
        target: parallelHostTarget,
      });
      continue;
    }
    result.push(mapping);
  }
  return result;
}

/** The compiler executable's own build: the project request plus the
 * monotonic clock its `--pass-stats` timing reads (when the source graph
 * defines it; older frozen graphs build without timing), and native worker
 * bindings when the target supports threaded AArch64 workers. */
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
  const memory = "packages/native-runtime/src/intrinsics/memory.ts";
  const shared = "packages/native-runtime/src/intrinsics/shared-atomics.ts";
  const packet = "packages/native-runtime/src/intrinsics/packet-memory.ts";
  const primitives = "packages/native-runtime/src/ffi/primitives.ts";
  const cliThreaded = "packages/compiler/src/cli-threaded.ts";
  const selected = requestModules(request, [
    clock,
    cliThreaded,
    shared,
    packet,
  ]);
  const runtimes = request.runtimes.slice(),
    hostBindings = request.hostBindings.slice(),
    foreignMemoryBindings = (request.foreignMemoryBindings ?? []).slice();
  if (hasProjectFunction(selected, clock, "monotonicMilliseconds")) {
    runtimes.push({ module: clock, namespace: "native-clock" });
    hostBindings.push({
      module: clock,
      name: "monotonicMilliseconds",
      operation: "monotonic-time",
    });
  }
  const hasParallelWorkers =
    hasParallelWorkerLibraries(foreignLibraries) &&
    hasProjectFunction(selected, cliThreaded, "mainThreaded") &&
    hasProjectFunction(selected, shared, "readSharedWord64") &&
    hasProjectFunction(selected, packet, "readMemoryFloat64");
  if (!hasParallelWorkers) return { ...request, runtimes, hostBindings };
  const memoryExports = [
    "mapMemory",
    "unmapMemory",
    "memoryPageBytes",
    "parkNativeWord",
    "wakeNativeWord",
    "startNativeThread",
    "hostedThreadEntry",
    "collectGarbage",
  ];
  const sharedExports = [
    "readSharedWord64",
    "writeSharedWord64",
    "compareExchangeSharedWord64",
    "readSharedUnsigned",
    "writeSharedUnsigned",
    "compareExchangeSharedUnsigned",
  ];
  const packetExports = [
    "readMemoryFloat64",
    "writeMemoryFloat64",
    "readMemoryString",
    "writeMemoryString",
  ];
  runtimes.push(
    {
      module: memory,
      namespace: "compiler-worker-memory",
      retainedExports: memoryExports,
    },
    {
      module: shared,
      namespace: "compiler-worker-shared-memory",
      retainedExports: sharedExports,
    },
    {
      module: packet,
      namespace: "compiler-worker-packet-memory",
      retainedExports: packetExports,
    },
    {
      module: primitives,
      namespace: "compiler-worker-ffi",
      retainedExports: ["adoptExternal"],
    },
  );
  foreignMemoryBindings.push({
    module: primitives,
    name: "adoptExternal",
    operation: "adopt",
  });
  hostBindings.push(
    { module: memory, name: "mapMemory", operation: "memory-map" },
    { module: memory, name: "unmapMemory", operation: "memory-unmap" },
    {
      module: memory,
      name: "memoryPageBytes",
      operation: "memory-page-bytes",
    },
    { module: memory, name: "parkNativeWord", operation: "word-park" },
    { module: memory, name: "wakeNativeWord", operation: "word-wake" },
    { module: memory, name: "startNativeThread", operation: "thread-start" },
    {
      module: memory,
      name: "hostedThreadEntry",
      operation: "hosted-thread-entry",
    },
    {
      module: memory,
      name: "collectGarbage",
      operation: "collect-garbage",
    },
    {
      module: shared,
      name: "readSharedWord64",
      operation: "shared-read-word64",
    },
    {
      module: shared,
      name: "writeSharedWord64",
      operation: "shared-write-word64",
    },
    {
      module: shared,
      name: "compareExchangeSharedWord64",
      operation: "shared-compare-exchange-word64",
    },
    {
      module: shared,
      name: "readSharedUnsigned",
      operation: "shared-read-unsigned",
    },
    {
      module: shared,
      name: "writeSharedUnsigned",
      operation: "shared-write-unsigned",
    },
    {
      module: shared,
      name: "compareExchangeSharedUnsigned",
      operation: "shared-compare-exchange-unsigned",
    },
    {
      module: packet,
      name: "readMemoryFloat64",
      operation: "memory-read-float64",
    },
    {
      module: packet,
      name: "writeMemoryFloat64",
      operation: "memory-write-float64",
    },
    {
      module: packet,
      name: "readMemoryString",
      operation: "memory-read-string",
    },
    {
      module: packet,
      name: "writeMemoryString",
      operation: "memory-write-string",
    },
  );
  return {
    ...request,
    entry: cliThreaded,
    start: "mainThreaded",
    threaded: true,
    threadExitPipe: true,
    runtimes,
    hostBindings,
    foreignMemoryBindings,
  };
}
