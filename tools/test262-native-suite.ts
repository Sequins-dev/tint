/**
 * Program-mode Test262 as one suite image: the engine and every selected
 * variant compiled once as a single whole program, each variant selected by
 * its index in the process argument and run in a fresh process.
 *
 * Execution variants keep the whole-program batch semantics of
 * prepareNativeBatch (identical lowered Scripts, such as shared harness files,
 * are one module; every case still gets its own fresh realm at run time).
 * Parse/early-negative variants are embedded as source text and passed at run
 * time to the engine's own runtime compiler front end (the path eval and
 * $262.evalScript use): parse and early errors only, never evaluation.
 *
 * Build failures are not outcomes: a variant that breaks the whole-program
 * compile is attributed (by the compiler's failing module, or by diagnostic
 * bisection when the failure names none), recorded with its compiler error,
 * and the image is rebuilt without it.
 */
import { spawn } from "node:child_process";
import {
  compileMacOSProgram,
  linkMacOSProgram,
  type CompiledMacOSProgram,
  type ImageFunctionRange,
} from "@tint/compiler/build";
import type { SourceModule } from "@tint/typescript/modules/model";
import type { ExecutionOutcome, ExecutionPlan } from "./test262-execution.ts";
import {
  nativeBatchConfiguration,
  nativeBatchImageRequest,
  nativeExitOutcome,
  parsedNativeHost,
  prepareConfiguredBatch,
  type NativeTestCase,
} from "./test262-native.ts";
import type { WorkspaceSourceSnapshot } from "./workspace-sources.ts";

/** One suite member: an execution case or a parse/early-negative plan. */
export type NativeSuiteCase =
  | { readonly kind: "execution"; readonly prepared: NativeTestCase }
  | { readonly kind: "early-error"; readonly plan: ExecutionPlan };

export interface NativeSuiteBuildFailure {
  readonly stage: string;
  readonly message: string;
  readonly module?: string;
}

/** Where the program's native module bytes go (code, safepoint tables,
 * literals and descriptors), for scaling measurements. */
export interface NativeSuiteStatistics {
  readonly moduleBytes: number;
  readonly functions: number;
  readonly functionBytes: number;
  readonly initializerBytes: number;
  readonly largestFunctionBytes: number;
  readonly stackMapBytes: number;
  readonly safepoints: number;
  readonly strings: number;
  readonly stringBytes: number;
  readonly records: number;
  readonly recordBytes: number;
  readonly signatures: number;
}
function nativeStatistics(
  compiled: CompiledMacOSProgram,
): NativeSuiteStatistics {
  const native = compiled.program.native;
  let functionBytes = 0,
    largest = 0,
    stackMapBytes = 0,
    safepoints = 0,
    stringBytes = 0,
    recordBytes = 0;
  for (const fn of native.functions) {
    functionBytes += fn.byteLength;
    largest = Math.max(largest, fn.byteLength);
  }
  for (const table of native.stackMaps) {
    stackMapBytes += table.byteLength;
    safepoints += table.entries;
  }
  for (const literal of native.strings) stringBytes += literal.byteLength;
  for (const record of native.records) recordBytes += record.byteLength;
  return {
    moduleBytes: native.code.length,
    functions: native.functions.length,
    functionBytes,
    initializerBytes:
      native.functions[compiled.program.initializer]?.byteLength ?? 0,
    largestFunctionBytes: largest,
    stackMapBytes,
    safepoints,
    strings: native.strings.length,
    stringBytes,
    records: native.records.length,
    recordBytes,
    signatures: native.signatures.length,
  };
}
/** The compiler's failure, with the members it is attributed to (empty when
 * the failing module is not one member's). */
export type NativeSuiteBuild =
  | {
      readonly ok: true;
      readonly bytes: Uint8Array;
      readonly modules: number;
      readonly stages: readonly { stage: string; ms: number }[];
      readonly native?: NativeSuiteStatistics;
    }
  | {
      readonly ok: false;
      readonly error: NativeSuiteBuildFailure;
      readonly culprits: readonly number[];
      readonly stages: readonly { stage: string; ms: number }[];
    };

const suiteEntry = "test262-host";
const earlyRejectionModule = "test262-suite-early";
/** Fan-out of each dispatch level: selection costs at most this many
 * comparisons per level, and no dispatch function grows with the suite. */
const dispatchFanOut = 64;

const earlyCaseId = (index: number) => `test262-case-${index}-host`;

/** Run-time front end for parse/early-negative sources: the same parse and
 * lowering (binding, early errors) the in-image Script evaluator applies
 * before it compiles an entry. Nothing is compiled or evaluated.
 * Exit statuses follow the syntax host: 40 rejected with SyntaxError at
 * parse/early-error time, 42 accepted, 10 unsupported. */
function earlyRejectionHost(): SourceModule {
  return parsedNativeHost(
    earlyRejectionModule,
    `import {createSourceTextView} from "source";
import {parseScript,parseModule} from "syntax";
import {lowerScript,lowerSourceTextModule} from "lowering";
export function rejectEarly(text:string,module:boolean):number{
 const view=createSourceTextView(text);
 const parsed=module?parseModule(view,"javascript"):parseScript(view);
 if(!parsed.ok)return parsed.error.code==="SYNTAX_ERROR"||parsed.error.code==="LEXICAL_ERROR"?40:10;
 const lowered=module?lowerSourceTextModule(parsed.value,text):lowerScript(parsed.value,text,{runtimeCompiled:true});
 if(lowered.ok)return 42;
 return lowered.error.code==="EARLY_ERROR"?40:10;
}`,
    new Map([
      ["source", "packages/source/src/text.ts"],
      ["syntax", "packages/typescript/src/syntax/index.ts"],
      ["lowering", "packages/js-engine/src/lowering/index.ts"],
    ]),
  );
}
function earlyCaseHost(index: number, plan: ExecutionPlan): SourceModule {
  return parsedNativeHost(
    earlyCaseId(index),
    `import {rejectEarly} from "early";
export function run():number{return rejectEarly(${JSON.stringify(plan.source)},${plan.goal === "module" ? "true" : "false"});}`,
    new Map([["early", earlyRejectionModule]]),
  );
}

/** A dispatch tree over the case hosts: leaves call `run` of up to
 * `dispatchFanOut` hosts by relative index; inner levels route by range. */
export function suiteDispatchModules(
  hosts: readonly string[],
  agentRuntime: string | undefined,
): SourceModule[] {
  if (hosts.length === 0) throw Error("empty Test262 suite");
  const modules: SourceModule[] = [];
  let level = hosts.map((id) => ({ id, name: "run", size: 1 }));
  for (let depth = 0; level.length > 1; depth++) {
    const next: { id: string; name: string; size: number }[] = [];
    for (let start = 0; start < level.length; start += dispatchFanOut) {
      const children = level.slice(start, start + dispatchFanOut),
        id = `test262-suite-select-${depth}-${next.length}`;
      let offset = 0;
      const branches = children.map((child, index) => {
        const call =
          child.size === 1
            ? `return child${index}();`
            : `return child${index}(selected-${offset});`;
        const test =
          child.size === 1
            ? `if(selected===${offset})`
            : `if(selected<${offset + child.size})`;
        offset += child.size;
        return test + call;
      });
      modules.push(
        parsedNativeHost(
          id,
          `${children.map((child, index) => `import {${child.name} as child${index}} from ${JSON.stringify(child.id)};`).join("\n")}
export function select(selected:number):number{
 ${branches.join("\n ")}
 return 99;
}`,
          new Map(children.map((child) => [child.id, child.id])),
        ),
      );
      next.push({ id, name: "select", size: offset });
    }
    level = next;
  }
  const root = level[0]!;
  const call = root.size === 1 ? "(selected===0?root():99)" : "root(selected)";
  modules.push(
    parsedNativeHost(
      suiteEntry,
      `import {${root.name} as root} from ${JSON.stringify(root.id)};
${agentRuntime === undefined ? "" : `import {runNativeAgent,finishNativeAgents} from "agent-runtime";`}
import {argumentCount,argumentByteLength,copyArgument} from "process";
export function run(${agentRuntime === undefined ? "" : "argument:number"}):number {
 ${agentRuntime === undefined ? "" : "if(argument!==0)return runNativeAgent(argument);"}
 if(argumentCount()!==2)return 99;
 const length=argumentByteLength(1);
 if(length<1||length>9)return 99;
 const bytes=new Uint8Array(length);
 if(copyArgument(1,bytes)!==length)return 99;
 let selected=0;
 for(let i=0;i<length;i++){
  const digit=bytes[i];
  if(digit===undefined||digit<48||digit>57)return 99;
  selected=selected*10+digit-48;
 }
 if(selected>=${root.size})return 99;
 ${agentRuntime === undefined ? `return ${call};` : `try{return ${call};}finally{finishNativeAgents();}`}
}`,
      new Map([
        ["process", "packages/native-runtime/src/intrinsics/process.ts"],
        [root.id, root.id],
        ...(agentRuntime === undefined
          ? []
          : [["agent-runtime", agentRuntime] as [string, string]]),
      ]),
    ),
  );
  return modules;
}

/** Map each generated module to the suite members that depend on it. */
function memberOwners(modules: readonly SourceModule[]): Map<string, number[]> {
  const owners = new Map<string, number[]>();
  for (const module of modules) {
    const match = /^test262-case-(\d+)-/.exec(module.id);
    if (match === null) continue;
    const member = Number(match[1]);
    for (const id of [module.id, ...module.dependencies.values()]) {
      if (!id.startsWith("test262-")) continue;
      const list = owners.get(id) ?? [];
      if (!list.includes(member)) list.push(member);
      owners.set(id, list);
    }
  }
  return owners;
}

export function createNativeSuiteBuilder(
  snapshot: WorkspaceSourceSnapshot,
  moduleExecution: boolean,
  serviceImage?: import("./native-service-image.ts").NativeServiceImagePlan,
  report: (stage: string) => void = () => {},
  /** Analysis: receives every emitted function of a successful build. */
  onEmittedFunctions?: (functions: readonly ImageFunctionRange[]) => void,
) {
  const config = nativeBatchConfiguration(snapshot, moduleExecution);
  const request = nativeBatchImageRequest(
    snapshot,
    moduleExecution,
    serviceImage,
    config,
  );
  /** The program for members in order; member i is selected by index i. */
  function modulesFor(cases: readonly NativeSuiteCase[]): SourceModule[] {
    const executions = cases.flatMap((item, index) =>
      item.kind === "execution" ? [{ index, prepared: item.prepared }] : [],
    );
    const modules: SourceModule[] = [];
    if (executions.length > 0) {
      const batch = prepareConfiguredBatch(
        executions.map((item) => item.prepared),
        moduleExecution,
        config,
      );
      // prepareNativeBatch numbers its case hosts by batch position and ends
      // with its flat selector, which the dispatch tree replaces.
      const selector = batch.pop();
      if (selector?.id !== suiteEntry)
        throw Error("native batch layout changed: missing selector host");
      const renamed = new Map<string, string>();
      for (const [position, item] of executions.entries())
        renamed.set(`test262-case-${position}-`, `test262-case-${item.index}-`);
      const rename = (id: string) => {
        const match = /^test262-case-(\d+)-/.exec(id);
        return match === null
          ? id
          : renamed.get(match[0])! + id.slice(match[0].length);
      };
      for (const module of batch)
        modules.push({
          ...module,
          id: rename(module.id),
          dependencies: new Map(
            [...module.dependencies].map(([name, id]) => [name, rename(id)]),
          ),
        });
    }
    if (cases.some((item) => item.kind === "early-error")) {
      if (executions.length === 0)
        throw Error("a suite of only early-error cases has no runtime host");
      modules.push(earlyRejectionHost());
      for (const [index, item] of cases.entries())
        if (item.kind === "early-error")
          modules.push(earlyCaseHost(index, item.plan));
    }
    modules.push(
      ...suiteDispatchModules(
        cases.map((_, index) => earlyCaseId(index)),
        config.agentProvider === undefined ? undefined : "test262-runtime",
      ),
    );
    return modules;
  }
  return (cases: readonly NativeSuiteCase[]): NativeSuiteBuild => {
    const modules = modulesFor(cases);
    const stages: { stage: string; ms: number }[] = [];
    let current = { stage: "front end", started: performance.now() };
    const base = request(modules);
    const buildRequest = {
      ...base,
      ...(onEmittedFunctions === undefined ? {} : { onEmittedFunctions }),
      report: (stage: string) => {
        const now = performance.now();
        stages.push({ stage: current.stage, ms: now - current.started });
        current = { stage, started: now };
        report(stage);
        base.report(stage);
      },
    };
    const compiled = compileMacOSProgram(buildRequest);
    const built = compiled.ok
      ? linkMacOSProgram(compiled.value, buildRequest)
      : compiled;
    stages.push({
      stage: current.stage,
      ms: performance.now() - current.started,
    });
    if (built.ok)
      return {
        ok: true,
        bytes: built.value,
        modules: modules.length,
        stages,
        ...(compiled.ok ? { native: nativeStatistics(compiled.value) } : {}),
      };
    const error = built.error as NativeSuiteBuildFailure;
    const culprits =
      error.module === undefined
        ? []
        : (memberOwners(modules).get(error.module) ?? []);
    return {
      ok: false,
      error: {
        stage: error.stage,
        message: error.message,
        ...(error.module === undefined ? {} : { module: error.module }),
      },
      culprits,
      stages,
    };
  };
}

/** Failures of the suite program as a whole rather than of a member: a
 * compiler resource limit, or an error in the suite's own dispatch modules. */
export function globalSuiteFailure(error: NativeSuiteBuildFailure): boolean {
  return (
    /\blimit\b/i.test(error.message) ||
    (error.module !== undefined &&
      (error.module === suiteEntry ||
        error.module === earlyRejectionModule ||
        error.module.startsWith("test262-suite-select-")))
  );
}
/** Attribute build failures to members, then build the rest. A failure that
 * names a member's module excludes it directly; otherwise the failing set is
 * bisected (diagnostic only: halves are compiled, not executed) down to one
 * member. Each excluded member keeps its compiler error. */
export function buildSuiteExcludingFailures(
  count: number,
  build: (members: readonly number[]) => NativeSuiteBuild,
  onAttempt: (members: number, result: NativeSuiteBuild) => void = () => {},
): {
  readonly image:
    | {
        readonly members: readonly number[];
        readonly build: NativeSuiteBuild & { ok: true };
      }
    | undefined;
  readonly failures: ReadonlyMap<number, NativeSuiteBuildFailure>;
} {
  const failures = new Map<number, NativeSuiteBuildFailure>();
  const attempt = (members: readonly number[]) => {
    const result = build(members);
    onAttempt(members.length, result);
    return result;
  };
  /** One failing member of `members`, found by compiling halves. */
  function isolate(
    members: readonly number[],
    failure: NativeSuiteBuild & { ok: false },
  ): { member: number; error: NativeSuiteBuildFailure } {
    let failing = members,
      error = failure.error;
    while (failing.length > 1) {
      const half = failing.slice(0, Math.ceil(failing.length / 2));
      const result = attempt(half);
      if (!result.ok) {
        failing = half;
        error = result.error;
        const named = result.culprits.filter((m) => half.includes(m));
        if (named.length > 0) return { member: named[0]!, error };
      } else failing = failing.slice(half.length);
    }
    if (failing.length === 1 && failing !== members) {
      const single = attempt(failing);
      if (single.ok)
        throw Error(
          "suite build failure is not attributable to a single member",
        );
      error = single.error;
    }
    return { member: failing[0]!, error };
  }
  let members = Array.from({ length: count }, (_, index) => index);
  while (members.length > 0) {
    const result = attempt(members);
    if (result.ok) return { image: { members, build: result }, failures };
    const named = result.culprits.filter((m) => members.includes(m));
    if (named.length > 0)
      for (const member of named) failures.set(member, result.error);
    else if (globalSuiteFailure(result.error)) {
      // A whole-program limit fails every subset that still reaches it;
      // bisection would only rediscover it. Every member keeps the error.
      for (const member of members) failures.set(member, result.error);
      return { image: undefined, failures };
    } else {
      const found = isolate(members, result);
      failures.set(found.member, found.error);
    }
    members = members.filter((member) => !failures.has(member));
  }
  return { image: undefined, failures };
}

/** Run each selector in a fresh process of `binary`, up to `jobs` at once;
 * outcomes are classified exactly as executeNativeProcess classifies them. */
export async function runSuiteProcesses(
  binary: string,
  selectors: readonly string[],
  jobs: number,
  timeoutMs: number,
  onOutcome: (position: number, outcome: ExecutionOutcome, ms: number) => void,
): Promise<void> {
  let next = 0;
  async function worker(): Promise<void> {
    for (
      let position = next++;
      position < selectors.length;
      position = next++
    ) {
      const started = performance.now();
      const outcome = await runProcess(binary, selectors[position]!, timeoutMs);
      onOutcome(position, outcome, performance.now() - started);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(jobs, selectors.length) }, worker),
  );
}
function runProcess(
  binary: string,
  selector: string,
  timeoutMs: number,
): Promise<ExecutionOutcome> {
  return new Promise((resolve) => {
    let timedOut = false,
      settled = false;
    const settle = (outcome: ExecutionOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(outcome);
    };
    const child = spawn(binary, [selector], { stdio: "ignore" });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.on("error", (error) =>
      settle({ kind: "crash", detail: "launch: " + error.message }),
    );
    child.on("exit", (code, signal) => {
      if (timedOut)
        settle({ kind: "timeout", detail: "native timeout after launch" });
      else if (signal !== null)
        settle({
          kind: "crash",
          detail: "native process terminated by " + signal,
        });
      else if (code === null)
        settle({ kind: "crash", detail: "native process reported no status" });
      else settle(nativeExitOutcome(code));
    });
  });
}

/** The compilation record of one suite build attempt. */
export interface NativeSuiteCompilation {
  readonly id: number;
  readonly variants: number;
  readonly compileMs: number;
  readonly outcome: string;
  readonly kind: "execution";
  readonly linking: "suite";
  readonly reason?: string;
  readonly imageBytes?: number;
  readonly modules?: number;
  readonly admissionMs?: number;
  readonly native?: NativeSuiteStatistics;
  readonly stages: readonly { stage: string; ms: number }[];
}

/** Build the suite image (attributing and excluding build failures), then run
 * every built member in a fresh process. Build failures are recorded with
 * their compiler error and never executed. */
export async function runNativeSuite(options: {
  readonly members: readonly NativeSuiteCase[];
  readonly build: ReturnType<typeof createNativeSuiteBuilder>;
  readonly nextCompilation: () => number;
  readonly compilation: (compilation: NativeSuiteCompilation) => void;
  readonly phase: (phase: string) => void;
  /** A debugger-contained serial launch; absent selects concurrent plain
   * processes. */
  readonly execute?: (binary: string, selector: string) => ExecutionOutcome;
  readonly timeoutMs: number;
  readonly admissionTimeoutMs: number;
  readonly jobs: number;
  /** Analysis: receives the built suite image before it runs. */
  readonly saveImage?: (bytes: Uint8Array) => void;
  readonly record: (
    member: number,
    outcome: ExecutionOutcome,
    compilation: number | undefined,
    details: object,
  ) => void;
}): Promise<void> {
  const { members } = options;
  const route = (member: number) =>
    members[member]!.kind === "early-error"
      ? { route: "early-error-dynamic" }
      : {};
  let started = performance.now();
  /** The failed attempt that reported each build error. */
  const attempts = new Map<NativeSuiteBuildFailure, number>();
  let compiled: NativeSuiteCompilation | undefined;
  const { image, failures } = buildSuiteExcludingFailures(
    members.length,
    (subset) => {
      started = performance.now();
      options.phase(`compiling suite image (${subset.length} variants)`);
      return options.build(subset.map((member) => members[member]!));
    },
    (variants, result) => {
      const record = {
        id: options.nextCompilation(),
        variants,
        compileMs: performance.now() - started,
        outcome: result.ok ? "compiled" : "build-failure",
        kind: "execution" as const,
        linking: "suite" as const,
        ...(result.ok
          ? {
              imageBytes: result.bytes.length,
              modules: result.modules,
              ...(result.native === undefined ? {} : { native: result.native }),
            }
          : { reason: JSON.stringify(result.error) }),
        stages: result.stages,
      };
      // A compiled image's record waits for its launch admission.
      if (result.ok) compiled = record;
      else {
        attempts.set(result.error, record.id);
        options.compilation(record);
      }
    },
  );
  for (const [member, error] of [...failures].sort((a, b) => a[0] - b[0]))
    options.record(
      member,
      {
        kind: "unsupported",
        reason: "native compilation: " + JSON.stringify(error),
      },
      attempts.get(error),
      { buildFailure: error, ...route(member) },
    );
  if (image === undefined || compiled === undefined) return;
  const compilation = compiled.id;
  const { NativeImageRunner } = await import("./test262-native-process.ts");
  options.phase("staging suite image");
  options.saveImage?.(image.build.bytes);
  const runner = new NativeImageRunner(
    image.build.bytes,
    options.timeoutMs,
    options.admissionTimeoutMs,
  );
  // One image, one launch admission (macOS assesses each new executable on
  // its first exec); no case's budget includes it.
  options.phase("admitting suite image (first launch)");
  const admission = runner.admit();
  options.compilation({ ...compiled, admissionMs: admission.admissionMs });
  if (!admission.admitted) {
    for (const member of image.members)
      options.record(member, admission.outcome, compilation, route(member));
    runner.close();
    return;
  }
  try {
    const selectors = image.members.map((_, position) => String(position));
    const done = (position: number, outcome: ExecutionOutcome, ms: number) => {
      const member = image.members[position]!;
      options.record(member, outcome, compilation, {
        executionMs: ms,
        ...route(member),
      });
    };
    let finished = 0;
    const progress = (
      position: number,
      outcome: ExecutionOutcome,
      ms: number,
    ) => {
      done(position, outcome, ms);
      finished++;
      if (finished % 256 === 0)
        options.phase(
          `executing suite image (${finished}/${selectors.length})`,
        );
    };
    options.phase(`executing suite image (0/${selectors.length})`);
    const execute = options.execute;
    if (execute === undefined)
      await runSuiteProcesses(
        runner.path,
        selectors,
        options.jobs,
        options.timeoutMs,
        progress,
      );
    else
      for (const [position, selector] of selectors.entries()) {
        const begun = performance.now();
        progress(
          position,
          execute(runner.path, selector),
          performance.now() - begun,
        );
      }
  } finally {
    runner.close();
  }
}
