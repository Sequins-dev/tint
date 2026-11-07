import { aarch64ImageRelocations } from "@tint/codegen/aarch64/image-relocations";
import { darwinHostABI } from "@tint/platform/darwin/host-abi";
import { optimizeModule } from "@tint/ir/optimization";
import {
  compileArm64Program,
  linkNativeServiceModules,
  type NativeServiceUnit,
  type NativeServiceBinding,
  type NativeHostBinding,
  type NativeRecordBinding,
  type NativeWeakBinding,
  type RuntimeSource,
  type ManagedSurfaceRequest,
  type SourceLineRange,
} from "./native/index.ts";
import type { SourceModule } from "@tint/typescript/modules/model";
import { checkClosureModule } from "@tint/typescript/checker";
import {
  planScalarClosures,
  lowerClosureFactory,
} from "@tint/ts-native/closure/lowering";
import { emitModule, type NativeFunction } from "@tint/codegen/aarch64/scalar";
import type { DebugFrame, FunctionRange } from "@tint/image/dwarf";
import { emitHostedEntry } from "@tint/codegen/aarch64/startup";
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
  readonly managedSurfaces?: readonly ManagedSurfaceRequest[];
  readonly allowDebugger?: boolean;
  readonly allowJit?: boolean;
  readonly recordBindings?: readonly NativeRecordBinding[];
  readonly weakBindings?: readonly NativeWeakBinding[];
  readonly inlineAllocation?: boolean;
  readonly denseReferenceLists?: boolean;
  readonly optimization?: "none" | "basic";
  readonly debugSymbols?: boolean;
  readonly debugDirectory?: string;
  readonly maxSpecializations?: number;
  readonly modules: readonly SourceModule[];
  readonly entry: string;
  readonly start: string;
  readonly runtimes: readonly RuntimeSource[];
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
/** Pure artifact composition shared by Node bootstrap and the native compiler. */
export function buildMacOSProgram(request: BuildRequest): BuildResult {
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
    return failure(
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
      youngCapacity = Math.min(
        268435456,
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
      return failure(
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
    return failure("allocator", "allocator source is missing");
  const checked = checkClosureModule(source.module);
  if (!checked.ok) return failure("allocator", checked.error.message);
  const declaration = checked.value.module.statements.find(
    (statement) =>
      statement !== undefined &&
      statement.kind === "function" &&
      statement.name === "createRegionAllocator",
  );
  if (declaration === undefined)
    return failure("allocator", "allocator factory is missing");
  const fn = checked.value.bindings.functions.find(
    (item) => item !== undefined && item.node === declaration,
  );
  if (fn === undefined)
    return failure("allocator", "allocator factory binding is missing");
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
  if (!planned.ok) return failure("allocator", planned.error);
  const scope = fn.scope;
  const environment = planned.value.environments.find(
    (item) => item !== undefined && item.scope === scope,
  );
  if (environment === undefined)
    return failure("allocator", "allocator environment is missing");
  const lowered = lowerClosureFactory(checked.value, fn.id, environment);
  if (!lowered.ok) return failure("allocator", lowered.error);
  const allocate = lowered.value.exports.find(
    (item) => item !== undefined && item.name === "allocate",
  );
  if (allocate === undefined)
    return failure("allocator", "allocation export is missing");
  const allocator = emitModule(
    request.optimization === "none"
      ? lowered.value.module
      : optimizeModule(lowered.value.module).module,
    {
      maxByteLength: 0xffffffff,
      hostABI: darwinHostABI(),
      debugSpans: request.debugSymbols ?? false,
    },
  );
  if (!allocator.ok) return failure("allocator", allocator.error.message);
  request.report("runtime");
  const runtime = compileArm64Program({
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
    return failure("runtime " + runtime.error.stage, runtime.error.message);
  const runtimeEntry = runtime.value.entry;
  if (runtimeEntry === undefined)
    return failure("runtime", "runtime entry is missing");
  request.report("program");
  const program = compileArm64Program({
    serviceImports: (request.nativeServices ?? []).map((service) => ({
      ...service.bind,
      contract: service.unit.factoryContract,
      surface: service.unit.surface.name,
    })),
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
    maxSpecializations: request.maxSpecializations ?? 4096,
    modules: request.modules,
    entry: request.entry,
    exports: [request.start],
    start: request.start,
    runtimes: request.runtimes,
    hostBindings: request.hostBindings,
    recordBindings: request.recordBindings ?? [],
    weakBindings: request.weakBindings ?? [],
  });
  if (!program.ok) return failure(program.error.stage, program.error.message);
  const programEntry = program.value.entry;
  if (programEntry === undefined)
    return failure("program", "program entry is missing");
  let programNative = program.value.native;
  if ((request.nativeServices?.length ?? 0) !== 0) {
    const services = request.nativeServices ?? [],
      hostBindings: NativeServiceBinding[] = [];
    const links = [];
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
      hostBindings.push({
        unit: index,
        name: service.bind.module + ":" + service.bind.name,
        contract: unit.factoryContract,
        role: "function-entry",
        parameters: signature.parameters,
        returnType: signature.returnType,
        metadataOffset: signature.offset,
        entryOffset: unit.entryOffset,
      });
      const bindings: NativeServiceBinding[] = [];
      for (const imported of unit.native.managedImports) {
        if (imported === undefined) throw "native service import invariant";
        const binding = program.value.serviceIdentities?.find(
          (binding) => binding.contract === imported.contract,
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
      native: allocator.value,
      initialize: lowered.value.initializer,
      allocate: allocate.function,
      environmentBytes: environment.layout.size,
    },
    runtime: { native: runtime.value.native, entry: runtimeEntry },
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
    const natives = [allocator.value, runtime.value.native, programNative];
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
          index === 1 ? runtime.value.lines : program.value.lines;
        for (const range of sourceLines) {
          if (range === undefined) throw "debug source range invariant";
          lines.push({ ...range, offset: base + range.offset });
        }
        const entries =
          index === 1 ? runtime.value.symbols : program.value.symbols;
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
