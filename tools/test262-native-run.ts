import { startNativeHeartbeat } from "./test262-native-heartbeat.ts";
import { attributeNativeModule } from "./native-image-attribution.ts";
import { nativeVariantSelection } from "./native-variant-selection.ts";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { writeNodeExecutable } from "./node-file-host.ts";
import {
  frozenNativeRunIdentity,
  nativeReportTimes,
  sameNativeObservationInput,
  type NativeObservationInput as ObservationInput,
  type NativeObservation,
  type NativeCompilation,
} from "./native-run-journal.ts";
import {
  workspaceSources,
  readWorkspaceSourceSnapshot,
  saveWorkspaceSourceSnapshot,
  workspaceSourceIdentity,
} from "./workspace-sources.ts";
import { resolve } from "node:path";
import { prepareDateTimeNativeService } from "./date-time-native-service.ts";
import { test262Checkout, test262Source, within } from "./test262-checkout.ts";
import {
  testMetadata,
  type TestMetadata,
  type SyntaxVariant,
} from "./test262.ts";
import {
  executionPlan,
  judgeExecution,
  executionTotals,
  type ExecutionOutcome,
  type ExecutionPlan,
} from "./test262-execution.ts";
import {
  prepareNativeScripts,
  prepareNativeScriptProgram,
  prepareNativeModuleProgram,
  nativeModuleCapability,
  nativeVariantRoute,
  createNativeBatchBuilder,
  createNativeUnitBatchBuilder,
  unitHostCacheEntry,
  type NativeBatchBuild,
  deferNativeCase,
  type NativeModuleInput,
  type NativeTestCase,
  nativeTestResources,
  nativeTestTarget,
  capturedScriptEvaluation,
  nativeScriptAdapter,
  nativeDynamicImportCapability,
  nativeTopLevelAwaitCapability,
  nativeJSONModuleCapability,
  nativeSourcePhaseCapability,
  nativeAssetModuleCapability,
  nativeDeferredModuleCapability,
  nativeDebuggerEntitlement,
} from "./test262-native.ts";
import {
  NativeImageRunner,
  nativeDebuggerExecutable,
  nativeDebuggerTracing,
  nativeDebuggerLaunch,
  nativeDebuggerStdio,
  nativeExecutableWriteback,
  createNativeRunJournal,
  executeNativeFile,
  nativeTransportOutcome,
} from "./test262-native-process.ts";
import {
  nativeArtifact,
  runNativeBatch,
  type NativeResult,
} from "./native-target-runner.ts";
import { createNativeSyntaxBatchBuilder } from "./test262-native-syntax.ts";
import { buildWithBisection } from "./native-batch-bisect.ts";
import {
  createNativeSuiteBuilder,
  nativeSuiteSummary,
  runNativeSuite,
  type NativeSuiteCase,
} from "./test262-native-suite.ts";
import {
  pauseNativeRun,
  type NativeDiagnosticPause,
} from "./native-run-control.ts";
const [
  checkout,
  selection = "language/expressions/addition",
  batchArgument = "8",
] = process.argv.slice(2);
if (checkout === undefined)
  throw new Error(
    "usage: node tools/test262-native-run.ts <test262-checkout> [path-under-test] [batch-size]",
  );
const target = nativeTestTarget;
const transport = target.arch === "x86_64";
const runner = process.env.TINT_NATIVE_RUNNER;
// "prepare" compiles the linked-unit host into its cache and exits without
// running a case, so any host with the memory for it can precompile the
// Darwin host (TINT_NATIVE_TARGET=darwin-aarch64 off arm64); "require" fails
// instead of compiling a missing host.
const unitHostMode = process.env.TINT_TEST262_UNIT_HOST;
if (
  unitHostMode !== undefined &&
  unitHostMode !== "prepare" &&
  unitHostMode !== "require"
)
  throw Error("TINT_TEST262_UNIT_HOST must be prepare, require or unset");
const prepareUnitHostOnly = unitHostMode === "prepare";
if (!prepareUnitHostOnly) {
  if (transport) {
    if (
      runner !== "x64-local" &&
      runner !== "x64-qemu-dev" &&
      runner !== "x64-ssh"
    )
      throw Error(
        "Linux x86-64 Test262 requires an explicit x86-64 TINT_NATIVE_RUNNER",
      );
    if (nativeDebuggerLaunch !== "process" || process.env.TINT_TEST262_PAUSE)
      throw Error(
        "Linux x86-64 Test262 transport requires process launch without diagnostic pauses",
      );
  } else if (
    (target.name === "darwin-aarch64" &&
      (process.platform !== "darwin" || process.arch !== "arm64")) ||
    (target.name === "linux-aarch64" &&
      (process.platform !== "linux" || process.arch !== "arm64")) ||
    (target.name !== "darwin-aarch64" && target.name !== "linux-aarch64")
  ) {
    throw Error(
      "the Test262 adapter requires local Darwin arm64, Linux arm64 or a Linux x86-64 runner",
    );
  }
}
/** Concurrent native processes of a suite image (TINT_TEST262_SUITE_JOBS). */
function suiteJobs(): number {
  const value = process.env.TINT_TEST262_SUITE_JOBS ?? "6";
  if (!/^[1-9][0-9]{0,2}$/.test(value))
    throw Error("TINT_TEST262_SUITE_JOBS must be an integer in 1-999");
  return Number(value);
}
const heartbeat = startNativeHeartbeat(selection);
try {
  const suite = test262Checkout(checkout, selection),
    harnessRoot = resolve(suite.root, "harness"),
    variantManifest = process.env.TINT_TEST262_VARIANTS;
  const selected = nativeVariantSelection(
    suite.files.map((file) => {
      const { source, sha256 } = test262Source(file.filename);
      return { ...file, sha256, metadata: testMetadata(source) };
    }),
    selection,
    variantManifest === undefined
      ? undefined
      : JSON.parse(readFileSync(variantManifest, "utf8")),
  );
  const { files, totalVariants, subset } = selected;
  const batchSize = Number(batchArgument);
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 1024)
    throw new Error("batch size must be an integer between 1 and 1024");
  const restoredSource = process.env.TINT_TEST262_SOURCES;
  const capturedSource = process.env.TINT_TEST262_CAPTURE_SOURCES;
  const snapshot =
    restoredSource === undefined
      ? workspaceSources()
      : readWorkspaceSourceSnapshot(restoredSource);
  const moduleSwitch = process.env.TINT_TEST262_MODULES;
  if (moduleSwitch !== undefined && moduleSwitch !== "1")
    throw Error("TINT_TEST262_MODULES must be 1 or unset");
  const moduleExecution = moduleSwitch === "1";
  if (moduleExecution && !nativeModuleCapability(snapshot))
    throw Error(
      "module execution requires the captured module host capability",
    );
  if (capturedSource !== undefined)
    saveWorkspaceSourceSnapshot(capturedSource, snapshot);
  const sourceSnapshotFile = capturedSource ?? restoredSource;
  const diagnosticPauses: NativeDiagnosticPause[] = [];
  const sourceSnapshot = workspaceSourceIdentity(snapshot);
  const dynamicImport =
    moduleExecution && nativeDynamicImportCapability(snapshot);
  const topLevelAwait =
    moduleExecution && nativeTopLevelAwaitCapability(snapshot);
  const jsonModules = moduleExecution && nativeJSONModuleCapability(snapshot);
  const sourcePhases = moduleExecution && nativeSourcePhaseCapability(snapshot);
  const assetModules = moduleExecution && nativeAssetModuleCapability(snapshot);
  const deferredModules =
    moduleExecution && nativeDeferredModuleCapability(snapshot);
  const scriptEvaluation = capturedScriptEvaluation(snapshot);
  const engine = nativeScriptAdapter(
    scriptEvaluation,
    moduleExecution,
    dynamicImport,
    topLevelAwait,
    jsonModules,
    sourcePhases,
    deferredModules,
    assetModules,
  );
  const frozenToolchainSha256 = frozenNativeRunIdentity(
    import.meta.url,
    sourceSnapshot,
  );
  const runStartedAt = new Date().toISOString();
  const serviceMode = process.env.TINT_TEST262_NATIVE_SERVICES;
  if (
    serviceMode !== undefined &&
    serviceMode !== "aot" &&
    serviceMode !== "monolithic"
  )
    throw Error(
      "TINT_TEST262_NATIVE_SERVICES must be aot, monolithic or unset",
    );
  if (transport && serviceMode === "aot")
    throw Error("cached DateTimeFormat native-service images require arm64");
  const capturedDateTimeService = snapshot.inputs.some(
    (input) =>
      input.id ===
      "packages/js-runtime/src/objects/date-time-service-factory.ts",
  );
  if (serviceMode === "aot" && !capturedDateTimeService)
    throw Error("the captured runtime has no DateTimeFormat native service");
  let serviceImage: ReturnType<typeof prepareDateTimeNativeService> | undefined;
  if (!transport && capturedDateTimeService && serviceMode !== "monolithic") {
    if (frozenToolchainSha256 === undefined)
      throw Error("native service composition requires a frozen toolchain");
    heartbeat.phase("preparing cached DateTimeFormat native service");
    serviceImage = prepareDateTimeNativeService(
      snapshot,
      frozenToolchainSha256,
      resolve(
        process.env.TINT_NATIVE_SERVICE_CACHE ??
          ".tint-bootstrap/native-service-cache",
      ),
    );
  }
  const nativeLinkingIdentity =
    serviceImage?.identity ??
    ({
      nativeLinkingMode: "monolithic",
      nativeServiceUnitIndexSha256: null,
    } as const);
  // Script linking: "units" compiles the runtime host once and each Script as
  // a separately linked unit; "program" (default) compiles every batch as one
  // whole program; "suite" compiles the whole selection as one program (see
  // test262-native-suite.ts), ignoring the batch size.
  const scriptLinking = process.env.TINT_TEST262_LINKING ?? "program";
  if (
    scriptLinking !== "program" &&
    scriptLinking !== "units" &&
    scriptLinking !== "suite"
  )
    throw Error("TINT_TEST262_LINKING must be program, units, suite or unset");
  if (transport && scriptLinking === "suite")
    throw Error("Linux x86-64 Test262 does not support suite linking");
  if (unitHostMode !== undefined && scriptLinking !== "units")
    throw Error("TINT_TEST262_UNIT_HOST requires TINT_TEST262_LINKING=units");
  // Only a frozen toolchain identifies the host's compiler exactly.
  const unitHostCache =
    frozenToolchainSha256 === undefined
      ? undefined
      : {
          directory: resolve(
            process.env.TINT_TEST262_UNIT_HOST_CACHE ??
              ".tint-bootstrap/unit-host-cache",
          ),
          key: JSON.stringify([
            target.name,
            frozenToolchainSha256,
            sourceSnapshot.sha256,
            moduleExecution,
            nativeLinkingIdentity,
          ]),
          required: unitHostMode === "require",
        };
  if (unitHostMode !== undefined && unitHostCache === undefined)
    throw Error("TINT_TEST262_UNIT_HOST requires a frozen toolchain");
  if (prepareUnitHostOnly && unitHostCache !== undefined) {
    heartbeat.phase("preparing the linked-unit host");
    const started = performance.now();
    createNativeUnitBatchBuilder(snapshot, moduleExecution, serviceImage, {
      hostCache: unitHostCache,
    }).prepare();
    const { path } = unitHostCacheEntry(unitHostCache);
    const bytes = readFileSync(path);
    // Written synchronously: the process exits before any case would run.
    writeFileSync(
      process.stdout.fd,
      JSON.stringify({
        kind: "unit-host",
        frozenToolchainSha256,
        sourceSnapshot,
        ...nativeLinkingIdentity,
        path,
        bytes: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        preparationMs: Math.round(performance.now() - started),
      }) + "\n",
    );
    process.exit(0);
  }
  const { append: journal, checkpoint } = createNativeRunJournal(
    process.env.TINT_TEST262_JOURNAL,
    {
      kind: "start",
      schemaVersion: 2,
      startedAt: runStartedAt,
      frozenToolchainSha256,
      ...nativeLinkingIdentity,
      scriptLinking,
      nodeVersion: process.version,
      ...(transport ? { target: target.name, runner } : {}),
      debuggerTracing: nativeDebuggerTracing,
      revision: suite.revision,
      dirty: suite.dirty,
      selection,
      ...subset,
      batchSize,
      sourceSnapshot,
      sourceSnapshotFile,
      engine,
      debugger: nativeDebuggerExecutable,
      debuggerStdio: nativeDebuggerStdio,
      debuggerLaunch: nativeDebuggerLaunch,
      executableWriteback: nativeExecutableWriteback,
      debuggerStartupTimeoutMs: nativeTestResources.timeoutMs,
      debuggerEntitlement: nativeDebuggerEntitlement,
      executionResources: nativeTestResources,
    },
    { resume: process.env.TINT_TEST262_RESUME === "1" },
  );
  diagnosticPauses.push(...checkpoint.diagnosticPauses);
  const build = createNativeBatchBuilder(
    snapshot,
    moduleExecution,
    serviceImage,
  );
  const buildUnits =
    scriptLinking === "units"
      ? createNativeUnitBatchBuilder(
          snapshot,
          moduleExecution,
          serviceImage,
          unitHostCache === undefined ? {} : { hostCache: unitHostCache },
        )
      : undefined;
  const buildSyntax = createNativeSyntaxBatchBuilder(snapshot);
  const suiteFunctions = process.env.TINT_TEST262_SUITE_FUNCTIONS,
    suiteImage = process.env.TINT_TEST262_SUITE_IMAGE,
    suiteAttribution = process.env.TINT_TEST262_SUITE_ATTRIBUTION;
  const suiteMembers: {
    readonly item: PendingItem;
    readonly member: NativeSuiteCase;
  }[] = [];
  const observations: NativeObservation[] = checkpoint.observations.slice();
  const batches: NativeCompilation[] = checkpoint.batches.slice();
  const totals = executionTotals(observations.map((item) => item.status));
  const progress = {
    total: totalVariants,
    done: totals.total,
    pass: totals.passed,
    fail: totals.failed,
    unsupported: totals.unsupported,
    infra: totals.timeouts + totals.crashes + totals.harnessErrors,
  };
  heartbeat.counts(progress);
  let priorIndex = 0;
  /** The linked-unit host's one-time compilation or cache load; journaled on
   * the first units batch, never charged to a variant's execution. */
  let hostPreparationMs: number | undefined,
    hostPreparationJournaled = false;
  if (buildUnits !== undefined && unitHostMode === "require") {
    // Fail before any case when the precompiled host is missing.
    heartbeat.phase("loading the precompiled linked-unit host");
    const hostStarted = performance.now();
    buildUnits.prepare();
    hostPreparationMs = performance.now() - hostStarted;
  }
  /** Pending variants by how their batch is built. Each queue fills to the
   * batch size on its own, so interleaved kinds do not cut batches short. */
  type QueueKind = "syntax" | "units" | "program";
  const queues = new Map<
    QueueKind,
    {
      input: ObservationInput;
      prepared: NativeTestCase<NativeModuleInput> | undefined;
      plan: ExecutionPlan;
      started: number;
      /** Selection order, which the journal preserves for resume. */
      sequence: number;
      kind: QueueKind;
      /** Time spent compiling this case's Script units while routing it. */
      unitCompileMs: number;
    }[]
  >([
    ["syntax", []],
    ["units", []],
    ["program", []],
  ]);
  function queue(kind: QueueKind) {
    const items = queues.get(kind);
    if (items === undefined) throw Error("unknown native batch queue");
    return items;
  }
  // Observations are journaled in selection order (resume replays a prefix);
  // results of batches that complete early wait here for earlier variants.
  let nextSequence = 0,
    releaseSequence = 0;
  const held = new Map<number, NativeObservation>();
  function record(
    input: ObservationInput,
    outcome: ExecutionOutcome,
    started: number,
    sequence: number,
    batch?: number,
    details: object = {},
  ) {
    const status = judgeExecution(input.metadata, outcome);
    console.error(`${input.path} [${input.variant}]: ${status}`);
    held.set(sequence, {
      ...input,
      outcome,
      status,
      elapsedMs: performance.now() - started,
      ...(batch === undefined ? {} : { batch }),
      ...details,
      completedAt: new Date().toISOString(),
    });
    for (
      let observation = held.get(releaseSequence);
      observation !== undefined;
      observation = held.get(releaseSequence)
    ) {
      held.delete(releaseSequence);
      releaseSequence++;
      release(observation);
    }
  }
  function release(observation: NativeObservation) {
    const status = observation.status;
    observations.push(observation);
    progress.done++;
    if (status === "pass") progress.pass++;
    else if (status === "fail") progress.fail++;
    else if (status === "unsupported") progress.unsupported++;
    else progress.infra++;
    heartbeat.counts(progress);
    journal({ kind: "observation", ...observation });
  }
  function adapterCrash(error: unknown): ExecutionOutcome {
    return {
      kind: "crash",
      detail: "native adapter/compiler: " + String(error),
    };
  }
  type PendingItem = ReturnType<typeof queue>[number];
  type BuiltBatch = NativeBatchBuild & {
    readonly compilation: NativeCompilation;
  };
  function commitCompilation(compilation: NativeCompilation) {
    batches.push(compilation);
    journal({ kind: "compilation", compilation });
  }
  /** A failed compilation is journaled at once; a compiled batch's record
   * waits for staging so it can carry the image's launch admission time. */
  function compileGroup(group: readonly PendingItem[]): BuiltBatch {
    const id = batches.length;
    const started = performance.now();
    heartbeat.phase(`compiling batch ${id} (${group.length} variants)`);
    let built: NativeBatchBuild;
    try {
      const kind = group[0]!.kind;
      built =
        kind === "syntax"
          ? buildSyntax(group.map((item) => item.plan))
          : kind === "units" && buildUnits !== undefined
            ? buildUnits(group.map((item) => item.prepared!))
            : build(group.map((item) => item.prepared!));
    } catch (error) {
      built = { ok: false, outcome: adapterCrash(error) };
    }
    const compilation = {
      id,
      variants: group.length,
      kind:
        group[0]!.prepared === undefined
          ? ("syntax" as const)
          : ("execution" as const),
      compileMs: performance.now() - started,
      outcome: built.ok ? "compiled" : built.outcome.kind,
      ...(group[0]!.kind === "units"
        ? {
            linking: "units" as const,
            unitCompileMs: group.reduce(
              (total, item) => total + item.unitCompileMs,
              0,
            ),
          }
        : {}),
      ...(!hostPreparationJournaled && hostPreparationMs !== undefined
        ? { hostPreparationMs }
        : {}),
      ...(!built.ok && built.outcome.kind === "unsupported"
        ? { reason: built.outcome.reason }
        : {}),
      ...(built.ok && built.fallback !== undefined
        ? { fallback: built.fallback }
        : {}),
    };
    if ("hostPreparationMs" in compilation) hostPreparationJournaled = true;
    if (!built.ok) commitCompilation(compilation);
    return { ...built, compilation };
  }
  function executeGroup(group: readonly PendingItem[], built: BuiltBatch) {
    const id = built.compilation.id;
    let image: NativeImageRunner | undefined;
    let setupFailure: ExecutionOutcome | undefined;
    let transported: NativeResult[] | undefined;
    if (built.ok) {
      let admissionMs: number | undefined;
      try {
        heartbeat.phase(`staging batch ${id}`);
        if (transport) {
          const directory = mkdtempSync(
            resolve(tmpdir(), "tint-test262-transport-"),
          );
          try {
            const binary = resolve(directory, "batch");
            writeNodeExecutable(binary, built.bytes);
            const artifact = nativeArtifact(target.name, binary);
            heartbeat.phase(
              `executing batch ${id} (${runner}, ${group.length} variants)`,
            );
            transported = runNativeBatch(
              group.map((_, index) => ({
                artifact,
                args: [String(built.selectors?.[index] ?? index)],
                timeoutMs: nativeTestResources.timeoutMs,
              })),
            );
          } finally {
            rmSync(directory, { recursive: true, force: true });
          }
        } else {
          image = new NativeImageRunner(
            built.bytes,
            nativeTestResources.timeoutMs,
            nativeTestResources.admissionTimeoutMs,
          );
          heartbeat.phase(`admitting batch ${id} (first launch)`);
          const admission = image.admit();
          admissionMs = admission.admissionMs;
          if (!admission.admitted) setupFailure = admission.outcome;
        }
      } catch (error) {
        setupFailure = adapterCrash(error);
      }
      const first = transported?.[0];
      commitCompilation({
        ...built.compilation,
        ...(admissionMs === undefined ? {} : { admissionMs }),
        ...(first === undefined
          ? {}
          : {
              execution: {
                imageSha256: first.artifact.imageSha256,
                executor: first.executor,
              },
            }),
      });
    }
    try {
      for (const [index, item] of group.entries()) {
        pauseNativeRun(
          process.env.TINT_TEST262_PAUSE,
          (event) => {
            diagnosticPauses.push(event);
            journal(event);
          },
          (path) => heartbeat.phase("paused on " + path),
        );
        const execution = `executing ${item.input.path} [${item.input.variant}; flags=${item.input.metadata.flags.join(",")}]`;
        heartbeat.phase(execution);
        let outcome: ExecutionOutcome;
        try {
          outcome = !built.ok
            ? built.outcome
            : (setupFailure ??
              (transported === undefined
                ? image!.run(built.selectors?.[index] ?? index, (phase) =>
                    heartbeat.phase(execution + " (" + phase + ")"),
                  )
                : nativeTransportOutcome(transported[index]!)));
        } catch (error) {
          outcome = adapterCrash(error);
        }
        record(item.input, outcome, item.started, item.sequence, id);
      }
    } finally {
      image?.close();
    }
  }
  /** One shared image per batch; a failed build is bisected so only the
   * variants that do not compile receive the failure. */
  function flush(kind: QueueKind) {
    const items = queue(kind);
    if (items.length === 0) return;
    queues.set(kind, []);
    buildWithBisection(
      items,
      (group) => {
        const built = compileGroup(group);
        return built.ok
          ? { ok: true as const, value: built }
          : { ok: false as const, failure: built };
      },
      (group, result) =>
        executeGroup(group, result.ok ? result.value : result.failure),
    );
  }
  for (const {
    filename,
    path,
    metadata,
    variants,
    sha256: pinnedSha256,
  } of files) {
    heartbeat.phase("preparing " + path);
    const { source, sha256 } = test262Source(filename);
    if (sha256 !== pinnedSha256)
      throw Error("pinned native source changed during selection: " + path);
    for (const variant of variants) {
      const started = performance.now(),
        plan = executionPlan(source, variant, metadata);
      const harness = plan.harness.map((name) => ({
        filename: within(harnessRoot, name),
        ...test262Source(within(harnessRoot, name)),
      }));
      const route = nativeVariantRoute(metadata, variant, moduleExecution);
      let moduleProgram:
        | ReturnType<typeof prepareNativeModuleProgram>
        | { readonly thrown: unknown }
        | undefined;
      if (route === "module") {
        try {
          moduleProgram = prepareNativeModuleProgram(
            plan,
            harness,
            filename,
            undefined,
            jsonModules,
            assetModules,
          );
        } catch (error) {
          moduleProgram = { thrown: error };
        }
      }
      let scriptProgram:
        | ReturnType<typeof prepareNativeScriptProgram>
        | { readonly thrown: unknown }
        | undefined;
      if (route === "script" && dynamicImport) {
        try {
          scriptProgram = prepareNativeScriptProgram(
            plan,
            variant,
            harness,
            filename,
            undefined,
            jsonModules,
            scriptEvaluation?.dynamicImport === true,
            assetModules,
            scriptEvaluation?.shadowRealm === true,
          );
        } catch (error) {
          scriptProgram = { thrown: error };
        }
      }
      const scriptMetadata =
        scriptProgram === undefined || "thrown" in scriptProgram
          ? undefined
          : scriptProgram.ok
            ? scriptProgram.root
            : scriptProgram;
      const fixtures =
        moduleProgram === undefined || "thrown" in moduleProgram
          ? scriptMetadata?.fixtures
          : moduleProgram.fixtures;
      const absent =
        moduleProgram === undefined || "thrown" in moduleProgram
          ? scriptMetadata?.absent
          : moduleProgram.absent;
      const input: ObservationInput = {
        path,
        sha256,
        variant,
        metadata,
        canSuspend: plan.canSuspend,
        ...(fixtures !== undefined && fixtures.length > 0 ? { fixtures } : {}),
        ...(absent !== undefined && absent.length > 0 ? { absent } : {}),
        harness: harness.map((item, index) => ({
          name: plan.harness[index],
          sha256: item.sha256,
        })),
      };
      if (priorIndex < checkpoint.observations.length) {
        const prior = checkpoint.observations[priorIndex]!;
        if (!sameNativeObservationInput(prior, input))
          throw Error(
            "native resume source/harness prefix differs at " +
              path +
              " [" +
              variant +
              "]",
          );
        priorIndex++;
        continue;
      }
      if (checkpoint.complete)
        throw Error("completed native journal population differs");
      const sequence = nextSequence++;
      function enqueue(
        kind: QueueKind,
        prepared: NativeTestCase<NativeModuleInput> | undefined,
        unitCompileMs = 0,
      ) {
        const item = {
          input,
          plan,
          prepared,
          started,
          sequence,
          kind,
          unitCompileMs,
        };
        if (scriptLinking === "suite") {
          suiteMembers.push({
            item,
            member:
              prepared === undefined
                ? { kind: "early-error", plan }
                : { kind: "execution", prepared },
          });
          return;
        }
        const items = queue(kind);
        items.push(item);
        if (items.length === batchSize) flush(kind);
      }
      try {
        if (route === "syntax") enqueue("syntax", undefined);
        else {
          let prepared:
            | { readonly ok: true; readonly value: NativeTestCase }
            | { readonly ok: false; readonly outcome: ExecutionOutcome };
          if (route === "module") {
            if (moduleProgram === undefined)
              throw Error("module preparation result is missing");
            if ("thrown" in moduleProgram) throw moduleProgram.thrown;
            prepared = moduleProgram.ok
              ? {
                  ok: true,
                  value: {
                    scripts: moduleProgram.harness,
                    modules: moduleProgram.entries,
                    ...(moduleProgram.absent === undefined
                      ? {}
                      : { moduleAbsent: moduleProgram.absent }),
                    asynchronous: plan.asynchronous,
                    canSuspend: plan.canSuspend,
                  },
                }
              : moduleProgram;
          } else if (dynamicImport) {
            if (scriptProgram === undefined)
              throw Error("Script preparation result is missing");
            if ("thrown" in scriptProgram) throw scriptProgram.thrown;
            prepared = scriptProgram.ok
              ? {
                  ok: true,
                  value: {
                    scripts: scriptProgram.scripts,
                    asynchronous: plan.asynchronous,
                    canSuspend: plan.canSuspend,
                    ...(scriptProgram.root === undefined
                      ? {}
                      : {
                          modules: scriptProgram.root.entries,
                          scriptRoot: { absent: scriptProgram.root.absent },
                        }),
                  },
                }
              : scriptProgram;
          } else {
            const scripts = prepareNativeScripts(plan, variant, harness);
            prepared = scripts.ok
              ? {
                  ok: true,
                  value: {
                    scripts: scripts.modules,
                    asynchronous: plan.asynchronous,
                    canSuspend: plan.canSuspend,
                  },
                }
              : scripts;
          }
          if (prepared.ok) {
            let units = false,
              unitCompileMs = 0;
            if (buildUnits !== undefined) {
              if (hostPreparationMs === undefined) {
                heartbeat.phase("preparing the linked-unit host");
                const hostStarted = performance.now();
                buildUnits.prepare();
                hostPreparationMs = performance.now() - hostStarted;
              }
              const routeStarted = performance.now();
              units = buildUnits.accepts(prepared.value);
              unitCompileMs = performance.now() - routeStarted;
            }
            enqueue(
              units ? "units" : "program",
              deferNativeCase(prepared.value),
              unitCompileMs,
            );
          } else
            record(
              input,
              prepared.outcome,
              started,
              sequence,
              undefined,
              scriptLinking === "suite" &&
                prepared.outcome.kind === "unsupported"
                ? {
                    buildFailure: {
                      stage: "preparation",
                      message: prepared.outcome.reason,
                    },
                  }
                : {},
            );
        }
      } catch (error) {
        record(input, adapterCrash(error), started, sequence);
      }
    }
  }
  if (priorIndex !== checkpoint.observations.length)
    throw Error("native resume prefix extends outside selection");
  for (const kind of queues.keys()) flush(kind);
  if (suiteMembers.length > 0)
    await runNativeSuite({
      members: suiteMembers.map((entry) => entry.member),
      build: createNativeSuiteBuilder(
        snapshot,
        moduleExecution,
        serviceImage,
        undefined,
        // Analysis: TINT_TEST262_SUITE_FUNCTIONS names a new JSON file for
        // the suite image's emitted function sizes.
        suiteFunctions === undefined
          ? undefined
          : (functions) =>
              writeFileSync(suiteFunctions, JSON.stringify(functions), {
                flag: "wx",
              }),
        // Analysis: TINT_TEST262_SUITE_ATTRIBUTION names a new JSON file for
        // the program module's per-function code and safepoint-map bytes.
        suiteAttribution === undefined
          ? undefined
          : (compiled) =>
              writeFileSync(
                suiteAttribution,
                JSON.stringify(attributeNativeModule(compiled.program.native)),
                { flag: "wx" },
              ),
      ),
      nextCompilation: () => batches.length,
      compilation: (compilation) => {
        batches.push(compilation);
        journal({ kind: "compilation", compilation });
      },
      phase: (phase) => heartbeat.phase(phase),
      ...(nativeDebuggerLaunch === "process"
        ? {}
        : {
            execute: (binary: string, selector: string) =>
              executeNativeFile(
                binary,
                nativeTestResources.timeoutMs,
                selector,
              ),
          }),
      timeoutMs: nativeTestResources.timeoutMs,
      admissionTimeoutMs: nativeTestResources.admissionTimeoutMs,
      jobs: suiteJobs(),
      // Analysis: TINT_TEST262_SUITE_IMAGE names a new file for the image.
      ...(suiteImage === undefined
        ? {}
        : {
            saveImage: (bytes: Uint8Array) =>
              writeNodeExecutable(suiteImage, bytes, true),
          }),
      record: (index, outcome, batch, details) => {
        const { item } = suiteMembers[index]!;
        record(
          item.input,
          outcome,
          item.started,
          item.sequence,
          batch,
          details,
        );
      },
    });
  if (held.size !== 0 || releaseSequence !== nextSequence)
    throw Error("native observations were not all released in order");
  if (observations.length !== totalVariants)
    throw Error("native selection did not observe every requested variant");
  let runCompletedAt: string | undefined;
  if (!checkpoint.complete) {
    runCompletedAt = new Date().toISOString();
    journal({
      kind: "complete",
      totals: executionTotals(observations.map((item) => item.status)),
      completedAt: runCompletedAt,
    });
  }
  heartbeat.phase("writing report");
  console.log(
    JSON.stringify(
      {
        schemaVersion: 1,
        kind: "runtime-execution",
        ...nativeReportTimes(checkpoint, runStartedAt, runCompletedAt),
        engine: {
          name: "Tint",
          adapter: engine,
          target: transport ? target.name : "macos-arm64",
          ...(transport ? { runner } : {}),
          bootstrap: process.version,
          debugger: nativeDebuggerExecutable,
          debuggerStdio: nativeDebuggerStdio,
          debuggerLaunch: nativeDebuggerLaunch,
          debuggerTracing: nativeDebuggerTracing,
          executableWriteback: nativeExecutableWriteback,
          debuggerStartupTimeoutMs: nativeTestResources.timeoutMs,
          debuggerEntitlement: nativeDebuggerEntitlement,
        },
        scope:
          (subset === undefined ? "" : "Explicit variant subset. ") +
          (selection === "." && subset === undefined
            ? "Complete pinned suite. "
            : "Selected variants only; no whole-suite coverage claim. ") +
          "Each supported variant runs in an isolated native process. Synchronous and Promise-job asynchronous Scripts use parsed strictness and unchanged harness sources. Parse/early-negative tests use native syntax validation without evaluation. Unsupported module execution, agents, lowering and runtime operations, as well as harness errors, crashes and timeouts remain in the totals." +
          (scriptEvaluation?.shadowRealm === true
            ? " ShadowRealm hosts create isolated globals and module records, wrap callable values freshly in both directions, copy execution errors and preserve syntax-error phases."
            : "") +
          (assetModules
            ? " Module requests retain source, defer and evaluation phases. Deferred namespaces evaluate on string operations except then; asynchronous transitive dependencies evaluate eagerly. The loader provides AbstractModuleSource and its Test262 host representation; JavaScript source requests reject with SyntaxError. JSON, text and immutable bytes modules use type-specific identities and native synthetic default exports. Attributes, top-level await and direct eval are enabled."
            : deferredModules
              ? " Module requests retain source, defer and evaluation phases. Deferred namespaces trigger synchronous evaluation on string operations except then; asynchronous transitive dependencies evaluate eagerly. The loader provides the Test262 module-source host representation and AbstractModuleSource intrinsic; JavaScript source requests reject with SyntaxError. JSON, attributes, top-level await and direct eval are enabled. Text/bytes and undiscovered relative specifiers remain unsupported."
              : sourcePhases
                ? " Module and Script-root imports preserve source/evaluation phases. Source Text Modules reject source requests with SyntaxError without linking or evaluation; the Test262 host provides its <module source> representation and realm-owned AbstractModuleSource intrinsic. JSON, attributes, top-level await and direct eval are enabled. Defer phases, text/bytes and undiscovered relative specifiers remain unsupported."
                : engine === "native-script-v18-managed-dynamic-import" ||
                    engine === "native-script-v19-managed-templates"
                  ? (engine === "native-script-v19-managed-templates"
                      ? " Runtime-compiled tagged templates retain parsed-unit site identity and use the existing realm template cache."
                      : "") +
                    (moduleExecution
                      ? " Module and Script-root dynamic imports use a lazy sibling table loader, including imports from runtime-compiled eval and Function bodies. Import helpers and checked referrer views come from the image-owned managed surface. JSON/type validation, top-level await and direct eval are enabled. Proposal phases, text/bytes and undiscovered relative specifiers stay unsupported."
                      : " Runtime compilation uses the image-owned import helper and checked referrer views. This run leaves the module loader disabled; static and dynamic module loading remain unsupported.")
                  : engine === "native-script-v17-import-resolution"
                    ? " Module and Script-root dynamic imports use checked referrer views and a lazy sibling table loader. JSON is parsed natively at load and exposes one default export; type attributes are checked before cached records are used. Unresolved bare specifiers reject their import promises with TypeError. Source modules support top-level await and direct eval. Text/bytes, source/defer phases, undiscovered relative specifiers and runtime compilation of loaded modules remain unsupported. Native fixture syntax and early-error checks remain lazy at load."
                    : engine === "native-script-v15-top-level-await"
                      ? " Module and Script-root dynamic imports use checked referrer views and a lazy sibling table loader. Async module evaluation drains the existing job queue. Native fixture syntax and early-error checks remain lazy at load. JSON, attributes beyond option validation and proposal phases remain unsupported."
                      : engine === "native-script-v14-fixture-binding-verdicts"
                        ? " Module and Script-root dynamic imports use the captured runtime, checked referrer views and lazy sibling table loader. Literal absent siblings and empty specifiers reject with TypeError; other undiscovered specifiers remain unsupported. Native fixture syntax checks remain lazy at load. JSON, attributes beyond option validation, top-level await and proposal phases remain unsupported."
                        : moduleExecution
                          ? " Module variants load sibling fixtures through a synchronous table loader; fixtures that bootstrap cannot parse are judged only by the native syntax verdict at load, and native acceptance stays unsupported; JSON, attributes, top-level await, import() and import.meta are unsupported."
                          : ""),
        variantPolicy:
          (subset === undefined
            ? "All syntaxVariants from tools/test262.ts; "
            : "Every explicit manifest entry validated against pinned paths, source hashes and syntaxVariants; ") +
          "raw/strict/sloppy/module flags retained; fixture files excluded. Syntax-negative files precede execution files, preserving file order within each lane. No unsupported or failed variants excluded from the denominator.",
        sourceSnapshot,
        sourceSnapshotFile,
        frozenToolchainSha256,
        ...nativeLinkingIdentity,
        resumption: {
          restoredVariants: checkpoint.observations.length,
          events: checkpoint.resumptions,
        },
        diagnosticPauses,
        revision: suite.revision,
        executionResources: nativeTestResources,
        compilation: {
          batchSize,
          batches,
          failurePolicy:
            scriptLinking === "suite"
              ? "One suite image holds every selected variant. A build failure is attributed to the variants whose modules the compiler names (otherwise bisected, diagnostically, to one variant), recorded with its compiler error and excluded from the rebuilt image; it is never executed elsewhere."
              : "A failed batch compilation is bisected until each failure is attributed to a single-variant build.",
          ...(scriptLinking === "suite"
            ? { suite: nativeSuiteSummary(observations) }
            : {}),
        },
        dirty: suite.dirty,
        selection:
          subset === undefined
            ? selection
            : selection + " [explicit variant subset]",
        ...(subset === undefined ? {} : { ...subset, complete: true }),
        totals: executionTotals(observations.map((item) => item.status)),
        observations,
      },
      null,
      2,
    ),
  );
} finally {
  await heartbeat.close();
}
