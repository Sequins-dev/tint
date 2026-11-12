import { aarch64ImageRelocations } from "@tint/codegen/aarch64/image-relocations";
import { darwinHostABI } from "@tint/platform/darwin/host-abi";
import { optimizeModule } from "@tint/ir/optimization";
import {
  compileArm64Program,
  linkNativeServiceModules,
  type NativeServiceUnit,
  type NativeServiceBinding,
  type NativeServiceLink,
  type NativeHostBinding,
  type GeneralLowering,
  type NativeRecordBinding,
  type NativeWeakBinding,
  type RuntimeSource,
  type ManagedSurfaceRequest,
  type SourceLineRange,
  type CompiledProgram,
  type NativeServiceImport,
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
/** A program operation range at an image offset (see onOperationRanges). */
export interface ImageOperationRange extends NativeOperationRange {
  readonly functionName: string;
  /** Image offset of the function's first instruction. */
  readonly functionOffset: number;
}
import type { DebugFrame, FunctionRange } from "@tint/image/dwarf";
import { emitHostedEntry } from "@tint/codegen/aarch64/startup";
import { unwindRanges } from "@tint/codegen/aarch64/unwind";
import type { UnwindRange } from "@tint/abi/unwind";
import { buildExecutable } from "@tint/image/darwin/macho";
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
  /** Branch and address forms to start the program's emission from, usually
   * reported by an earlier build sharing most functions (see
   * EmissionFormHints); onEmissionForms receives the forms this build used. */
  readonly emissionFormHints?: EmissionFormHints;
  readonly onEmissionForms?: (hints: EmissionFormHints) => void;
  /** Analysis tooling: receives the program's per-IR-operation code ranges,
   * at image offsets in the same space as debug symbols. */
  readonly onOperationRanges?: (ranges: readonly ImageOperationRange[]) => void;
  readonly debugDirectory?: string;
  readonly maxSpecializations?: number;
  readonly modules: readonly SourceModule[];
  readonly entry: string;
  readonly start: string;
  readonly runtimes: readonly RuntimeSource[];
  /** Compiles application code the typed pipeline rejects with general
   * JavaScript semantics (see CompileRequest.generalLowering). */
  readonly generalLowering?: GeneralLowering;
  /** Receives the general fallback when one was used. */
  readonly onGeneralFallback?: (
    modules: readonly string[],
    reason: string,
  ) => void;
  readonly hostBindings: readonly NativeHostBinding[];
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
    // Both moving collectors require forwarding words and a start bitmap for
    // the semispace. Generational collection also needs old-space mark bytes.
    // Reject invalid workspaces before runtime initialization can throw.
    const capacity = generational
        ? Math.floor(request.managedBytes / 1024) * 512
        : Math.floor(request.managedBytes / 32) * 16,
      units = capacity / 16,
      requiredWords = units + Math.ceil(units / 32),
      // Must match initializeGenerationalRuntime's nursery bound.
      youngCapacity = Math.min(
        134217728,
        Math.max(512, Math.floor(capacity / 2048) * 512),
      ),
      requiredMarks = generational
        ? Math.ceil((capacity - youngCapacity) / 128)
        : 0;
    if (
      !Number.isSafeInteger(request.managedBytes) ||
      request.managedBytes > 0xffffffff ||
      capacity < (generational ? 1024 : 16) ||
      !Number.isSafeInteger(request.allocationCapacity) ||
      request.allocationCapacity < Math.max(1, requiredMarks) ||
      request.allocationCapacity * 3 + 96 < requiredWords
    )
      return compileFailure(
        "memory-policy",
        generational
          ? "generational runtime allocation metadata cannot cover forwarding and old-space marks"
          : "copying runtime allocation metadata cannot cover the managed semispace",
      );
  }
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
  const planned = planScalarClosures(
    checked.value,
    {
      pointerSize: 8,
      wordSize: 8,
      allocationAlignment: 16,
      frameAlignment: 16,
      maxAlignment: 16,
    },
    4096,
  );
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
      : optimizeModule(lowered.value.module).module,
    {
      maxByteLength: 0xffffffff,
      hostABI: darwinHostABI(),
      debugSpans: request.debugSymbols ?? false,
      pageAlignedCode: true,
    },
  );
  if (!allocator.ok)
    return compileFailure("allocator", allocator.error.message);
  request.report("runtime");
  const runtime = compileArm64Program({
    pageAlignedCode: true,
    optimization: request.optimization ?? "basic",
    debugSymbols: request.debugSymbols ?? false,
    maxSpecializations: request.maxSpecializations ?? 4096,
    modules: request.modules,
    entry: request.runtimeModule,
    exports: [request.runtimeEntry ?? "initializeRuntime"],
    start: request.runtimeEntry ?? "initializeRuntime",
    runtimes: [{ module: request.memoryModule, namespace: "native-memory" }],
    hostBindings: [
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
    ],
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
    operationRanges: request.onOperationRanges !== undefined,
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
    hostBindings: request.hostBindings,
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
  const hosted = emitHostedEntry({
    threaded: request.threaded ?? false,
    abi: darwinHostABI(),
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
    pageSize: 16384,
  });
  if (!hosted.ok) return failure("startup", hosted.error);
  request.report("image");
  const imports: string[] = [];
  for (const reference of hosted.value.imports) {
    if (reference === undefined) throw "native import invariant";
    if (!imports.includes(reference.target.name))
      imports.push(reference.target.name);
  }
  // Unwind information is always emitted (it is small): debuggers, profilers
  // and crash reporters need it to unwind through leaves and the entry.
  const unwind: UnwindRange[] = [hosted.value.entryUnwind];
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
  if (request.debugSymbols) {
    symbols.push({
      name: "tint:process-entry",
      offset: hosted.value.entryOffset,
      byteLength:
        (hosted.value.moduleOffsets[0] ?? hosted.value.entryOffset) -
        hosted.value.entryOffset,
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
        for (const entry of entries) {
          if (entry === undefined) throw "debug symbol invariant";
          symbols.push({
            name: label + ":" + entry.name,
            offset: base + entry.offset,
            byteLength: entry.byteLength,
            frame: debugFrame(functionsByOffset.get(entry.offset), base),
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
  const image = buildExecutable({
    allowDebugger: request.allowDebugger ?? request.debugSymbols ?? false,
    allowJit: request.allowJit ?? false,
    symbols,
    unwind,
    debug: request.debugSymbols
      ? { directory: request.debugDirectory ?? ".", functions: symbols, lines }
      : undefined,
    code: hosted.value.code,
    entryOffset: hosted.value.entryOffset,
    identifier: request.identifier,
    minimumOS: { major: 14, minor: 0, patch: 0 },
    sdk: { major: 15, minor: 0, patch: 0 },
    maxByteLength: 0xffffffff,
    imports,
    ...aarch64ImageRelocations(hosted.value.imports),
  });
  if (!image.ok) return failure("image", image.error);
  return { ok: true, value: image.value.bytes };
}
