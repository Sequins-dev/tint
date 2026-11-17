import { nativeTargetLayout } from "./native/target-layout.ts";
import {
  aarch64ImageRelocations,
  type AArch64AddressReference,
} from "@tint/codegen/aarch64/image-relocations";
import { darwinAArch64Target, type NativeTarget } from "@tint/platform/target";
import type { PosixHostABI } from "@tint/abi/host";
import { optimizeModule, unboundedWork } from "@tint/ir/optimization";
import {
  compileArm64Program,
  linkNativeServiceModules,
  type NativeServiceUnit,
  type NativeServiceBinding,
  type NativeServiceLink,
  type NativeHostBinding,
  type ForeignLibrary,
  type NativeForeignBinding,
  type NativeForeignMemoryBinding,
  type GeneralLowering,
  type NativeRecordBinding,
  type NativeWeakBinding,
  type RuntimeSource,
  type ManagedSurfaceRequest,
  type SourceLineRange,
  type CompiledProgram,
  type NativeServiceImport,
  type ProgramOptimizationObserver,
} from "./native/index.ts";
import type { SourceModule } from "@tint/typescript/modules/model";
import { checkClosureModule } from "@tint/typescript/checker";
import {
  planScalarClosures,
  lowerClosureFactory,
} from "@tint/ts-native/closure/lowering";
import {
  emitModule,
  type NativeFunction,
  type NativeModule,
  type EmissionFormHints,
  type NativeOperationRange,
} from "@tint/codegen/aarch64/scalar";
/** An emitted function at an image offset (see onEmittedFunctions). */
export interface ImageFunctionRange {
  readonly module: "allocator" | "runtime" | "program";
  readonly name: string;
  readonly offset: number;
  readonly byteLength: number;
}
/** A program operation range at an image offset (see onOperationRanges). */
export interface ImageOperationRange extends NativeOperationRange {
  readonly functionName: string;
  /** Image offset of the function's first instruction. */
  readonly functionOffset: number;
}
import type { DebugFrame, DebugGlobal, FunctionRange } from "@tint/image/dwarf";
import { heapDebugRecordVariablePrefix } from "@tint/abi/heap-debug";
import {
  createDebugTypeTable,
  debugFunctionParts,
  functionStructure,
  heapKindTypes,
  heapRecordType,
} from "./debug-types.ts";
import type { ProgramFunctionDebug } from "./native/debug-functions.ts";
import type { ModuleIR } from "@tint/ir/scalar";
import {
  emitHostedEntry,
  type HostDiagnostics,
  type HostSignpostSite,
} from "@tint/codegen/aarch64/startup";
import { signpostNames } from "@tint/codegen/aarch64/diagnostics";
import { buildTraceTable, type TraceFunction } from "@tint/image/trace-table";
import type { Module, Statement } from "@tint/typescript/syntax";
import { unwindRanges } from "@tint/codegen/aarch64/unwind";
import type { UnwindRange } from "@tint/abi/unwind";
import type {
  ImageLibrary,
  ImageSymbol,
  ReadOnlySection,
} from "@tint/image/executable";
import { writeExecutableImage } from "./image-writer.ts";
import { cSystemLibrary } from "@tint/abi/c";
/** Describe only the ABI-owned pointer homes whose lifetimes the emitter proves. */
function debugFrame(
  fn: NativeFunction | undefined,
  base: number,
): DebugFrame | undefined {
  const frame = fn === undefined ? undefined : fn.debugFrame;
  if (frame === undefined) return undefined;
  const ranges: { offset: number; byteLength: number }[] = [];
  for (const range of frame.ranges) {
    if (range === undefined) throw "debug frame range invariant";
    ranges.push({ offset: base + range.offset, byteLength: range.byteLength });
  }
  return {
    register: frame.register,
    ranges,
    variables: [
      { name: "__tint_context", offset: frame.contextOffset },
      { name: "__tint_result", offset: frame.resultOffset },
    ],
  };
}
export interface BuildRequest {
  /** What the image is built for; defaults to darwin-aarch64 (requests from
   * frozen project sources predate it). */
  readonly target?: NativeTarget;
  readonly threaded?: boolean;
  /** Immutable native units prepared for the same frozen source/toolchain. */
  readonly nativeServices?: readonly {
    readonly unit: NativeServiceUnit;
    readonly bind: { readonly module: string; readonly name: string };
  }[];
  /** Service import slots the program reserves in addition to one per native
   * service, for units linked later (see linkMacOSProgram). Linking then
   * binds every native service and every slot. */
  readonly serviceSlots?: readonly {
    readonly bind: { readonly module: string; readonly name: string };
    /** Omitted for a factory of `surface` as this program publishes it. */
    readonly contract?: string;
    readonly surface: string;
  }[];
  readonly managedSurfaces?: readonly ManagedSurfaceRequest[];
  readonly allowDebugger?: boolean;
  readonly allowJit?: boolean;
  readonly recordBindings?: readonly NativeRecordBinding[];
  readonly weakBindings?: readonly NativeWeakBinding[];
  readonly inlineAllocation?: boolean;
  readonly denseReferenceLists?: boolean;
  readonly optimization?: "none" | "basic";
  readonly debugSymbols?: boolean;
  /** Opt-in: an uncaught throw prints its value and a symbolicated trace of
   * its throw origin (frame pointers plus an embedded symbol/line table).
   * See docs/runtime-diagnostics.md. */
  readonly stackTraces?: boolean;
  /** Opt-in: os_signpost intervals for collector phases and allocation slow
   * paths, for Instruments' os_signpost / Points of Interest timelines. */
  readonly signposts?: boolean;
  /** Opt-in: the GDB/LLDB JIT interface (__jit_debug_register_code and
   * __jit_debug_descriptor) and its jit-debug host operations. */
  readonly jitDebugInterface?: boolean;
  /** The heap debugger descriptor (`__tint_heap_descriptor`), per-record
   * DWARF variables and the dormant allocation-sampling hook for external
   * heap tools (docs/native-heap-profiling.md). Defaults to debugSymbols. */
  readonly heapIntrospection?: boolean;
  /** Branch and address forms to start the program's emission from, usually
   * reported by an earlier build sharing most functions (see
   * EmissionFormHints); onEmissionForms receives the forms this build used. */
  readonly emissionFormHints?: EmissionFormHints;
  readonly onEmissionForms?: (hints: EmissionFormHints) => void;
  /** Analysis tooling: receives the program's per-IR-operation code ranges,
   * at image offsets in the same space as debug symbols. */
  readonly onOperationRanges?: (ranges: readonly ImageOperationRange[]) => void;
  /** Analysis tooling: every emitted function of the allocator, runtime and
   * program modules, at image offsets (code size reports, disassembly). */
  readonly onEmittedFunctions?: (
    functions: readonly ImageFunctionRange[],
  ) => void;
  /** Diagnostics: observes the program's optimization (pass events and
   * remarks); the emitted image is unchanged. */
  readonly optimizationObserver?: ProgramOptimizationObserver;
  /** Diagnostics (miscompile bisection): stop the program's optimization
   * after this many reported passes. Changes the emitted program. */
  readonly optimizationPassLimit?: number;
  /** Analysis tooling: the program's scalar IR before and after optimization. */
  readonly onScalarIR?: (
    stage: "lowered" | "optimized",
    module: ModuleIR,
  ) => void;
  readonly debugDirectory?: string;
  readonly maxSpecializations?: number;
  readonly modules: readonly SourceModule[];
  readonly entry: string;
  readonly start: string;
  readonly runtimes: readonly RuntimeSource[];
  /** Compiles application code the typed pipeline rejects with general
   * JavaScript semantics (see CompileRequest.generalLowering). */
  readonly generalLowering?: GeneralLowering;
  /** Refuse the general fallback (see CompileRequest.requireTyped). */
  readonly requireTyped?: boolean;
  /** Receives the general fallback when one was used. */
  readonly onGeneralFallback?: (
    modules: readonly string[],
    reason: string,
  ) => void;
  readonly hostBindings: readonly NativeHostBinding[];
  /** C binding modules and explicit c-call bindings (docs/native-ffi.md). */
  readonly foreignLibraries?: readonly ForeignLibrary[];
  readonly foreignBindings?: readonly NativeForeignBinding[];
  readonly foreignMemoryBindings?: readonly NativeForeignMemoryBinding[];
  readonly allocatorModule: string;
  readonly runtimeModule: string;
  readonly runtimeEntry?:
    | "initializeRuntime"
    | "initializeCopyingRuntime"
    | "initializeGenerationalRuntime";
  readonly memoryModule: string;
  readonly identifier: string;
  readonly managedBytes: number;
  readonly controlBytes: number;
  readonly allocationCapacity: number;
  readonly rootCapacity: number;
  readonly stackBytes: number;
  readonly report: (stage: string) => void;
}
export type BuildResult =
  | { readonly ok: true; readonly value: Uint8Array }
  | {
      readonly ok: false;
      readonly error: { readonly stage: string; readonly message: string };
    };
function failure(stage: string, message: string): BuildResult {
  return { ok: false, error: { stage, message } };
}
/** Compiled allocator, runtime and program, before service units are linked
 * and the executable is composed. Builds that link different units into one
 * program reuse it. */
export interface CompiledMacOSProgram {
  readonly allocatorSource: SourceModule;
  readonly allocator: NativeModule;
  readonly allocatorInitializer: number;
  readonly allocate: number;
  readonly environmentBytes: number;
  readonly runtime: CompiledProgram;
  readonly runtimeEntry: number;
  readonly program: CompiledProgram;
  readonly programEntry: number;
}
export type CompiledMacOSProgramResult =
  | { readonly ok: true; readonly value: CompiledMacOSProgram }
  | {
      readonly ok: false;
      readonly error: { readonly stage: string; readonly message: string };
    };
function compileFailure(
  stage: string,
  message: string,
): CompiledMacOSProgramResult {
  return { ok: false, error: { stage, message } };
}
/** Pure artifact composition shared by Node bootstrap and the native compiler. */
export function buildMacOSProgram(request: BuildRequest): BuildResult {
  const compiled = compileMacOSProgram(request);
  if (!compiled.ok) return { ok: false, error: compiled.error };
  return linkMacOSProgram(compiled.value, request);
}
/** Validate the memory policy and compile the allocator, runtime and program.
 * Native services are linked by linkMacOSProgram. */
export function compileMacOSProgram(
  request: BuildRequest,
): CompiledMacOSProgramResult {
  const unsupported = targetUnsupported(request);
  if (unsupported !== undefined) return compileFailure("target", unsupported);
  if (
    request.allowJit !== true &&
    request.hostBindings.some(
      (binding) =>
        binding !== undefined &&
        (binding.operation === "executable-map" ||
          binding.operation === "executable-write" ||
          binding.operation === "executable-call-number" ||
          binding.operation === "executable-call-managed" ||
          binding.operation === "executable-call-value"),
    )
  )
    return compileFailure(
      "host-binding",
      "executable-memory capabilities require allowJit",
    );
  const generational = request.runtimeEntry === "initializeGenerationalRuntime";
  if (request.runtimeEntry === "initializeCopyingRuntime" || generational) {
    // Both moving collectors require a start bitmap for the semispace.
    // Generational collection also needs old-space mark bytes.
    // Reject invalid workspaces before runtime initialization can throw.
    const capacity = generational
        ? Math.floor(request.managedBytes / 1024) * 512
        : Math.floor(request.managedBytes / 32) * 16,
      // One start bit per 8-byte allocation granule.
      units = capacity / 8,
      requiredWords = Math.ceil(units / 32),
      // Must match initializeGenerationalRuntime's nursery bound.
      youngCapacity = Math.min(
        268435456,
        Math.max(512, Math.floor(capacity / 2048) * 512),
      ),
      // One dirty bit per granule, eight per mark byte.
      requiredMarks = generational
        ? Math.ceil((capacity - youngCapacity) / 64)
        : 0;
    if (
      !Number.isSafeInteger(request.managedBytes) ||
      request.managedBytes > 0xffffffff ||
      capacity < (generational ? 1024 : 16) ||
      !Number.isSafeInteger(request.allocationCapacity) ||
      request.allocationCapacity < Math.max(1, requiredMarks) ||
      // Generational metadata also holds the major's live bits and chunk
      // offsets beside the start bits.
      request.allocationCapacity * 3 + 96 <
        (generational ? 3 : 1) * requiredWords
    )
      return compileFailure(
        "memory-policy",
        generational
          ? "generational runtime allocation metadata cannot cover forwarding and old-space marks"
          : "copying runtime allocation metadata cannot cover the managed semispace",
      );
  }
  const hostABI: PosixHostABI = buildTarget(request).hostABI;
  request.report("allocator");
  const allocatorId = request.allocatorModule;
  const source = request.modules.find(
    (module) => module !== undefined && module.id === allocatorId,
  );
  if (source === undefined)
    return compileFailure("allocator", "allocator source is missing");
  const checked = checkClosureModule(source.module);
  if (!checked.ok) return compileFailure("allocator", checked.error.message);
  const declaration = checked.value.module.statements.find(
    (statement) =>
      statement !== undefined &&
      statement.kind === "function" &&
      statement.name === "createRegionAllocator",
  );
  if (declaration === undefined)
    return compileFailure("allocator", "allocator factory is missing");
  const fn = checked.value.bindings.functions.find(
    (item) => item !== undefined && item.node === declaration,
  );
  if (fn === undefined)
    return compileFailure("allocator", "allocator factory binding is missing");
  const planned = planScalarClosures(checked.value, nativeTargetLayout, 4096);
  if (!planned.ok) return compileFailure("allocator", planned.error);
  const scope = fn.scope;
  const environment = planned.value.environments.find(
    (item) => item !== undefined && item.scope === scope,
  );
  if (environment === undefined)
    return compileFailure("allocator", "allocator environment is missing");
  const lowered = lowerClosureFactory(checked.value, fn.id, environment);
  if (!lowered.ok) return compileFailure("allocator", lowered.error);
  const allocate = lowered.value.exports.find(
    (item) => item !== undefined && item.name === "allocate",
  );
  if (allocate === undefined)
    return compileFailure("allocator", "allocation export is missing");
  const allocator = emitModule(
    request.optimization === "none"
      ? lowered.value.module
      : optimizeModule(lowered.value.module, unboundedWork).module,
    {
      maxByteLength: 0xffffffff,
      unboundedAnalysis: true,
      hostABI,
      debugSpans: request.debugSymbols === true || request.stackTraces === true,
      throwTraces: request.stackTraces === true,
      pageAlignedCode: true,
    },
  );
  if (!allocator.ok)
    return compileFailure("allocator", allocator.error.message);
  request.report("runtime");
  // Parallel collection: raw atomics over its shared record, the worker
  // pool's threads and parking, and the worker thunk. Bound only when the
  // memory intrinsics declare them, so older frozen source graphs still build.
  const memorySource = request.modules.find(
    (module) => module !== undefined && module.id === request.memoryModule,
  );
  const collectorBindings: NativeHostBinding[] = [],
    collectorCandidates: NativeHostBinding[] = [
      {
        module: request.memoryModule,
        name: "mapMemory",
        operation: "memory-map",
      },
      {
        module: request.memoryModule,
        name: "releaseMemory",
        operation: "memory-release",
      },
      {
        module: request.memoryModule,
        name: "compareExchangeMemoryWord",
        operation: "memory-compare-exchange-word",
      },
      {
        module: request.memoryModule,
        name: "fetchAddMemoryWord",
        operation: "memory-fetch-add-word",
      },
      {
        module: request.memoryModule,
        name: "loadAcquireMemoryWord",
        operation: "memory-load-acquire-word",
      },
      {
        module: request.memoryModule,
        name: "storeReleaseMemoryWord",
        operation: "memory-store-release-word",
      },
      {
        module: request.memoryModule,
        name: "collectorWorkerEntry",
        operation: "collector-worker-entry",
      },
      {
        module: request.memoryModule,
        name: "permanentFunctionAddress",
        operation: "permanent-function-address",
      },
      {
        module: request.memoryModule,
        name: "permanentArrayAddress",
        operation: "permanent-array-address",
      },
      {
        module: request.memoryModule,
        name: "compareExchangeMemoryUnsigned",
        operation: "shared-compare-exchange-unsigned",
      },
      {
        module: request.memoryModule,
        name: "startNativeThread",
        operation: "thread-start",
      },
      {
        module: request.memoryModule,
        name: "parkNativeWord",
        operation: "word-park",
      },
      {
        module: request.memoryModule,
        name: "wakeNativeWord",
        operation: "word-wake",
      },
      {
        module: request.memoryModule,
        name: "spinPause",
        operation: "cpu-pause",
      },
    ];
  for (const binding of collectorCandidates) {
    if (binding === undefined) throw "collector binding invariant";
    if (
      memorySource !== undefined &&
      memorySource.module.statements.some(
        (statement) =>
          statement !== undefined &&
          statement.kind === "function" &&
          statement.name === binding.name,
      )
    )
      collectorBindings.push(binding);
  }
  const runtimeBindings: NativeHostBinding[] = [
    {
      module: request.memoryModule,
      name: "configureExternalMemory",
      operation: "external-memory-configure",
    },
    {
      module: request.memoryModule,
      name: "configureGenerationalAllocation",
      operation: "generational-state",
    },
    {
      module: request.memoryModule,
      name: "configureLinearAllocation",
      operation: "allocation-state",
    },
    {
      module: request.memoryModule,
      name: "readMemoryWord",
      operation: "memory-read-word",
    },
    {
      module: request.memoryModule,
      name: "currentRootHead",
      operation: "root-head",
    },
    {
      module: request.memoryModule,
      name: "engineRangeError",
      operation: "engine-range-error",
    },
    {
      module: request.memoryModule,
      name: "writeMemoryWord",
      operation: "memory-write-word",
    },
    {
      module: request.memoryModule,
      name: "moveMemory",
      operation: "memory-move",
    },
  ];
  for (const binding of collectorBindings) {
    if (binding === undefined) throw "collector binding invariant";
    runtimeBindings.push(binding);
  }
  const runtime = compileArm64Program({
    hostABI,
    pageAlignedCode: true,
    optimization: request.optimization ?? "basic",
    debugSymbols: request.debugSymbols ?? false,
    stackTraces: request.stackTraces === true,
    symbols: request.signposts === true,
    maxSpecializations: request.maxSpecializations ?? 4096,
    modules: request.modules,
    entry: request.runtimeModule,
    exports: [request.runtimeEntry ?? "initializeRuntime"],
    start: request.runtimeEntry ?? "initializeRuntime",
    runtimes: [{ module: request.memoryModule, namespace: "native-memory" }],
    hostBindings: runtimeBindings,
  });
  if (!runtime.ok)
    return compileFailure(
      "runtime " + runtime.error.stage,
      runtime.error.message,
    );
  const runtimeEntry = runtime.value.entry;
  if (runtimeEntry === undefined)
    return compileFailure("runtime", "runtime entry is missing");
  request.report("program");
  const serviceImports: NativeServiceImport[] = [];
  for (const service of request.nativeServices ?? []) {
    if (service === undefined) throw "native service invariant";
    serviceImports.push({
      module: service.bind.module,
      name: service.bind.name,
      contract: service.unit.factoryContract,
      surface: service.unit.surface.name,
    });
  }
  for (const slot of request.serviceSlots ?? []) {
    if (slot === undefined) throw "service slot invariant";
    const contract = slot.contract;
    serviceImports.push(
      contract === undefined
        ? {
            module: slot.bind.module,
            name: slot.bind.name,
            surface: slot.surface,
          }
        : {
            module: slot.bind.module,
            name: slot.bind.name,
            contract,
            surface: slot.surface,
          },
    );
  }
  const program = compileArm64Program({
    hostABI,
    pageAlignedCode: true,
    serviceImports,
    managedSurfaces: request.managedSurfaces ?? [],
    closedProgram: true,
    denseReferenceLists: request.denseReferenceLists ?? false,
    linearAllocation:
      request.inlineAllocation ??
      (request.runtimeEntry === "initializeCopyingRuntime" ||
        request.runtimeEntry === "initializeGenerationalRuntime"),
    generationalBarriers:
      request.runtimeEntry === "initializeGenerationalRuntime",
    optimization: request.optimization ?? "basic",
    debugSymbols: request.debugSymbols ?? false,
    stackTraces: request.stackTraces === true,
    operationRanges: request.onOperationRanges !== undefined,
    ...(request.onScalarIR === undefined
      ? {}
      : { onScalarIR: request.onScalarIR }),
    ...(request.optimizationObserver === undefined
      ? {}
      : { optimizationObserver: request.optimizationObserver }),
    ...(request.optimizationPassLimit === undefined
      ? {}
      : { optimizationPassLimit: request.optimizationPassLimit }),
    ...(request.emissionFormHints === undefined
      ? {}
      : { emissionFormHints: request.emissionFormHints }),
    maxSpecializations: request.maxSpecializations ?? 4096,
    modules: request.modules,
    entry: request.entry,
    exports: [request.start],
    start: request.start,
    runtimes: request.runtimes,
    ...(request.generalLowering === undefined
      ? {}
      : { generalLowering: request.generalLowering }),
    ...(request.requireTyped === true ? { requireTyped: true } : {}),
    hostBindings: request.hostBindings,
    foreignLibraries: request.foreignLibraries ?? [],
    foreignBindings: request.foreignBindings ?? [],
    foreignMemoryBindings: request.foreignMemoryBindings ?? [],
    recordBindings: request.recordBindings ?? [],
    weakBindings: request.weakBindings ?? [],
  });
  if (!program.ok)
    return compileFailure(program.error.stage, program.error.message);
  const general = program.value.general,
    reportGeneral = request.onGeneralFallback;
  if (general !== undefined && reportGeneral !== undefined)
    reportGeneral(general.modules, general.reason);
  const reportForms = request.onEmissionForms,
    usedForms = program.value.native.formHints;
  if (reportForms !== undefined && usedForms !== undefined)
    reportForms(usedForms);
  const programEntry = program.value.entry;
  if (programEntry === undefined)
    return compileFailure("program", "program entry is missing");
  return {
    ok: true,
    value: {
      allocatorSource: source,
      allocator: allocator.value,
      allocatorInitializer: lowered.value.initializer,
      allocate: allocate.function,
      environmentBytes: environment.layout.size,
      runtime: runtime.value,
      runtimeEntry,
      program: program.value,
      programEntry,
    },
  };
}
/** Link the request's native services into a compiled program and compose
 * the signed executable. */
export function linkMacOSProgram(
  compiled: CompiledMacOSProgram,
  request: BuildRequest,
): BuildResult {
  const target = buildTarget(request),
    hostABI: PosixHostABI = target.hostABI;
  const source = compiled.allocatorSource,
    runtimeEntry = compiled.runtimeEntry,
    programEntry = compiled.programEntry;
  let programNative = compiled.program.native;
  if ((request.nativeServices?.length ?? 0) !== 0) {
    const services = request.nativeServices ?? [],
      hostBindings: NativeServiceBinding[] = [];
    const links: NativeServiceLink[] = [],
      // Services sharing a unit bind to one linked copy of its code.
      linkedUnits = new Map<NativeServiceUnit, number>();
    for (let index = 0; index < services.length; index++) {
      const service = services[index];
      if (service === undefined) throw "native service invariant";
      const unit = service.unit,
        entry = unit.native.functions.find(
          (fn) =>
            fn !== undefined &&
            fn.import !== true &&
            fn.offset === unit.entryOffset,
        ),
        signature =
          entry === undefined
            ? undefined
            : unit.native.signatures.find(
                (signature) =>
                  signature !== undefined &&
                  signature.functions.includes(entry.id),
              );
      if (
        unit.version !== 1 ||
        unit.profile !== "managed-factory-v1" ||
        signature === undefined ||
        signature.parameters.length !== 1 ||
        signature.parameters[0] !== "reference" ||
        signature.returnType !== "general"
      )
        return failure("service-link", "invalid managed factory entry");
      const known = linkedUnits.get(unit),
        unitIndex = known ?? links.length;
      hostBindings.push({
        unit: unitIndex,
        name: service.bind.module + ":" + service.bind.name,
        contract: unit.factoryContract,
        role: "function-entry",
        parameters: signature.parameters,
        returnType: signature.returnType,
        metadataOffset: signature.offset,
        entryOffset: unit.entryOffset,
      });
      if (known !== undefined) continue;
      linkedUnits.set(unit, unitIndex);
      const bindings: NativeServiceBinding[] = [];
      for (const imported of unit.native.managedImports) {
        if (imported === undefined) throw "native service import invariant";
        const binding = compiled.program.serviceIdentities?.find(
          (binding) =>
            binding !== undefined && binding.contract === imported.contract,
        );
        if (binding === undefined)
          return failure(
            "service-link",
            "host is missing unit contract: " + imported.contract,
          );
        bindings.push({ ...binding, name: imported.name });
      }
      links.push({ native: unit.native, bindings });
    }
    const linked = linkNativeServiceModules(programNative, links, hostBindings);
    if (!linked.ok) return failure("service-link", linked.error);
    programNative = linked.value.native;
  }
  request.report("startup");
  let diagnostics: HostDiagnostics | undefined;
  const heapIntrospection =
    request.heapIntrospection ?? request.debugSymbols === true;
  if (
    request.stackTraces === true ||
    request.signposts === true ||
    request.jitDebugInterface === true ||
    heapIntrospection
  ) {
    if (request.jitDebugInterface === true && request.allowJit !== true)
      return failure("startup", "the JIT debug interface requires allowJit");
    const sites =
      request.signposts === true ? collectorSignposts(compiled, request) : [];
    if (typeof sites === "string") return failure("signposts", sites);
    diagnostics = {
      stackTraces: request.stackTraces === true,
      signposts: sites,
      allocationSignposts: request.signposts === true,
      jitDebug: request.jitDebugInterface === true,
      heapIntrospection,
    };
  }
  const hosted = emitHostedEntry({
    diagnostics,
    threaded: request.threaded ?? false,
    abi: hostABI,
    allocator: {
      native: compiled.allocator,
      initialize: compiled.allocatorInitializer,
      allocate: compiled.allocate,
      environmentBytes: compiled.environmentBytes,
    },
    runtime: { native: compiled.runtime.native, entry: runtimeEntry },
    program: { native: programNative, entry: programEntry },
    managedBytes: request.managedBytes,
    controlBytes: request.controlBytes,
    allocationCapacity: request.allocationCapacity,
    rootCapacity: request.rootCapacity,
    stackBytes: request.stackBytes,
    pageSize: target.memoryPageBytes,
  });
  if (!hosted.ok) return failure("startup", hosted.error);
  request.report("image");
  const imports: string[] = [];
  for (const reference of hosted.value.imports) {
    if (reference === undefined) throw "native import invariant";
    if (!imports.includes(reference.target.name))
      imports.push(reference.target.name);
  }
  const libraries = foreignImageLibraries(
    request.foreignLibraries ?? [],
    imports,
    hostABI.symbolPrefix,
  );
  if (typeof libraries === "string") return failure("image", libraries);
  // Unwind information is always emitted (it is small): debuggers, profilers
  // and crash reporters need it to unwind through leaves and the entry.
  const unwind: UnwindRange[] = [hosted.value.entryUnwind];
  const hostedDiagnostics = hosted.value.diagnostics;
  const unwindModules = [
    compiled.allocator,
    compiled.runtime.native,
    programNative,
  ];
  for (let index = 0; index < unwindModules.length; index++) {
    const native = unwindModules[index],
      base = hosted.value.moduleOffsets[index];
    if (native === undefined || base === undefined)
      throw "unwind module placement invariant";
    for (const range of unwindRanges(native, base)) {
      if (range === undefined) throw "unwind range invariant";
      unwind.push(range);
    }
  }
  const reportFunctions = request.onEmittedFunctions;
  if (reportFunctions !== undefined) {
    const emitted: ImageFunctionRange[] = [],
      natives = [compiled.allocator, compiled.runtime.native, programNative];
    for (let index = 0; index < natives.length; index++) {
      const native = natives[index],
        base = hosted.value.moduleOffsets[index];
      if (native === undefined || base === undefined)
        throw "emitted function placement invariant";
      for (const fn of native.functions) {
        if (fn === undefined) throw "emitted function invariant";
        if (fn.import === true) continue;
        emitted.push({
          module:
            index === 0 ? "allocator" : index === 1 ? "runtime" : "program",
          name: fn.name,
          offset: base + fn.offset,
          byteLength: fn.byteLength,
        });
      }
    }
    reportFunctions(emitted);
  }
  for (const range of hostedDiagnostics?.unwind ?? []) {
    if (range === undefined) throw "diagnostic unwind invariant";
    unwind.push(range);
  }
  const reportOperations = request.onOperationRanges,
    operationBase = hosted.value.moduleOffsets[2],
    programOperations = programNative.operationRanges;
  if (
    reportOperations !== undefined &&
    operationBase !== undefined &&
    programOperations !== undefined
  ) {
    const names = new Map<number, string>(),
      starts = new Map<number, number>();
    for (const fn of programNative.functions) {
      if (fn === undefined) throw "operation function invariant";
      names.set(fn.id, fn.name);
      starts.set(fn.id, operationBase + fn.offset);
    }
    const ranges: ImageOperationRange[] = [];
    for (const range of programOperations) {
      if (range === undefined) throw "operation range invariant";
      ranges.push({
        ...range,
        functionName: names.get(range.function) ?? "",
        functionOffset: starts.get(range.function) ?? 0,
        offset: operationBase + range.offset,
      });
    }
    reportOperations(ranges);
  }
  const symbols: FunctionRange[] = [];
  const lines: SourceLineRange[] = [];
  const debugTypes = createDebugTypeTable();
  if (request.debugSymbols === true || request.stackTraces === true) {
    const modulesStart =
        hosted.value.moduleOffsets[0] ?? hosted.value.entryOffset,
      processStart = hosted.value.processStartOffset;
    symbols.push({
      name: "tint:process-entry",
      offset: hosted.value.entryOffset,
      byteLength: (processStart ?? modulesStart) - hosted.value.entryOffset,
    });
    if (processStart !== undefined)
      symbols.push({
        name: "tint:process-start",
        offset: processStart,
        byteLength: modulesStart - processStart,
      });
    const natives = [
      compiled.allocator,
      compiled.runtime.native,
      programNative,
    ];
    const labels = ["allocator", "runtime", "program"];
    for (let index = 0; index < natives.length; index++) {
      const native = natives[index],
        base = hosted.value.moduleOffsets[index],
        label = labels[index];
      if (native === undefined || base === undefined || label === undefined)
        throw "debug module placement invariant";
      const functionsByOffset = new Map<number, NativeFunction>();
      for (const fn of native.functions) {
        if (fn === undefined) throw "debug function invariant";
        if (fn.import === true) continue;
        functionsByOffset.set(fn.offset, fn);
      }
      if (index === 0) {
        const positionAt = source.sourcePosition;
        if (positionAt !== undefined) {
          for (const range of native.sourceRanges) {
            if (range === undefined) throw "debug allocator range invariant";
            const position = positionAt(range.start);
            if (position !== undefined)
              lines.push({
                offset: base + range.offset,
                byteLength: range.byteLength,
                file: source.id,
                line: position.line,
                column: position.column,
              });
          }
        }
        for (const fn of native.functions) {
          if (fn === undefined) throw "debug allocator function invariant";
          if (fn.import === true) continue;
          symbols.push({
            name: "allocator:" + fn.name,
            offset: base + fn.offset,
            byteLength: fn.byteLength,
            frame: debugFrame(fn, base),
          });
        }
      } else {
        const sourceLines =
          index === 1 ? compiled.runtime.lines : compiled.program.lines;
        for (const range of sourceLines) {
          if (range === undefined) throw "debug source range invariant";
          lines.push({ ...range, offset: base + range.offset });
        }
        const entries =
          index === 1 ? compiled.runtime.symbols : compiled.program.symbols;
        const described = new Map<number, ProgramFunctionDebug>();
        for (const fn of (index === 1 ? compiled.runtime : compiled.program)
          .debugFunctions ?? []) {
          if (fn === undefined) throw "debug function description invariant";
          described.set(fn.offset, fn);
        }
        for (const entry of entries) {
          if (entry === undefined) throw "debug symbol invariant";
          const source = described.get(entry.offset),
            parts =
              source === undefined
                ? undefined
                : debugFunctionParts(debugTypes, source, base);
          symbols.push({
            name: label + ":" + entry.name,
            offset: base + entry.offset,
            byteLength: entry.byteLength,
            frame: debugFrame(functionsByOffset.get(entry.offset), base),
            ...(parts === undefined
              ? {}
              : { variables: parts.variables, inlined: parts.inlined }),
          });
        }
      }
      for (const helper of native.helpers) {
        if (helper === undefined) throw "debug helper invariant";
        symbols.push({
          name: label + ":helper:" + helper.kind,
          offset: base + helper.offset,
          byteLength: helper.byteLength,
        });
      }
      for (let i = 0; i < native.cellHelpers.length; i++) {
        const helper = native.cellHelpers[i];
        if (helper === undefined) throw "debug cell helper invariant";
        symbols.push({
          name: label + ":cell:" + helper.access.operation + ":" + i,
          offset: base + helper.offset,
          byteLength: helper.byteLength,
        });
      }
    }
  }
  // Heap introspection: each record descriptor is a DWARF variable whose
  // type is the structure of the objects it describes, and every built-in
  // kind has a named structure (docs/native-heap-profiling.md).
  const debugGlobals: DebugGlobal[] = [];
  if (request.debugSymbols === true && heapIntrospection) {
    heapKindTypes(debugTypes);
    const modules = [
      {
        label: "runtime",
        compiled: compiled.runtime,
        native: compiled.runtime.native,
      },
      { label: "program", compiled: compiled.program, native: programNative },
    ];
    for (let index = 0; index < modules.length; index++) {
      const entry = modules[index],
        base = hosted.value.moduleOffsets[index + 1];
      if (entry === undefined || base === undefined)
        throw "heap record module invariant";
      const described = entry.compiled.debugRecords ?? [],
        original = entry.compiled.native.records;
      for (let at = 0; at < entry.native.records.length; at++) {
        const descriptor = entry.native.records[at],
          source = original[at];
        if (descriptor === undefined) throw "heap record descriptor invariant";
        // Service linking appends unit records; only the module's own
        // descriptors (unchanged placement) have layouts here.
        if (source === undefined || source.offset !== descriptor.offset)
          continue;
        const record = described[descriptor.record];
        if (record === undefined || record.byteLength !== descriptor.byteLength)
          continue;
        debugGlobals.push({
          name:
            heapDebugRecordVariablePrefix +
            entry.label +
            "." +
            String(descriptor.record),
          type: heapRecordType(debugTypes, record),
          offset: base + descriptor.offset,
        });
      }
      const functionDescriptor = entry.native.functionDescriptor;
      if (functionDescriptor !== undefined)
        debugGlobals.push({
          name: heapDebugRecordVariablePrefix + entry.label + ".function",
          type: functionStructure(debugTypes),
          offset: base + functionDescriptor.offset,
        });
    }
  }
  for (const routine of hostedDiagnostics?.routines ?? []) {
    if (routine === undefined) throw "diagnostic routine invariant";
    if (request.debugSymbols === true || request.stackTraces === true)
      symbols.push({
        name: routine.name,
        offset: routine.offset,
        byteLength: routine.byteLength,
      });
  }
  let code = hosted.value.code;
  const readOnlySections: ReadOnlySection[] = [];
  if (hostedDiagnostics !== undefined) {
    const cstring = hostedDiagnostics.cstring;
    if (cstring.byteLength > 0)
      readOnlySections.push({
        kind: "cstring",
        offset: cstring.offset,
        byteLength: cstring.byteLength,
      });
    if (request.stackTraces === true) {
      // Trace names omit generated-instance suffixes; the program's own
      // functions also omit their module label.
      const traced: TraceFunction[] = [];
      for (const symbol of symbols) {
        if (symbol === undefined) throw "trace symbol invariant";
        const name = sourceName(symbol.name);
        traced.push({
          name: name.startsWith("program:") ? name.slice(8) : name,
          offset: symbol.offset,
          byteLength: symbol.byteLength,
        });
      }
      const table = buildTraceTable(traced, lines, 0xffffffff - code.length);
      if (!table.ok) return failure("image", "trace table: " + table.error);
      if (hostedDiagnostics.tableOffset !== code.length)
        throw "trace table placement invariant";
      const extended = new Uint8Array(code.length + table.value.length);
      extended.set(code);
      extended.set(table.value, code.length);
      readOnlySections.push({
        kind: "rodata",
        offset: code.length,
        byteLength: table.value.length,
      });
      code = extended;
    }
  }
  const references: AArch64AddressReference[] = [];
  for (const reference of hosted.value.imports) {
    if (reference === undefined) throw "image reference invariant";
    references.push({
      offset: reference.offset,
      rd: reference.rd,
      scratch: reference.scratch,
      target: { kind: "import", name: reference.target.name },
    });
  }
  for (const reference of hostedDiagnostics?.dataReferences ?? []) {
    if (reference === undefined) throw "diagnostic reference invariant";
    references.push({
      offset: reference.offset,
      rd: reference.rd,
      scratch: reference.scratch,
      target: { kind: "data", offset: reference.target },
    });
  }
  const relocations = aarch64ImageRelocations(references);
  const imageSymbols: ImageSymbol[] = [];
  if (request.debugSymbols === true)
    for (const symbol of symbols) {
      if (symbol === undefined) throw "image symbol invariant";
      imageSymbols.push({ name: symbol.name, offset: symbol.offset });
    }
  for (const symbol of hostedDiagnostics?.codeSymbols ?? []) {
    if (symbol === undefined) throw "diagnostic symbol invariant";
    imageSymbols.push({ name: symbol.name, offset: symbol.offset });
  }
  const image = writeExecutableImage(
    target,
    {
      allowDebugger: request.allowDebugger ?? request.debugSymbols ?? false,
      allowJit: request.allowJit ?? false,
      symbols: imageSymbols,
      data: hostedDiagnostics?.data,
      dataSymbols: hostedDiagnostics?.dataSymbols,
      readOnlySections,
      unwind,
      debug: request.debugSymbols
        ? {
            directory: request.debugDirectory ?? ".",
            functions: symbols,
            lines,
            types: debugTypes.types,
            origins: debugTypes.origins,
            globals: debugGlobals,
          }
        : undefined,
      code,
      entryOffset: hosted.value.processStartOffset ?? hosted.value.entryOffset,
      maxByteLength: 0xffffffff,
      imports,
      libraries,
      ...relocations,
    },
    request.identifier,
    request.foreignLibraries ?? [],
  );
  if (!image.ok) return failure("image", image.error);
  return { ok: true, value: image.value };
}
function buildTarget(request: BuildRequest): NativeTarget {
  return request.target ?? darwinAArch64Target;
}
/** The Darwin mmap flags of `tint:ffi` external storage
 * (native-runtime ffi/darwin.ts). */
const darwinMappingFlagsModule = "packages/native-runtime/src/ffi/darwin.ts";
/** Why the request needs a facility its target does not provide yet, if it
 * does: one explicit failure before compilation instead of a missing
 * import or a wrong constant at run time. */
function targetUnsupported(request: BuildRequest): string | undefined {
  const target = buildTarget(request);
  if (
    target.hostABI.executableMemory === undefined &&
    request.hostBindings.some(
      (binding) =>
        binding !== undefined && binding.operation.startsWith("executable-"),
    )
  )
    return target.name + " has no executable-memory (live code) publication";
  if (
    target.os !== "darwin" &&
    request.modules.some(
      (module) =>
        module !== undefined && module.id === darwinMappingFlagsModule,
    )
  )
    return (
      "tint:ffi external storage uses Darwin mapping flags; " +
      target.name +
      " does not support it yet"
    );
  return undefined;
}

/** The C libraries beyond the system library whose symbols the image
 * imports (docs/native-ffi.md, "Libraries"): one per library name, in
 * first-use order, listing the imports it binds. Libraries the program
 * loads but never calls add nothing, so images without such calls are
 * unchanged. */
function foreignImageLibraries(
  libraries: readonly ForeignLibrary[],
  imports: readonly string[],
  prefix: string,
): ImageLibrary[] | string {
  const names: string[] = [],
    weak: boolean[] = [],
    symbols: string[][] = [],
    owners = new Map<string, string>();
  for (const library of libraries) {
    if (library === undefined) throw "foreign library invariant";
    const image = library.image;
    if (cSystemLibrary(image)) continue;
    let index = names.indexOf(image.name);
    for (const fn of library.declaration.functions) {
      if (fn === undefined) throw "foreign library function invariant";
      const name = prefix + fn.symbol;
      if (!imports.includes(name)) continue;
      const owner = owners.get(name);
      if (owner !== undefined && owner !== image.name)
        return "symbol " + fn.symbol + " is bound to two libraries";
      if (owner !== undefined) continue;
      owners.set(name, image.name);
      if (index < 0) {
        index = names.length;
        names.push(image.name);
        weak.push(image.optional);
        symbols.push([]);
      }
      const list = symbols[index];
      if (list === undefined) throw "foreign library symbol invariant";
      list.push(name);
    }
  }
  const result: ImageLibrary[] = [];
  for (let index = 0; index < names.length; index++) {
    const name = names[index],
      optional = weak[index],
      list = symbols[index];
    if (name === undefined || optional === undefined || list === undefined)
      throw "foreign library list invariant";
    result.push({ name, weak: optional, symbols: list });
  }
  return result;
}
/** A debug symbol name without its generated-instance suffix. */
function sourceName(name: string): string {
  const suffix = name.indexOf(" [");
  if (suffix >= 0) return name.slice(0, suffix);
  // Generated functions: drop the "$<id>" instance number.
  const instance = name.lastIndexOf("$");
  if (instance < 0 || instance === name.length - 1) return name;
  for (let index = instance + 1; index < name.length; index++) {
    const code = name.charCodeAt(index);
    if (code < 48 || code > 57) return name;
  }
  return name.slice(0, instance);
}
/** Start of the function value of `method` in the object literal that the
 * named top-level factory returns (its closure symbol is closure@start). */
function returnedMethodStart(
  module: Module,
  factory: string,
  method: string,
): number | undefined {
  for (const statement of module.statements) {
    if (statement === undefined) throw "signpost statement invariant";
    if (statement.kind !== "function" || statement.name !== factory) continue;
    const block = statement.body;
    if (block.kind !== "block") continue;
    const body: readonly Statement[] = block.statements;
    for (const inner of body) {
      if (inner === undefined) throw "signpost body invariant";
      if (inner.kind !== "return") continue;
      const value = inner.expression;
      if (value === undefined || value.kind !== "object") continue;
      for (const property of value.properties) {
        if (property === undefined) throw "signpost property invariant";
        if (property.kind === "spread") continue;
        if (property.name === method && property.method === true)
          return property.value.start;
      }
    }
  }
  return undefined;
}
/** Collector phase functions of the runtime, by source name. Absent functions
 * (another collector) are skipped; finding none is an error. */
function collectorSignposts(
  compiled: CompiledMacOSProgram,
  request: BuildRequest,
): HostSignpostSite[] | string {
  const runtimeModule = request.runtimeModule,
    root = runtimeModule.slice(0, runtimeModule.lastIndexOf("/") + 1),
    cheney = root + "tracing/cheney.ts",
    parallel = root + "tracing/parallel.ts";
  function method(id: string, factory: string, name: string): string {
    const source = request.modules.find(
      (module) => module !== undefined && module.id === id,
    );
    const start =
      source === undefined
        ? undefined
        : returnedMethodStart(source.module, factory, name);
    return start === undefined ? "" : id + ":closure@" + String(start);
  }
  const wanted: {
    readonly name: string;
    readonly interval: string;
    readonly alternate?: string;
    readonly parameter?: number;
    readonly metrics?: boolean;
  }[] = [
    {
      name: root + "generational.ts:collect",
      interval: "gc.collect",
      metrics: true,
    },
    { name: root + "copying.ts:collect", interval: "gc.collect" },
    {
      name: method(cheney, "createCheneyCollector", "collect"),
      interval: "gc.minor",
      alternate: "gc.major",
      parameter: 8,
    },
    {
      name: method(parallel, "createParallelEvacuator", "collect"),
      interval: "gc.parallel-minor",
      alternate: "gc.parallel-major",
      parameter: 8,
    },
    { name: parallel + ":share", interval: "gc.worker" },
    // The precise stack-map walk, serial or on a parallel worker.
    { name: root + "tracing/scan.ts:walkNativeStack", interval: "gc.roots" },
    { name: parallel + ":scanRemembered", interval: "gc.remembered" },
  ];
  const functions = compiled.runtime.native.functions,
    sites: HostSignpostSite[] = [];
  for (const symbol of compiled.runtime.symbols) {
    if (symbol === undefined) throw "signpost symbol invariant";
    const name = sourceName(symbol.name);
    const site = wanted.find(
      (item) => item !== undefined && item.name === name,
    );
    if (site === undefined) continue;
    const fn = functions.find(
      (item) =>
        item !== undefined &&
        item.import !== true &&
        item.offset === symbol.offset,
    );
    const interval = signpostNames.indexOf(site.interval);
    if (fn === undefined || interval < 0) return "signpost target " + name;
    const stackBytes = fn.signature.stackBytes;
    if (stackBytes % 16 !== 0 || stackBytes >= 4096)
      return "signposted function has unsupported stack arguments: " + name;
    const parameter = site.parameter,
      alternate =
        site.alternate === undefined
          ? -1
          : signpostNames.indexOf(site.alternate);
    if (parameter === undefined || alternate < 0) {
      sites.push({
        module: 1,
        offset: fn.offset,
        name: interval,
        stackBytes,
        ...(site.metrics === true ? { metrics: true } : {}),
      });
      continue;
    }
    const location = fn.signature.parameters[parameter];
    if (location === undefined || location.kind !== "integer")
      return "signpost classification is not an integer argument: " + name;
    sites.push({
      module: 1,
      offset: fn.offset,
      name: interval,
      stackBytes,
      classify: { register: location.index, alternate },
    });
  }
  if (sites.length === 0) return "no collector functions to signpost";
  return sites;
}
