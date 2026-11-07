import { startNativeHeartbeat } from "./test262-native-heartbeat.ts";
import { nativeVariantSelection } from "./native-variant-selection.ts";
import { readFileSync } from "node:fs";
import {
  frozenNativeRunIdentity,
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
  type NativeTestCase,
  nativeTestResources,
  capturedScriptEvaluation,
  nativeScriptAdapter,
  nativeDynamicImportCapability,
  nativeTopLevelAwaitCapability,
  nativeJSONModuleCapability,
  nativeSourcePhaseCapability,
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
} from "./test262-native-process.ts";
import { createNativeSyntaxBatchBuilder } from "./test262-native-syntax.ts";
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
if (process.platform !== "darwin" || process.arch !== "arm64")
  throw new Error("native adapter currently requires macOS arm64");
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
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 64)
    throw new Error("batch size must be an integer between 1 and 64");
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
  );
  const nativeLinkingIdentity = {
    nativeLinkingMode: "monolithic",
    nativeServiceUnitIndexSha256: null,
  } as const;
  const frozenToolchainSha256 = frozenNativeRunIdentity(
    import.meta.url,
    sourceSnapshot,
  );
  const { append: journal, checkpoint } = createNativeRunJournal(
    process.env.TINT_TEST262_JOURNAL,
    {
      kind: "start",
      schemaVersion: 2,
      frozenToolchainSha256,
      ...nativeLinkingIdentity,
      nodeVersion: process.version,
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
  const build = createNativeBatchBuilder(snapshot, moduleExecution);
  const buildSyntax = createNativeSyntaxBatchBuilder(snapshot);
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
  let pending: {
    input: ObservationInput;
    prepared: NativeTestCase | undefined;
    plan: ExecutionPlan;
    started: number;
  }[] = [];
  function record(
    input: ObservationInput,
    outcome: ExecutionOutcome,
    started: number,
    batch?: number,
  ) {
    const status = judgeExecution(input.metadata, outcome);
    console.error(`${input.path} [${input.variant}]: ${status}`);
    const observation = {
      ...input,
      outcome,
      status,
      elapsedMs: performance.now() - started,
      ...(batch === undefined ? {} : { batch }),
    };
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
  function flush() {
    if (pending.length === 0) return;
    const id = batches.length;
    const started = performance.now();
    heartbeat.phase(`compiling batch ${id} (${pending.length} variants)`);
    let built: ReturnType<typeof build>;
    try {
      built =
        pending[0]!.prepared === undefined
          ? buildSyntax(pending.map((item) => item.plan))
          : build(pending.map((item) => item.prepared!));
    } catch (error) {
      built = { ok: false, outcome: adapterCrash(error) };
    }
    const compilation = {
      id,
      variants: pending.length,
      kind:
        pending[0]!.prepared === undefined
          ? ("syntax" as const)
          : ("execution" as const),
      compileMs: performance.now() - started,
      outcome: built.ok ? "compiled" : built.outcome.kind,
    };
    batches.push(compilation);
    journal({ kind: "compilation", compilation });
    let image: NativeImageRunner | undefined;
    let setupFailure: ExecutionOutcome | undefined;
    if (built.ok) {
      try {
        heartbeat.phase(`staging batch ${id}`);
        image = new NativeImageRunner(
          built.bytes,
          nativeTestResources.timeoutMs,
        );
      } catch (error) {
        setupFailure = adapterCrash(error);
      }
    }
    try {
      for (const [index, item] of pending.entries()) {
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
              image!.run(index, (phase) =>
                heartbeat.phase(execution + " (" + phase + ")"),
              ));
        } catch (error) {
          outcome = adapterCrash(error);
        }
        record(item.input, outcome, item.started, id);
      }
    } finally {
      image?.close();
    }
    pending = [];
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
      try {
        if (route === "syntax") {
          if (pending[0]?.prepared !== undefined) flush();
          pending.push({ input, plan, prepared: undefined, started });
          if (pending.length === batchSize) flush();
        } else {
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
            if (pending.length > 0 && pending[0]!.prepared === undefined)
              flush();
            pending.push({
              plan,
              input,
              prepared: prepared.value,
              started,
            });
            if (pending.length === batchSize) flush();
          } else {
            flush();
            record(input, prepared.outcome, started);
          }
        }
      } catch (error) {
        flush();
        record(input, adapterCrash(error), started);
      }
    }
  }
  if (priorIndex !== checkpoint.observations.length)
    throw Error("native resume prefix extends outside selection");
  flush();
  if (observations.length !== totalVariants)
    throw Error("native selection did not observe every requested variant");
  if (!checkpoint.complete)
    journal({
      kind: "complete",
      totals: executionTotals(observations.map((item) => item.status)),
    });
  heartbeat.phase("writing report");
  console.log(
    JSON.stringify(
      {
        schemaVersion: 1,
        kind: "runtime-execution",
        engine: {
          name: "Tint",
          adapter: engine,
          target: "macos-arm64",
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
          (deferredModules
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
            "A failed batch compilation is retained for every affected variant; no automatic retry.",
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
