export { managedDirectCallDeclarations } from "./managed-closure-uses.ts";
import { nativeTargetLayout } from "./target-layout.ts";
import type { NativeServiceBinding } from "./service-unit-link.ts";
import {
  describeFunctionDebug,
  describeHeapRecords,
  type DebugHeapRecord,
  type ProgramFunctionDebug,
} from "./debug-functions.ts";
import type { ManagedIdentityShape } from "./managed-imports.ts";
import { managedSurfaceContract } from "./managed-directory-reader.ts";
import {
  createManagedTypeContractIndex,
  managedFunctionType,
} from "./managed-contracts.ts";
export {
  linkNativeServiceModules,
  type NativeServiceBinding,
  type NativeServiceLink,
  type NativeServiceLinking,
} from "./service-unit-link.ts";
export {
  compileNativeServiceUnit,
  compileX64NativeServiceUnit,
  type NativeServiceUnit,
  type X64NativeServiceUnit,
  type NativeServiceCompilation,
} from "./service-unit.ts";
import {
  resolveRuntimeEntryBindings,
  rejectHostRuntimeEntries,
} from "./managed-runtime-entries.ts";
import { materializeManagedRuntimeProviders } from "./managed-runtimes.ts";
import {
  validRuntimeNamespace,
  dynamicObjectRuntimeSource,
  nativeArrayDetachModule,
  nativeValueViewsModule,
  nativeWeakModule,
  type RuntimeSource,
} from "./runtime-contracts.ts";
import {
  prepareManagedSurfaceExports,
  materializeManagedSurfaceExports,
  type ManagedSurfaceAOTPlan,
  type ManagedSurfaceRequest,
  type ManagedSurfaceRuntimeExports,
} from "./managed-aot.ts";
import {
  verifyManagedSurfacePhysicalAgreement,
  type SerializedManagedSurfaceDirectory,
} from "./managed-directory-data.ts";
import type { ManagedSurfacePhysicalFacts } from "./managed-directory.ts";
export type { RuntimeSource } from "./runtime-contracts.ts";
export {
  boundaryNumber,
  boundaryString,
  boundaryBoolean,
  boundaryUndefined,
  boundaryNull,
  boundaryUnknown,
  type BoundaryExport,
  type BoundaryField,
  type BoundaryRecord,
  type BoundaryRecordUse,
  type TypedBoundaryModule,
} from "./general-partition.ts";
import { pruneUnusedModules, reachableModules } from "./module-pruning.ts";
import type { PosixHostABI } from "@tint/abi/host";
import {
  darwinAArch64Target,
  type AArch64Target,
  type NativeTarget,
} from "@tint/platform/target";
import {
  emitModule as emitX64,
  type X64Module,
  type X64SignpostSite,
} from "@tint/codegen/x86_64/scalar";
import type { PosixHostFacts } from "@tint/abi/host";
import { bindingIdentifiers, rewriteModule } from "@tint/typescript/syntax";
import {
  optimizeModuleVersion,
  pruneClosedModule,
  pruneModuleReferences,
  lowerReferenceLists,
  referenceListWorkBudget,
  traceModuleReferences,
  unboundedWork,
  type ReferenceListRuntime,
  type ReferenceListAlias,
  type ModuleVersion,
  type OptimizationObserver,
  type OptimizationRemark,
  type PassEvent,
  type PassStatistics,
} from "@tint/ir/optimization";
import {
  bindHostOperations,
  bindForeignCalls,
  dynamicForeignCall,
  dynamicScalarCall,
  type ForeignOperand,
  type ForeignBinding,
  bindWeakOperations,
  type WeakOperation,
  type WeakBinding,
  type HostOperation,
  type HostBinding,
  type ModuleIR,
  type ScalarType,
  type FunctionIR,
  type Span,
  functionHeader,
} from "@tint/ir/scalar";
import {
  createEmissionStore,
  emissionStorage,
  type BuildStorage,
} from "../spill-files.ts";
import type { FunctionStore } from "@tint/ir/storage";
import {
  addFixedFfiPlans,
  ffiMemoryModule,
  fixedFfiCallArities,
  fixedFfiCallEntry,
  mixedFfiCallEntry,
  recognizeStaticFfi,
  makeStaticFfiModule,
  staticFfiEntry,
  staticFfiModule,
  staticFfiNumberEntry,
  hasStaticFfiBytesEntry,
  hasStaticFfiNumberEntry,
  staticFfiBytesEntry,
} from "./foreign/static-ffi.ts";
import { bindModule } from "@tint/typescript/binding";
import {
  checkClosureModule,
  withRealmGlobals,
  type CheckedClosures,
  type ClosureFallback,
} from "@tint/typescript/checker";
import {
  closeGeneralPartition,
  type BoundaryRecord,
  type TypedBoundaryModule,
} from "./general-partition.ts";
import {
  linkModules,
  locateSource,
  locateSourceRange,
  specializeModule,
  prepareModuleInstance,
  prepareModuleInvocation,
  prepareNativeGlobals,
  type NativeConstructor,
  type ModuleInstanceExport,
  type ModuleInstanceFallback,
  type LinkFallback,
  type LinkedExport,
  type SourceRange,
  type SpecializationCapability,
} from "@tint/ts-native/modules";
import {
  appendSourceModules,
  requestModules,
  type ModuleRequest,
  type SourcePosition,
  type SourceModuleLoader,
  type LoadResult,
} from "@tint/typescript/modules";
import type { SourceModule } from "@tint/typescript/modules/model";
import {
  prepareObservedCollectionRuntimes,
  type CollectionRuntimeObservation,
  type RuntimeModuleTransform,
} from "@tint/ts-native/runtime";
import {
  lowerModuleEntries,
  insertDynamicObjectRuntime,
  usesDynamicObjectRuntime,
  usesRealmInstanceof,
  type ModuleEntryOptions,
  type RecordOperation,
  type FunctionAddressBinding,
} from "@tint/ts-native/closure/lowering";
import {
  emitModule,
  emitModuleFromStore,
  type CodegenAnalysis,
  type Emission,
  type EmissionOptions,
  type NativeModule,
  type ManagedFunctionEntryBinding,
  type EmissionFormHints,
} from "@tint/codegen/aarch64/scalar";
import type {
  ImportDeclaration,
  Module,
  Statement,
} from "@tint/typescript/syntax";
import {
  foreignDeclaration,
  foreignCall,
  foreignRuntimeBindings,
  foreignRuntimeModules,
  foreignViewRegistry,
  selectX64ForeignRuntime,
  type ForeignLibrary,
  type NativeForeignBinding,
  type NativeForeignMemoryBinding,
} from "./foreign/index.ts";
export {
  expandForeignInputs,
  prepareForeignLibrary,
  parseForeignDeclarations,
  expandForeignLibrary,
  foreignDeclarationInput,
  linkedForeignLibrary,
  foreignRuntimeBindings,
  foreignRuntimeModules,
  type ForeignLibrary,
  type NativeForeignBinding,
  type NativeForeignMemoryBinding,
  type ForeignInputs,
  type ForeignInputsResult,
  type ForeignLibraryResult,
  type ForeignStub,
} from "./foreign/index.ts";

export interface NativeHostBinding {
  readonly module: string;
  readonly name: string;
  readonly operation: HostOperation;
}
/** Explicitly authorized export; names in source alone grant no capability. */
export interface NativeRecordBinding {
  readonly module: string;
  readonly name: string;
  readonly operation: RecordOperation;
  /** slot-read and the property cache operations: the first slot field's
   * name and the slot count; field-word: the field's name. */
  readonly field?: string;
  readonly count?: number;
  /** Property cache operations: the site's first cache field. */
  readonly siteField?: string;
  /** Property cache reads: the site's consecutive entries (default 1). */
  readonly entries?: number;
}
/** Opaque managed weak storage is available only to declared runtime exports. */
export interface NativeWeakBinding {
  readonly module: string;
  readonly name: string;
  readonly operation: WeakOperation;
}
/** Bodyless calls authorized by the compiler's native service composition. */
export interface NativeServiceImport {
  readonly module: string;
  readonly name: string;
  /** Omitted for a surface factory: the contract then names the surface's
   * directory as this compilation publishes it, so slots can be reserved
   * before that directory exists. */
  readonly contract?: string;
  /** A managed factory must exactly match this host-owned surface frame. */
  readonly surface?: string;
}
export interface CompileRequest extends ModuleRequest {
  readonly moduleConstructors?: readonly ModuleConstructorBinding[];
  readonly workerEvaluation?: readonly WorkerEvaluation[];
  readonly workerModules?: readonly string[] | undefined;
  readonly storage?: BuildStorage;
  readonly serviceImports?: readonly NativeServiceImport[];
  readonly managedSurfaces?: readonly ManagedSurfaceRequest[];
  /** The target's host policy (NativeTarget.hostABI). Builds pass their
   * target's; direct callers (tests and tools) default to darwin-aarch64. */
  readonly hostABI?: PosixHostABI;
  /** The target implements FEAT_JSCVT (Darwin arm64 targets: all Apple
   * silicon), so codegen may convert to ToInt32 with FJCVTZS. */
  readonly jsConvert?: boolean;
  readonly recordBindings?: readonly NativeRecordBinding[];
  readonly weakBindings?: readonly NativeWeakBinding[];
  /** Executable hosts select whether the runtime processes weak slots. */
  readonly nodeFfiWeakProcessing?: boolean;
  readonly nodeFfiRealmModules?: ReadonlySet<string>;
  readonly nodeFfiFixedArities?: readonly number[];
  /** Require the hosted context's optional linear-allocation state at byte 56. */
  readonly linearAllocation?: boolean;
  readonly generationalBarriers?: boolean;
  /** BuildRequest.trustedExecutableCode: the image's trust boundary for code
   * it publishes and calls at run time. */
  readonly trustedExecutableCode?: boolean;
  /** One-shot executable entry; no external calls may enter another native function. */
  readonly closedProgram?: boolean;
  /** Experimental: authorize bundled SparseList semantics for representation
   * rewriting. Requires closedProgram and a successful private-header proof. */
  readonly denseReferenceLists?: boolean;
  readonly optimization?: "none" | "basic";
  readonly debugSymbols?: boolean;
  /** Diagnostics: throw origins call the hosted trace-capture routine, and
   * the result carries the function and line ranges (as with debugSymbols)
   * for the image's stack-trace table. */
  readonly stackTraces?: boolean;
  /** Return function symbols and line ranges (as with debugSymbols) without
   * changing the emitted code. */
  readonly symbols?: boolean;
  /** Record per-IR-operation code ranges (analysis tooling only). */
  readonly operationRanges?: boolean;
  /** Analysis tooling: receives the program's scalar IR before and after
   * optimization (the module emission consumes). */
  readonly onScalarIR?: (
    stage: "lowered" | "optimized",
    module: ModuleIR,
  ) => void;
  /** Diagnostics: observes the program's optimization (pass events and
   * remarks). Observation never changes the emitted program. */
  readonly optimizationObserver?: ProgramOptimizationObserver;
  /** Diagnostics (miscompile bisection): stop the program's optimization
   * after this many reported passes (see ProgramOptimizationObserver). */
  readonly optimizationPassLimit?: number;
  /** Starting branch and address forms for the program's emission. */
  readonly emissionFormHints?: EmissionFormHints;
  /** The emitted code will be placed at a 4 KiB aligned address (hosted
   * images align every module), enabling two-instruction local addresses. */
  readonly pageAlignedCode?: boolean;
  /** Emit with every far-reach form (EmissionOptions.forceFarReach). */
  readonly forceFarReach?: boolean;
  /** Maximum instances in each application/runtime specialization pass. */
  readonly maxSpecializations?: number;
  /** Explicit capabilities for exports of declared trusted runtime modules. */
  readonly hostBindings?: readonly NativeHostBinding[];
  /** Expanded C binding modules (docs/native-ffi.md). Each one the program
   * loads becomes a trusted runtime module whose stubs bind to c-calls. */
  readonly foreignLibraries?: readonly ForeignLibrary[];
  /** Explicit c-call capabilities for exports of declared runtime modules. */
  readonly foreignBindings?: readonly NativeForeignBinding[];
  /** Explicit external-storage primitive capabilities (c-memory). */
  readonly foreignMemoryBindings?: readonly NativeForeignMemoryBinding[];
  readonly entry: string;
  readonly exports: readonly string[];
  /** Optional one-shot export invocation after initialization. */
  readonly start?: string;
  /** Runtime templates and their dependencies remain outside application module state. */
  readonly runtimes: readonly RuntimeSource[];
  /** General (full JavaScript semantics) lowering for application code the
   * typed pipeline cannot specialize. Without it, such programs fail. */
  readonly generalLowering?: GeneralLowering;
  /** Refuse the general fallback: a typed rejection fails the compilation
   * even when `generalLowering` is present. Builds whose performance depends
   * on staying typed (the compiler self-build, benchmarks) set it, so a
   * construct the typed pipeline rejects cannot silently cost them typed
   * specialization. */
  readonly requireTyped?: boolean;
}
export interface ModuleConstructorBinding {
  readonly module: string;
  readonly name: string;
  readonly factory: string;
}
/** One deferred evaluation scope: the top-level statements of `modules` run
 * when `entry`'s `start` export is called, not during image initialization. */
export interface WorkerEvaluation {
  readonly entry: string;
  readonly start: string;
  readonly modules: readonly string[];
}
/** An optimization remark with its span resolved to an original source file
 * (UTF-16 offsets in that file; line and column when the module supplies
 * source positions, as for debug line tables). */
export interface LocatedRemark extends OptimizationRemark {
  readonly file?: string;
  readonly line?: number;
  readonly column?: number;
}
/** Observes a program's optimization: every pass event in order (dense
 * reference-list lowering, unreachable-function removal and the optimizer's
 * pipeline) and located remarks. `begin` receives the program before the
 * first pass. */
export interface ProgramOptimizationObserver {
  /** Source names (`module:function`) of generated function names, before
   * `begin`. Derived functions extend a generated name (`$direct` twins,
   * `:sparse` list clones). */
  readonly functionNames?: (names: ReadonlyMap<string, string>) => void;
  readonly begin?: (module: ModuleIR) => void;
  readonly pass?: (event: PassEvent) => void;
  readonly remark?: (remark: LocatedRemark) => void;
}
/** Application modules to compile with general JavaScript semantics. */
export interface GeneralProgramRequest {
  /** The application modules, as parsed (TypeScript syntax retained). */
  readonly modules: readonly SourceModule[];
  /** Modules reachable from the application for resolving imports. With an
   * owned-syntax request this may include all modules. */
  readonly available: readonly SourceModule[];
  /** All original IDs when syntax was selectively replayed. */
  readonly availableIds?: readonly string[];
  readonly entry: string;
  /** The entry export the generated host calls; it returns the exit status. */
  readonly start: string;
  /** Typed modules the general modules import, reached through checked
   * entries: the host imports their exports and presents them to general
   * code as synthetic modules. */
  readonly boundaries: readonly TypedBoundaryModule[];
  /** Configured guest entry modules when composing a checked worker program. */
  readonly workerEntries?: readonly string[];
  /** Record types the boundaries use; they cross as JavaScript views. */
  readonly records?: readonly BoundaryRecord[];
  /** Source capability that seeded this retry, where classified. */
  readonly trigger?: FallbackTrigger;
  /** The original graph passed the host checker before representation choice. */
  readonly sourceValidated?: boolean;
}
export interface FallbackTrigger {
  readonly phase: "link" | "check" | "specialize" | "runtime" | "lower";
  readonly code: string;
  readonly capability:
    | ClosureFallback["capability"]
    | LinkFallback["capability"]
    | SpecializationCapability
    | ModuleInstanceFallback["capability"]
    | "native-callable-view";
  readonly location: {
    readonly module: string;
    readonly start: number;
    readonly end: number;
  };
  readonly owner: {
    readonly kind: ClosureFallback["ownerKind"];
    readonly module: string;
    readonly start: number;
    readonly end: number;
  };
}
export type GeneralProgram =
  | {
      readonly ok: true;
      readonly value: {
        /** Generated typed modules (lowered application and its host). */
        readonly modules: readonly SourceModule[];
        /** Generated guest modules that may execute on a product worker. */
        readonly workerModules?: readonly string[];
        readonly moduleConstructors?: readonly ModuleConstructorBinding[];
        readonly workerEvaluation?: readonly WorkerEvaluation[];
        /** The generated host module; it exports `start(): number`. */
        readonly entry: string;
        /** A proved primitive entry uses the general value ABI without the program realm. */
        readonly usesRealm?: boolean;
        readonly functions?: readonly GeneralFallbackFunction[];
        readonly classes?: readonly GeneralFallbackClass[];
        /** Record bindings of generated runtime modules (record view
         * slots), and those runtime modules. */
        readonly recordBindings?: readonly NativeRecordBinding[];
        readonly runtimes?: readonly RuntimeSource[];
      };
    }
  | { readonly ok: false; readonly error: string };
export interface GeneralFallbackFunction extends Span {
  readonly module: string;
  readonly name: string;
}
export interface GeneralFallbackClass extends Span {
  readonly module: string;
  readonly name: string;
}
interface GeneralFallback {
  readonly modules: readonly string[];
  readonly reason: string;
  readonly functions?: readonly GeneralFallbackFunction[];
  readonly classes?: readonly GeneralFallbackClass[];
}
/** Lowers application modules to typed modules of runtime-helper calls that
 * implement JavaScript semantics, plus a typed host entry. Provided by the
 * JavaScript engine (it depends on this package). */
export interface GeneralLowering {
  /** Runtime modules the generated code imports; hosts load them. */
  readonly runtimeModules: readonly string[];
  /** Representation views and runtime exports the generated code needs. */
  readonly recordBindings: readonly NativeRecordBinding[];
  readonly runtimes: readonly RuntimeSource[];
  /** Image-provided modules materialized by the generated host. */
  readonly syntheticModules?: readonly string[];
  /** Optional host oracle for the captured original source graph. The host
   * supplies source goals, options and module resolution for this entry. */
  readonly validateSource?: (entry: string) => readonly SourceDiagnostic[];
  /** Compose a typed entry with its Worker entries before checking it. With
   * `typedGuests`, the Worker entries are typed start functions in their own
   * deferred scopes (docs/design-worker-runtime.md); otherwise they are guest
   * modules with JavaScript semantics. */
  readonly prepareTypedWorkers?: (
    request: GeneralProgramRequest,
    typedGuests: boolean,
  ) => GeneralProgram;
  readonly lower: (request: GeneralProgramRequest) => GeneralProgram;
}
export interface SourceDiagnostic extends Span {
  readonly code: string;
  readonly message: string;
  readonly module: string;
}
export interface SourceLineRange {
  readonly offset: number;
  readonly byteLength: number;
  readonly file: string;
  readonly line: number;
  readonly column: number;
}
export interface PublishedManagedSurface {
  readonly name: string;
  readonly digest: string;
  /** The published directory, for compiling separately linked units
   * against this program's surface. */
  readonly directory: SerializedManagedSurfaceDirectory;
  readonly signatures: number;
  readonly records: number;
  readonly runtimeSlots: number;
  readonly runtimeTargets: number;
  readonly runtimeSignatures: number;
}
export interface CompiledX64HostedProgram {
  readonly ok: true;
  readonly native: X64Module;
  readonly lines: readonly SourceLineRange[];
  readonly functionNames: ReadonlyMap<string, string>;
  readonly parameterNames: ReadonlyMap<string, string>;
  readonly serviceIdentities: readonly NativeServiceBinding[];
  readonly managedSurfaces?: readonly PublishedManagedSurface[];
  readonly invocation: number;
  readonly returnType: "number" | "boolean" | "void" | "reference" | "general";
}
export interface CompiledProgram {
  /** Compiler-issued semantic identities in this program's permanent metadata. */
  readonly serviceIdentities?: readonly NativeServiceBinding[];
  readonly managedSurfaces?: readonly PublishedManagedSurface[];
  readonly optimization: readonly PassStatistics[];
  readonly lines: readonly SourceLineRange[];
  /** Debug builds: source variables and inline scopes by function. */
  readonly debugFunctions?: readonly ProgramFunctionDebug[];
  /** Debug builds: every record layout as a heap object type, by record
   * index (the index word before each descriptor). */
  readonly debugRecords?: readonly DebugHeapRecord[];
  readonly symbols: readonly {
    readonly byteLength: number;
    readonly name: string;
    readonly offset: number;
  }[];
  readonly native: NativeModule;
  /** Native function index. Calling it creates an instance and returns its export record. */
  readonly initializer: number;
  readonly entry: number | undefined;
  readonly exports: readonly string[];
  /** Present when application modules were compiled with general semantics
   * because the typed pipeline rejected them (visible fallback). */
  readonly general?: GeneralFallback;
}
export type Compilation =
  | { readonly ok: true; readonly value: CompiledProgram }
  | {
      readonly ok: false;
      readonly error: CompilationError;
    };
function failure(stage: string, message: string, module?: string): Compilation {
  return {
    ok: false,
    error:
      module === undefined ? { stage, message } : { stage, message, module },
  };
}
interface CompilationError {
  readonly stage: string;
  readonly message: string;
  /** The module the failure is attributed to, when known. */
  readonly module?: string;
  readonly diagnostic?: string;
  readonly sourceDiagnostics?: readonly SourceDiagnostic[];
  readonly fallback?: FallbackTrigger;
  readonly preventsFallback?: boolean;
  readonly needsDynamicRealm?: boolean;
  readonly needsBindingRealm?: boolean;
  readonly nativeProjections?: readonly string[];
}
/** A compiler-issued identity that foreign code binds by contract. */
interface IdentityPlan {
  readonly shape: ManagedIdentityShape;
  readonly contract: string;
  record: number | undefined;
  function: number | undefined;
}
/** Source names of generated functions, for debug symbols and diagnostics. */
interface FunctionSourceNames {
  /** `module:sourceName` (closures: `module:closure@offset`) by generated name. */
  readonly names: Map<string, string>;
  /** Source binding names by module:start:end of their declaration. */
  readonly variables: Map<string, string>;
  readonly positions: Map<string, SourcePosition>;
}
/** The front-end facts dense reference-list lowering needs. */
interface ReferenceListPlan {
  readonly bindings: readonly ReferenceListRuntime[];
  /** `module:start:end` of each lowered entry's source declaration. */
  readonly origins: readonly (string | undefined)[];
}
/** What optimization and emission need from the front end: the lowered IR
 * and compact source facts. Syntax, binding and checker results stay in the
 * front end's frame and become collectable when it returns (unoptimized
 * hosts keep a frame's dead locals alive until it returns). Later stages
 * replace `ir.module`, so only its current version stays reachable. */
interface TypedProgram {
  readonly workerFunctions?: ReadonlySet<string>;
  readonly ir: ModuleVersion;
  initializer: number;
  invocation: number;
  /** Linker ranges, for locating spans in their source modules. */
  readonly ranges: readonly SourceRange[];
  readonly serviceImports: ManagedFunctionEntryBinding[];
  readonly identityPlans: readonly IdentityPlan[];
  readonly surfaceRecordWitnesses: readonly number[];
  readonly surfacePlans: readonly ManagedSurfaceAOTPlan[];
  readonly surfaceRuntimes: readonly ManagedSurfaceRuntimeExports[];
  /** Present when observers, debug information or symbols need them. */
  readonly sourceNames: FunctionSourceNames | undefined;
  readonly referenceLists: ReferenceListPlan | undefined;
}
interface CompilationFailure {
  readonly ok: false;
  readonly error: CompilationError;
}
function stageFailure(
  stage: string,
  message: string,
  module?: string,
): CompilationFailure {
  return {
    ok: false,
    error:
      module === undefined ? { stage, message } : { stage, message, module },
  };
}
/** What lowering needs from linking, specialization and checking; the
 * linked and intermediate syntax stays in checkTypedProgram's frame. */
interface NodeErrorNames {
  readonly coded: string | undefined;
  readonly type: string | undefined;
  readonly range: string | undefined;
  readonly system: string | undefined;
  readonly info: string | undefined;
}
interface CheckedTypedProgram {
  readonly nodeErrors: NodeErrorNames | undefined;
  readonly checked: CheckedClosures;
  readonly options: ModuleEntryOptions;
  readonly exports: readonly LinkedExport[];
  readonly ranges: readonly SourceRange[];
  readonly runtimeNamespacesByModule: Map<string, string>;
  readonly surfacePlans: readonly ManagedSurfaceAOTPlan[];
  readonly surfaceFunctions: readonly (readonly string[])[];
  readonly surfaceRuntimes: readonly ManagedSurfaceRuntimeExports[];
  readonly initializerName: string;
  readonly entryName: string;
}
/** What specialization and checking need from linking; the linked syntax
 * and its binding stay in linkTypedProgram's frame. */
interface LinkedTypedProgram {
  readonly application: Module;
  readonly exports: readonly LinkedExport[];
  readonly ranges: readonly SourceRange[];
  readonly sourceNames: ReadonlyMap<string, string> | undefined;
  readonly helpers: Map<string, string>;
  readonly runtimeNamespacesByModule: Map<string, string>;
  readonly retainedRuntimeExports: readonly string[];
  readonly retainedRuntimeModules: Set<string>;
  readonly surfacePlans: readonly ManagedSurfaceAOTPlan[];
}
type TypedLinking =
  | { readonly ok: true; readonly value: LinkedTypedProgram }
  | CompilationFailure;
type TypedChecking =
  | { readonly ok: true; readonly value: CheckedTypedProgram }
  | CompilationFailure;
type TypedLowering =
  { readonly ok: true; readonly value: TypedProgram } | CompilationFailure;
/** Pure closed-program compilation. Source loading and executable packaging
 * are host concerns. Application code the typed pipeline rejects compiles
 * with general JavaScript semantics when the request provides a general
 * lowering; the fallback is reported in `general`. */
/** Loaded C binding modules are trusted runtimes (their stubs are bound
 * below); unloaded ones add nothing to the program. */
function withForeignRuntimes(
  request: CompileRequest,
  signedChar: boolean = request.hostABI?.os !== "linux",
): CompileRequest {
  const libraries = request.foreignLibraries ?? [];
  const loader = request.moduleLoader;
  const ids = new Set<string>();
  if (loader !== undefined) {
    for (const id of loader.ids) if (id !== undefined) ids.add(id);
  } else {
    for (const module of request.modules)
      if (module !== undefined) ids.add(module.id);
  }
  let nodeFfi = false,
    nodeBuffer = false;
  if (
    ids.has(foreignRuntimeModules.nodeFfi) ||
    ids.has(foreignRuntimeModules.nodeBuffer)
  ) {
    // The standalone collector can receive the application's source table
    // too. Authority follows the entry's imports, not source availability.
    const dependencies = new Map<string, ReadonlyMap<string, string>>();
    for (const source of request.modules) {
      if (source === undefined) throw "node source invariant";
      dependencies.set(source.id, source.dependencies);
    }
    const resolve =
      loader?.sourceDependencies ??
      ((id: string): ReadonlyMap<string, string> | undefined =>
        dependencies.get(id));
    const reachable = sourceDependencyClosure([request.entry], resolve);
    nodeFfi = reachable.includes(foreignRuntimeModules.nodeFfi);
    nodeBuffer = reachable.includes(foreignRuntimeModules.nodeBuffer);
  }
  if (libraries.length === 0 && !nodeFfi && !nodeBuffer) return request;
  const runtimes: RuntimeSource[] = request.runtimes.slice();
  for (const library of libraries) {
    if (library === undefined) throw "foreign library invariant";
    if (
      !ids.has(library.id) ||
      runtimes.some(
        (runtime) => runtime !== undefined && runtime.module === library.id,
      )
    )
      continue;
    // The bound stubs are runtime entries; other declarations (wrappers,
    // Layout constants) initialize with the module.
    const retained: string[] = [];
    for (const stub of library.stubs) {
      if (stub === undefined) throw "foreign stub invariant";
      retained.push(stub.name);
    }
    let namespace = "c." + library.declaration.module.slice(7);
    for (
      let suffix = 2;
      runtimes.some(
        (runtime) => runtime !== undefined && runtime.namespace === namespace,
      );
      suffix++
    )
      namespace =
        "c." + library.declaration.module.slice(7) + "-" + String(suffix);
    runtimes.push({
      module: library.id,
      namespace,
      retainedExports: retained,
    });
  }
  if (!nodeFfi && !nodeBuffer) return { ...request, runtimes };
  const included = withNodeRuntimes(
    request,
    ids,
    runtimes,
    nodeFfi,
    nodeBuffer,
  );
  return nodeFfi ? withStaticFfiRuntimes(included, signedChar) : included;
}

function withStaticFfiRuntimes(
  request: CompileRequest,
  signedChar: boolean,
): CompileRequest {
  const loader = request.moduleLoader;
  const direct = (
    dependencies: ReadonlyMap<string, string> | undefined,
  ): boolean => {
    return dependencies?.get("node:ffi") === foreignRuntimeModules.nodeFfi;
  };
  const edges = loader?.sourceDependencies;
  const sources =
    loader !== undefined && edges !== undefined
      ? requestModules(
          request,
          loader.ids.filter((id) => id !== undefined && direct(edges(id))),
        )
      : requestModules(request).filter(
          (source) => source !== undefined && direct(source.dependencies),
        );
  const weakProcessing = request.nodeFfiWeakProcessing !== false;
  const literalPlans = weakProcessing
    ? recognizeStaticFfi(sources, signedChar)
    : [];
  const trusted = new Set(request.runtimes.map((runtime) => runtime?.module));
  const application = generalApplicationModules(
    request,
    requestModules(
      request,
      edges === undefined
        ? undefined
        : sourceDependencyClosure([request.entry], (id) =>
            trusted.has(id) ? undefined : edges(id),
          ),
    ),
  );
  const arities =
    weakProcessing && application.ok
      ? fixedFfiCallArities(application.value)
      : [];
  if (weakProcessing && literalPlans.length === 0 && arities.length === 0)
    return request;
  const plans = addFixedFfiPlans(literalPlans, arities);
  const generated = makeStaticFfiModule(
    plans,
    weakProcessing,
    arities,
    request.hostABI !== undefined,
  );
  function replace(modules: readonly SourceModule[]): SourceModule[] {
    return modules.map((source) =>
      source?.id === generated.id ? generated : source,
    );
  }
  let moduleLoader: SourceModuleLoader | undefined;
  if (loader !== undefined) {
    const loadWithRoot = loader.loadWithRoot;
    moduleLoader = {
      ids: loader.ids,
      load: (ids): readonly SourceModule[] => replace(loader.load(ids)),
      ...(edges === undefined ? {} : { sourceDependencies: edges }),
      ...(loadWithRoot === undefined
        ? {}
        : {
            loadWithRoot: (root: string): LoadResult | undefined => {
              const loaded = loadWithRoot(root);
              return loaded?.ok === true
                ? { ok: true, value: replace(loaded.value) }
                : loaded;
            },
          }),
    };
  }
  const entries: string[] = [];
  const bindings = request.foreignMemoryBindings?.slice() ?? [];
  for (let index = 0; index < plans.length; index++) {
    const plan = plans[index];
    if (plan === undefined) throw "static FFI plan invariant";
    if (!plan.typedOnly) {
      const name = staticFfiEntry(index);
      entries.push(name);
      bindings.push({
        module: staticFfiModule,
        name,
        operation: "call-static-scalar",
        staticSignature: plan.signature,
      });
    }
    if (hasStaticFfiNumberEntry(plan)) {
      const name = staticFfiNumberEntry(index);
      entries.push(name);
      bindings.push({
        module: staticFfiModule,
        name,
        operation: "call-direct-scalar",
        staticSignature: plan.signature,
      });
    }
    if (arities.includes(1) && hasStaticFfiBytesEntry(plan)) {
      const name = staticFfiBytesEntry(index);
      entries.push(name);
      bindings.push({
        module: staticFfiModule,
        name,
        operation: "call-direct-bytes",
        staticSignature: plan.signature,
      });
    }
  }
  const runtime: RuntimeSource = {
    module: staticFfiModule,
    namespace: "node-ffi-static",
    retainedExports: entries,
  };
  const runtimes = request.runtimes.slice();
  runtimes.push(runtime);
  return {
    ...request,
    modules: replace(request.modules),
    moduleLoader,
    runtimes,
    foreignMemoryBindings: bindings,
    nodeFfiFixedArities: arities,
  };
}

/** Resolve the reviewed runtime surfaces only when loaded. Their values pass
 * directly to the shared realm while byte and weak-slot primitives stay private. */
function withNodeRuntimes(
  request: CompileRequest,
  ids: ReadonlySet<string>,
  runtimes: RuntimeSource[],
  nodeFfi: boolean,
  nodeBuffer: boolean,
): CompileRequest {
  function retain(runtime: RuntimeSource): void {
    if (!runtimes.some((existing) => existing?.module === runtime.module))
      runtimes.push(runtime);
  }
  if (nodeFfi)
    retain({
      module: foreignRuntimeModules.nodeFfi,
      namespace: "node-ffi",
      retainedExports: [],
    });
  if (nodeBuffer)
    retain({
      module: foreignRuntimeModules.nodeBuffer,
      namespace: "node-buffer",
      retainedExports: [],
    });
  const recordBindings = (request.recordBindings ?? []).slice();
  // General compilation enrolls these same witnesses when that partition
  // starts. A standalone typed request needs them without a general host.
  if (request.generalLowering === undefined) {
    const objects = "packages/js-runtime/src/objects/index.ts";
    const views = ["viewObjectValue", "viewSymbolValue", "viewBigIntValue"];
    retain({
      module: objects,
      namespace: "node-object-views",
      retainedExports: views,
    });
    for (const name of views) {
      if (name === undefined) throw "node runtime view invariant";
      if (
        !recordBindings.some(
          (binding) => binding?.module === objects && binding.name === name,
        )
      )
        recordBindings.push({ module: objects, name, operation: "view" });
    }
  }
  if (!nodeFfi) return { ...request, runtimes, recordBindings };
  const unaryView = "viewUnaryNumberClosure";
  retain({
    module: nativeValueViewsModule,
    namespace: "native-value-views",
    retainedExports: [unaryView],
  });
  if (
    !recordBindings.some(
      (binding) =>
        binding?.module === nativeValueViewsModule &&
        binding.name === unaryView,
    )
  )
    recordBindings.push({
      module: nativeValueViewsModule,
      name: unaryView,
      operation: "view",
    });
  const finalizerView = "viewWeakRegistryOwner";
  if (!recordBindings.some((binding) => binding?.name === finalizerView)) {
    const values = "packages/js-runtime/src/objects/values.ts";
    retain({
      module: values,
      namespace: "node-ffi-finalization",
      retainedExports: [finalizerView],
    });
    recordBindings.push({
      module: values,
      name: finalizerView,
      operation: "view",
    });
  }

  const ffi = foreignRuntimeBindings(ids);
  for (const runtime of ffi.runtimes) {
    if (runtime === undefined) throw "node FFI runtime invariant";
    retain(runtime);
  }
  const hostBindings = (request.hostBindings ?? []).slice();
  for (const binding of ffi.hostBindings) {
    if (binding === undefined) throw "node FFI host binding invariant";
    if (
      !hostBindings.some(
        (entry) =>
          entry?.module === binding.module && entry.name === binding.name,
      )
    )
      hostBindings.push({
        module: binding.module,
        name: binding.name,
        operation: binding.operation,
      });
  }
  const foreignMemoryBindings = (request.foreignMemoryBindings ?? []).slice();
  for (const binding of ffi.memoryBindings) {
    if (binding === undefined) throw "node FFI memory binding invariant";
    if (
      !foreignMemoryBindings.some(
        (entry) =>
          entry?.module === binding.module && entry.name === binding.name,
      )
    )
      foreignMemoryBindings.push(binding);
  }
  const weakBindings = (request.weakBindings ?? []).slice();
  for (const binding of ffi.weakBindings) {
    if (binding === undefined) throw "node FFI weak binding invariant";
    if (
      !weakBindings.some(
        (entry) =>
          entry?.module === binding.module && entry.name === binding.name,
      )
    )
      weakBindings.push({
        module: binding.module,
        name: binding.name,
        operation: binding.operation,
      });
  }
  return {
    ...request,
    runtimes,
    recordBindings,
    hostBindings,
    foreignMemoryBindings,
    weakBindings,
  };
}
function withTypedNodeFfiRealm(request: CompileRequest): CompileRequest {
  if (!request.runtimes.some((runtime) => runtime?.namespace === "node-ffi"))
    return request;
  const values = "packages/js-runtime/src/objects/values.ts";
  const objects = "packages/js-runtime/src/objects/index.ts";
  const views = ["viewObjectValue", "viewSymbolValue", "viewBigIntValue"];
  const arities = request.nodeFfiFixedArities ?? [];
  const runtimes: RuntimeSource[] = request.runtimes.map((runtime) => {
    if (runtime?.module === staticFfiModule && arities.length !== 0) {
      const retained: string[] = runtime.retainedExports?.slice() ?? [];
      for (const arity of arities) {
        if (arity === undefined) throw "fixed FFI arity invariant";
        retained.push(fixedFfiCallEntry(arity));
        if (arity !== 0) retained.push(mixedFfiCallEntry(arity));
      }
      return {
        ...runtime,
        retainedExports: retained,
      };
    }
    if (runtime?.module !== values) return runtime;
    return {
      module: values,
      namespace: "general-object-views",
      retainedExports: [
        "viewWeakRegistryOwner",
        "viewTypeofObject",
        "generalValueTypeof",
        "callGeneralValue",
        "constructGeneralValue",
      ],
    };
  });
  if (!runtimes.some((runtime) => runtime?.module === objects))
    runtimes.push({
      module: objects,
      namespace: "node-object-views",
      retainedExports: views,
    });
  const recordBindings = request.recordBindings?.slice() ?? [];
  if (arities.length !== 0) {
    const witness = "viewTypedFfiCall";
    runtimes.push({
      module: ffiMemoryModule,
      namespace: "node-ffi-memory",
      retainedExports: [witness],
    });
    recordBindings.push({
      module: ffiMemoryModule,
      name: witness,
      operation: "view",
    });
  }
  for (const name of views) {
    if (name === undefined) throw "node runtime view invariant";
    if (
      !recordBindings.some(
        (binding) => binding?.module === objects && binding.name === name,
      )
    )
      recordBindings.push({ module: objects, name, operation: "view" });
  }
  recordBindings.push({
    module: values,
    name: "viewTypeofObject",
    operation: "view",
  });
  const dependencies = new Map<string, ReadonlyMap<string, string>>();
  for (const source of request.modules) {
    if (source === undefined) throw "node FFI source invariant";
    dependencies.set(source.id, source.dependencies);
  }
  const resolve =
    request.moduleLoader?.sourceDependencies ??
    ((id: string): ReadonlyMap<string, string> | undefined =>
      dependencies.get(id));
  const application = new Set<string>();
  for (const id of sourceDependencyClosure([request.entry], resolve))
    if (id !== undefined) application.add(id);
  const runtimeModules = sourceDependencyClosure(
    runtimes.map((source) => source.module),
    resolve,
  );
  for (const id of runtimeModules) if (id !== undefined) application.delete(id);
  return {
    ...request,
    runtimes,
    recordBindings,
    nodeFfiRealmModules: application,
  };
}
export type NativeBackendSelection =
  | { readonly ok: true; readonly target: AArch64Target }
  | { readonly ok: false; readonly error: CompilationError };

/** Select the backend before preparing inputs that need its ABI. */
export function selectNativeBackend(
  target: NativeTarget,
): NativeBackendSelection {
  if (target.arch === "aarch64") return { ok: true, target };
  return {
    ok: false,
    error: {
      stage: "emit",
      message: target.name + ": standalone native compilation requires slice 7",
    },
  };
}

/** Compile for the selected output target, independently of the host. */
export function compileNativeProgram(
  request: CompileRequest,
  target: NativeTarget = darwinAArch64Target,
): Compilation {
  const backend = selectNativeBackend(target);
  if (!backend.ok) return { ok: false, error: backend.error };
  return compileArm64Program({
    ...request,
    hostABI: backend.target.hostABI,
    jsConvert: backend.target.os === "darwin",
  });
}

/** The dynamic-object runtime's companion capability: a buffer's detachment
 * detaches the native typed arrays the program realm projected over it. */
function addNativeArrayDetach(
  runtimes: RuntimeSource[],
  hostBindings: NativeHostBinding[],
): void {
  const name = "detachNativeArray";
  if (!runtimes.some((source) => source?.module === nativeArrayDetachModule))
    runtimes.push({
      module: nativeArrayDetachModule,
      namespace: "native-array-detach",
      retainedExports: [name],
    });
  if (
    !hostBindings.some(
      (binding) =>
        binding?.module === nativeArrayDetachModule && binding.name === name,
    )
  )
    hostBindings.push({
      module: nativeArrayDetachModule,
      name,
      operation: "native-array-detach",
    });
}

function withoutDynamicObjectRuntime(request: CompileRequest): {
  readonly explicit: RuntimeSource | undefined;
  readonly without: CompileRequest;
} {
  const explicit = request.runtimes.find(
    (source) => source?.namespace === "dynamic-object",
  );
  const without =
    explicit === undefined
      ? request
      : {
          ...request,
          runtimes: request.runtimes.filter((source) => source !== explicit),
        };
  return { explicit, without };
}

function expandDynamicObjectRealm(
  request: CompileRequest,
  without: CompileRequest,
  explicit: RuntimeSource | undefined,
  error: CompilationFailure["error"],
  realmTypeofModules?: ReadonlySet<string>,
):
  | {
      readonly ok: true;
      readonly request: CompileRequest;
      readonly realmModules: ReadonlySet<string> | undefined;
    }
  | { readonly ok: false; readonly failure: CompilationFailure } {
  const projections = error.nativeProjections ?? [];
  const callableViews = projections.includes("projectUnaryNumber");
  const runtime =
    error.needsBindingRealm === true || projections.length !== 0
      ? dynamicObjectRuntimeSource(error.needsBindingRealm, projections)
      : (explicit ?? dynamicObjectRuntimeSource());
  const module = runtime.module;
  const loader = request.moduleLoader;
  let expandedRequest = request;
  if (loader === undefined) {
    if (!request.modules.some((source) => source?.id === module))
      return { ok: false, failure: { ok: false, error } };
  } else if (!loader.ids.includes(module)) {
    const loadWithRoot = loader.loadWithRoot;
    const expanded =
      loadWithRoot === undefined ? undefined : loadWithRoot(module);
    if (expanded === undefined)
      return { ok: false, failure: { ok: false, error } };
    if (!expanded.ok)
      return {
        ok: false,
        failure: stageFailure(
          expanded.error.stage,
          expanded.error.message,
          expanded.error.module,
        ),
      };
    expandedRequest = {
      ...request,
      modules: expanded.value,
      moduleLoader: undefined,
    };
  }
  const objects = "packages/js-runtime/src/objects/index.ts";
  const names: string[] = [
    "viewObjectValue",
    "viewSymbolValue",
    "viewBigIntValue",
  ];
  const runtimes = without.runtimes.slice();
  runtimes.push(runtime);
  const hostBindings = (request.hostBindings ?? []).slice();
  addNativeArrayDetach(runtimes, hostBindings);
  const weakBindings = (request.weakBindings ?? []).slice();
  const bindings = (request.recordBindings ?? []).slice();
  const retained = names.slice();
  let realmModules = realmTypeofModules;
  if (callableViews && request.nodeFfiRealmModules === undefined) {
    names.push("viewTypeofObject");
    retained.push("viewTypeofObject", "generalValueTypeof", "callGeneralValue");
    if (realmModules === undefined) {
      const dependencies = new Map<string, ReadonlyMap<string, string>>();
      for (const source of expandedRequest.modules) {
        if (source === undefined) throw "realm view source invariant";
        dependencies.set(source.id, source.dependencies);
      }
      const resolve =
        loader?.sourceDependencies ??
        ((id: string): ReadonlyMap<string, string> | undefined =>
          dependencies.get(id));
      const application = new Set<string>();
      for (const id of sourceDependencyClosure([request.entry], resolve))
        if (id !== undefined) application.add(id);
      const runtimeModules = sourceDependencyClosure(
        runtimes.map((source) => source.module),
        resolve,
      );
      for (const id of runtimeModules)
        if (id !== undefined) application.delete(id);
      realmModules = application;
    }
  }
  if (projections.length !== 0) {
    const witnesses: string[] = [];
    if (callableViews) witnesses.push("viewUnaryNumberClosure");
    if (projections.includes("projectNumberList"))
      witnesses.push("viewNumberList");
    const existing = runtimes.findIndex(
      (source) => source?.module === nativeValueViewsModule,
    );
    if (existing < 0)
      runtimes.push({
        module: nativeValueViewsModule,
        namespace: "native-value-views",
        retainedExports: witnesses,
      });
    for (const name of witnesses) {
      if (name === undefined) throw "native view witness invariant";
      if (
        !bindings.some(
          (binding) =>
            binding?.module === nativeValueViewsModule && binding.name === name,
        )
      )
        bindings.push({
          module: nativeValueViewsModule,
          name,
          operation: "view",
        });
    }
    if (!runtimes.some((source) => source?.module === nativeWeakModule))
      runtimes.push({
        module: nativeWeakModule,
        namespace: "native-view-weak",
      });
    const operations: readonly NativeWeakBinding[] = [
      { module: nativeWeakModule, name: "createWeakSlot", operation: "new" },
      { module: nativeWeakModule, name: "weakSlotKey", operation: "key" },
      { module: nativeWeakModule, name: "weakSlotValue", operation: "value" },
      {
        module: nativeWeakModule,
        name: "setWeakSlotValue",
        operation: "set-value",
      },
      { module: nativeWeakModule, name: "clearWeakSlot", operation: "clear" },
    ];
    for (const operation of operations) {
      if (operation === undefined) throw "native weak operation invariant";
      if (
        !weakBindings.some(
          (binding) =>
            binding?.module === operation.module &&
            binding.name === operation.name,
        )
      )
        weakBindings.push(operation);
    }
  }
  if (!runtimes.some((source) => source?.module === objects))
    runtimes.push({
      module: objects,
      namespace: callableViews
        ? "general-object-views"
        : "dynamic-object-views",
      retainedExports: retained,
    });
  for (const name of names) {
    if (name === undefined) throw "dynamic realm binding invariant";
    if (
      !bindings.some(
        (binding) => binding?.module === objects && binding.name === name,
      )
    )
      bindings.push({ module: objects, name, operation: "view" });
  }
  return {
    ok: true,
    request: {
      ...expandedRequest,
      runtimes,
      hostBindings,
      recordBindings: bindings,
      weakBindings,
    },
    realmModules,
  };
}

function compileTypedWithProgramRealm(
  request: CompileRequest,
  realmTypeofModules?: ReadonlySet<string>,
): Compilation {
  const { explicit, without } = withoutDynamicObjectRuntime(request);
  const initial = compileTypedProgram(without, realmTypeofModules);
  if (initial.ok || initial.error.needsDynamicRealm !== true) return initial;
  const expanded = expandDynamicObjectRealm(
    request,
    without,
    explicit,
    initial.error,
    realmTypeofModules,
  );
  if (!expanded.ok) return expanded.failure;
  return compileTypedProgram(expanded.request, expanded.realmModules);
}

function lowerTypedWithProgramRealm(
  request: CompileRequest,
  realmTypeofModules?: ReadonlySet<string>,
  invokeDirectly: boolean = false,
): TypedLowering {
  const { explicit, without } = withoutDynamicObjectRuntime(request);
  const initial = lowerTypedProgram(
    without,
    realmTypeofModules,
    invokeDirectly,
  );
  if (initial.ok || initial.error.needsDynamicRealm !== true) return initial;
  const expanded = expandDynamicObjectRealm(
    request,
    without,
    explicit,
    initial.error,
    realmTypeofModules,
  );
  if (!expanded.ok) return expanded.failure;
  return lowerTypedProgram(
    expanded.request,
    expanded.realmModules,
    invokeDirectly,
  );
}
export function compileArm64Program(original: CompileRequest): Compilation {
  const validateSource = original.generalLowering?.validateSource;
  if (validateSource !== undefined && original.requireTyped !== true) {
    const diagnostics = validateSource(original.entry);
    const first = diagnostics[0];
    if (first !== undefined)
      return {
        ok: false,
        error: {
          stage: "source",
          diagnostic: first.code,
          module: first.module,
          message:
            first.module +
            ":" +
            String(first.start) +
            ":" +
            String(first.end) +
            ": " +
            first.code +
            ": " +
            first.message,
          sourceDiagnostics: diagnostics,
        },
      };
  }
  const request = withForeignRuntimes(original);
  // Worker entries that keep JavaScript semantics are a general fallback.
  let guests: GeneralFallback | undefined = undefined;
  const typed = compileWithTypedWorkerEntry<CompiledProgram>(
    request,
    (source): Compilation => {
      const prepared = withTypedNodeFfiRealm(source);
      return compileTypedWithProgramRealm(
        prepared,
        prepared.nodeFfiRealmModules,
      );
    },
    (fallback: GeneralFallback): void => {
      guests = fallback;
    },
  );
  if (typed.ok) {
    const fallback = guests;
    return fallback === undefined
      ? typed
      : { ok: true, value: { ...typed.value, general: fallback } };
  }
  const lowering = request.generalLowering;
  if (lowering === undefined || typed.error.preventsFallback === true)
    return typed;
  const general = compileGeneralProgram<CompiledProgram>(
    request,
    lowering,
    typed.error,
    (source, realmTypeofModules): Compilation =>
      compileTypedWithProgramRealm(source, realmTypeofModules),
  );
  if (!general.ok) return general;
  return {
    ok: true,
    value: { ...general.value, general: general.fallback },
  };
}

/** A typed worker entry is checked directly. Its Worker entries are tried as
 * typed start functions first, then as host-evaluated guest modules with
 * JavaScript semantics, and only then does the whole program use the general
 * lowering. */
function compileWithTypedWorkerEntry<T>(
  request: CompileRequest,
  compile: (
    request: CompileRequest,
  ) => { readonly ok: true; readonly value: T } | CompilationFailure,
  onGuestFallback?: (fallback: GeneralFallback) => void,
): { readonly ok: true; readonly value: T } | CompilationFailure {
  const lowering = request.generalLowering;
  const prepare = lowering?.prepareTypedWorkers;
  const guests = request.workerModules;
  const start = request.start;
  if (
    lowering === undefined ||
    prepare === undefined ||
    guests === undefined ||
    start === undefined
  )
    return compile(request);
  const available = requestModules(request);
  const application = generalApplicationModules(request, available);
  if (!application.ok) return stageFailure("worker-entry", application.error);
  const typedGuests = composeTypedWorkers<T>(
    request,
    compile,
    lowering,
    prepare(
      {
        available,
        modules: application.value,
        entry: request.entry,
        start,
        boundaries: [],
        workerEntries: guests,
      },
      true,
    ),
    available,
    guests,
  );
  let declined = "typed Worker entries were not composed";
  if (typedGuests !== undefined) {
    if (typedGuests.ok) return typedGuests;
    declined = typedGuests.error.message;
  }
  const guestModules = composeTypedWorkers<T>(
    request,
    compile,
    lowering,
    prepare(
      {
        available,
        modules: application.value,
        entry: request.entry,
        start,
        boundaries: [],
        workerEntries: guests,
      },
      false,
    ),
    available,
    guests,
  );
  if (guestModules === undefined)
    return request.requireTyped === true
      ? stageFailure("worker-entry", "missing typed Worker composition")
      : compile(request);
  if (guestModules.ok) {
    onGuestFallback?.({ modules: guests, reason: declined });
    return guestModules;
  }
  if (request.requireTyped === true) return guestModules;
  return compile(request);
}
/** Compiles one prepared typed-entry composition; undefined when preparation
 * itself declined. */
function composeTypedWorkers<T>(
  request: CompileRequest,
  compile: (
    request: CompileRequest,
  ) => { readonly ok: true; readonly value: T } | CompilationFailure,
  lowering: GeneralLowering,
  prepared: GeneralProgram,
  available: readonly SourceModule[],
  guests: readonly string[],
): { readonly ok: true; readonly value: T } | CompilationFailure | undefined {
  if (!prepared.ok) return undefined;
  const program = prepared.value;
  const replaced = new Set(program.modules.map((source) => source.id));
  const modules: SourceModule[] = [];
  for (const source of available)
    if (source !== undefined && !replaced.has(source.id)) modules.push(source);
  for (const source of program.modules)
    if (source !== undefined) modules.push(source);
  const runtimes = request.runtimes.slice();
  const hostBindings = (request.hostBindings ?? []).slice();
  if (
    program.workerEvaluation !== undefined &&
    !runtimes.some((runtime) => runtime?.namespace === "dynamic-object")
  ) {
    runtimes.push(dynamicObjectRuntimeSource());
    addNativeArrayDetach(runtimes, hostBindings);
  }
  const recordBindings = (request.recordBindings ?? []).slice();
  for (const runtime of [...lowering.runtimes, ...(program.runtimes ?? [])])
    if (
      runtime !== undefined &&
      !runtimes.some((existing) => existing.module === runtime.module)
    )
      runtimes.push(runtime);
  for (const binding of [
    ...lowering.recordBindings,
    ...(program.recordBindings ?? []),
  ])
    if (
      binding !== undefined &&
      !recordBindings.some(
        (existing) =>
          existing.module === binding.module && existing.name === binding.name,
      )
    )
      recordBindings.push(binding);
  return compile({
    ...request,
    modules,
    moduleLoader: undefined,
    entry: program.entry,
    workerModules: program.workerModules ?? guests,
    ...(program.moduleConstructors === undefined
      ? {}
      : { moduleConstructors: program.moduleConstructors }),
    ...(program.workerEvaluation === undefined
      ? {}
      : { workerEvaluation: program.workerEvaluation }),
    hostBindings,
    recordBindings,
    runtimes,
  });
}

type GeneralCompilation<T> =
  | {
      readonly ok: true;
      readonly value: T;
      readonly fallback: GeneralFallback;
    }
  | CompilationFailure;

function compileGeneralProgram<T>(
  request: CompileRequest,
  lowering: GeneralLowering,
  typedError: CompilationError,
  compile: (
    request: CompileRequest,
    realmTypeofModules: ReadonlySet<string> | undefined,
  ) => { readonly ok: true; readonly value: T } | CompilationFailure,
): GeneralCompilation<T> {
  if (request.requireTyped === true)
    return stageFailure(
      typedError.stage,
      typedError.message + " (typed compilation required)",
      typedError.module,
    );
  const validateSource = lowering.validateSource;
  if (validateSource !== undefined && typedError.fallback === undefined)
    return { ok: false, error: typedError };
  const reason = typedError.stage + ": " + typedError.message;
  const start = request.start;
  if (start === undefined)
    return stageFailure(
      typedError.stage,
      typedError.message + " (general fallback requires a start export)",
    );
  const loader = request.moduleLoader;
  const sourceDependencies = loader?.sourceDependencies;
  const roots = [request.entry];
  for (const id of request.workerModules ?? [])
    if (id !== undefined) roots.push(id);
  const replayIds =
    sourceDependencies === undefined
      ? undefined
      : sourceDependencyClosure(roots, sourceDependencies);
  const available = requestModules(request, replayIds);
  const application = generalApplicationModules(request, available);
  if (!application.ok)
    return stageFailure(
      typedError.stage,
      typedError.message + " (general fallback: " + application.error + ")",
    );
  // Module-granular partition: the module a typed failure is attributed to
  // becomes general, with its importers and any typed module whose used
  // exports cannot cross a checked boundary; typed modules keep their
  // type-based compilation. Unattributed failures make the whole
  // application general.
  const seed = new Set<string>();
  const applicationIds = new Set<string>();
  for (const module of application.value) {
    if (module === undefined) continue;
    applicationIds.add(module.id);
    for (const [, dependency] of module.dependencies)
      if (lowering.syntheticModules?.includes(dependency) === true)
        seed.add(module.id);
  }
  const owner = typedError.fallback?.owner;
  if (
    validateSource !== undefined &&
    (owner === undefined || !applicationIds.has(owner.module))
  )
    return { ok: false, error: typedError };
  // The general runtime's representation views and retained exports join
  // the request's, without duplicates.
  const recordBindings: NativeRecordBinding[] = [],
    runtimes: RuntimeSource[] = [];
  for (const binding of request.recordBindings ?? [])
    if (binding !== undefined) recordBindings.push(binding);
  for (const binding of lowering.recordBindings)
    if (
      binding !== undefined &&
      !recordBindings.some(
        (existing) =>
          existing !== undefined &&
          existing.module === binding.module &&
          existing.name === binding.name,
      )
    )
      recordBindings.push(binding);
  for (const runtime of request.runtimes)
    if (runtime !== undefined) runtimes.push(runtime);
  for (const runtime of lowering.runtimes)
    if (
      runtime !== undefined &&
      !runtimes.some(
        (existing) =>
          existing !== undefined && existing.module === runtime.module,
      )
    )
      runtimes.push(runtime);
  // Engine dependencies already classify source-level JS through their own
  // helper. Their host-language typeof tests inspect raw representation (for
  // example, distinguishing a native engine abort from a thrown realm function).
  const rawTypeofModules = new Set<string>();
  const byId = new Map<string, SourceModule>();
  for (const module of available)
    if (module !== undefined) byId.set(module.id, module);
  const rawIds = sourceDependencyClosure(
    lowering.runtimeModules,
    sourceDependencies ??
      ((id: string): ReadonlyMap<string, string> | undefined =>
        byId.get(id)?.dependencies),
  );
  for (const id of rawIds) if (id !== undefined) rawTypeofModules.add(id);
  const availableIds =
    sourceDependencies === undefined ? undefined : loader?.ids;
  const realmTypeofModules = new Set<string>();
  if (availableIds === undefined) {
    for (const module of available)
      if (module !== undefined && !rawTypeofModules.has(module.id))
        realmTypeofModules.add(module.id);
  } else {
    for (const id of availableIds)
      if (id !== undefined && !rawTypeofModules.has(id))
        realmTypeofModules.add(id);
  }
  let error = typedError;
  const checkedBoundaries = new Set<string>();
  for (let attempt = 0; attempt <= application.value.length; attempt++) {
    const culprit = error.module;
    if (
      culprit === undefined ||
      !applicationIds.has(culprit) ||
      seed.has(culprit)
    )
      for (const id of applicationIds) seed.add(id);
    else seed.add(culprit);
    let partition = closeGeneralPartition(
      application.value,
      seed,
      application.trusted,
      available,
    );
    // The linker binds every declaration of an imported leaf. A structured
    // implicit-arguments rejection in that leaf will survive partitioning, so
    // close all such edges before replaying the full typed runtime graph.
    if (replayIds !== undefined) {
      for (;;) {
        if (partition.blocked !== undefined) break;
        let grew = false;
        for (const boundary of partition.boundaries) {
          if (boundary === undefined || checkedBoundaries.has(boundary.id))
            continue;
          checkedBoundaries.add(boundary.id);
          if (!applicationIds.has(boundary.id)) continue;
          const source = byId.get(boundary.id);
          if (source === undefined || source.module.imports.length !== 0)
            continue;
          const bound = bindModule(source.module, typedGlobals);
          if (
            !bound.ok &&
            bound.error.fallback?.capability === "arguments-object"
          ) {
            seed.add(boundary.id);
            grew = true;
          }
        }
        if (!grew) break;
        partition = closeGeneralPartition(
          application.value,
          seed,
          application.trusted,
          available,
        );
      }
    }
    if (partition.blocked !== undefined)
      return stageFailure(
        "general",
        "general code uses " +
          partition.blocked.exports +
          " of the trusted module " +
          partition.blocked.module +
          ", whose types cannot cross a checked boundary (typed: " +
          reason +
          ")",
      );
    for (const module of partition.general)
      if (module !== undefined) seed.add(module.id);
    const lowered = lowering.lower({
      modules: partition.general,
      available,
      ...(availableIds === undefined ? {} : { availableIds }),
      entry: request.entry,
      start,
      boundaries: partition.boundaries,
      sourceValidated: validateSource !== undefined,
      ...(error.fallback === undefined ? {} : { trigger: error.fallback }),
      ...(partition.records === undefined
        ? {}
        : { records: partition.records }),
    });
    if (!lowered.ok)
      return stageFailure(
        "general",
        lowered.error + " (typed: " + reason + ")",
      );
    const generated = lowered.value.modules;
    const modules: SourceModule[] = [];
    const replay =
      replayIds === undefined || loader === undefined
        ? undefined
        : appendSourceModules(loader, generated);
    if (replay === undefined) {
      for (const module of available)
        if (module !== undefined) modules.push(module);
      for (const module of generated)
        if (module !== undefined) modules.push(module);
    }
    const usesRealm = lowered.value.usesRealm !== false;
    const programBindings = usesRealm
        ? recordBindings.slice()
        : (request.recordBindings ?? []).slice(),
      programRuntimes = usesRealm ? runtimes.slice() : request.runtimes.slice();
    for (const binding of lowered.value.recordBindings ?? [])
      if (binding !== undefined) programBindings.push(binding);
    for (const runtime of lowered.value.runtimes ?? [])
      if (runtime !== undefined) programRuntimes.push(runtime);
    const compiled = compile(
      {
        ...request,
        recordBindings: programBindings,
        runtimes: programRuntimes,
        modules,
        moduleLoader: replay,
        entry: lowered.value.entry,
        exports: [start],
        workerModules: lowered.value.workerModules ?? request.workerModules,
      },
      usesRealm ? realmTypeofModules : undefined,
    );
    const generalIds: string[] = [];
    for (const module of partition.general)
      if (module !== undefined) generalIds.push(module.id);
    if (compiled.ok) {
      const functions = lowered.value.functions;
      const classes = lowered.value.classes;
      const general: GeneralFallback = {
        modules: generalIds,
        reason,
        ...(functions === undefined ? {} : { functions }),
        ...(classes === undefined ? {} : { classes }),
      };
      return {
        ok: true,
        value: compiled.value,
        fallback: general,
      };
    }
    if (compiled.error.preventsFallback === true) return compiled;
    if (validateSource !== undefined) {
      const trigger = compiled.error.fallback;
      if (
        trigger === undefined ||
        !applicationIds.has(trigger.owner.module) ||
        seed.has(trigger.owner.module)
      )
        return compiled;
    }
    if (seed.size === applicationIds.size)
      return stageFailure(
        "general " + compiled.error.stage,
        compiled.error.message + " (typed: " + reason + ")",
      );
    error = compiled.error;
  }
  throw "general partition did not converge";
}

function sourceDependencyClosure(
  roots: readonly string[],
  dependenciesOf: (id: string) => ReadonlyMap<string, string> | undefined,
): readonly string[] {
  const seen = new Set<string>(),
    queue = roots.slice(),
    order: string[] = [];
  for (let index = 0; index < queue.length; index++) {
    const id = queue[index];
    if (id === undefined || seen.has(id)) continue;
    seen.add(id);
    order.push(id);
    const dependencies = dependenciesOf(id);
    if (dependencies === undefined) continue;
    for (const [, dependency] of dependencies) queue.push(dependency);
  }
  return order;
}
/** The modules reachable from the entry that the general lowering may
 * replace, and the trusted runtime and host-bound modules they import. Trusted
 * modules always stay typed: general code reaches them through checked
 * boundaries, and the walk does not enter them. */
function generalApplicationModules(
  request: CompileRequest,
  available: readonly SourceModule[],
):
  | {
      readonly ok: true;
      readonly value: readonly SourceModule[];
      readonly trusted: readonly SourceModule[];
    }
  | { readonly ok: false; readonly error: string } {
  const byId = new Map<string, SourceModule>();
  for (const module of available) {
    if (module === undefined) throw "general module invariant";
    byId.set(module.id, module);
  }
  const trusted = new Set<string>();
  for (const runtime of request.runtimes)
    if (runtime !== undefined) trusted.add(runtime.module);
  for (const binding of request.hostBindings ?? [])
    if (binding !== undefined) trusted.add(binding.module);
  for (const binding of request.recordBindings ?? [])
    if (binding !== undefined) trusted.add(binding.module);
  for (const binding of request.weakBindings ?? [])
    if (binding !== undefined) trusted.add(binding.module);
  for (const binding of request.foreignBindings ?? [])
    if (binding !== undefined) trusted.add(binding.module);
  for (const binding of request.foreignMemoryBindings ?? [])
    if (binding !== undefined) trusted.add(binding.module);
  for (const service of request.serviceImports ?? [])
    if (service !== undefined) trusted.add(service.module);
  const result: SourceModule[] = [],
    imported: SourceModule[] = [],
    seen = new Set<string>();
  const queue = [request.entry];
  if (request.generalLowering?.syntheticModules !== undefined)
    for (const id of request.workerModules ?? []) queue.push(id);
  for (let index = 0; index < queue.length; index++) {
    const id = queue[index];
    if (id === undefined) throw "general queue invariant";
    if (seen.has(id)) continue;
    seen.add(id);
    if (request.generalLowering?.syntheticModules?.includes(id) === true)
      continue;
    const module = byId.get(id);
    if (module === undefined)
      return { ok: false, error: "missing module " + id };
    if (trusted.has(id)) {
      imported.push(module);
      continue;
    }
    result.push(module);
    for (const declaration of module.module.imports) {
      if (declaration === undefined) throw "general import invariant";
      if (declaration.typeOnly) continue;
      const dependency = module.dependencies.get(declaration.specifier);
      if (dependency !== undefined) queue.push(dependency);
    }
  }
  return { ok: true, value: result, trusted: imported };
}
/** Globals of typed (non-general) programs. */
const baseTypedGlobals: readonly string[] = [
  "undefined",
  "NaN",
  "Infinity",
  "Array",
  "Object",
  "Boolean",
  "String",
  "Number",
  "BigInt",
  "Math",
  "Atomics",
  "Map",
  "Set",
  "Uint8Array",
  "Int8Array",
  "Uint8ClampedArray",
  "Uint16Array",
  "Int16Array",
  "Uint32Array",
  "Int32Array",
  "Float32Array",
  "Float64Array",
  "ArrayBuffer",
  "SharedArrayBuffer",
  "DataView",
  "TextEncoder",
  "TextDecoder",
  "TypeError",
  "RangeError",
  "Error",
  "console",
];
const typedGlobals: readonly string[] = withRealmGlobals(baseTypedGlobals);
/** Links the program and prepares its globals and managed surfaces. */
function linkTypedProgram(request: CompileRequest): TypedLinking {
  const globals = typedGlobals;
  const modules = requestModules(request).slice();
  let entry = "$tint$compiler-entry";
  while (modules.some((m) => m !== undefined && m.id === entry)) entry += "$";
  const roots = [request.entry];
  for (const surface of request.managedSurfaces ?? []) {
    if (surface === undefined) throw "surface request invariant";
    const selectedModules = [surface.bind.module];
    for (const selection of surface.values) {
      if (selection === undefined) throw "surface selection invariant";
      selectedModules.push(selection.module);
    }
    for (const selection of surface.types) {
      if (selection === undefined) throw "surface type selection invariant";
      selectedModules.push(selection.module);
    }
    for (const id of selectedModules) {
      if (id === undefined) throw "surface module root invariant";
      if (!roots.includes(id)) roots.push(id);
    }
  }
  const runtimeNamespacesByModule = new Map<string, string>(),
    providersByNamespace = new Map<string, string>();
  for (const runtime of request.runtimes) {
    if (runtime === undefined) throw "runtime source invariant";
    if (runtimeNamespacesByModule.has(runtime.module))
      return stageFailure(
        "link",
        "duplicate runtime module: " + runtime.module,
      );
    if (!validRuntimeNamespace(runtime.namespace))
      return stageFailure(
        "link",
        "invalid runtime namespace: " + runtime.namespace,
      );
    if (providersByNamespace.has(runtime.namespace))
      return stageFailure(
        "link",
        "duplicate runtime namespace: " + runtime.namespace,
      );
    runtimeNamespacesByModule.set(runtime.module, runtime.namespace);
    providersByNamespace.set(runtime.namespace, runtime.module);
    if (runtime.namespace === "dynamic-object") roots.unshift(runtime.module);
    else roots.push(runtime.module);
  }
  // Runtime implementation dependencies must remain callable before the
  // application module instance exists. This does not grant host capabilities.
  const retainedRuntimeModules = new Set<string>();
  const runtimeQueue = request.runtimes
    .filter((runtime) => runtime.retainedExports === undefined)
    .map((runtime) => runtime.module);
  for (let index = 0; index < runtimeQueue.length; index++) {
    const id = runtimeQueue[index];
    if (id === undefined || retainedRuntimeModules.has(id)) continue;
    retainedRuntimeModules.add(id);
    const source = modules.find(
      (candidate) => candidate !== undefined && candidate.id === id,
    );
    if (source === undefined) continue;
    for (const declaration of source.module.imports) {
      if (declaration === undefined) throw "runtime import invariant";
      const dependency = source.dependencies.get(declaration.specifier);
      if (dependency !== undefined) runtimeQueue.push(dependency);
    }
  }
  const imports: ImportDeclaration[] = roots.map((specifier) => ({
    specifier,
    specifierSpan: { start: 0, end: 0 },
    bindings: [],
    typeOnly: false,
    start: 0,
    end: 0,
  }));
  const statements: Statement[] = imports.map((declaration) => ({
    kind: "import",
    declaration,
    start: 0,
    end: 0,
  }));
  const dependencies = new Map<string, string>();
  for (const root of roots) {
    if (root === undefined) throw "module root invariant";
    dependencies.set(root, root);
  }
  modules.push({
    id: entry,
    module: { statements, imports, start: 0, end: 0 },
    dependencies,
  });
  // Runtimes with retained exports are used only through those exports and
  // the request's bindings to them; unused modules they re-export are not
  // instantiated.
  const rootExports = new Map<string, string[]>();
  for (const runtime of request.runtimes) {
    if (runtime === undefined) throw "runtime source invariant";
    if (runtime.retainedExports !== undefined)
      rootExports.set(runtime.module, runtime.retainedExports.slice());
  }
  for (const constructor of request.moduleConstructors ?? []) {
    if (constructor === undefined) throw "module constructor invariant";
    const requested = rootExports.get(constructor.module);
    if (requested === undefined)
      rootExports.set(constructor.module, [
        constructor.name,
        constructor.factory,
      ]);
    else requested.push(constructor.name, constructor.factory);
  }
  // Managed surfaces select exports of their modules by name and publish
  // them; those modules stay entirely used.
  for (const surface of request.managedSurfaces ?? []) {
    if (surface === undefined) throw "surface request invariant";
    rootExports.delete(surface.bind.module);
    for (const selection of surface.values) {
      if (selection === undefined) throw "surface selection invariant";
      rootExports.delete(selection.module);
    }
    for (const selection of surface.types) {
      if (selection === undefined) throw "surface type selection invariant";
      rootExports.delete(selection.module);
    }
  }
  function retainBinding(module: string, name: string): void {
    rootExports.get(module)?.push(name);
  }
  for (const binding of request.hostBindings ?? []) {
    if (binding === undefined) throw "host binding invariant";
    retainBinding(binding.module, binding.name);
  }
  for (const binding of request.recordBindings ?? []) {
    if (binding === undefined) throw "record binding invariant";
    retainBinding(binding.module, binding.name);
  }
  for (const binding of request.weakBindings ?? []) {
    if (binding === undefined) throw "weak binding invariant";
    retainBinding(binding.module, binding.name);
  }
  for (const binding of request.serviceImports ?? []) {
    if (binding === undefined) throw "service import invariant";
    retainBinding(binding.module, binding.name);
  }
  for (const binding of request.foreignBindings ?? []) {
    if (binding === undefined) throw "foreign binding invariant";
    retainBinding(binding.module, binding.name);
  }
  for (const binding of request.foreignMemoryBindings ?? []) {
    if (binding === undefined) throw "foreign memory binding invariant";
    retainBinding(binding.module, binding.name);
  }
  const linked = linkModules(
    pruneUnusedModules(modules, entry, rootExports),
    entry,
    globals,
    {
      evaluation: "instance",
      origins: false,
      // Source binding names: callable views' `name`, and the binding a
      // temporal-dead-zone ReferenceError names.
      sourceNames: true,
      ...(request.workerEvaluation === undefined
        ? {}
        : { deferred: deferredModules(request.workerEvaluation) }),
    },
  );
  // Managed-surface layouts link only the runtimes; the application's input
  // syntax is otherwise dead here and must not stay reachable through the
  // surface stage (docs/compiler-memory.md, "Link").
  const surfaceModules =
    (request.managedSurfaces?.length ?? 0) === 0
      ? []
      : reachableModules(
          modules,
          request.runtimes.map((runtime) => runtime.module),
        );
  modules.length = 0;
  if (!linked.ok) {
    const diagnostic = linked.error;
    let fallback = diagnostic.fallback;
    if (fallback === undefined) {
      for (const id of request.generalLowering?.syntheticModules ?? []) {
        if (id === undefined) throw "synthetic module invariant";
        if (diagnostic.message === "unresolved module: " + id) {
          fallback = {
            capability: "module-evaluation",
            owner: { start: diagnostic.start, end: diagnostic.end },
            ownerKind: "module",
          };
          break;
        }
      }
    }
    if (fallback === undefined)
      return stageFailure("link", diagnostic.message, diagnostic.module);
    return {
      ok: false,
      error: {
        stage: "link",
        message: diagnostic.message,
        module: diagnostic.module,
        fallback: {
          phase: "link",
          code: diagnostic.code ?? "UNSUPPORTED",
          capability: fallback.capability,
          location: {
            module: diagnostic.module,
            start: diagnostic.start,
            end: diagnostic.end,
          },
          owner: {
            kind: fallback.ownerKind,
            module: diagnostic.module,
            start: fallback.owner.start,
            end: fallback.owner.end,
          },
        },
      },
    };
  }
  const retainedRuntimeExports: string[] = [];
  for (const runtime of request.runtimes) {
    if (runtime === undefined) throw "runtime source invariant";
    for (const name of runtime.retainedExports ?? []) {
      if (name === undefined) throw "retained runtime name invariant";
      const selected = linked.value.exports.find(
        (item) =>
          item !== undefined &&
          item.module === runtime.module &&
          item.namespace === "value" &&
          item.name === name,
      );
      if (selected === undefined)
        return stageFailure(
          "runtime",
          "retained runtime export is missing: " + name,
        );
      if (
        runtime.namespace !== "dynamic-object" &&
        !retainedRuntimeExports.includes(selected.linkedName)
      )
        retainedRuntimeExports.push(selected.linkedName);
    }
  }
  const helpers = new Map<string, string>();
  for (const item of linked.value.exports) {
    if (item === undefined) throw "linked export invariant";
    const namespace = runtimeNamespacesByModule.get(item.module);
    if (namespace !== undefined && item.namespace === "value")
      helpers.set(namespace + ":" + item.name, item.linkedName);
  }
  const bound = bindModule(linked.value.module, globals);
  if (!bound.ok) return stageFailure("bind", bound.error.message);
  const constructors: NativeConstructor[] = [];
  for (const name of ["TextEncoder", "TextDecoder"]) {
    if (name === undefined) throw "native constructor name invariant";
    const factory = helpers.get("text-encoding:createNative" + name);
    if (factory !== undefined) constructors.push({ global: name, factory });
  }
  const consoleLog = helpers.get("native-console:consoleLog"),
    consoleError = helpers.get("native-console:consoleError");
  const moduleConstructors: { name: string; factory: string }[] = [];
  for (const binding of request.moduleConstructors ?? []) {
    if (binding === undefined) throw "module constructor invariant";
    const constructor = linked.value.exports.find(
      (item) =>
        item !== undefined &&
        item.module === binding.module &&
        item.namespace === "value" &&
        item.name === binding.name,
    );
    const factory = linked.value.exports.find(
      (item) =>
        item !== undefined &&
        item.module === binding.module &&
        item.namespace === "value" &&
        item.name === binding.factory,
    );
    if (constructor === undefined || factory === undefined)
      return stageFailure(
        "globals",
        "missing module constructor or factory: " + binding.name,
      );
    moduleConstructors.push({
      name: constructor.linkedName,
      factory: factory.linkedName,
    });
  }
  const normalized = prepareNativeGlobals(
    linked.value.module,
    bound.value,
    constructors,
    consoleLog === undefined || consoleError === undefined
      ? undefined
      : { log: consoleLog, error: consoleError },
    moduleConstructors,
  );
  if (!normalized.ok) return stageFailure("globals", normalized.error);
  const workerEvaluation = request.workerEvaluation;
  const application =
    workerEvaluation === undefined
      ? normalized.value
      : deferWorkerEvaluation(
          normalized.value,
          linked.value.exports,
          linked.value.ranges,
          workerEvaluation,
        );
  if (application === undefined)
    return stageFailure(
      "worker-entry",
      "missing checked Worker entry function",
    );
  const surfaces = prepareManagedSurfaceExports(
    application,
    linked.value,
    request.managedSurfaces ?? [],
    surfaceModules,
    request.runtimes,
    retainedRuntimeModules,
    globals,
    request.maxSpecializations ?? 8192,
    request.generationalBarriers === true,
  );
  if (!surfaces.ok) return stageFailure("surface", surfaces.error);
  const surfacePlans = surfaces.value.plans;
  return {
    ok: true,
    value: {
      application: surfaces.value.module,
      exports: linked.value.exports,
      ranges: linked.value.ranges,
      sourceNames: linked.value.sourceNames,
      helpers,
      runtimeNamespacesByModule,
      retainedRuntimeExports,
      retainedRuntimeModules,
      surfacePlans,
    },
  };
}

/** Evaluate Worker-dependent root modules once their host has installed the
 * isolate's Worker bindings. */
function deferredModules(
  evaluations: readonly WorkerEvaluation[],
): readonly string[] {
  const modules: string[] = [];
  for (const evaluation of evaluations)
    if (evaluation !== undefined)
      for (const id of evaluation.modules) modules.push(id);
  return modules;
}
/** Worker application functions poll for stop requests at their safepoints
 * (the emitters match a devirtualized `$direct` twin by its closure's name).
 * Inlining stays within each class so runtime helpers never gain polls. */
function interruptibleInlining(
  workerFunctions: ReadonlySet<string> | undefined,
): { readonly interruptible?: (fn: FunctionIR) => boolean } {
  const names = workerFunctions;
  if (names === undefined) return {};
  return {
    interruptible: (fn: FunctionIR): boolean =>
      names.has(fn.name.endsWith("$direct") ? fn.name.slice(0, -7) : fn.name),
  };
}
function deferWorkerEvaluation(
  module: Module,
  exports: readonly LinkedExport[],
  ranges: readonly SourceRange[],
  evaluations: readonly WorkerEvaluation[],
): Module | undefined {
  const wrappers: string[] = [];
  const bodies: Statement[][] = [];
  const found: (Statement | undefined)[] = [];
  const scopes = new Map<string, number>();
  for (let index = 0; index < evaluations.length; index++) {
    const evaluation = evaluations[index];
    if (evaluation === undefined) throw "worker evaluation invariant";
    const entry = exports.find(
      (item) =>
        item !== undefined &&
        item.module === evaluation.entry &&
        item.namespace === "value" &&
        item.name === evaluation.start,
    );
    if (entry === undefined) return undefined;
    wrappers.push(entry.linkedName);
    bodies.push([]);
    found.push(undefined);
    for (const id of evaluation.modules) {
      if (scopes.has(id)) return undefined;
      scopes.set(id, index);
    }
  }
  const declarations: Statement[] = [];
  for (const statement of module.statements) {
    if (statement === undefined) throw "worker evaluation statement invariant";
    const origin = locateSourceRange(ranges, statement);
    const scope = origin === undefined ? undefined : scopes.get(origin.module);
    if (
      scope === undefined ||
      statement.kind === "interface" ||
      statement.kind === "type-alias"
    ) {
      declarations.push(statement);
      continue;
    }
    const body = bodies[scope];
    if (body === undefined) throw "worker evaluation scope invariant";
    body.push(statement);
    if (statement.kind === "function" && statement.name === wrappers[scope])
      found[scope] = statement;
  }
  const end = module.end;
  for (let index = 0; index < wrappers.length; index++) {
    const wrapper = found[index],
      body = bodies[index],
      name = wrappers[index];
    if (
      wrapper?.kind !== "function" ||
      body === undefined ||
      name === undefined
    )
      return undefined;
    body.push({
      kind: "return",
      expression: {
        kind: "call",
        callee: { kind: "identifier", name, start: end, end },
        arguments: [],
        start: end,
        end,
      },
      start: end,
      end,
    });
    const scopedBody: Statement = {
      kind: "block",
      statements: body,
      start: module.start,
      end,
    };
    declarations.push({
      ...wrapper,
      start: module.start,
      end,
      body: scopedBody,
    });
  }
  return { ...module, statements: declarations };
}
/** Specializes the application; its binding dies with this frame. */
function specializeApplication(
  application: Module,
  maxSpecializations: number,
  ranges: readonly SourceRange[],
): { readonly ok: true; readonly value: Module } | CompilationFailure {
  const bound = bindModule(application, typedGlobals);
  if (!bound.ok) return stageFailure("bind", bound.error.message);
  const specialized = specializeModule(application, bound.value, {
    maxSpecializations,
  });
  if (!specialized.ok) {
    const diagnostic = specialized.error;
    const fallback = diagnostic.fallback;
    const location = locateSourceRange(ranges, diagnostic);
    const owner =
      fallback === undefined
        ? undefined
        : locateSourceRange(ranges, fallback.owner);
    if (fallback === undefined || location === undefined || owner === undefined)
      return stageFailure("specialize", diagnostic.message, location?.module);
    return {
      ok: false,
      error: {
        stage: "specialize",
        message: diagnostic.message,
        module: owner.module,
        fallback: {
          phase: "specialize",
          code: "UNSUPPORTED",
          capability: fallback.capability,
          location,
          owner: {
            kind: fallback.ownerKind,
            module: owner.module,
            start: owner.start,
            end: owner.end,
          },
        },
      },
    };
  }
  return { ok: true, value: specialized.value.module };
}
/** Checks the first specialization and prepares the source for instantiation.
 * The collection pass consumes the checked graph through its observation. */
function checkApplication(
  linkedProgram: LinkedTypedProgram,
  request: CompileRequest,
  callHelper: string | undefined,
  mixed: boolean,
):
  | {
      readonly ok: true;
      readonly value: {
        readonly instanceSource: Module;
        readonly observation: CollectionRuntimeObservation;
        readonly callsGeneral: boolean;
        readonly nodeErrors: NodeErrorNames | undefined;
      };
    }
  | CompilationFailure {
  const specialized = specializeApplication(
    linkedProgram.application,
    request.maxSpecializations ?? 8192,
    linkedProgram.ranges,
  );
  if (!specialized.ok) return { ok: false, error: specialized.error };
  const realmImports = new Map<string, "callable" | "value">();
  for (const exported of request.nodeFfiRealmModules === undefined
    ? []
    : linkedProgram.exports) {
    if (exported === undefined || exported.namespace !== "value") continue;
    if (exported.module === foreignRuntimeModules.nodeFfi) {
      if (exported.name !== "suffix")
        realmImports.set(
          exported.linkedName,
          exported.name === "default" ||
            exported.name === "types" ||
            exported.name === "DynamicLibrary"
            ? "value"
            : "callable",
        );
    } else if (exported.module === foreignRuntimeModules.nodeBuffer) {
      if (exported.name === "Buffer" || exported.name === "constants")
        realmImports.set(
          exported.linkedName,
          exported.name === "Buffer" ? "callable" : "value",
        );
    }
  }
  const checked = checkClosureModule(specialized.value, {
    realmImports:
      request.nodeFfiRealmModules === undefined ? undefined : realmImports,
    cViews: foreignViewRegistry(
      request.foreignLibraries ?? [],
      linkedProgram.exports,
    ),
  });
  if (!checked.ok) {
    const location = locateSourceRange(linkedProgram.ranges, checked.error);
    const message =
      (location === undefined
        ? ""
        : location.module +
          ":" +
          String(location.start) +
          ":" +
          String(location.end) +
          ": ") + checked.error.message;
    const fallback = checked.error.fallback;
    const owner =
      fallback === undefined
        ? undefined
        : locateSourceRange(linkedProgram.ranges, fallback.owner);
    const trigger: FallbackTrigger | undefined =
      fallback === undefined || location === undefined || owner === undefined
        ? undefined
        : {
            phase: "check",
            code: checked.error.code,
            capability: fallback.capability,
            location,
            owner: {
              kind: fallback.ownerKind,
              module: owner.module,
              start: owner.start,
              end: owner.end,
            },
          };
    return {
      ok: false,
      error: {
        stage: "check",
        message,
        ...(location === undefined ? {} : { module: location.module }),
        ...(trigger === undefined ? {} : { fallback: trigger }),
        ...(checked.error.preventsFallback === true
          ? { diagnostic: checked.error.code, preventsFallback: true }
          : {}),
      },
    };
  }
  const helpers = linkedProgram.helpers,
    application = linkedProgram.application,
    hasDynamicRuntime = helpers.has("dynamic-object:create");
  const dynamic = usesDynamicObjectRuntime(checked.value, mixed);
  const nativeProjections: string[] = [];
  checked.value.nativeCallableViews?.forEach((_value, _site) => {
    if (!nativeProjections.includes("projectUnaryNumber"))
      nativeProjections.push("projectUnaryNumber");
  });
  checked.value.nativeCallbackViews?.forEach((_value, _site) => {
    if (!nativeProjections.includes("projectNativeCallback"))
      nativeProjections.push("projectNativeCallback");
  });
  checked.value.nativeListViews?.forEach((_value, _site) => {
    if (!nativeProjections.includes("projectNumberList"))
      nativeProjections.push("projectNumberList");
  });
  checked.value.nativeRecordViews?.forEach((_value, _site) => {
    if (!nativeProjections.includes("projectNativeRecord"))
      nativeProjections.push("projectNativeRecord");
  });
  // Retained runtime functions can dispatch through attached error views
  // without capturing the program instance's realm closures.
  function canCaptureErrorRealm(site: Span): boolean {
    const origin = locateSourceRange(linkedProgram.ranges, site);
    return (
      origin === undefined ||
      !linkedProgram.retainedRuntimeModules.has(origin.module)
    );
  }
  const realmInstanceof = usesRealmInstanceof(
    checked.value,
    mixed || dynamic,
    canCaptureErrorRealm,
  );
  if (
    !hasDynamicRuntime &&
    (dynamic || realmInstanceof || nativeProjections.length !== 0)
  )
    return {
      ok: false,
      error: {
        stage: "lower",
        message: realmInstanceof
          ? "UNSUPPORTED: instanceof requires the program realm runtime"
          : "UNSUPPORTED: dynamic-key objects require the program realm runtime",
        needsDynamicRealm: true,
        ...(nativeProjections.length > 0 ? { nativeProjections } : {}),
        ...(checked.value.needsBindingRealm === true
          ? { needsBindingRealm: true }
          : {}),
      },
    };
  const instanceSource = hasDynamicRuntime
    ? insertDynamicObjectRuntime(
        application,
        checked.value,
        helpers,
        realmInstanceof,
        mixed,
        canCaptureErrorRealm,
        linkedProgram.sourceNames,
      )
    : application;
  let callsGeneral = false;
  if (callHelper !== undefined)
    checked.value.intrinsics.forEach((intrinsic, _expression) => {
      if (intrinsic === "general-call" || intrinsic === "general-construct")
        callsGeneral = true;
    });
  // Carry only linked names across collection preparation. The final checker
  // assigns fresh type IDs, and the observation releases the first graph.
  function nodeErrorName(
    name: string,
    module: string = "packages/native-runtime/src/node/errors.ts",
  ): string | undefined {
    return linkedProgram.exports.find(
      (item) =>
        item !== undefined &&
        item.module === module &&
        item.namespace === "type" &&
        item.name === name,
    )?.linkedName;
  }
  const coded = nodeErrorName("NativeCodedError"),
    type = nodeErrorName(
      "NativeCodedTypeError",
      "packages/native-runtime/src/node/type-error.ts",
    ),
    range = nodeErrorName("NativeCodedRangeError"),
    system = nodeErrorName("NativeSystemError");
  const nodeErrors: NodeErrorNames | undefined =
    coded === undefined &&
    type === undefined &&
    range === undefined &&
    system === undefined
      ? undefined
      : { coded, type, range, system, info: nodeErrorName("SystemErrorInfo") };
  return {
    ok: true,
    value: {
      instanceSource,
      observation: { checked: checked.value },
      callsGeneral,
      nodeErrors,
    },
  };
}
/** Specializes and checks the linked program; returns what lowering needs. */
function checkTypedProgram(
  request: CompileRequest,
  mixed: boolean,
  invokeDirectly: boolean,
): TypedChecking {
  const linking = linkTypedProgram(request);
  if (!linking.ok) return { ok: false, error: linking.error };
  const linkedProgram = linking.value,
    globals = typedGlobals,
    exports = linkedProgram.exports,
    ranges = linkedProgram.ranges,
    helpers = linkedProgram.helpers,
    runtimeNamespacesByModule = linkedProgram.runtimeNamespacesByModule,
    retainedRuntimeExports = linkedProgram.retainedRuntimeExports,
    retainedRuntimeModules = linkedProgram.retainedRuntimeModules,
    surfacePlans = linkedProgram.surfacePlans;
  const callHelper = helpers.get("general-object-views:callGeneralValue");
  const constructHelper = helpers.get(
    "general-object-views:constructGeneralValue",
  );
  const classifierHelper = helpers.get(
    "general-object-views:generalValueTypeof",
  );
  const fixedFfiHelpers: string[] = [];
  if (request.nodeFfiRealmModules !== undefined)
    for (const arity of request.nodeFfiFixedArities ?? []) {
      if (arity === undefined) throw "fixed FFI arity invariant";
      const helper = helpers.get("node-ffi-static:" + fixedFfiCallEntry(arity));
      if (helper !== undefined) fixedFfiHelpers.push(helper);
      const mixedFfi = helpers.get(
        "node-ffi-static:" + mixedFfiCallEntry(arity),
      );
      if (mixedFfi !== undefined) fixedFfiHelpers.push(mixedFfi);
    }
  const retainClassifier =
    classifierHelper !== undefined &&
    (helpers.has("dynamic-object:projectUnaryNumber") ||
      request.nodeFfiRealmModules !== undefined);
  const checked = checkApplication(linkedProgram, request, callHelper, mixed);
  if (!checked.ok) return { ok: false, error: checked.error };
  const callsGeneral = checked.value.callsGeneral,
    nodeErrors = checked.value.nodeErrors;
  let initializerName = "",
    entryName = "";
  const start = request.start;
  let surfaceFunctions: readonly (readonly string[])[] = [];
  let surfaceRuntimes: readonly ManagedSurfaceRuntimeExports[] = [];
  let instanceFallback: ModuleInstanceFallback | undefined;
  const transform: RuntimeModuleTransform = (inputModule, context) => {
    let generatedRetain: readonly string[] = [],
      generatedExclude: readonly string[] = [];
    let module = inputModule;
    if (surfacePlans.length !== 0) {
      const retainedValues = new Set<string>();
      for (const name of retainedRuntimeExports) {
        if (name === undefined) throw "retained surface value invariant";
        retainedValues.add(name);
      }
      for (const statement of module.statements) {
        if (statement === undefined || statement.kind !== "function") continue;
        const origin = locateSourceRange(ranges, statement);
        if (origin !== undefined && retainedRuntimeModules.has(origin.module))
          retainedValues.add(statement.name);
      }
      const materialized = materializeManagedSurfaceExports(
        module,
        surfacePlans,
        context,
        retainedValues,
      );
      if (!materialized.ok) return materialized;
      module = materialized.value.module;
      surfaceFunctions = materialized.value.functions;
      surfaceRuntimes = materialized.value.runtimes;
      generatedRetain = materialized.value.generated.retain;
      generatedExclude = materialized.value.generated.exclude;
    }
    const retained: string[] = callsGeneral
        ? retainedRuntimeExports.slice()
        : retainedRuntimeExports.filter(
            (name) => name !== callHelper && name !== constructHelper,
          ),
      generatedNames = new Set<string>();
    for (const name of generatedRetain) {
      if (name === undefined) throw "surface retain invariant";
      retained.push(name);
      generatedNames.add(name);
    }
    for (const name of generatedExclude) {
      if (name === undefined) throw "surface exclude invariant";
      generatedNames.add(name);
    }
    for (const statement of module.statements) {
      if (statement === undefined) throw "module statement invariant";
      if (
        (statement.kind === "function" ||
          statement.kind === "type-alias" ||
          statement.kind === "interface" ||
          statement.kind === "class") &&
        generatedNames.has(statement.name)
      )
        continue;
      const origin = locateSourceRange(ranges, statement);
      if (origin === undefined || !retainedRuntimeModules.has(origin.module))
        continue;
      if (statement.kind === "function") retained.push(statement.name);
      else if (statement.kind === "variable")
        for (const declaration of statement.declarations) {
          if (declaration === undefined) throw "runtime declaration invariant";
          for (const identifier of bindingIdentifiers(declaration)) {
            if (identifier === undefined) throw "binding identifier invariant";
            retained.push(identifier.name);
          }
        }
    }
    const selected: ModuleInstanceExport[] = [];
    for (const name of request.exports) {
      if (name === undefined) throw "selected export invariant";
      const found = exports.find(
        (item) =>
          item !== undefined &&
          item.module === request.entry &&
          item.namespace === "value" &&
          item.name === name,
      );
      if (
        found === undefined ||
        !module.statements.some(
          (s) =>
            s !== undefined &&
            s.kind === "function" &&
            s.name === found.linkedName,
        )
      )
        return {
          ok: false,
          error: "selected export is not a concrete function: " + name,
        };
      selected.push({ name, local: found.linkedName });
    }
    const bound = bindModule(module, globals);
    if (!bound.ok) return { ok: false, error: bound.error.message };
    if (
      (callsGeneral && callHelper !== undefined) ||
      retainClassifier ||
      fixedFfiHelpers.length !== 0
    ) {
      // Realm calls use specialized dependencies. Close the stateless
      // classifier and call entries after specialization.
      const functionNames = new Map<Span, string>();
      for (const statement of module.statements)
        if (statement?.kind === "function")
          functionNames.set(statement, statement.name);
      const dependencies = new Map<string, Set<string>>();
      for (const reference of bound.value.references) {
        if (reference === undefined || reference.binding === undefined)
          continue;
        const target = bound.value.bindings[reference.binding];
        if (target?.kind !== "function" || target.owner !== undefined) continue;
        let caller = bound.value.scopes[reference.scope]?.owner;
        if (caller === undefined) continue;
        let fn = bound.value.functions[caller];
        while (fn !== undefined && fn.parent !== undefined) {
          caller = fn.parent;
          fn = bound.value.functions[caller];
        }
        const name = fn === undefined ? undefined : functionNames.get(fn.node);
        if (name === undefined) continue;
        const known = dependencies.get(name);
        const names = known ?? new Set<string>();
        names.add(target.name);
        if (known === undefined) dependencies.set(name, names);
      }
      const pending = fixedFfiHelpers.slice();
      if (callsGeneral && callHelper !== undefined) pending.push(callHelper);
      if (callsGeneral && constructHelper !== undefined)
        pending.push(constructHelper);
      if (retainClassifier && classifierHelper !== undefined)
        pending.push(classifierHelper);
      const seen = new Set(pending);
      for (let index = 0; index < pending.length; index++) {
        const root = pending[index];
        if (root === undefined) throw "realm call dependency invariant";
        if (!retained.includes(root)) retained.push(root);
        const names = dependencies.get(root);
        if (names === undefined) continue;
        for (const dependency of names) {
          if (dependency === undefined || seen.has(dependency)) continue;
          seen.add(dependency);
          pending.push(dependency);
        }
      }
    }
    const instance = prepareModuleInstance(
      module,
      bound.value,
      selected,
      retained,
      invokeDirectly,
    );
    if (!instance.ok) {
      instanceFallback = instance.fallback;
      return { ok: false, error: instance.error };
    }
    initializerName = instance.value.initializer.name;
    if (invokeDirectly) {
      entryName = initializerName;
      return { ok: true, value: instance.value.module };
    }
    if (start !== undefined) {
      const invocation = prepareModuleInvocation(instance.value, start);
      if (!invocation.ok) return invocation;
      entryName = invocation.value.entry.name;
      return { ok: true, value: invocation.value.module };
    }
    return { ok: true, value: instance.value.module };
  };
  const prepared = prepareObservedCollectionRuntimes(
    checked.value.instanceSource,
    checked.value.observation,
    helpers,
    globals,
    transform,
    request.maxSpecializations ?? 8192,
    (request.managedSurfaces?.length ?? 0) === 0
      ? undefined
      : (types) => {
          const compared = createManagedTypeContractIndex(types);
          return (left, right): boolean => {
            if (!compared.ok) return false;
            const result = compared.value.matches(left, right);
            return result.ok && result.value;
          };
        },
    undefined,
    (request.managedSurfaces?.length ?? 0) === 0 &&
      (request.serviceImports?.length ?? 0) === 0,
  );
  if (!prepared.ok) {
    const diagnostic = prepared.diagnostic;
    const site = instanceFallback?.location ?? diagnostic;
    const fallback = instanceFallback ?? diagnostic?.fallback;
    if (diagnostic !== undefined && diagnostic.preventsFallback === true)
      return {
        ok: false,
        error: {
          stage: "runtime",
          message: prepared.error,
          diagnostic: diagnostic.code,
          preventsFallback: true,
        },
      };
    if (site !== undefined && fallback !== undefined) {
      const location = locateSourceRange(ranges, site);
      const owner = locateSourceRange(ranges, fallback.owner);
      if (location !== undefined && owner !== undefined)
        return {
          ok: false,
          error: {
            stage: "runtime",
            message: prepared.error,
            module: location.module,
            fallback: {
              phase: "runtime",
              code: diagnostic?.code ?? "UNSUPPORTED",
              capability: fallback.capability,
              location,
              owner: {
                kind: fallback.ownerKind,
                module: owner.module,
                start: owner.start,
                end: owner.end,
              },
            },
          },
        };
    }
    return stageFailure("runtime", prepared.error);
  }
  return {
    ok: true,
    value: {
      checked: prepared.value.checked,
      nodeErrors,
      options: {
        ...prepared.value.options,
        sourceNames: linkedProgram.sourceNames,
      },
      exports,
      ranges,
      runtimeNamespacesByModule,
      surfacePlans,
      surfaceFunctions,
      surfaceRuntimes,
      initializerName,
      entryName,
    },
  };
}
function realmTypeofSourcePredicate(
  ranges: readonly SourceRange[],
  modules: ReadonlySet<string>,
): (span: Span) => boolean {
  return (span): boolean => {
    const origin = locateSourceRange(ranges, span);
    return origin !== undefined && modules.has(origin.module);
  };
}
/** Lowers the checked program and binds its host, foreign and weak
 * operations. Returns the IR with the compact facts later stages need. */
function lowerTypedProgram(
  request: CompileRequest,
  realmTypeofModules?: ReadonlySet<string>,
  invokeDirectly: boolean = false,
): TypedLowering {
  const front = checkTypedProgram(
    request,
    realmTypeofModules !== undefined,
    invokeDirectly,
  );
  if (!front.ok) return { ok: false, error: front.error };
  const checkedProgram = front.value,
    nativeChecked = checkedProgram.checked,
    exports = checkedProgram.exports,
    ranges = checkedProgram.ranges,
    runtimeNamespacesByModule = checkedProgram.runtimeNamespacesByModule,
    surfacePlans = checkedProgram.surfacePlans,
    surfaceFunctions = checkedProgram.surfaceFunctions,
    surfaceRuntimes = checkedProgram.surfaceRuntimes,
    initializerName = checkedProgram.initializerName,
    entryName = checkedProgram.entryName,
    start = request.start;
  const surfaceSources = new Map<string, number>();
  if (surfacePlans.length !== 0)
    rewriteModule(nativeChecked.module, {
      statement: (node, original) => {
        if (original.kind === "function") {
          const name = original.name;
          const fn = nativeChecked.bindings.functions.find(
            (fn) => fn !== undefined && fn.node === original,
          );
          if (fn !== undefined) surfaceSources.set(name, fn.id);
        }
        return node;
      },
    });
  const runtimeSources = new Map<string, number>();
  for (const statement of nativeChecked.module.statements) {
    if (statement === undefined || statement.kind !== "function") continue;
    const fn = nativeChecked.bindings.functions.find(
      (fn) =>
        fn !== undefined && fn.parent === undefined && fn.node === statement,
    );
    if (fn !== undefined) runtimeSources.set(statement.name, fn.id);
  }
  const functionAddressBindings: FunctionAddressBinding[] = [];
  for (const state of surfaceRuntimes) {
    if (state === undefined) throw "surface runtime state invariant";
    const bindings = resolveRuntimeEntryBindings(
      nativeChecked,
      state.entries.stubs,
    );
    if (!bindings.ok) return stageFailure("surface", bindings.error);
    for (const binding of bindings.value) {
      if (binding === undefined) throw "surface address binding invariant";
      functionAddressBindings.push(binding);
    }
  }
  const initializerDeclaration = nativeChecked.module.statements.find(
    (s) =>
      s !== undefined && s.kind === "function" && s.name === initializerName,
  );
  const entryDeclaration = nativeChecked.module.statements.find(
    (s) => s !== undefined && s.kind === "function" && s.name === entryName,
  );
  const entries: number[] = [];
  let initializer = -1,
    invocation = -1;
  for (const fn of nativeChecked.bindings.functions) {
    if (fn === undefined) throw "checked function invariant";
    if (fn.parent !== undefined) continue;
    if (fn.node === initializerDeclaration) initializer = entries.length;
    if (fn.node === entryDeclaration) invocation = entries.length;
    entries.push(fn.id);
  }
  if (initializer < 0)
    return stageFailure("lower", "module initializer is missing");
  if (start !== undefined && invocation < 0)
    return stageFailure("lower", "module invocation is missing");
  const recordBindings: {
    function: number;
    operation: RecordOperation;
    field?: string | undefined;
    count?: number | undefined;
    siteField?: string | undefined;
    entries?: number | undefined;
  }[] = [];
  for (const plan of surfacePlans) {
    if (plan === undefined) throw "surface plan invariant";
    for (const name of plan.records) {
      if (name === undefined) throw "surface identity name invariant";
      const source = surfaceSources.get(name);
      const fn =
        source === undefined
          ? undefined
          : nativeChecked.bindings.functions[source];
      if (fn === undefined)
        return stageFailure(
          "surface",
          "surface identity stub is missing: " + name,
        );
      recordBindings.push({ function: fn.id, operation: "identity" });
    }
  }
  for (const binding of request.recordBindings ?? []) {
    if (binding === undefined) throw "record binding invariant";
    if (!runtimeNamespacesByModule.has(binding.module))
      return stageFailure(
        "record-binding",
        "record bindings require a declared runtime module",
      );
    const module = binding.module,
      name = binding.name;
    const exported = exports.find(
      (item) =>
        item !== undefined &&
        item.module === module &&
        item.namespace === "value" &&
        item.name === name,
    );
    if (exported === undefined)
      return stageFailure(
        "record-binding",
        "record binding export is missing: " + name,
      );
    const linkedName = exported.linkedName;
    const declaration = nativeChecked.module.statements.find(
      (item) =>
        item !== undefined &&
        item.kind === "function" &&
        item.name === linkedName,
    );
    const fn = nativeChecked.bindings.functions.find(
      (item) =>
        item !== undefined &&
        item.node === declaration &&
        item.parent === undefined,
    );
    if (fn === undefined)
      return stageFailure(
        "record-binding",
        "record binding requires a module function: " + name,
      );
    recordBindings.push({
      function: fn.id,
      operation: binding.operation,
      field: binding.field,
      count: binding.count,
      siteField: binding.siteField,
      entries: binding.entries,
    });
  }
  const serviceSources: {
    readonly function: number;
    readonly name: string;
    readonly contract: string;
  }[] = [];
  const serviceNames = new Set<number>();
  for (const binding of request.serviceImports ?? []) {
    const surfaceName = binding?.surface,
      surfacePlan =
        surfaceName === undefined
          ? undefined
          : surfacePlans.find(
              (plan) =>
                plan !== undefined && plan.directory.name === surfaceName,
            ),
      contract =
        binding?.contract ??
        (surfacePlan === undefined
          ? undefined
          : "tint.service.factory.v1/" +
            surfacePlan.directory.name +
            "/" +
            surfacePlan.directory.digest);
    if (
      binding === undefined ||
      contract === undefined ||
      !runtimeNamespacesByModule.has(binding.module) ||
      contract.length === 0 ||
      contract.includes("\0")
    )
      return stageFailure(
        "service-import",
        "service imports require an authorized runtime export and contract",
      );
    const exported = exports.find(
      (item) =>
        item !== undefined &&
        item.module === binding.module &&
        item.name === binding.name &&
        item.namespace === "value",
    );
    const declaration =
      exported === undefined
        ? undefined
        : nativeChecked.module.statements.find(
            (item) =>
              item !== undefined &&
              item.kind === "function" &&
              item.name === exported.linkedName,
          );
    const fn =
      declaration === undefined
        ? undefined
        : nativeChecked.bindings.functions.find(
            (item) =>
              item !== undefined &&
              item.node === declaration &&
              item.parent === undefined,
          );
    if (fn === undefined || serviceNames.has(fn.id))
      return stageFailure(
        "service-import",
        "missing or duplicate service entry",
      );
    if (binding.surface !== undefined) {
      const plan = surfacePlans.find(
          (plan) =>
            plan !== undefined && plan.directory.name === binding.surface,
        ),
        frameName = plan?.directory.frame,
        frame =
          frameName === undefined
            ? undefined
            : plan?.surface.types.find(
                (type) => type !== undefined && type.name === frameName,
              )?.type;
      const frameType =
        frame?.kind === "named"
          ? nativeChecked.typeNames.get(frame.name)
          : undefined;
      const id = managedFunctionType(nativeChecked, fn.id),
        type = id === undefined ? undefined : nativeChecked.types[id];
      if (
        plan === undefined ||
        contract !==
          "tint.service.factory.v1/" +
            plan.directory.name +
            "/" +
            plan.directory.digest ||
        frameType === undefined ||
        type?.kind !== "function" ||
        type.parameters.length !== 1 ||
        type.receiver !== undefined ||
        nativeChecked.types[type.result]?.kind !== "unknown"
      )
        return stageFailure(
          "service-import",
          "factory differs from its host surface",
        );
      const parameter = type.parameters[0],
        compare = createManagedTypeContractIndex(nativeChecked.types);
      if (parameter === undefined || !compare.ok)
        return stageFailure("service-import", "factory frame is unavailable");
      const match = compare.value.matches(parameter, frameType);
      if (!match.ok || !match.value)
        return stageFailure("service-import", "factory frame contract differs");
    }
    serviceNames.add(fn.id);
    serviceSources.push({
      function: fn.id,
      name: binding.module + ":" + binding.name,
      contract,
    });
  }
  function realmHelper(name: string, namespace: string): number | undefined {
    if (realmTypeofModules === undefined) return undefined;
    const item = exports.find(
      (item) =>
        item !== undefined &&
        item.namespace === "value" &&
        item.name === name &&
        runtimeNamespacesByModule.get(item.module) === namespace,
    );
    return item === undefined ? undefined : runtimeSources.get(item.linkedName);
  }
  const classifierSource = realmHelper(
    "generalValueTypeof",
    "general-object-views",
  );
  const callSource = realmHelper("callGeneralValue", "general-object-views");
  const constructSource = realmHelper(
    "constructGeneralValue",
    "general-object-views",
  );
  const fixedFfiCalls = new Map<number, number>();
  const mixedFfiCalls = new Map<number, number>();
  if (request.nodeFfiRealmModules !== undefined) {
    for (const arity of request.nodeFfiFixedArities ?? []) {
      if (arity === undefined) throw "fixed FFI arity invariant";
      const entry = realmHelper(fixedFfiCallEntry(arity), "node-ffi-static");
      if (entry !== undefined) fixedFfiCalls.set(arity, entry);
      const mixedEntry = realmHelper(
        mixedFfiCallEntry(arity),
        "node-ffi-static",
      );
      if (mixedEntry !== undefined) mixedFfiCalls.set(arity, mixedEntry);
    }
  }
  const errorView = realmHelper("nativeErrorReceiver", "general-record-views");
  const errorOperation = realmHelper(
    "realmErrorOperation",
    "general-object-views",
  );
  const errorSlot = realmHelper("getErrorView", "general-record-views");
  const typeErrorSlot = realmHelper("getTypeErrorView", "general-record-views");
  const rangeErrorSlot = realmHelper(
    "getRangeErrorView",
    "general-record-views",
  );
  const referenceErrorSlot = realmHelper(
    "getReferenceErrorView",
    "general-record-views",
  );
  if (
    errorView !== undefined &&
    (errorOperation === undefined ||
      errorSlot === undefined ||
      typeErrorSlot === undefined ||
      rangeErrorSlot === undefined ||
      referenceErrorSlot === undefined)
  )
    return stageFailure(
      "record-binding",
      "incomplete mixed native error views",
    );
  function nodeErrorType(name: string | undefined): number | undefined {
    return name === undefined ? undefined : nativeChecked.typeNames.get(name);
  }
  const nodeErrors = checkedProgram.nodeErrors;
  const lowered = lowerModuleEntries(
    nativeChecked,
    entries,
    nativeTargetLayout,
    4096,
    {
      ...checkedProgram.options,
      realmTypeof:
        classifierSource === undefined || realmTypeofModules === undefined
          ? undefined
          : {
              function: classifierSource,
              applies: realmTypeofSourcePredicate(ranges, realmTypeofModules),
            },
      realmCall: callSource,
      fixedFfiCalls: fixedFfiCalls.size === 0 ? undefined : fixedFfiCalls,
      mixedFfiCalls: mixedFfiCalls.size === 0 ? undefined : mixedFfiCalls,
      realmConstruct: constructSource,
      realmErrors:
        realmTypeofModules === undefined ||
        errorView === undefined ||
        errorOperation === undefined ||
        errorSlot === undefined ||
        typeErrorSlot === undefined ||
        rangeErrorSlot === undefined ||
        referenceErrorSlot === undefined
          ? undefined
          : {
              view: errorView,
              operation: errorOperation,
              error: errorSlot,
              typeError: typeErrorSlot,
              rangeError: rangeErrorSlot,
              referenceError: referenceErrorSlot,
              applies: realmTypeofSourcePredicate(ranges, realmTypeofModules),
            },
      nodeErrorTypes:
        nodeErrors === undefined
          ? undefined
          : {
              coded: nodeErrorType(nodeErrors.coded),
              type: nodeErrorType(nodeErrors.type),
              range: nodeErrorType(nodeErrors.range),
              system: nodeErrorType(nodeErrors.system),
              info: nodeErrorType(nodeErrors.info),
            },
      recordBindings,
      functionAddressBindings,
      importedFunctions: serviceSources.map((source) => source.function),
      debug: request.debugSymbols ?? false,
    },
  );
  if (!lowered.ok) {
    const fallback = lowered.fallback;
    if (fallback !== undefined) {
      const location = locateSourceRange(ranges, fallback.location);
      const owner = locateSourceRange(ranges, fallback.owner);
      if (location !== undefined && owner !== undefined)
        return {
          ok: false,
          error: {
            stage: "lower",
            message:
              location.module +
              ":" +
              String(location.start) +
              ":" +
              String(location.end) +
              ": " +
              lowered.error,
            module: location.module,
            preventsFallback: true,
            fallback: {
              phase: "lower",
              code: "UNSUPPORTED",
              capability: fallback.capability,
              location,
              owner: {
                kind: "function",
                module: owner.module,
                start: owner.start,
                end: owner.end,
              },
            },
          },
        };
      return {
        ok: false,
        error: {
          stage: "lower",
          message: lowered.error,
          preventsFallback: true,
        },
      };
    }
    let message = lowered.error,
      culprit: string | undefined;
    const marker = message.lastIndexOf("(source "),
      colon = message.indexOf(":", marker),
      close = message.indexOf(")", colon);
    if (marker >= 0 && colon > marker && close > colon) {
      const start = Number(message.slice(marker + 8, colon)),
        end = Number(message.slice(colon + 1, close));
      if (
        Number.isSafeInteger(start) &&
        Number.isSafeInteger(end) &&
        start > 0 &&
        end >= start
      ) {
        const location = locateSourceRange(ranges, { start, end });
        if (location !== undefined) culprit = location.module;
        if (location !== undefined)
          message =
            location.module +
            ":" +
            String(location.start) +
            ":" +
            String(location.end) +
            ": " +
            message;
      }
    }
    return stageFailure("lower", message, culprit);
  }
  const serviceImports: ManagedFunctionEntryBinding[] = [];
  for (const source of serviceSources) {
    if (source === undefined) throw "service source invariant";
    const id = lowered.value.entries.indexOf(source.function),
      fn = lowered.value.module.functions[id];
    if (fn === undefined || fn.import !== true)
      return stageFailure(
        "service-import",
        "service entry is absent from lowering",
      );
    const parameters: ScalarType[] = [];
    for (const slot of fn.parameters) {
      const type = fn.slots[slot ?? -1];
      if (type === undefined)
        return stageFailure("service-import", "missing entry parameter");
      parameters.push(type);
    }
    serviceImports.push({
      function: id,
      name: source.name,
      contract: source.contract,
      parameters,
      returnType: fn.returnType,
    });
  }
  const surfaceRecordWitnesses: number[] = [];
  const identityPlans: IdentityPlan[] = [];
  if (surfacePlans.length !== 0) {
    const loweredModule = lowered.value;
    function surfaceFunction(name: string): FunctionIR | undefined {
      const source = surfaceSources.get(name);
      const index =
        source === undefined ? -1 : loweredModule.entries.indexOf(source);
      return index < 0 ? undefined : loweredModule.module.functions[index];
    }
    for (let index = 0; index < surfacePlans.length; index++) {
      const plan = surfacePlans[index],
        functions = surfaceFunctions[index];
      if (plan === undefined || functions === undefined)
        throw "surface lowering plan invariant";
      const records: ManagedSurfacePhysicalFacts["records"][number][] = [],
        signatures: ManagedSurfacePhysicalFacts["signatures"][number][] = [];
      for (
        let recordIndex = 0;
        recordIndex < plan.directory.records.length;
        recordIndex++
      ) {
        const expected = plan.directory.records[recordIndex],
          name = plan.records[recordIndex];
        if (expected === undefined || name === undefined)
          throw "surface record mapping invariant";
        const fn = surfaceFunction(name);
        // The witness that addresses this record keeps it through pruning.
        if (fn !== undefined) surfaceRecordWitnesses.push(fn.id);
        let record: number | undefined = undefined;
        for (const block of fn?.blocks ?? []) {
          if (block === undefined) throw "surface identity block invariant";
          for (const op of block.instructions) {
            if (op === undefined)
              throw "surface identity instruction invariant";
            if (op.kind === "record-descriptor-address") record = op.record;
          }
        }
        const layout =
          record === undefined
            ? undefined
            : loweredModule.module.records?.[record];
        if (layout === undefined)
          return stageFailure(
            "surface",
            "missing AOT layout: " + expected.alias,
          );
        identityPlans.push({
          contract: managedSurfaceContract(
            plan.directory.name,
            plan.directory.digest,
            "record",
            recordIndex,
          ),
          shape: {
            role: "record",
            parameters: [],
            returnType: undefined,
            recordLayout: expected.layout,
          },
          record,
          function: undefined,
        });
        for (const alias of [expected.alias, ...expected.aliases]) {
          if (alias === undefined) throw "surface record alias invariant";
          records.push({ alias, layout });
        }
      }
      for (const expected of plan.directory.signatures) {
        if (expected === undefined) throw "surface signature invariant";
        const name = functions[expected.function],
          fn = name === undefined ? undefined : surfaceFunction(name);
        if (fn === undefined)
          return stageFailure("surface", "missing AOT ABI: " + expected.alias);
        identityPlans.push({
          contract: managedSurfaceContract(
            plan.directory.name,
            plan.directory.digest,
            "fn",
            plan.directory.signatures.indexOf(expected),
          ),
          shape: {
            role: "signature",
            parameters: expected.parameters,
            returnType: expected.returnType,
          },
          record: undefined,
          function: fn.id,
        });
        const parameters: ScalarType[] = [];
        for (const slot of fn.parameters) {
          if (slot === undefined) throw "surface parameter invariant";
          const type = fn.slots[slot];
          if (type === undefined)
            return stageFailure("surface", "missing AOT parameter");
          parameters.push(type);
        }
        for (const alias of [expected.alias, ...expected.aliases]) {
          if (alias === undefined) throw "surface signature alias invariant";
          signatures.push({ alias, parameters, returnType: fn.returnType });
        }
      }
      const state = surfaceRuntimes[index];
      if (state === undefined) throw "surface runtime state invariant";
      const runtimes = materializeManagedRuntimeProviders(
        state.names,
        (name: string) => {
          const source = runtimeSources.get(name),
            id =
              source === undefined ? -1 : loweredModule.entries.indexOf(source),
            fn = id < 0 ? undefined : loweredModule.module.functions[id];
          if (fn === undefined) return undefined;
          const parameters: ScalarType[] = [];
          for (const slot of fn.parameters) {
            if (slot === undefined) throw "runtime parameter invariant";
            const type = fn.slots[slot];
            if (type === undefined) return undefined;
            parameters.push(type);
          }
          return { parameters, returnType: fn.returnType };
        },
      );
      if (!runtimes.ok) return stageFailure("surface", runtimes.error);
      const runtimeTargets: string[] = [];
      for (const provider of state.names.providers) {
        if (provider === undefined) throw "service runtime provider invariant";
        for (const name of provider.targets) {
          if (name === undefined) throw "service runtime target invariant";
          runtimeTargets.push(name);
        }
      }
      let runtimeSlot = 0;
      for (const provider of plan.directory.runtimes) {
        if (provider === undefined) throw "service provider invariant";
        for (const operation of provider.operations) {
          if (operation === undefined) throw "service operation invariant";
          const name = runtimeTargets[runtimeSlot],
            source = name === undefined ? undefined : runtimeSources.get(name),
            id =
              source === undefined ? -1 : loweredModule.entries.indexOf(source);
          if (id < 0)
            return stageFailure(
              "surface",
              "missing native service runtime entry",
            );
          identityPlans.push({
            contract: managedSurfaceContract(
              plan.directory.name,
              plan.directory.digest,
              "runtime",
              runtimeSlot,
            ),
            shape: {
              role: "function-entry",
              parameters: operation.parameters,
              returnType: operation.returnType,
            },
            record: undefined,
            function: id,
          });
          runtimeSlot++;
        }
      }
      const agreement = verifyManagedSurfacePhysicalAgreement(plan.directory, {
        records,
        signatures,
        runtimes: runtimes.value,
      });
      if (!agreement.ok) return stageFailure("surface", agreement.error);
    }
  }
  // Resolve by the exported declaration identity after module linking, never by
  // source spelling alone. Host and managed capabilities share this lookup.
  function runtimeEntry(module: string, name: string): number | undefined {
    if (!runtimeNamespacesByModule.has(module)) return undefined;
    const exported = exports.find(
      (item) =>
        item !== undefined &&
        item.module === module &&
        item.namespace === "value" &&
        item.name === name,
    );
    if (exported === undefined) return undefined;
    const linkedName = exported.linkedName;
    const declaration = nativeChecked.module.statements.find(
      (item) =>
        item !== undefined &&
        item.kind === "function" &&
        item.name === linkedName,
    );
    if (declaration === undefined) return undefined;
    const fn = nativeChecked.bindings.functions.find(
      (item) =>
        item !== undefined &&
        item.node === declaration &&
        item.parent === undefined,
    );
    if (fn === undefined) return undefined;
    const index = entries.indexOf(fn.id);
    return index < 0 ? undefined : index;
  }
  const hostBindings: HostBinding[] = [];
  for (const binding of request.hostBindings ?? []) {
    if (binding === undefined) throw "native host binding invariant";
    if (!runtimeNamespacesByModule.has(binding.module))
      return stageFailure(
        "host",
        "host bindings require a declared runtime module",
      );
    const index = runtimeEntry(binding.module, binding.name);
    if (index === undefined)
      return stageFailure(
        "host",
        "host bindings require a module entry exported by a declared runtime: " +
          binding.name,
      );
    hostBindings.push({ function: index, operation: binding.operation });
  }
  const foreignBindings: ForeignBinding[] = [];
  for (const binding of request.foreignBindings ?? []) {
    if (binding === undefined) throw "native foreign binding invariant";
    const index = runtimeEntry(binding.module, binding.name);
    if (index === undefined)
      return stageFailure(
        "host",
        "foreign bindings require a module entry exported by a declared runtime: " +
          binding.name,
      );
    const declaration = foreignDeclaration(
      request.foreignLibraries ?? [],
      binding.library,
      binding.declaration,
    );
    if (declaration === undefined)
      return stageFailure(
        "host",
        "unknown foreign declaration " +
          binding.library +
          " " +
          binding.declaration,
      );
    foreignBindings.push({ function: index, call: foreignCall(declaration) });
  }
  for (const binding of request.foreignMemoryBindings ?? []) {
    if (binding === undefined) throw "native foreign memory binding invariant";
    const index = runtimeEntry(binding.module, binding.name);
    if (index === undefined)
      return stageFailure(
        "host",
        "foreign memory bindings require a module entry exported by a declared runtime: " +
          binding.name,
      );
    const operation = binding.operation;
    if (
      operation === "call-direct-scalar" ||
      operation === "call-direct-bytes"
    ) {
      const signature = binding.staticSignature;
      if (signature === undefined)
        return stageFailure(
          "host",
          "direct FFI call requires a fixed prototype",
        );
      const operands: ForeignOperand[] = signature.parameters.map(
        (_parameter): ForeignOperand =>
          operation === "call-direct-bytes" ? "bytes" : "number",
      );
      foreignBindings.push({
        function: index,
        call: {
          symbol: binding.name,
          signature,
          operands,
          result: signature.result.kind === "void" ? "void" : "number",
          indirect: true,
        },
      });
      continue;
    }
    if (operation === "call-static-scalar") {
      const signature = binding.staticSignature;
      if (signature === undefined)
        return stageFailure(
          "host",
          "static FFI call requires a fixed prototype",
        );
      foreignBindings.push({
        function: index,
        call: dynamicScalarCall(false, signature),
      });
      continue;
    }
    foreignBindings.push(
      operation === "call" ||
        operation === "call-callbacks" ||
        operation === "call-scalar" ||
        operation === "call-scalar-callbacks"
        ? {
            function: index,
            call:
              operation === "call-scalar" ||
              operation === "call-scalar-callbacks"
                ? dynamicScalarCall(operation === "call-scalar-callbacks")
                : dynamicForeignCall(operation === "call-callbacks"),
          }
        : {
            function: index,
            memory: {
              operation,
              type: { kind: "void" },
              offset: 0,
              minimum: 0,
              callback: binding.staticSignature,
            },
          },
    );
  }
  for (const library of request.foreignLibraries ?? []) {
    if (library === undefined) throw "foreign library invariant";
    if (!runtimeNamespacesByModule.has(library.id)) continue;
    for (const stub of library.stubs) {
      if (stub === undefined) throw "foreign stub invariant";
      const index = runtimeEntry(library.id, stub.name);
      if (index === undefined)
        return stageFailure("host", "missing foreign stub " + stub.name);
      foreignBindings.push({
        function: index,
        call: stub.call,
        memory: stub.memory,
      });
    }
  }
  for (const binding of foreignBindings) {
    if (binding === undefined) throw "foreign binding invariant";
    if (hostBindings.some((item) => item.function === binding.function))
      return stageFailure(
        "host",
        "function has conflicting host and foreign bindings",
      );
  }
  const weakBindings: WeakBinding[] = [];
  for (const binding of request.weakBindings ?? []) {
    if (binding === undefined) throw "native weak binding invariant";
    const index = runtimeEntry(binding.module, binding.name);
    if (index === undefined)
      return stageFailure(
        "weak",
        "weak bindings require a module entry exported by a declared runtime: " +
          binding.name,
      );
    if (hostBindings.some((item) => item.function === index))
      return stageFailure(
        "weak",
        "function has conflicting host and weak bindings",
      );
    weakBindings.push({ function: index, operation: binding.operation });
  }
  const hostIdentities: { readonly function: number }[] = [];
  for (const binding of hostBindings) {
    if (binding === undefined) throw "host binding invariant";
    hostIdentities.push({ function: binding.function });
  }
  for (const binding of weakBindings) {
    if (binding === undefined) throw "weak binding invariant";
    hostIdentities.push({ function: binding.function });
  }
  for (const binding of foreignBindings) {
    if (binding === undefined) throw "foreign binding invariant";
    hostIdentities.push({ function: binding.function });
  }
  const authority = rejectHostRuntimeEntries(
    functionAddressBindings,
    lowered.value.entries,
    hostIdentities,
  );
  if (!authority.ok) return stageFailure("surface", authority.error);
  const hostBound = bindHostOperations(lowered.value.module, hostBindings);
  if (!hostBound.ok) return stageFailure("host", hostBound.error);
  const hosted = bindForeignCalls(hostBound.value, foreignBindings);
  if (!hosted.ok) return stageFailure("host", hosted.error);
  const weak = bindWeakOperations(hosted.value, weakBindings);
  if (!weak.ok) return stageFailure("weak", weak.error);
  const workerModules = request.workerModules;
  const workerFunctions =
    workerModules === undefined ? undefined : new Set<string>();
  if (workerModules !== undefined && workerFunctions !== undefined) {
    for (const fn of nativeChecked.bindings.functions) {
      if (fn === undefined) throw "worker function invariant";
      const origin = locateSourceRange(ranges, fn.node);
      if (origin === undefined || !workerModules.includes(origin.module))
        continue;
      const binding = nativeChecked.bindings.bindings.find(
        (candidate) =>
          candidate !== undefined &&
          candidate.kind === "function" &&
          candidate.node === fn.node,
      );
      workerFunctions.add(
        binding === undefined ? "closure_" + fn.id : binding.name + "$" + fn.id,
      );
    }
    if (workerFunctions.size === 0)
      return stageFailure("worker", "worker modules have no managed functions");
  }
  /** `module:sourceName` (closures: `module:closure@offset`) of each
   * generated function name, for debug symbols and diagnostics. */
  function functionSourceNames(): FunctionSourceNames {
    const originalNames = new Map<string, string>(),
      variables = new Map<string, string>();
    const positions = new Map<string, SourcePosition>();
    const names = new Map<string, string>();
    for (const source of requestModules(request)) {
      if (source === undefined) throw "debug source invariant";
      const position = source.sourcePosition;
      if (position === undefined) positions.delete(source.id);
      else positions.set(source.id, position);
      const boundSource = bindModule(source.module, typedGlobals);
      // Modules outside the typed globals (JavaScript compiled with general
      // semantics) keep generated function names.
      if (!boundSource.ok) continue;
      for (const binding of boundSource.value.bindings) {
        if (binding === undefined) throw "debug binding invariant";
        const key =
          source.id + ":" + binding.node.start + ":" + binding.node.end;
        if (binding.kind === "function") originalNames.set(key, binding.name);
        variables.set(key, binding.name);
      }
    }
    for (const fn of nativeChecked.bindings.functions) {
      if (fn === undefined) throw "debug function invariant";
      const binding = nativeChecked.bindings.bindings.find(
        (b) => b !== undefined && b.kind === "function" && b.node === fn.node,
      );
      const generated =
        binding === undefined ? "closure_" + fn.id : binding.name + "$" + fn.id;
      const origin = locateSourceRange(ranges, fn.node);
      if (origin !== undefined) {
        const sourceName =
          originalNames.get(
            origin.module + ":" + origin.start + ":" + origin.end,
          ) ?? "closure@" + origin.start;
        names.set(generated, origin.module + ":" + sourceName);
      }
    }
    return { names, variables, positions };
  }
  const observer = request.optimizationObserver;
  const describeSources =
    (observer !== undefined && observer.functionNames !== undefined) ||
    request.debugSymbols === true ||
    request.stackTraces === true ||
    request.symbols === true;
  // Dense list lowering keys each entry by its source declaration; the
  // checked program is unavailable once this front end returns.
  let referenceLists: ReferenceListPlan | undefined = undefined;
  if (
    request.denseReferenceLists &&
    surfacePlans.length === 0 &&
    request.closedProgram &&
    invocation >= 0 &&
    request.optimization !== "none"
  ) {
    const nativeIds = new Uint32Array(nativeChecked.bindings.functions.length);
    for (let i = 0; i < entries.length; i++) {
      const id = entries[i];
      if (id === undefined) throw "list native entry invariant";
      nativeIds[id] = i + 1;
    }
    function nativeId(source: number): number {
      return (nativeIds[source] ?? 0) - 1;
    }
    const bindings: ReferenceListRuntime[] = [];
    for (const binding of checkedProgram.options.lists ?? []) {
      if (binding === undefined) throw "list binding invariant";
      const runtime = binding.runtime,
        fn = nativeChecked.bindings.functions[runtime.create];
      const origin =
        fn === undefined ? undefined : locateSourceRange(ranges, fn.node);
      if (
        origin === undefined ||
        runtimeNamespacesByModule.get(origin.module) !== "sparse-list"
      )
        continue;
      const has = runtime.has,
        remove = runtime.delete,
        resize = runtime.resize;
      if (has === undefined || remove === undefined || resize === undefined)
        continue;
      bindings.push({
        create: nativeId(runtime.create),
        read: nativeId(runtime.read),
        write: nativeId(runtime.write),
        push: nativeId(runtime.push),
        length: nativeId(runtime.length),
        has: nativeId(has),
        delete: nativeId(remove),
        resize: nativeId(resize),
      });
    }
    const origins: (string | undefined)[] = [];
    for (let id = 0; id < entries.length; id++) {
      const source = entries[id],
        fn =
          source === undefined
            ? undefined
            : nativeChecked.bindings.functions[source];
      const origin =
        fn === undefined ? undefined : locateSourceRange(ranges, fn.node);
      origins.push(
        origin === undefined
          ? undefined
          : origin.module + ":" + origin.start + ":" + origin.end,
      );
    }
    referenceLists = { bindings, origins };
  }
  return {
    ok: true,
    value: {
      ir: { module: weak.value },
      ranges,
      initializer,
      invocation,
      serviceImports,
      identityPlans,
      surfaceRecordWitnesses,
      surfacePlans,
      surfaceRuntimes,
      sourceNames: describeSources ? functionSourceNames() : undefined,
      ...(workerFunctions === undefined ? {} : { workerFunctions }),
      referenceLists,
    },
  };
}
/** Lowers dense reference lists (bundled SparseList semantics) in the
 * program's IR. A separate frame keeps the pre-lowering IR collectable. */
function lowerProgramReferenceLists(
  program: TypedProgram,
  lists: ReferenceListPlan,
  remark: ((remark: OptimizationRemark) => void) | undefined,
  recordPass: (statistics: PassStatistics, after: ModuleIR) => boolean,
): void {
  const representation = program.ir.module,
    bindings = lists.bindings,
    origins = lists.origins;
  const aliasKeys: (string | undefined)[] = [];
  function aliasLayout(id: number): string {
    const cached = aliasKeys[id];
    if (cached !== undefined) return cached;
    const fn = representation.functions[id];
    if (fn === undefined) return "missing";
    let key = "" + fn.returnType;
    for (const p of fn.parameters) {
      if (p === undefined) throw "list parameter invariant";
      const type = fn.slots[p];
      if (type === undefined) throw "list slot invariant";
      key = key + ":" + type;
    }
    const reachable = traceModuleReferences(representation, [id]);
    if (reachable === undefined) return "unproved:" + id;
    for (let layout = 0; layout < reachable.records.length; layout++)
      if (reachable.records[layout] === 1) key = key + ":" + layout;
    aliasKeys[id] = key;
    return key;
  }
  const aliases: ReferenceListAlias[] = [];
  const known = new Map<string, number>(),
    listOrigins = new Set<string>();
  for (const binding of bindings) {
    if (binding === undefined) throw "list binding invariant";
    for (const id of [
      binding.create,
      binding.read,
      binding.write,
      binding.push,
      binding.length,
      binding.has,
      binding.delete,
      binding.resize,
    ]) {
      if (id === undefined) throw "list method invariant";
      const origin = origins[id];
      if (origin !== undefined) {
        listOrigins.add(origin);
        const key = origin + ":" + aliasLayout(id);
        if (!known.has(key)) known.set(key, id);
      }
    }
  }
  for (let id = 0; id < origins.length; id++) {
    const origin = origins[id];
    if (origin === undefined || !listOrigins.has(origin)) continue;
    const canonical = known.get(origin + ":" + aliasLayout(id));
    if (canonical !== undefined && canonical !== id)
      aliases.push({ function: id, canonical });
  }
  const loweredLists = lowerReferenceLists(
    representation,
    bindings,
    [program.initializer, program.invocation],
    referenceListWorkBudget(representation),
    aliases,
    remark,
  );
  if (loweredLists === undefined) return;
  program.ir.module = loweredLists.module;
  recordPass(
    {
      phase: "scalar",
      pass: "dense-reference-lists",
      visited: loweredLists.work,
      rewritten: loweredLists.rewritten,
    },
    program.ir.module,
  );
}
/** Replace the optimization owner's module so original bodies can be collected
 * before emission. Observability callers may keep their own IR snapshots. */
function packEmissionIR(program: ModuleVersion, store: FunctionStore): void {
  const functions: FunctionIR[] = [];
  for (const fn of program.module.functions) {
    if (fn === undefined) throw "emission function invariant";
    store.put(fn);
    functions.push(functionHeader(fn));
  }
  program.module = { ...program.module, functions };
}

/** Instructions plus blocks: the IR measure for automatic packing. */
function moduleIRSize(module: ModuleIR): number {
  let size = 0;
  for (const fn of module.functions) {
    if (fn === undefined) throw "emission function invariant";
    for (const block of fn.blocks) {
      if (block === undefined) throw "emission block invariant";
      size += 1 + block.instructions.length;
    }
  }
  return size;
}

function emitProgram(
  program: ModuleVersion,
  storage: BuildStorage | undefined,
  options: EmissionOptions,
): Emission {
  // Small programs keep bodies decoded in memory: every emitter sweep would
  // otherwise decode each body again. Large ones pack unless told otherwise.
  const selected = emissionStorage(storage, moduleIRSize(program.module));
  if (selected === undefined) return emitModule(program.module, options);
  const store = createEmissionStore(selected);
  try {
    packEmissionIR(program, store);
    return emitModuleFromStore(program.module, store, options);
  } finally {
    store.close();
  }
}

function lowerX64Program(
  source: CompileRequest,
  invokeDirectly: boolean,
  onGeneralFallback?: (modules: readonly string[], reason: string) => void,
): TypedLowering {
  const typed = compileWithTypedWorkerEntry<TypedProgram>(
    source,
    (input): TypedLowering => {
      const prepared = withTypedNodeFfiRealm(input);
      return lowerTypedWithProgramRealm(
        prepared,
        prepared.nodeFfiRealmModules,
        invokeDirectly,
      );
    },
    (fallback: GeneralFallback): void =>
      onGeneralFallback?.(fallback.modules, fallback.reason),
  );
  const lowering = source.generalLowering;
  if (
    typed.ok ||
    lowering === undefined ||
    typed.error.preventsFallback === true
  )
    return typed;
  const general = compileGeneralProgram<TypedProgram>(
    source,
    lowering,
    typed.error,
    (program, realmTypeofModules): TypedLowering =>
      lowerTypedWithProgramRealm(program, realmTypeofModules),
  );
  if (!general.ok) return general;
  if (onGeneralFallback !== undefined)
    onGeneralFallback(general.fallback.modules, general.fallback.reason);
  return { ok: true, value: general.value };
}

/** Use the normal typed linker and scalar IR for a closed hosted x86-64
 * application. The AArch64 Compilation contract carries backend-specific
 * metadata; keep the x86-64 emitter and entry linker on their own boundary. */
export function compileX64HostedProgram(
  request: CompileRequest,
  host: PosixHostFacts,
  options: {
    readonly runtime?: true;
    readonly forceFarReach?: boolean;
    readonly jitDebugInterface?: boolean;
    readonly generational?: boolean;
    readonly trustedExecutableCode?: boolean;
    readonly inlineAllocation?: boolean;
    readonly threaded?: boolean;
    readonly nodeWorkerLibrary?: boolean;
    readonly signposts?: readonly X64SignpostSite[];
    readonly allocationProbes?: boolean;
    readonly report?: (stage: string) => void;
    readonly onGeneralFallback?: (
      modules: readonly string[],
      reason: string,
    ) => void;
  } = {},
): CompilationFailure | CompiledX64HostedProgram {
  const selected =
    options.runtime === true ? request : selectX64ForeignRuntime(request);
  if (typeof selected === "string") return stageFailure("foreign", selected);
  const needSourceNames =
    request.debugSymbols === true || options.signposts !== undefined;
  const lowered = lowerX64Program(
    withForeignRuntimes(
      {
        ...request,
        // Recorded in managed-surface directories (the x86-64 emitter takes the
        // policy from options.generational).
        generationalBarriers: options.generational === true,
        moduleLoader: selected.moduleLoader,
        modules: selected.modules,
        symbols: needSourceNames,
      },
      true,
    ),
    options.runtime !== true && options.threaded !== true,
    options.onGeneralFallback,
  );
  if (!lowered.ok) return lowered;
  const program = lowered.value;
  const lists = program.referenceLists;
  if (lists !== undefined)
    lowerProgramReferenceLists(
      program,
      lists,
      undefined,
      (_stats, _module) => false,
    );
  const entry = program.ir.module.functions[program.invocation];
  if (entry === undefined)
    return stageFailure("entry", "linux-x86_64: missing entry");
  const returnType = entry.returnType;
  if (options.runtime === true) {
    const workspaces: readonly ScalarType[] = [
      "Uint32Array",
      "Uint32Array",
      "Uint32Array",
      "Float64Array",
      "Uint8Array",
      "Uint32Array",
      "Float64Array",
    ];
    if (
      returnType !== "reference" ||
      entry.parameters.length !== 8 + workspaces.length ||
      entry.parameters.some(
        (slot, index) =>
          slot === undefined ||
          entry.slots[slot] !== (index < 8 ? "number" : workspaces[index - 8]),
      )
    )
      return stageFailure(
        "entry",
        "linux-x86_64: invalid collector initializer signature",
      );
  } else if (
    returnType !== "number" &&
    returnType !== "boolean" &&
    returnType !== "void" &&
    returnType !== "general"
  )
    return stageFailure(
      "entry",
      "linux-x86_64: expected a Number, Boolean, void or general entry",
    );
  if (
    options.threaded === true &&
    (entry.parameters.length !== (options.nodeWorkerLibrary === true ? 2 : 1) ||
      entry.parameters.some(
        (slot) => slot === undefined || entry.slots[slot] !== "number",
      ))
  )
    return stageFailure(
      "entry",
      "linux-x86_64: threaded entry parameters must match the selected worker host",
    );
  const managed =
    program.serviceImports.length !== 0 || program.surfacePlans.length !== 0;
  if (!managed) {
    // Keep the remapped module and release the superseded version before
    // optimization. The native compiler's managed heap is bounded.
    const reachable = pruneModuleReferences(
      program.ir.module,
      [program.invocation],
      unboundedWork,
    );
    if (reachable !== undefined) {
      program.invocation =
        (reachable.functionIds[program.invocation] ?? program.invocation + 1) -
        1;
      program.ir.module = reachable.module;
    }
  }
  const reportIR = request.onScalarIR,
    initial = reportIR === undefined ? undefined : program.ir.module;
  options.report?.("optimize");
  if (request.optimization !== "none")
    optimizeModuleVersion(program.ir, unboundedWork, {
      closedRecords: !managed,
      closedCalls: !managed,
      devirtualizeClosures: true,
      ...interruptibleInlining(program.workerFunctions),
    });
  if (!managed && program.workerFunctions === undefined) {
    // Prune functions that became unreachable after inlining and release the
    // superseded module before x86-64 emission (matching the arm64 pipeline).
    const reachable = pruneModuleReferences(
      program.ir.module,
      [program.invocation],
      unboundedWork,
    );
    if (reachable !== undefined) {
      program.invocation =
        (reachable.functionIds[program.invocation] ?? program.invocation + 1) -
        1;
      program.ir.module = reachable.module;
    }
  }
  const invocation = program.invocation;
  if (reportIR !== undefined && initial !== undefined) {
    reportIR("lowered", initial);
    reportIR("optimized", program.ir.module);
  }
  const sourceNames = program.sourceNames;
  if (needSourceNames && sourceNames === undefined)
    throw "x64 foreign source names invariant";
  const signposts: X64SignpostSite[] = [];
  if (sourceNames !== undefined)
    for (const fn of program.ir.module.functions) {
      if (fn === undefined) throw "x64 signpost function invariant";
      // Devirtualization gives a closure a direct twin with the same source
      // and the same positional arguments, followed by its environment.
      const name = fn.name.endsWith("$direct") ? fn.name.slice(0, -7) : fn.name;
      const source = sourceNames.names.get(name);
      if (source === undefined) continue;
      sourceNames.names.set(fn.name, source);
      const site = options.signposts?.find(
        (item) => item !== undefined && item.name === source,
      );
      if (site !== undefined) signposts.push({ ...site, name: fn.name });
    }
  const recordWitnesses: number[] = [],
    functionWitnesses: number[] = [];
  for (const plan of program.identityPlans) {
    if (plan === undefined) throw "service identity plan invariant";
    const record = plan.record,
      fn = plan.function;
    if (record !== undefined) recordWitnesses.push(record);
    if (fn !== undefined) functionWitnesses.push(fn);
  }
  options.report?.("emit");
  const emitFunctions: FunctionIR[] | undefined =
    reportIR === undefined ? program.ir.module.functions.slice() : undefined;
  const emitInput: ModuleIR =
    emitFunctions === undefined
      ? program.ir.module
      : { ...program.ir.module, functions: emitFunctions };
  if (emitFunctions !== undefined)
    program.ir.module = { ...program.ir.module, functions: [] };
  const releaseFunction =
    emitFunctions === undefined
      ? undefined
      : (id: number): void => {
          const fn = emitFunctions[id];
          if (fn !== undefined) emitFunctions[id] = functionHeader(fn);
        };
  const emitted = emitX64(
    emitInput,
    host,
    options.generational === true,
    options.inlineAllocation !== false,
    request.debugSymbols === true,
    signposts,
    options.allocationProbes === true,
    options.forceFarReach === true,
    managed
      ? {
          mode: "service",
          bindings: {
            version: 1,
            signatures: [],
            functions: program.serviceImports,
          },
          records: recordWitnesses,
          functions: functionWitnesses,
        }
      : undefined,
    options.jitDebugInterface === true,
    program.workerFunctions,
    options.trustedExecutableCode === true,
    releaseFunction,
  );
  if (!emitted.ok) {
    const message = emitted.error.message;
    return stageFailure(
      "emit",
      "linux-x86_64: " +
        (message.startsWith("x86-64 scalar: ")
          ? message.slice("x86-64 scalar: ".length)
          : message),
    );
  }
  const lines: SourceLineRange[] = [];
  const serviceIdentities: NativeServiceBinding[] = [];
  const native = emitted.value;
  const brand = native.functionDescriptor;
  if (program.surfacePlans.length !== 0 && brand !== undefined)
    serviceIdentities.push({
      name: "tint.function.v1",
      contract: "tint.function.v1",
      role: "function-brand",
      parameters: [],
      returnType: undefined,
      metadataOffset: brand.offset,
    });
  for (const plan of program.identityPlans) {
    if (plan === undefined) throw "service identity plan invariant";
    const record = plan.record,
      fn = plan.function;
    const metadata =
      plan.shape.role === "record"
        ? native.records.find(
            (item) => item !== undefined && item.record === record,
          )
        : native.signatures.find(
            (item) => item !== undefined && item.functions.includes(fn ?? -1),
          );
    if (metadata === undefined) continue;
    const entry = fn === undefined ? undefined : native.functions[fn];
    serviceIdentities.push({
      ...plan.shape,
      name: plan.contract,
      contract: plan.contract,
      metadataOffset: metadata.offset,
      ...(plan.shape.role !== "function-entry" || entry === undefined
        ? {}
        : { entryOffset: entry.offset }),
    });
  }
  const parameterNames = new Map<string, string>();
  if (request.debugSymbols === true && sourceNames !== undefined)
    for (const fn of emitted.value.functions) {
      if (fn === undefined) throw "x64 debug function invariant";
      for (const parameter of fn.frame?.parameters ?? []) {
        if (parameter === undefined) throw "x64 debug parameter invariant";
        const origin = locateSourceRange(program.ranges, parameter);
        if (origin === undefined) continue;
        const name = sourceNames.variables.get(
          origin.module + ":" + origin.start + ":" + origin.end,
        );
        if (name !== undefined)
          parameterNames.set(
            String(fn.id) + ":" + String(parameter.frameOffset),
            name,
          );
      }
    }
  if (sourceNames !== undefined)
    for (const span of emitted.value.sourceRanges) {
      if (span === undefined) throw "x64 source range invariant";
      const origin = locateSourceRange(program.ranges, span);
      if (origin === undefined) continue;
      const locate = sourceNames.positions.get(origin.module);
      const position = locate === undefined ? undefined : locate(origin.start);
      if (position === undefined) continue;
      lines.push({
        offset: span.offset,
        byteLength: span.byteLength,
        file: origin.module,
        line: position.line,
        column: position.column,
      });
    }
  const managedSurfaces = publishedManagedSurfaces(
    program.surfacePlans,
    program.surfaceRuntimes,
  );
  return {
    ok: true,
    native: emitted.value,
    invocation,
    returnType,
    lines,
    functionNames:
      sourceNames === undefined ? new Map<string, string>() : sourceNames.names,
    parameterNames,
    serviceIdentities,
    ...(managedSurfaces === undefined ? {} : { managedSurfaces }),
  };
}
function publishedManagedSurfaces(
  surfacePlans: readonly ManagedSurfaceAOTPlan[],
  surfaceRuntimes: readonly ManagedSurfaceRuntimeExports[],
): readonly PublishedManagedSurface[] | undefined {
  if (surfacePlans.length === 0) return undefined;
  const published: PublishedManagedSurface[] = [];
  for (let index = 0; index < surfacePlans.length; index++) {
    const plan = surfacePlans[index];
    if (plan === undefined) throw "published surface invariant";
    const stubs = surfaceRuntimes[index]?.entries.stubs;
    published.push({
      name: plan.directory.name,
      digest: plan.directory.digest,
      directory: plan.directory,
      signatures: plan.directory.signatures.length,
      records: plan.directory.records.length,
      runtimeSlots: surfaceRuntimes[index]?.entries.slots.length ?? 0,
      runtimeTargets: stubs?.entries.length ?? 0,
      runtimeSignatures:
        (stubs?.declarations.length ?? 0) - (stubs?.entries.length ?? 0),
    });
  }
  return published;
}

function compileTypedProgram(
  request: CompileRequest,
  realmTypeofModules?: ReadonlySet<string>,
): Compilation {
  // Only the lowered IR and compact source facts outlive the front end.
  const lowered = lowerTypedProgram(request, realmTypeofModules);
  if (!lowered.ok) return { ok: false, error: lowered.error };
  const program = lowered.value,
    ranges = program.ranges,
    surfacePlans = program.surfacePlans,
    surfaceRuntimes = program.surfaceRuntimes,
    identityPlans = program.identityPlans,
    surfaceRecordWitnesses = program.surfaceRecordWitnesses,
    sourceNames = program.sourceNames;
  let serviceImports = program.serviceImports;
  const passes: PassStatistics[] = [];
  const observer = request.optimizationObserver,
    observePass = observer === undefined ? undefined : observer.pass,
    passLimit = request.optimizationPassLimit;
  /** Remarks with their spans resolved to source files. */
  function locatedRemarks(
    sink: (remark: LocatedRemark) => void,
  ): (remark: OptimizationRemark) => void {
    const byId = new Map<string, SourcePosition>();
    for (const source of requestModules(request)) {
      if (source === undefined) throw "remark source invariant";
      const position = source.sourcePosition;
      if (position === undefined) byId.delete(source.id);
      else byId.set(source.id, position);
    }
    return (remark: OptimizationRemark): void => {
      const origin =
        remark.end > remark.start
          ? locateSourceRange(ranges, {
              start: remark.start,
              end: remark.end,
            })
          : undefined;
      if (origin === undefined) {
        sink({
          pass: remark.pass,
          outcome: remark.outcome,
          function: remark.function,
          start: remark.start,
          end: remark.end,
          message: remark.message,
        });
        return;
      }
      const positionAt = byId.get(origin.module),
        position =
          positionAt === undefined ? undefined : positionAt(origin.start);
      sink({
        pass: remark.pass,
        outcome: remark.outcome,
        function: remark.function,
        start: origin.start,
        end: origin.end,
        message: remark.message,
        file: origin.module,
        ...(position === undefined
          ? {}
          : { line: position.line, column: position.column }),
      });
    };
  }
  const observeBegin = observer === undefined ? undefined : observer.begin,
    observeRemark = observer === undefined ? undefined : observer.remark,
    programRemark =
      observeRemark === undefined ? undefined : locatedRemarks(observeRemark),
    optimizationObserver: OptimizationObserver | undefined =
      observer === undefined
        ? undefined
        : {
            ...(observePass === undefined ? {} : { pass: observePass }),
            ...(programRemark === undefined ? {} : { remark: programRemark }),
          };
  /** Reports a compiler-level pass; true when the pass limit is reached. */
  function recordPass(statistics: PassStatistics, after: ModuleIR): boolean {
    passes.push(statistics);
    if (observePass !== undefined)
      observePass({ statistics, module: after, budgetExhausted: false });
    return passLimit !== undefined && passes.length >= passLimit;
  }
  function passesRemaining(): boolean {
    return passLimit === undefined || passes.length < passLimit;
  }
  const observeNames =
    observer === undefined ? undefined : observer.functionNames;
  if (observeNames !== undefined) {
    if (sourceNames === undefined) throw "observed source names invariant";
    observeNames(sourceNames.names);
  }
  if (observeBegin !== undefined) observeBegin(program.ir.module);
  const referenceLists = program.referenceLists;
  if (passesRemaining() && referenceLists !== undefined)
    lowerProgramReferenceLists(
      program,
      referenceLists,
      programRemark,
      recordPass,
    );
  function prune(module: ModuleIR): ModuleIR {
    if (
      !request.closedProgram ||
      program.invocation < 0 ||
      request.optimization === "none" ||
      !passesRemaining()
    )
      return module;
    // Managed surfaces and native services let foreign code (published JIT
    // entries, service callers) enter through their identity functions, so
    // those are roots too; raw memory capabilities still decline.
    const foreign = surfacePlans.length !== 0 || serviceImports.length !== 0;
    const roots: number[] = [program.initializer, program.invocation];
    if (foreign) {
      for (const plan of identityPlans) {
        if (plan === undefined) throw "service identity plan invariant";
        const entry = plan.function;
        if (entry !== undefined) roots.push(entry);
      }
      for (const witness of surfaceRecordWitnesses) {
        if (witness === undefined) throw "surface record witness invariant";
        roots.push(witness);
      }
      for (const binding of serviceImports) {
        if (binding === undefined) throw "service import invariant";
        roots.push(binding.function);
      }
    }
    // Tracing and remapping are linear in the instructions of the module;
    // a capped budget silently kept every function of large programs.
    const result = pruneClosedModule(module, roots, unboundedWork, foreign);
    if (result === undefined) {
      // Declined (raw memory capabilities or unstable record layouts).
      recordPass(
        {
          phase: "scalar",
          pass: "remove-unreachable",
          visited: 0,
          rewritten: 0,
          skipped: module.functions.length,
        },
        module,
      );
      return module;
    }
    // Every identity foreign code binds must survive; otherwise keep all.
    for (const plan of identityPlans) {
      if (plan === undefined) throw "service identity plan invariant";
      const entry = plan.function,
        record = plan.record;
      if (
        (entry !== undefined && (result.functionIds[entry] ?? 0) === 0) ||
        (record !== undefined && (result.recordIds[record] ?? 0) === 0)
      )
        return module;
    }
    const init = result.functionIds[program.initializer],
      entry = result.functionIds[program.invocation];
    if (init === undefined || init === 0 || entry === undefined || entry === 0)
      throw "closed root mapping invariant";
    program.initializer = init - 1;
    program.invocation = entry - 1;
    const mapped: ManagedFunctionEntryBinding[] = [];
    for (const binding of serviceImports) {
      if (binding === undefined) throw "service import invariant";
      const id = result.functionIds[binding.function] ?? 0;
      if (id !== 0) mapped.push({ ...binding, function: id - 1 });
    }
    serviceImports = mapped;
    for (const plan of identityPlans) {
      if (plan === undefined) throw "service identity plan invariant";
      const recordId = plan.record,
        functionId = plan.function;
      if (recordId !== undefined) {
        const id = result.recordIds[recordId] ?? 0;
        plan.record = id === 0 ? undefined : id - 1;
      }
      if (functionId !== undefined) {
        const id = result.functionIds[functionId] ?? 0;
        plan.function = id === 0 ? undefined : id - 1;
      }
    }
    recordPass(
      {
        phase: "scalar",
        pass: "remove-unreachable",
        visited: result.work,
        rewritten: result.removedFunctions + result.removedRecords,
      },
      result.module,
    );
    return result.module;
  }
  // AOT is not work-limited: a capped budget silently dropped whole phases
  // (and every pass added later) once the program grew past it.
  // Avoid optimizing unreachable bodies; prune again after inlining removes calls.
  program.ir.module = prune(program.ir.module);
  const reportIR = request.onScalarIR,
    // Analysis tooling alone keeps the unoptimized IR alive.
    reachable = reportIR === undefined ? undefined : program.ir.module;
  // No foreign code (managed surfaces, service callers) enters the program,
  // constructs its records or supplies function values.
  const closedWorld =
    request.closedProgram === true &&
    surfacePlans.length === 0 &&
    (request.serviceImports?.length ?? 0) === 0;
  if (request.optimization !== "none" && passesRemaining()) {
    const optimized = optimizeModuleVersion(program.ir, unboundedWork, {
      devirtualizeClosures: request.closedProgram === true,
      closedRecords: closedWorld,
      closedCalls: closedWorld,
      ...interruptibleInlining(program.workerFunctions),
      ...(optimizationObserver === undefined
        ? {}
        : { observer: optimizationObserver }),
      ...(passLimit === undefined
        ? {}
        : { passLimit: passLimit - passes.length }),
    });
    for (const pass of optimized.passes) {
      if (pass === undefined) throw "optimization pass invariant";
      passes.push(pass);
    }
  }
  program.ir.module = prune(program.ir.module);
  const observedModule =
      observePass === undefined ? undefined : program.ir.module,
    initializer = program.initializer,
    invocation = program.invocation;
  if (reportIR !== undefined && reachable !== undefined) {
    reportIR("lowered", reachable);
    reportIR("optimized", program.ir.module);
  }
  // Codegen analyses that still have size limits fall back to conservative
  // code; each fallback is a missed remark and counts in the emission pass.
  let analysisLimits = 0;
  const native = emitProgram(program.ir, request.storage, {
    maxByteLength: Number.MAX_SAFE_INTEGER,
    unboundedAnalysis: request.optimization !== "none",
    analysisLimit: (analysis: CodegenAnalysis, fn: FunctionIR): void => {
      analysisLimits++;
      if (programRemark !== undefined)
        programRemark({
          pass: "emit-native-code",
          outcome: "missed",
          function: fn.name,
          start: 0,
          end: 0,
          message:
            analysis +
            " exceeded its size limit (" +
            String(fn.blocks.length) +
            " blocks, " +
            String(fn.slots.length) +
            " slots): conservative code",
        });
    },
    hostABI: request.hostABI ?? darwinAArch64Target.hostABI,
    jsConvert: request.jsConvert === true,
    debugSpans: request.debugSymbols === true || request.stackTraces === true,
    throwTraces: request.stackTraces ?? false,
    operationRanges: request.operationRanges ?? false,
    linearAllocation: request.linearAllocation ?? false,
    generationalBarriers: request.generationalBarriers ?? false,
    trustedExecutableCode: request.trustedExecutableCode === true,
    managedABI:
      serviceImports.length === 0
        ? undefined
        : { version: 1, signatures: [], functions: serviceImports },
    closedRoots:
      request.closedProgram && invocation >= 0 ? [invocation] : undefined,
    formHints: request.emissionFormHints,
    pageAlignedCode: request.pageAlignedCode ?? false,
    forceFarReach: request.forceFarReach === true ? true : undefined,
    workerFunctions: program.workerFunctions,
  });
  const optimizedModule = program.ir.module;
  if (!native.ok) {
    const error = native.error;
    const invalid = optimizedModule.functions.find(
      (fn) => fn !== undefined && fn.id === error.function,
    );
    const location = error.span;
    const origin =
      location === undefined ? undefined : locateSourceRange(ranges, location);
    return failure(
      "emit",
      (origin === undefined
        ? invalid === undefined
          ? ""
          : invalid.name + ": "
        : origin.module + ":") +
        (origin !== undefined
          ? String(origin.start) + ":" + String(origin.end) + ": "
          : location === undefined
            ? ""
            : String(location.start) + ":" + String(location.end) + ": ") +
        error.message,
    );
  }
  if (observePass !== undefined && observedModule !== undefined)
    observePass({
      statistics: {
        phase: "codegen",
        pass: "emit-native-code",
        visited: optimizedModule.functions.length,
        rewritten: 0,
        skipped: analysisLimits,
      },
      module: observedModule,
      budgetExhausted: false,
    });
  const serviceIdentities: NativeServiceBinding[] = [],
    brand = native.value.functionDescriptor;
  if (surfacePlans.length !== 0 && brand !== undefined)
    serviceIdentities.push({
      name: "tint.function.v1",
      contract: "tint.function.v1",
      role: "function-brand",
      parameters: [],
      returnType: undefined,
      metadataOffset: brand.offset,
    });
  for (const plan of identityPlans) {
    if (plan === undefined) throw "service identity plan invariant";
    const recordId = plan.record,
      functionId = plan.function;
    const metadata =
      plan.shape.role === "record"
        ? recordId === undefined
          ? undefined
          : native.value.records.find(
              (record) => record !== undefined && record.record === recordId,
            )
        : functionId === undefined
          ? undefined
          : native.value.signatures.find(
              (signature) =>
                signature !== undefined &&
                signature.functions.includes(functionId ?? -1),
            );
    if (metadata === undefined) continue;
    const fn =
      functionId === undefined ? undefined : native.value.functions[functionId];
    serviceIdentities.push({
      ...plan.shape,
      name: plan.contract,
      contract: plan.contract,
      metadataOffset: metadata.offset,
      ...(plan.shape.role !== "function-entry" || fn === undefined
        ? {}
        : { entryOffset: fn.offset }),
    });
  }
  const symbols: { name: string; offset: number; byteLength: number }[] = [];
  const lines: SourceLineRange[] = [];
  let debugFunctions: readonly ProgramFunctionDebug[] = [];
  let debugRecords: readonly DebugHeapRecord[] = [];
  if (
    request.debugSymbols === true ||
    request.stackTraces === true ||
    request.symbols === true
  ) {
    if (sourceNames === undefined) throw "debug source names invariant";
    const names = sourceNames.names;
    // Linking renames bindings; variables keep their source names.
    const variableNames = sourceNames.variables,
      positions = sourceNames.positions;
    for (const range of native.value.sourceRanges) {
      if (range === undefined) throw "debug source range invariant";
      const origin = locateSourceRange(ranges, range);
      if (origin === undefined) continue;
      const positionAt = positions.get(origin.module);
      if (positionAt === undefined) continue;
      const position = positionAt(origin.start);
      if (position === undefined) continue;
      lines.push({
        offset: range.offset,
        byteLength: range.byteLength,
        file: origin.module,
        line: position.line,
        column: position.column,
      });
    }
    for (const fn of native.value.functions) {
      if (fn === undefined) throw "debug native function invariant";
      if (fn.import === true) continue;
      const sourceName = names.get(fn.name);
      symbols.push({
        name:
          sourceName === undefined
            ? fn.name
            : sourceName + " [" + fn.name + "]",
        offset: fn.offset,
        byteLength: fn.byteLength,
      });
    }
    if (request.debugSymbols === true)
      debugRecords = describeHeapRecords(
        optimizedModule,
        (name) => names.get(name) ?? name,
      );
    debugFunctions = describeFunctionDebug(
      native.value,
      optimizedModule.records ?? [],
      (span) => {
        const origin = locateSourceRange(ranges, span);
        if (origin === undefined) return undefined;
        const positionAt = positions.get(origin.module);
        const position =
          positionAt === undefined ? undefined : positionAt(origin.start);
        return position === undefined
          ? undefined
          : {
              file: origin.module,
              line: position.line,
              column: position.column,
            };
      },
      (name) => names.get(name) ?? name,
      (span, fallback) => {
        const origin = locateSourceRange(ranges, span);
        return origin === undefined
          ? fallback
          : (variableNames.get(
              origin.module + ":" + origin.start + ":" + origin.end,
            ) ?? fallback);
      },
    );
  }
  const managedSurfaces = publishedManagedSurfaces(
    surfacePlans,
    surfaceRuntimes,
  );
  return {
    ok: true,
    value: {
      native: native.value,
      symbols,
      lines,
      ...(debugFunctions.length === 0 ? {} : { debugFunctions }),
      ...(debugRecords.length === 0 ? {} : { debugRecords }),
      optimization: passes,
      initializer,
      entry: invocation < 0 ? undefined : invocation,
      exports: request.exports.slice(),
      ...(serviceIdentities.length === 0 ? {} : { serviceIdentities }),
      ...(managedSurfaces === undefined ? {} : { managedSurfaces }),
    },
  };
}
export {
  prepareNativeFunctionEntry,
  type PreparedNativeFunctionEntry,
  type NativeEntryPreparationOptions,
  compileClosedFunction,
  compileX64ClosedNumberFunction,
  compileClosedDynamicFunction,
  compileManagedGlobalAccessDynamicFunction,
  compileManagedReceiverWriteDynamicFunction,
  type ManagedReceiverWriteDynamicFunctionCode,
  type ManagedReceiverWriteDynamicFunctionCompilation,
  type ManagedGlobalAccessDynamicFunctionCode,
  type ManagedGlobalAccessDynamicFunctionCompilation,
  type ClosedFunctionCompilation,
  type ClosedDynamicFunctionCompilation,
  type ClosedDynamicFunctionCode,
  type ClosedFunctionOptions,
} from "./closed-functions.ts";
export {
  resolveManagedPointers,
  resolveX64ManagedPointers,
  managedIdentityByteLength,
  sameManagedRecordLayout,
  type ManagedIdentityShape,
  type ManagedIdentityBinding,
  type ManagedIdentityReader,
  type ManagedPointerResolution,
} from "./managed-imports.ts";
export {
  reifyManagedSurfaceTypes,
  prepareManagedSurfaceTypes,
  createManagedSurfaceFactory,
  createManagedSurfaceReflectors,
  createManagedSurfaceWitnessFactory,
  type ManagedSurfaceWitnessFactory,
  type ManagedSurfaceReflectors,
  type ManagedSurfaceIdentityReflector,
  type ManagedSurfacePreparation,
  type ManagedSurfaceFactory,
  type ManagedSurfaceTypeDescription,
  type ManagedSurfaceTypeRequest,
  type PreparedManagedSurfaceTypes,
  type ManagedSurfaceTypeEntry,
  type ManagedSurfaceTypes,
} from "./managed-surfaces.ts";
export {
  adaptManagedSurfaceEntry,
  type ManagedSurfaceEntryAdaptation,
} from "./managed-entry.ts";
export {
  canonicalizeManagedSurfaceTypes,
  serializeManagedSurfaceTypes,
  restoreManagedSurfaceTypes,
  type SerializedManagedSurfaceTypes,
  type ManagedSurfaceSerialization,
} from "./managed-surface-text.ts";
export {
  planManagedSurfaceContracts,
  type ManagedSurfaceContractClass,
  type ManagedSurfaceContractPlan,
  type ManagedSurfaceContracts,
  createManagedTypeContractIndex,
  type ManagedTypeContractComparison,
  type ManagedTypeContractIndex,
  type ManagedTypeContracts,
  createManagedTypeContractCache,
  type ManagedTypeContractCache,
} from "./managed-contracts.ts";

export {
  planManagedSignatureGroups,
  type ManagedSignatureGroupRequest,
  type CheckedManagedSignatureGroup,
  type ManagedSignatureGroupPlan,
} from "./managed-contracts.ts";

export {
  lowerManagedSignatureGroups,
  type LoweredManagedSignatureGroups,
} from "./managed-contracts.ts";
export {
  resolveManagedSurfaceSelections,
  prepareManagedSurfaceTable,
  type ManagedSurfaceTypeArgument,
  type ManagedSurfaceSelection,
  type ManagedSurfaceSelectionPlan,
  type ManagedSurfaceSelections,
} from "./managed-selections.ts";
export {
  deriveManagedSurfacePhysicalFacts,
  type ManagedSurfaceLayoutRuntime,
  type ManagedSurfacePhysicalFacts,
  type ManagedSurfacePhysicalDerivation,
} from "./managed-directory.ts";
export {
  managedSurfaceDirectoryVersion,
  encodeManagedSurfaceDirectory,
  digestManagedSurfaceDirectory,
  createManagedSurfaceDirectory,
  verifyManagedSurfacePhysicalAgreement,
  type ManagedSurfacePhysicalAgreement,
  type ManagedSurfaceDirectoryData,
  type SerializedManagedSurfaceDirectory,
  type ManagedSurfaceExport,
  type ManagedSurfaceDirectoryEncoding,
  type ManagedSurfaceDirectoryDigest,
  type ManagedSurfaceDirectoryPreparation,
  type ManagedSurfaceDirectoryCreation,
} from "./managed-directory-data.ts";
export {
  createManagedSurfaceAnchors,
  resolveManagedSurfaceAnchors,
  materializeManagedSurfaceTable,
  type ManagedSurfaceTableMaterialization,
  type ManagedSurfaceAnchorEntry,
  type ManagedSurfaceAnchorCreation,
  type ManagedSurfaceAnchorResolution,
} from "./managed-anchors.ts";
export {
  materializeManagedSurfaceExport,
  type ManagedSurfaceExportMaterialization,
} from "./managed-export-body.ts";
export type { ManagedSurfaceRequest } from "./managed-aot.ts";
export {
  readManagedSurfaceDirectory,
  managedSurfaceContract,
  selectManagedIdentityBindings,
  linkManagedSurfaceModule,
  linkX64ManagedSurfaceModule,
  type ManagedIdentitySelection,
  type ManagedSurfaceDirectoryHost,
  type ManagedSurfaceDirectoryRead,
  type ManagedSurfaceDirectoryReading,
} from "./managed-directory-reader.ts";

export {
  createRuntimeEntryStubs,
  resolveRuntimeEntryBindings,
} from "./managed-runtime-entries.ts";
export type {
  RuntimeEntryPlan,
  RuntimeEntryStub,
  RuntimeEntryPlanResult,
  RuntimeEntryABI,
} from "./managed-runtime-entries.ts";

export {
  planManagedSurfaceRuntimes,
  createManagedRuntimeAnchors,
  resolveManagedCollectionNames,
  resolveManagedRuntimeNames,
  materializeManagedRuntimeProviders,
  prepareManagedRuntimeEntries,
} from "./managed-runtimes.ts";
export type {
  ManagedRuntimeTypeSource,
  ManagedSurfaceRuntimeKey,
  ManagedRuntimeProviderKey,
  ManagedSurfaceRuntimeCensus,
  ManagedRuntimeAnchorPlan,
  ManagedRuntimeNamePlan,
  ManagedRuntimeProvider,
  ManagedRuntimeEntrySlots,
  ManagedRuntimeOperationABI,
} from "./managed-runtimes.ts";

export { normalizeManagedSurfaceApplications } from "./managed-applications.ts";
export type { ManagedSurfaceApplicationNormalization } from "./managed-applications.ts";

export { declareManagedJitRuntime } from "./managed-jit-runtime.ts";
export {
  createManagedCollectionPlanCache,
  type ManagedCollectionPlanCache,
} from "./managed-jit-program.ts";
// Entries of one compiler share the surface's type declarations.
export {
  createInterfaceResolutionCache,
  type InterfaceResolutionCache,
} from "@tint/typescript/checker";
export {
  prepareManagedSurfaceEntry,
  prepareX64ManagedSurfaceEntry,
  type ManagedSurfaceEntryRequest,
  type ManagedSurfaceEntryPreparation,
  type PreparedManagedSurfaceEntry,
} from "./managed-jit-entry.ts";
