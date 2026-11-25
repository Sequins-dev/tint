import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { deserialize, serialize } from "node:v8";
import { prepareDateTimeNativeService } from "./date-time-native-service.ts";
import { frozenNativeRunIdentity } from "./native-run-journal.ts";
import {
  workspaceModuleLoader,
  workspaceModules,
  workspaceSources,
  workspaceSourceIdentity,
} from "./workspace-sources.ts";
import { projectRoots, projectBuildRequest } from "@tint/compiler/cli";
import { createSourceText } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import {
  buildMacOSProgram,
  compileMacOSProgram,
  linkMacOSProgram,
  type BuildRequest,
  type CompiledRuntimeUnits,
  type CompiledRuntimeUnitsResult,
  type ImageOperationRange,
  type RuntimeUnitInputs,
} from "@tint/compiler/build";
import type { SourceModule } from "@tint/typescript/modules/model";
import {
  createSourceModuleLoader,
  type SourceModuleText,
} from "@tint/typescript/modules";
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
  foreignRuntimeModules,
  prepareForeignLibrary,
  type ForeignLibrary,
  type GeneralFallbackFunction,
  type GeneralFallbackClass,
  type NativeForeignBinding,
  type NativeForeignMemoryBinding,
  type NativeHostBinding,
  type NativeRecordBinding,
  type NativeWeakBinding,
  type RuntimeSource,
  type ManagedSurfaceRequest,
} from "@tint/compiler/native";
import {
  nativeFixtureTarget,
  nativeScriptCallsEnabled,
} from "./native-host-target.ts";
import { writeNodeExecutable } from "./node-file-host.ts";
import {
  buildNativeFixture,
  type NativeFixtureBuild,
} from "./gate/native-fixture.ts";
import { admitDarwinFixture } from "./native-admission.ts";
import { nativeArtifact, runNativeBatch } from "./native-target-runner.ts";
/** Build target and execution runner are selected independently. */
const fixtureTarget = nativeFixtureTarget();
import type { CLibraryManifestEntry } from "@tint/abi/c";
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
  /** Library manifest entries the declaration may use (e.g. an optional
   * library), as a build request's additions to `cLibraryManifest`. */
  readonly manifest?: readonly CLibraryManifestEntry[];
}

/** Builds in one process share the workspace parse and the compiled runtime
 * units while the workspace sources are unchanged; the images are the same.
 * TINT_FIXTURE_CACHE=0, read per build, starts every build from scratch. */
function fixtureCache(): boolean {
  return process.env.TINT_FIXTURE_CACHE !== "0";
}
/** Runtime unit compiles, reuses in this process and restores from the
 * gate's cache directory (see shareRuntimeUnits). */
export const fixtureCacheStatistics = { compiled: 0, shared: 0, restored: 0 };
/** Runtime units shared by every test process of one native batch: beside
 * its journal (TINT_GATE_NATIVE_IMAGES), or in TINT_FIXTURE_CACHE_DIRECTORY.
 * Standalone runs keep them in their process only. */
function fixtureCacheDirectory(): string | undefined {
  if (!fixtureCache()) return undefined;
  const directory = process.env.TINT_FIXTURE_CACHE_DIRECTORY;
  if (directory) return directory;
  const journal = process.env.TINT_GATE_NATIVE_IMAGES;
  return journal ? join(dirname(journal), "fixture-cache") : undefined;
}
/** Parsed workspace modules, by syntax tree, with the identity of the
 * captured sources they were parsed from: only those can be restored from
 * another process's cache entry. */
const snapshotSyntax = new WeakMap<object, string>();
function snapshotModules(
  roots: readonly string[],
  snapshot: WorkspaceSourceSnapshot,
  identity: string,
): readonly SourceModule[] {
  const modules = workspaceModules(roots, snapshot);
  for (const module of modules) snapshotSyntax.set(module.module, identity);
  return modules;
}
/** The cache file of runtime units compiled only from captured workspace
 * sources, or undefined when a fixture supplies or transforms one of them. */
function runtimeUnitsFile(inputs: RuntimeUnitInputs): string | undefined {
  const directory = fixtureCacheDirectory();
  const identity = snapshotSyntax.get(inputs.modules[0]?.module ?? {});
  if (
    directory === undefined ||
    identity === undefined ||
    inputs.allocator === undefined ||
    !inputs.modules.every(
      (source) => snapshotSyntax.get(source.module) === identity,
    )
  )
    return undefined;
  const key = createHash("sha256")
    .update(
      JSON.stringify([
        "tint-fixture-runtime-units-v1",
        identity,
        fixtureTarget.name,
        inputs.key,
        inputs.allocator.id,
        inputs.modules.map((source) => [
          source.id,
          [...source.dependencies].sort(),
        ]),
      ]),
    )
    .digest("hex");
  return join(directory, "runtime-units-" + key + ".v8");
}
/** Restore runtime units from the cache file. The allocator source is not
 * cloneable (it may hold position callbacks); it comes from this build's
 * inputs, parsed from the same sources. */
function restoreRuntimeUnits(
  file: string,
  inputs: RuntimeUnitInputs,
): CompiledRuntimeUnitsResult | undefined {
  if (inputs.allocator === undefined || !existsSync(file)) return undefined;
  try {
    const entry = deserialize(readFileSync(file)) as {
      readonly file: string;
      readonly units: Omit<CompiledRuntimeUnits, "allocatorSource">;
    };
    if (entry.file !== file) return undefined;
    return {
      ok: true,
      value: { ...entry.units, allocatorSource: inputs.allocator },
    };
  } catch {
    // An unreadable entry is compiled again and replaced.
    return undefined;
  }
}
function storeRuntimeUnits(file: string, units: CompiledRuntimeUnits): void {
  mkdirSync(dirname(file), { recursive: true });
  const staging = file + "." + process.pid + ".tmp";
  const { allocatorSource: _source, ...stored } = units;
  writeFileSync(staging, serialize({ file, units: stored }));
  renameSync(staging, file);
}
let currentWorkspace:
  | {
      readonly snapshot: WorkspaceSourceSnapshot;
      readonly identity: ReturnType<typeof workspaceSourceIdentity>;
    }
  | undefined;
/** Capture the workspace sources, keeping the previous snapshot object while
 * their identity is unchanged: parsed modules (workspaceModules) and expanded
 * C bindings (expandForeignSnapshot) are cached per snapshot object. */
function captureWorkspace(): NonNullable<typeof currentWorkspace> {
  const snapshot = workspaceSources();
  const identity = workspaceSourceIdentity(snapshot);
  if (!fixtureCache()) return { snapshot, identity };
  if (currentWorkspace?.identity.sha256 !== identity.sha256)
    currentWorkspace = { snapshot, identity };
  return currentWorkspace;
}
/** Runtime units shared by this process's builds (BuildRequest.runtimeUnits).
 * The key holds the units' options and the identity of each parsed source
 * module they are compiled from, so a module parsed from another snapshot or
 * generated by a fixture is a different key. */
const sharedRuntimeUnits = new Map<string, CompiledRuntimeUnitsResult>();
const syntaxIds = new WeakMap<object, number>();
let nextSyntaxId = 0;
function shareRuntimeUnits(
  inputs: RuntimeUnitInputs,
  compile: () => CompiledRuntimeUnitsResult,
): CompiledRuntimeUnitsResult {
  const parts = [inputs.key];
  for (const source of inputs.modules) {
    let syntax = syntaxIds.get(source.module);
    if (syntax === undefined) {
      syntax = nextSyntaxId++;
      syntaxIds.set(source.module, syntax);
    }
    const dependencies = [...source.dependencies]
      .map(([specifier, id]) => specifier + ">" + id)
      .sort();
    parts.push(source.id + "#" + syntax + ":" + dependencies.join(","));
  }
  const key = parts.join("\n");
  const shared = sharedRuntimeUnits.get(key);
  if (shared !== undefined) {
    fixtureCacheStatistics.shared++;
    return shared;
  }
  const file = runtimeUnitsFile(inputs);
  const restored =
    file === undefined ? undefined : restoreRuntimeUnits(file, inputs);
  if (restored !== undefined) {
    fixtureCacheStatistics.restored++;
    sharedRuntimeUnits.set(key, restored);
    return restored;
  }
  fixtureCacheStatistics.compiled++;
  const units = compile();
  if (units.ok) {
    sharedRuntimeUnits.set(key, units);
    if (file !== undefined) storeRuntimeUnits(file, units.value);
  }
  return units;
}

/** Copy an image and its build records (manifest, source, run records) to a
 * new path. A copied manifest names the copied source; the image bytes, and
 * so the manifest's image hash, are unchanged. */
function copyFixtureImage(from: string, to: string): void {
  const prefix = basename(from) + ".";
  copyFileSync(from, to);
  chmodSync(to, 0o755);
  for (const file of readdirSync(dirname(from)))
    if (file.startsWith(prefix))
      copyFileSync(
        join(dirname(from), file),
        to + "." + file.slice(prefix.length),
      );
  const manifest = to + ".manifest.json";
  if (existsSync(manifest)) {
    const record = JSON.parse(readFileSync(manifest, "utf8"));
    if (typeof record.fixture === "string") {
      record.fixture = to + ".source.ts";
      writeFileSync(manifest, JSON.stringify(record, null, 2) + "\n");
    }
  }
}
/** Images of fixed fixtures, built once per process (see sharedFixtureImage). */
const sharedImages = new Map<string, string>();
/** Build a fixture whose program and options never vary (`key`) once per
 * process, and once per native batch through its cache directory. Every
 * call returns a private copy of the image and its build records, which the
 * caller may delete. Build-affecting TINT_ variables are part of the key. */
export function sharedFixtureImage(
  name: string,
  key: readonly unknown[],
  build: () => string,
): string {
  if (!fixtureCache()) return build();
  const environment = Object.entries(process.env)
    .filter(
      ([variable]) =>
        variable.startsWith("TINT_") &&
        !variable.startsWith("TINT_GATE_") &&
        !variable.startsWith("TINT_FIXTURE_") &&
        variable !== "TINT_BUILD_ONLY" &&
        variable !== "TINT_KEEP_NATIVE",
    )
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const id = createHash("sha256")
    .update(
      JSON.stringify([
        "tint-fixture-image-v1",
        captureWorkspace().identity.sha256,
        fixtureTarget.name,
        name,
        key,
        environment,
      ]),
    )
    .digest("hex");
  let kept = sharedImages.get(id);
  if (kept === undefined || !existsSync(kept)) {
    const cache = fixtureCacheDirectory();
    const stored =
      cache === undefined ? undefined : join(cache, "image-" + id, name);
    if (stored !== undefined && existsSync(stored + ".manifest.json"))
      kept = stored;
    else {
      const built = build();
      const staging = mkdtempSync(
        join(
          cache ?? process.env.TINT_FIXTURE_TMPDIR ?? tmpdir(),
          "tint-shared-" + name + "-",
        ),
      );
      copyFixtureImage(built, join(staging, name));
      rmSync(dirname(built), { recursive: true, force: true });
      kept = join(staging, name);
      if (stored !== undefined)
        try {
          renameSync(staging, dirname(stored));
          kept = stored;
        } catch {
          // Another process stored the same image first; keep this copy.
        }
      if (kept !== stored)
        process.once("exit", () =>
          rmSync(staging, { recursive: true, force: true }),
        );
    }
    sharedImages.set(id, kept);
  }
  const copy = join(
    mkdtempSync(
      join(
        process.env.TINT_FIXTURE_TMPDIR ?? tmpdir(),
        "tint-hosted-" + name + "-",
      ),
    ),
    name,
  );
  copyFixtureImage(kept, copy);
  return copy;
}

type GeneralLowering = ReturnType<typeof createGeneralLowering>;
let generalLowering: GeneralLowering | undefined;
let nodeGeneralLowering: GeneralLowering | undefined;
const eventLoopClockModule = "packages/native-runtime/src/intrinsics/clock.ts";
/** General (JavaScript-semantics) lowering for application code the typed
 * pipeline rejects, with console output through the hosted fs binding.
 * TINT_GENERAL_FALLBACK=0 disables retries while retaining the worker image
 * composition used by the typed path. Read per build: fixtures can set the
 * variable after importing this module. */
export function workspaceGeneralLowering(
  functionFallback = false,
  nodeEventLoop = false,
  workerImage?: {
    readonly managedBytes: number;
    readonly stackBytes: number;
    readonly nodeHosted: boolean;
  },
): GeneralLowering | undefined {
  if (process.env.TINT_GENERAL_FALLBACK === "0" && workerImage === undefined)
    return undefined;
  const cached = nodeEventLoop ? nodeGeneralLowering : generalLowering;
  if (!functionFallback && workerImage === undefined && cached !== undefined)
    return cached;
  const lowering = createGeneralLowering({
    functionFallback,
    nativeScriptCalls: nativeScriptCallsEnabled(),
    runtime: {
      objects: "packages/js-runtime/src/objects/index.ts",
      modules: "packages/js-runtime/src/modules/index.ts",
      globalEnvironment: "packages/js-runtime/src/environments/global/index.ts",
      environmentRecords:
        "packages/js-runtime/src/environments/records/index.ts",
    },
    output: {
      module: "packages/native-runtime/src/intrinsics/fs.ts",
      name: "write",
    },
    ...(nodeEventLoop
      ? {
          nodeEventLoop: {
            globals: "packages/native-runtime/src/node/event-loop-globals.ts",
            driver: "packages/native-runtime/src/event-loop-reactor.ts",
            clock: eventLoopClockModule,
            reactor:
              "packages/platform/src/" + fixtureTarget.os + "/reactor.ts",
          },
        }
      : {}),
    ...(workerImage === undefined
      ? {}
      : {
          nodeWorkers: {
            host: "packages/native-runtime/src/node/worker-host.ts",
            shared: "packages/native-runtime/src/shared-blocks.ts",
            lifecycle: "packages/native-runtime/src/worker-lifecycle.ts",
            threadHost: "packages/platform/src/workers.ts",
            typedBindings:
              "packages/native-runtime/src/node/worker-threads-native.ts",
            managedBytes: workerImage.managedBytes,
            nodeHosted: workerImage.nodeHosted,
            stackBytes: workerImage.stackBytes,
          },
        }),
  });
  if (!functionFallback && workerImage === undefined) {
    if (nodeEventLoop) nodeGeneralLowering = lowering;
    else generalLowering = lowering;
  }
  return lowering;
}

/** Build through the full hosted pipeline and run through the target runner.
 * Returns the image path (kept only with TINT_BUILD_ONLY=1 or
 * TINT_KEEP_NATIVE=1). */
function buildHostedFixture(
  text: string,
  name: string,
  dependencies: readonly [string, string][] = [],
  generatedModules: readonly SourceModule[] = [],
  recordBindings: readonly NativeRecordBinding[] = [],
  additionalRuntimes: readonly RuntimeSource[] = [],
  options: {
    readonly allowJit?: boolean;
    /** BuildRequest.trustedExecutableCode (a trust boundary; see
     * docs/native-code-loading.md). */
    readonly trustedExecutableCode?: boolean;
    readonly threaded?: boolean;
    readonly threadExitPipe?: boolean;
    readonly workerModules?: readonly string[];
    readonly hostBindings?: readonly NativeHostBinding[];
    /** Project bindings to leave out, so the bound functions keep their
     * portable bodies (e.g. cpu-sha256, forcing the portable SHA-256). */
    readonly omittedHostOperations?: readonly NativeHostBinding["operation"][];
    /** Fixture-local binding declarations and explicit c-call bindings. */
    readonly foreignDeclarations?: readonly FixtureForeignDeclaration[];
    readonly foreignBindings?: readonly NativeForeignBinding[];
    readonly foreignMemoryBindings?: readonly NativeForeignMemoryBinding[];
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
    readonly nodeEventLoop?: boolean;
    readonly nodeWorkers?: boolean;
    readonly nodeWorkerLibrary?: boolean;
    /** Host validation over captured application sources, when supplied. */
    readonly validateSource?: GeneralLowering["validateSource"];
    readonly functionFallback?: boolean;
    /** Replay fixtures and these helper modules from captured source text. */
    readonly replaySources?: readonly SourceModuleText[];
    readonly optimization?: BuildRequest["optimization"];
    readonly onFallbackTrigger?: (
      trigger: NonNullable<Parameters<GeneralLowering["lower"]>[0]["trigger"]>,
    ) => void;
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
    /** Every far-reach code form (docs/large-images.md); defaults to
     * TINT_FORCE_FAR_REACH. */
    readonly forceFarReach?: boolean;
    /** Verification-only gap before the compiled program. The ordinary
     * allocator, runtime, program, startup and writers still run unchanged. */
    readonly programPaddingBytes?: number;
  } = {
    managedBytes: 4194304,
    allocationCapacity: 65536,
  },
): string | NativeFixtureBuild {
  const bytes = new TextEncoder().encode(text);
  const functionFallback =
    options.functionFallback === true && options.validateSource !== undefined;
  const workerImage =
    options.nodeWorkers === true
      ? {
          managedBytes: options.managedBytes,
          nodeHosted: options.nodeWorkerLibrary === true,
          stackBytes: options.stackBytes ?? 16777216,
        }
      : undefined;
  const general = workspaceGeneralLowering(
    functionFallback,
    options.nodeEventLoop === true || workerImage !== undefined,
    workerImage,
  );
  const eventLoop =
    (options.nodeEventLoop === true || workerImage !== undefined) &&
    general !== undefined;
  /** The general fallback's reason, when the program took it. */
  let generalFallback: string | undefined;
  let fallbackFunctions: readonly GeneralFallbackFunction[] | undefined;
  let fallbackClasses: readonly GeneralFallbackClass[] | undefined;
  const replaySources = options.replaySources;
  const fixtureSource = "fixture";
  const original =
    replaySources === undefined
      ? (() => {
          const source = createSourceText(bytes, bytes.length);
          assert.ok(source.ok);
          const parsed = parseModule(source.value);
          assert.ok(parsed.ok, JSON.stringify(parsed));
          return {
            id: fixtureSource,
            module: parsed.value,
            dependencies: new Map(dependencies),
            sourcePosition: (offset: number) => {
              const position = source.value.positionAt(offset);
              return position.ok ? position.value : undefined;
            },
          };
        })()
      : undefined;
  const stackTraces =
      options.stackTraces ?? process.env.TINT_STACK_TRACES === "1",
    signposts = options.signposts ?? process.env.TINT_SIGNPOSTS === "1",
    jitDebugInterface =
      options.jitDebugInterface ?? process.env.TINT_JIT_DEBUG === "1";
  const heapVariable = process.env.TINT_HEAP_INTROSPECTION,
    heapIntrospection =
      options.heapIntrospection ??
      (heapVariable === undefined ? undefined : heapVariable === "1");
  const { snapshot: captured, identity: sourceSnapshot } = captureWorkspace();
  const foreign = expandForeignSnapshot(captured);
  const foreignLibraries: ForeignLibrary[] = [...foreign.libraries];
  const foreignModules: SourceModule[] = [];
  /** Runtime modules the generated binding modules import. */
  const dependencyIds: string[] = [];
  for (const declaration of options.foreignDeclarations ?? []) {
    const prepared = prepareForeignLibrary(
      declaration.id,
      declaration.text,
      fixtureTarget.c,
      declaration.manifest,
    );
    if (!prepared.ok) assert.fail(prepared.error);
    const generated = new TextEncoder().encode(prepared.value.text);
    const generatedSource = createSourceText(generated, generated.length);
    assert.ok(generatedSource.ok);
    const generatedModule = parseModule(generatedSource.value);
    assert.ok(generatedModule.ok, JSON.stringify(generatedModule));
    foreignLibraries.push(prepared.value.library);
    // Like a binding package's grant (expandForeignInputs): lazily loaded
    // optional libraries resolve through tint:ffi/unsafe, may-callback
    // wrappers take their callback state from tint:ffi.
    const dependencies = new Map<string, string>();
    for (const [specifier, id] of [
      ["tint:ffi/unsafe", foreignRuntimeModules.unsafe],
      ["tint:ffi", foreignRuntimeModules.index],
    ] as const)
      if (prepared.value.text.includes('from "' + specifier + '"')) {
        dependencies.set(specifier, id);
        if (!dependencyIds.includes(id)) dependencyIds.push(id);
      }
    foreignModules.push({
      id: declaration.id,
      module: generatedModule.value,
      dependencies,
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
  if (replaySources !== undefined)
    assert.ok(
      fixtureGenerated.length === 0 && serviceImage === undefined,
      "source replay fixtures must supply text for every application module",
    );
  const localModuleIds = new Set(
    (replaySources ?? fixtureGenerated).map((module) => module.id),
  );
  const sysvDynamic =
    fixtureTarget.arch === "x86_64" &&
    (dependencyIds.includes(foreignRuntimeModules.unsafe) ||
      dependencies.some(
        (dependency) =>
          dependency[1] === foreignRuntimeModules.unsafe ||
          dependency[1] === foreignRuntimeModules.index,
      ));

  const roots = [
    ...projectRoots(),
    ...(general?.runtimeModules ?? []),
    ...dependencies
      .map((dependency) => dependency[1])
      .filter(
        (id) =>
          !localModuleIds.has(id) &&
          general?.syntheticModules?.includes(id) !== true,
      ),
    ...dependencyIds,
    ...(sysvDynamic ? [foreignRuntimeModules.sysv] : []),
  ];
  const replay = { loads: 0, modules: 0, utf16Units: 0 };
  const moduleLoader =
    replaySources === undefined
      ? undefined
      : (() => {
          const workspace = workspaceModuleLoader(roots, foreign.snapshot);
          const fixture = createSourceModuleLoader([
            ...replaySources,
            { id: fixtureSource, text, dependencies: new Map(dependencies) },
          ]);
          const ids = [...workspace.ids, ...fixture.ids];
          assert.equal(
            new Set(ids).size,
            ids.length,
            "duplicate replay module",
          );
          return {
            ids,
            sourceDependencies: (id: string) =>
              fixture.sourceDependencies?.(id) ??
              workspace.sourceDependencies?.(id),
            load: (selected?: readonly string[]) => {
              const loaded = [
                ...workspace.load(selected),
                ...fixture.load(selected),
              ];
              replay.loads++;
              replay.modules += loaded.length;
              for (const module of loaded)
                replay.utf16Units += module.module.end;
              return loaded;
            },
          };
        })();
  const modules =
    original === undefined
      ? []
      : (() => {
          let workspace = snapshotModules(
            roots,
            foreign.snapshot,
            sourceSnapshot.sha256,
          );
          if (
            fixtureTarget.arch === "x86_64" &&
            workspace.some(
              (module) => module.id === foreignRuntimeModules.unsafe,
            ) &&
            !workspace.some(
              (module) => module.id === foreignRuntimeModules.sysv,
            )
          )
            workspace = snapshotModules(
              [...roots, foreignRuntimeModules.sysv],
              foreign.snapshot,
              sourceSnapshot.sha256,
            );
          const capturedModules: SourceModule[] = [
            ...workspace,
            ...fixtureGenerated,
            original,
          ];
          return (
            serviceImage?.transformModules(capturedModules) ?? capturedModules
          );
        })();
  const { runtimeEntry: defaultRuntimeEntry, ...request } = projectBuildRequest(
    modules,
    () => {},
    foreignLibraries,
    moduleLoader,
  );
  const runtimeEntry =
    options.runtimeEntry ??
    defaultRuntimeEntry ??
    (fixtureTarget.arch === "x86_64"
      ? "initializeGenerationalRuntime"
      : "initializeRuntime");
  // The tint:ffi runtime's capabilities when the program loads it.
  const ffi = foreignRuntimeBindings(
    new Set(moduleLoader?.ids ?? modules.map((module) => module.id)),
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
  const buildRequest: BuildRequest = {
    ...observation.request,
    ...request,
    ...(fixtureCache() ? { runtimeUnits: shareRuntimeUnits } : {}),
    target: fixtureTarget,
    ...(options.optimization === undefined
      ? {}
      : { optimization: options.optimization }),
    threaded: options.threaded ?? false,
    nodeWorkerLibrary: options.nodeWorkerLibrary === true,
    threadExitPipe: options.threadExitPipe ?? false,
    ...(options.workerModules === undefined
      ? {}
      : { workerModules: options.workerModules }),
    forceFarReach:
      options.forceFarReach ?? process.env.TINT_FORCE_FAR_REACH === "1",
    machOLayout:
      process.env.TINT_FORCE_LARGE_IMAGE === "1"
        ? { compactVMLimit: 1, signedChunkBytes: 65536 }
        : undefined,
    allowDebugger: true,
    allowJit: options.allowJit ?? false,
    trustedExecutableCode: options.trustedExecutableCode ?? false,
    runtimes: [
      ...request.runtimes,
      ...additionalRuntimes,
      ...ffi.runtimes,
      ...(eventLoop
        ? [
            {
              module: eventLoopClockModule,
              namespace: "node-event-loop-clock",
              retainedExports: ["monotonicMilliseconds"],
            },
          ]
        : []),
      ...(serviceImage?.runtimes ?? []),
    ],
    recordBindings: [
      ...recordBindings,
      ...(serviceImage?.recordBindings ?? []),
    ],
    weakBindings: [...(options.weakBindings ?? []), ...ffi.weakBindings],
    foreignMemoryBindings: [
      ...ffi.memoryBindings,
      ...(options.foreignMemoryBindings ?? []),
    ],
    managedSurfaces: [
      ...(options.managedSurfaces ?? []),
      ...(serviceImage === undefined ? [] : [serviceImage.surface]),
    ],
    nativeServices,
    hostBindings: [
      ...request.hostBindings.filter(
        (binding) =>
          options.omittedHostOperations?.includes(binding.operation) !== true,
      ),
      ...(options.hostBindings ?? []),
      ...ffi.hostBindings,
      ...(eventLoop
        ? [
            {
              module: eventLoopClockModule,
              name: "monotonicMilliseconds",
              operation: "monotonic-time" as const,
            },
          ]
        : []),
    ],
    foreignBindings: [
      ...(request.foreignBindings ?? []),
      ...(options.foreignBindings ?? []),
    ],
    runtimeModule: options.runtimeModule ?? request.runtimeModule,
    ...(runtimeEntry === undefined ? {} : { runtimeEntry }),
    entry: fixtureSource,
    start: "run",
    ...(options.requireTyped === true ||
    process.env.TINT_GENERAL_FALLBACK === "0"
      ? { requireTyped: true }
      : {}),
    ...(general === undefined
      ? {}
      : {
          generalLowering: {
            ...general,
            ...(options.validateSource === undefined
              ? {}
              : { validateSource: options.validateSource }),
            ...(functionFallback || options.onFallbackTrigger !== undefined
              ? {
                  lower: (request: Parameters<GeneralLowering["lower"]>[0]) => {
                    if (request.trigger !== undefined)
                      options.onFallbackTrigger?.(request.trigger);
                    const lowered = general.lower(request);
                    fallbackFunctions = lowered.ok
                      ? lowered.value.functions
                      : undefined;
                    fallbackClasses = lowered.ok
                      ? lowered.value.classes
                      : undefined;
                    return lowered;
                  },
                }
              : {}),
          },
          onGeneralFallback: (modules: readonly string[], reason: string) => {
            generalFallback = reason;
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
    // x86-64 stack frames spill more slots than arm64; 1 MiB overflows during
    // general-fallback realm startup.
    stackBytes:
      options.stackBytes ??
      (fixtureTarget.arch === "x86_64" ? 4194304 : 1048576),
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
  };
  const padding = options.programPaddingBytes ?? 0;
  const built =
    padding === 0
      ? buildMacOSProgram(buildRequest)
      : (() => {
          assert.ok(
            Number.isSafeInteger(padding) &&
              padding > 0 &&
              padding % 4096 === 0,
          );
          const compiled = compileMacOSProgram(buildRequest);
          if (!compiled.ok) return compiled;
          const runtime = compiled.value.runtime;
          const code = new Uint8Array(runtime.native.code.length + padding);
          code.set(runtime.native.code);
          return linkMacOSProgram(
            {
              ...compiled.value,
              runtime: { ...runtime, native: { ...runtime.native, code } },
            },
            buildRequest,
          );
        })();
  if (!built.ok) assert.fail(JSON.stringify(built.error));
  const directory = mkdtempSync(
      join(
        process.env.TINT_FIXTURE_TMPDIR ?? tmpdir(),
        "tint-hosted-" + name + "-",
      ),
    ),
    path = join(directory, name);
  writeNodeExecutable(path, built.value, true);
  const imageHash = createHash("sha256");
  for (let offset = 0; offset < built.value.length; offset += 0x4000000)
    imageHash.update(built.value.subarray(offset, offset + 0x4000000));
  if (operationRanges !== undefined)
    writeFileSync(path + ".operations.json", JSON.stringify(operationRanges));
  observation.finish(path);
  for (const [stage, text] of dumps)
    writeFileSync(path + "." + stage + ".ir", text + "\n");
  const fixturePath = path + ".source.ts";
  writeFileSync(fixturePath, bytes, { flag: "wx" });
  const generated =
    replaySources === undefined
      ? generatedModules.map((module) => ({
          id: module.id,
          dependencies: [...module.dependencies],
          module: module.module,
        }))
      : replaySources.map((module) => ({
          id: module.id,
          dependencies: [...module.dependencies],
          text: module.text,
        }));
  const { replaySources: _replaySources, ...manifestOptions } = options;
  writeFileSync(
    path + ".manifest.json",
    JSON.stringify(
      {
        kind: "tint-hosted-native-build",
        version: 1,
        target: fixtureTarget.name,
        sourceSnapshot,
        imageSha256: imageHash.digest("hex"),
        fixture: fixturePath,
        fixtureSha256: createHash("sha256").update(bytes).digest("hex"),
        generatorArguments: process.argv.slice(1),
        generatedModulesSha256: createHash("sha256")
          .update(JSON.stringify(generated))
          .digest("hex"),
        ...(moduleLoader === undefined ? {} : { sourceReplay: replay }),
        ...(fallbackFunctions === undefined ? {} : { fallbackFunctions }),
        ...(fallbackClasses === undefined ? {} : { fallbackClasses }),
        options: {
          ...manifestOptions,
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
  return generalFallback === undefined ? path : { path, generalFallback };
}

export function prepareHostedFixture(
  ...args: Parameters<typeof buildHostedFixture>
): string {
  const name = args[1];
  const path = buildNativeFixture(name, () => buildHostedFixture(...args));
  console.log(path);
  return path;
}

export function verifyHostedFixture(
  ...args: Parameters<typeof buildHostedFixture>
): string {
  const name = args[1];
  const path = prepareHostedFixture(...args);
  const mode = process.env.TINT_BUILD_ONLY;
  if (mode === "defer-admission") return path;
  if (mode === "1") {
    // Admit build-only Darwin images before callers launch their own LLDB.
    if (fixtureTarget.os === "darwin" && args[6]?.nodeWorkerLibrary !== true)
      admitDarwinFixture(path);
  } else
    try {
      const artifact = nativeArtifact(
        fixtureTarget.name,
        path,
        path + ".manifest.json",
      );
      const results = runNativeBatch([{ artifact }, { artifact }]);
      writeFileSync(
        path + ".run.json",
        JSON.stringify(results, null, 2) + "\n",
      );
      for (const result of results) {
        if (result.kind === "execution-unavailable")
          throw Error("execution unavailable: " + result.reason);
        assert.ok(
          result.kind === "exited" && result.status === 42,
          JSON.stringify(result),
        );
      }
      console.log("Verified native " + name + " twice.");
    } finally {
      if (process.env.TINT_KEEP_NATIVE !== "1")
        rmSync(dirname(path), { recursive: true, force: true });
    }
  return path;
}
