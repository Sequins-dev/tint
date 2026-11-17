import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { prepareDateTimeNativeService } from "./date-time-native-service.ts";
import { frozenNativeRunIdentity } from "./native-run-journal.ts";
import {
  workspaceModules,
  workspaceSources,
  workspaceSourceIdentity,
} from "./workspace-sources.ts";
import { projectRoots, projectBuildRequest } from "@tint/compiler/cli";
import { createSourceText } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import {
  buildMacOSProgram,
  type BuildRequest,
  type ImageOperationRange,
} from "@tint/compiler/build";
import type { SourceModule } from "@tint/typescript/modules/model";
import type { ModuleIR } from "@tint/ir/scalar";
import { createGeneralLowering } from "@tint/js-engine/program";
import { formatModule } from "./ir-dump/format.ts";
import {
  createBuildObservation,
  observabilityOptions,
} from "./observability/build-observer.ts";
import {
  expandForeignInputs,
  foreignRuntimeBindings,
  prepareForeignLibrary,
  type ForeignLibrary,
  type NativeForeignBinding,
  type NativeHostBinding,
  type NativeRecordBinding,
  type NativeWeakBinding,
  type RuntimeSource,
  type ManagedSurfaceRequest,
} from "@tint/compiler/native";
import { nativeFixtureTarget } from "./native-host-target.ts";
/** Hosted fixtures run on this host, under LLDB. */
const fixtureTarget = nativeFixtureTarget();
import type { WorkspaceSourceSnapshot } from "./workspace-sources.ts";

const foreignSnapshots = new WeakMap<
  WorkspaceSourceSnapshot,
  {
    readonly snapshot: WorkspaceSourceSnapshot;
    readonly libraries: readonly ForeignLibrary[];
  }
>();
/** The captured snapshot with its C binding declarations expanded into
 * generated modules (docs/native-ffi.md), as the compiler CLI loads it. */
export function expandForeignSnapshot(captured: WorkspaceSourceSnapshot): {
  readonly snapshot: WorkspaceSourceSnapshot;
  readonly libraries: readonly ForeignLibrary[];
} {
  const cached = foreignSnapshots.get(captured);
  if (cached !== undefined) return cached;
  const expanded = expandForeignInputs(captured.inputs, fixtureTarget.c);
  if (!expanded.ok) throw Error(expanded.error);
  const result = {
    snapshot: {
      ...captured,
      inputs: expanded.value.inputs,
      mappings: [...captured.mappings, ...expanded.value.mappings],
    },
    libraries: expanded.value.libraries,
  };
  foreignSnapshots.set(captured, result);
  return result;
}
/** A fixture-local C binding declaration module (docs/native-ffi.md). */
export interface FixtureForeignDeclaration {
  readonly id: string;
  readonly text: string;
}

/** General (JavaScript-semantics) lowering for application code the typed
 * pipeline rejects, with console output through the hosted fs binding.
 * TINT_GENERAL_FALLBACK=0 disables it. */
export const workspaceGeneralLowering =
  process.env.TINT_GENERAL_FALLBACK === "0"
    ? undefined
    : createGeneralLowering({
        runtime: {
          objects: "packages/js-runtime/src/objects/index.ts",
          modules: "packages/js-runtime/src/modules/index.ts",
          globalEnvironment:
            "packages/js-runtime/src/environments/global/index.ts",
          environmentRecords:
            "packages/js-runtime/src/environments/records/index.ts",
        },
        output: {
          module: "packages/native-runtime/src/intrinsics/fs.ts",
          name: "write",
        },
      });

/** Build through the full hosted pipeline; always contain native failures in
 * LLDB. Returns the image path (kept only with TINT_BUILD_ONLY=1 or
 * TINT_KEEP_NATIVE=1). */
export function verifyHostedFixture(
  text: string,
  name: string,
  dependencies: readonly [string, string][] = [],
  generatedModules: readonly SourceModule[] = [],
  recordBindings: readonly NativeRecordBinding[] = [],
  additionalRuntimes: readonly RuntimeSource[] = [],
  options: {
    readonly allowJit?: boolean;
    readonly threaded?: boolean;
    readonly hostBindings?: readonly NativeHostBinding[];
    /** Fixture-local binding declarations and explicit c-call bindings. */
    readonly foreignDeclarations?: readonly FixtureForeignDeclaration[];
    readonly foreignBindings?: readonly NativeForeignBinding[];
    readonly weakBindings?: readonly NativeWeakBinding[];
    readonly managedSurfaces?: readonly ManagedSurfaceRequest[];
    readonly nativeServices?: BuildRequest["nativeServices"];
    readonly nativeServiceIdentity?: {
      readonly nativeLinkingMode: "aot-native-services-v1";
      readonly nativeServiceUnitIndexSha256: string;
    };
    readonly runtimeModule?: string;
    readonly runtimeEntry?: Exclude<BuildRequest["runtimeEntry"], undefined>;
    readonly managedBytes: number;
    readonly allocationCapacity: number;
    readonly stackBytes?: number;
    readonly rootCapacity?: number;
    /** Fail instead of falling back to general semantics (benchmarks whose
     * measurements must be of typed code). */
    readonly requireTyped?: boolean;
    /** Receives the general fallback when one was used (also reported on
     * stderr). */
    readonly onGeneralFallback?: (
      modules: readonly string[],
      reason: string,
    ) => void;
    /** Generic instantiation budget; defaults to the compiler project's. */
    readonly maxSpecializations?: number;
    /** Runtime diagnostics (docs/runtime-diagnostics.md); each defaults to
     * its TINT_STACK_TRACES / TINT_SIGNPOSTS / TINT_JIT_DEBUG variable. */
    readonly stackTraces?: boolean;
    readonly signposts?: boolean;
    readonly jitDebugInterface?: boolean;
    /** Heap introspection (docs/native-heap-profiling.md); defaults to
     * TINT_HEAP_INTROSPECTION, else to debug symbols. */
    readonly heapIntrospection?: boolean;
  } = {
    managedBytes: 4194304,
    allocationCapacity: 65536,
  },
): string {
  const bytes = new TextEncoder().encode(text);
  const stackTraces =
      options.stackTraces ?? process.env.TINT_STACK_TRACES === "1",
    signposts = options.signposts ?? process.env.TINT_SIGNPOSTS === "1",
    jitDebugInterface =
      options.jitDebugInterface ?? process.env.TINT_JIT_DEBUG === "1";
  const heapVariable = process.env.TINT_HEAP_INTROSPECTION,
    heapIntrospection =
      options.heapIntrospection ??
      (heapVariable === undefined ? undefined : heapVariable === "1");
  const source = createSourceText(bytes, bytes.length);
  assert.ok(source.ok);
  const parsed = parseModule(source.value);
  assert.ok(parsed.ok, JSON.stringify(parsed));
  const captured = workspaceSources();
  const sourceSnapshot = workspaceSourceIdentity(captured);
  const foreign = expandForeignSnapshot(captured);
  const foreignLibraries: ForeignLibrary[] = [...foreign.libraries];
  const foreignModules: SourceModule[] = [];
  for (const declaration of options.foreignDeclarations ?? []) {
    const prepared = prepareForeignLibrary(
      declaration.id,
      declaration.text,
      fixtureTarget.c,
    );
    if (!prepared.ok) assert.fail(prepared.error);
    const generated = new TextEncoder().encode(prepared.value.text);
    const generatedSource = createSourceText(generated, generated.length);
    assert.ok(generatedSource.ok);
    const generatedModule = parseModule(generatedSource.value);
    assert.ok(generatedModule.ok, JSON.stringify(generatedModule));
    foreignLibraries.push(prepared.value.library);
    foreignModules.push({
      id: declaration.id,
      module: generatedModule.value,
      dependencies: new Map(),
    });
  }
  const serviceMode = process.env.TINT_HOSTED_NATIVE_SERVICES;
  if (
    serviceMode !== undefined &&
    serviceMode !== "aot" &&
    serviceMode !== "monolithic"
  )
    throw Error("TINT_HOSTED_NATIVE_SERVICES must be aot, monolithic or unset");
  let serviceImage: ReturnType<typeof prepareDateTimeNativeService> | undefined;
  if (serviceMode === "aot") {
    const toolchain = frozenNativeRunIdentity(import.meta.url, sourceSnapshot);
    assert.ok(toolchain, "freeze the service fixture before compiling");
    serviceImage = prepareDateTimeNativeService(
      captured,
      toolchain,
      process.env.TINT_NATIVE_SERVICE_CACHE ??
        join(process.cwd(), ".tint-bootstrap/native-service-cache"),
      {
        generationalBarriers:
          (options.runtimeEntry ??
            projectBuildRequest([], () => {}).runtimeEntry) ===
          "initializeGenerationalRuntime",
      },
    );
  }
  const fixtureGenerated = [...generatedModules, ...foreignModules];
  const capturedModules = [
    ...workspaceModules(
      [
        ...projectRoots(),
        ...(workspaceGeneralLowering?.runtimeModules ?? []),
        ...dependencies
          .map((dependency) => dependency[1])
          .filter((id) => !fixtureGenerated.some((module) => module.id === id)),
      ],
      foreign.snapshot,
    ),
    ...fixtureGenerated,
  ];
  capturedModules.push({
    id: "fixture",
    module: parsed.value,
    dependencies: new Map(dependencies),
    sourcePosition: (offset) => {
      const position = source.value.positionAt(offset);
      return position.ok ? position.value : undefined;
    },
  });
  const modules =
    serviceImage === undefined
      ? capturedModules
      : serviceImage.transformModules(capturedModules);
  const request = projectBuildRequest(modules, () => {}, foreignLibraries);
  // The tint:ffi runtime's capabilities when the program loads it.
  const ffi = foreignRuntimeBindings(
    new Set(modules.map((module) => module.id)),
  );
  const nativeServices = [
    ...(options.nativeServices ?? []),
    ...(serviceImage?.services ?? []),
  ];
  // Analysis tooling: TINT_OPERATION_RANGES=1 writes <binary>.operations.json.
  let operationRanges: readonly ImageOperationRange[] | undefined;
  const dumps: [string, string][] = [];
  // Compiler observability (docs/compiler-observability.md): TINT_PASS_STATS,
  // TINT_CODE_SIZE, TINT_DUMP_PASSES, TINT_REMARKS and TINT_OPT_PASS_LIMIT.
  const observability = observabilityOptions(),
    observation = createBuildObservation(observability);
  const built = buildMacOSProgram({
    ...observation.request,
    ...request,
    target: fixtureTarget,
    threaded: options.threaded ?? false,
    allowDebugger: true,
    allowJit: options.allowJit ?? false,
    runtimes: [
      ...request.runtimes,
      ...additionalRuntimes,
      ...ffi.runtimes,
      ...(serviceImage?.runtimes ?? []),
    ],
    recordBindings: [
      ...recordBindings,
      ...(serviceImage?.recordBindings ?? []),
    ],
    weakBindings: [...(options.weakBindings ?? []), ...ffi.weakBindings],
    foreignMemoryBindings: ffi.memoryBindings,
    managedSurfaces: [
      ...(options.managedSurfaces ?? []),
      ...(serviceImage === undefined ? [] : [serviceImage.surface]),
    ],
    nativeServices,
    hostBindings: [
      ...request.hostBindings,
      ...(options.hostBindings ?? []),
      ...ffi.hostBindings,
    ],
    foreignBindings: [
      ...(request.foreignBindings ?? []),
      ...(options.foreignBindings ?? []),
    ],
    runtimeModule: options.runtimeModule ?? request.runtimeModule,
    runtimeEntry:
      options.runtimeEntry ?? request.runtimeEntry ?? "initializeRuntime",
    entry: "fixture",
    start: "run",
    ...(workspaceGeneralLowering === undefined
      ? {}
      : {
          generalLowering: workspaceGeneralLowering,
          ...(options.requireTyped === true ? { requireTyped: true } : {}),
          onGeneralFallback: (modules: readonly string[], reason: string) => {
            options.onGeneralFallback?.(modules, reason);
            process.stderr.write(
              "general fallback for " +
                modules.join(", ") +
                " (" +
                reason +
                ")\n",
            );
          },
        }),
    managedBytes: options.managedBytes,
    // Copying GC metadata needs a forwarding word per semispace allocation unit.
    allocationCapacity: options.allocationCapacity,
    rootCapacity: options.rootCapacity ?? 4096,
    stackBytes: options.stackBytes ?? 1048576,
    identifier: "tint-hosted-" + name,
    ...(options.maxSpecializations === undefined
      ? {}
      : { maxSpecializations: options.maxSpecializations }),
    debugSymbols: process.env.TINT_DEBUG_SYMBOLS === "1",
    // Runtime diagnostics (docs/runtime-diagnostics.md).
    stackTraces,
    signposts,
    jitDebugInterface,
    ...(heapIntrospection === undefined ? {} : { heapIntrospection }),
    // Analysis tooling: TINT_DUMP_IR=<substring> writes <binary>.lowered.ir and
    // <binary>.optimized.ir for functions whose names contain it ("" = all).
    ...(process.env.TINT_DUMP_IR === undefined
      ? {}
      : {
          onScalarIR: (stage: "lowered" | "optimized", module: ModuleIR) => {
            dumps.push([
              stage,
              formatModule(module, process.env.TINT_DUMP_IR || undefined),
            ]);
          },
        }),
    ...(process.env.TINT_OPERATION_RANGES === "1"
      ? {
          onOperationRanges: (ranges: readonly ImageOperationRange[]) => {
            operationRanges = ranges;
          },
        }
      : {}),
  });
  if (!built.ok) assert.fail(JSON.stringify(built.error));
  const directory = mkdtempSync(join(tmpdir(), "tint-hosted-" + name + "-")),
    path = join(directory, name);
  writeFileSync(path, built.value, { mode: 0o755 });
  if (operationRanges !== undefined)
    writeFileSync(path + ".operations.json", JSON.stringify(operationRanges));
  observation.finish(path);
  for (const [stage, text] of dumps)
    writeFileSync(path + "." + stage + ".ir", text + "\n");
  const fixturePath = path + ".source.ts";
  writeFileSync(fixturePath, bytes, { flag: "wx" });
  const generated = generatedModules.map((module) => ({
    id: module.id,
    dependencies: [...module.dependencies],
    module: module.module,
  }));
  writeFileSync(
    path + ".manifest.json",
    JSON.stringify(
      {
        kind: "tint-hosted-native-build",
        version: 1,
        sourceSnapshot,
        imageSha256: createHash("sha256").update(built.value).digest("hex"),
        fixture: fixturePath,
        fixtureSha256: createHash("sha256").update(bytes).digest("hex"),
        generatorArguments: process.argv.slice(1),
        generatedModulesSha256: createHash("sha256")
          .update(JSON.stringify(generated))
          .digest("hex"),
        options: {
          ...options,
          ...(serviceImage === undefined
            ? {}
            : {
                nativeServiceIdentity: serviceImage.identity,
              }),
          ...(nativeServices.length === 0
            ? {}
            : {
                nativeServices: nativeServices.map((service) => ({
                  bind: service.bind,
                  unit: {
                    version: service.unit.version,
                    profile: service.unit.profile,
                    factoryContract: service.unit.factoryContract,
                    surface: service.unit.surface,
                    entryOffset: service.unit.entryOffset,
                    counts: service.unit.counts,
                    codeBytes: service.unit.native.code.length,
                    codeSha256: createHash("sha256")
                      .update(service.unit.native.code)
                      .digest("hex"),
                  },
                })),
              }),
        },
        ...(serviceImage === undefined
          ? {}
          : {
              nativeServiceSourceProjectionSha256: createHash("sha256")
                .update(
                  JSON.stringify(
                    modules.map((module) => ({
                      id: module.id,
                      module: module.module,
                      dependencies: [...module.dependencies],
                    })),
                  ),
                )
                .digest("hex"),
            }),
        debugSymbols: process.env.TINT_DEBUG_SYMBOLS === "1",
        // Truncated optimization changes the image (miscompile bisection).
        ...(observability.passLimit === undefined
          ? {}
          : { optimizationPassLimit: observability.passLimit }),
        stackTraces,
        signposts,
        jitDebugInterface,
        ...(heapIntrospection === undefined ? {} : { heapIntrospection }),
      },
      null,
      2,
    ) + "\n",
    { flag: "wx" },
  );
  console.log(path);
  if (process.env.TINT_BUILD_ONLY !== "1")
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        const result = spawnSync(
          "lldb",
          [
            "--no-lldbinit",
            "--batch",
            "-o",
            "settings set target.disable-aslr false",
            "-o",
            "process launch --stop-at-entry",
            "-o",
            "script assert lldb.process.GetState() == lldb.eStateStopped",
            "-o",
            "continue",
            "-o",
            "script assert lldb.process.GetState() == lldb.eStateExited and lldb.process.GetExitStatus() == 42",
            path,
          ],
          { encoding: "utf8", timeout: 60000 },
        );
        assert.equal(result.error, undefined);
        assert.equal(result.signal, null, result.stderr);
        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /exited with status = 42 /, result.stdout);
      }
      console.log("Verified native " + name + " twice.");
    } finally {
      if (process.env.TINT_KEEP_NATIVE !== "1")
        rmSync(directory, { recursive: true, force: true });
    }
  return path;
}
