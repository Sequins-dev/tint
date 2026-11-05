import { createSourceTextView } from "@tint/source/text";
import {
  parseScript,
  parseEvalScript,
  type Module,
  type DynamicFunctionSyntax,
} from "@tint/typescript/syntax";
import type { GlobalEnvironment } from "@tint/js-runtime/environments/global";
import {
  createScriptRecord,
  viewObjectValue,
  type OrdinaryObject,
  createRuntimeError,
  rejectUnsupportedExecution,
  type ErrorRealm,
  type ScriptPropertyKey,
  type ScriptCompletionRecord,
  type DirectEvalCompiler,
} from "@tint/js-runtime/objects";
import {
  lowerScript,
  lowerEvalScript,
  lowerDirectEvalScript,
  directEvalStrict,
  directEvalInFunction,
  directEvalInMethod,
  directEvalInDerivedConstructor,
  directEvalInClassFieldInitializer,
  directEvalInPrivateEnvironment,
  directEvalCapabilitiesConsistent,
  lowerDynamicFunctionImplementation,
} from "./lowering/index.ts";
import type { EngineCodeStorage } from "./native/code-storage.ts";
import type { ScriptEntryFrame } from "./native/script-entry.ts";

export interface ScriptEvaluationContext {
  readonly realm: ErrorRealm;
  readonly global: GlobalEnvironment<ScriptPropertyKey, unknown>;
}
export type ScriptCompileFailure =
  | "profile"
  | "prepare"
  | "lower"
  | "emit"
  | "select"
  | "link"
  | "budget"
  | "publish";
export type ScriptEntryCompilation =
  | { readonly ok: true; readonly address: number }
  | { readonly ok: false; readonly stage: ScriptCompileFailure };
export type ScriptEvaluationFault =
  | "compile-threw"
  | "invoke-threw"
  | "completion-view"
  | "completion-kind"
  | "context-leak";
/** Embedding authority. Code publication belongs to compile; realms share the
 * existing engine arena, while each evaluator owns its paired realm/global. */
export interface ScriptEvaluationHost {
  readonly domain: () => number;
  readonly storage: EngineCodeStorage;
  readonly table: () => unknown;
  readonly compile: (lowered: Module) => ScriptEntryCompilation;
  readonly invoke: (address: number, frame: ScriptEntryFrame) => unknown;
  readonly completion: (value: unknown) => ScriptCompletionRecord | undefined;
  readonly fault: (reason: ScriptEvaluationFault) => void;
}
export type ScriptEvaluator = (source: unknown) => unknown;
/** Host Script evaluation: no caller environment, inherited strictness, job
 * checkpoint or code cache. Unsupported execution remains sticky across catches. */
export function createScriptEvaluator(
  context: ScriptEvaluationContext,
  host: ScriptEvaluationHost,
): ScriptEvaluator {
  return createEntryEvaluator(context, host, "script");
}
export type IndirectEvaluator = (source: string) => unknown;
/** Indirect eval owns its realm/global, but retains the effective active Script
 * identity. The ScriptRecord passed through the frame is a private carrier, not
 * a new parse identity; lowering reads only its realm and hostDefined fields. */
export function createIndirectEvaluator(
  context: ScriptEvaluationContext,
  host: ScriptEvaluationHost,
): IndirectEvaluator {
  const evaluate = createEntryEvaluator(context, host, "indirect-eval");
  // Keep the exported string-argument ABI explicit instead of returning an
  // unknown-argument closure through a variance-compatible function type.
  return (source: string): unknown => evaluate(source);
}
const directEvalSupported =
  directEvalStrict |
  directEvalInFunction |
  directEvalInMethod |
  directEvalInDerivedConstructor |
  directEvalInClassFieldInitializer |
  directEvalInPrivateEnvironment;
/** Direct PerformEval uses its caller's typed site through the existing frame.
 * Caller capabilities are checked before parsing their source. */
export function createDirectEvaluator(
  context: ScriptEvaluationContext,
  host: ScriptEvaluationHost,
): DirectEvalCompiler {
  const realm = context.realm,
    runner = createEntryRunner(context, host);
  return (source: string, flags: number, site: unknown): unknown => {
    if (
      realm.unsupported ||
      site === undefined ||
      (flags & ~directEvalSupported) !== 0 ||
      !directEvalCapabilitiesConsistent(flags)
    )
      return rejectUnsupportedExecution(realm);
    runner.ensureDomain();
    const parsed = parseEvalScript(createSourceTextView(source), {
      strict: (flags & directEvalStrict) !== 0,
      newTarget: (flags & directEvalInFunction) !== 0,
      superProperty: (flags & directEvalInMethod) !== 0,
      superCall: (flags & directEvalInDerivedConstructor) !== 0,
    });
    if (!parsed.ok) return rejectSource(realm, parsed.error.code);
    if (parsed.value.statements.length === 0) return undefined;
    const lowered = lowerDirectEvalScript(parsed.value, source, flags, {
      privateEnvironment: (flags & directEvalInPrivateEnvironment) !== 0,
      fieldInitializer: (flags & directEvalInClassFieldInitializer) !== 0,
    });
    if (!lowered.ok) return rejectLowering(realm, lowered.error.code);
    return completeEntry(realm, runner, runner.run(lowered.value, site, false));
  };
}
export type DynamicFunctionBodyCompiler = (
  syntax: DynamicFunctionSyntax,
  identity: unknown,
) => OrdinaryObject<ScriptPropertyKey, unknown>;
/** Compile and instantiate one hidden body carrier. The constructor owns caching. */
export function createDynamicFunctionBodyCompiler(
  context: ScriptEvaluationContext,
  host: ScriptEvaluationHost,
): DynamicFunctionBodyCompiler {
  const runner = createEntryRunner(context, host),
    realm = context.realm;
  return (
    syntax: DynamicFunctionSyntax,
    identity: unknown,
  ): OrdinaryObject<ScriptPropertyKey, unknown> => {
    if (realm.unsupported) return rejectUnsupportedExecution(realm);
    runner.ensureDomain();
    const lowered = lowerDynamicFunctionImplementation(syntax);
    if (!lowered.ok) return rejectUnsupportedExecution(realm);
    const done = runner.run(lowered.value, identity, false);
    if (done.error !== "none") return runner.fault("completion-kind");
    const carrier = viewObjectValue(done.value, context.global.object);
    if (carrier === undefined || carrier.internalCall === undefined)
      return runner.fault("completion-view");
    return carrier;
  };
}
interface EntryRunner {
  readonly ensureDomain: () => void;
  readonly fault: (reason: ScriptEvaluationFault) => never;
  readonly run: (
    lowered: Module,
    identity: unknown,
    inheritActive: boolean,
  ) => ScriptCompletionRecord;
}
function createEntryRunner(
  context: ScriptEvaluationContext,
  host: ScriptEvaluationHost,
): EntryRunner {
  const realm = context.realm,
    global = context.global,
    domain = host.domain();
  function ensureDomain(): void {
    if (
      !Number.isSafeInteger(domain) ||
      domain <= 0 ||
      host.domain() !== domain ||
      host.storage.domain !== domain
    )
      rejectUnsupportedExecution(realm);
  }
  function fault(reason: ScriptEvaluationFault): never {
    host.fault(reason);
    return rejectUnsupportedExecution(realm);
  }
  function run(
    lowered: Module,
    identity: unknown,
    inheritActive: boolean,
  ): ScriptCompletionRecord {
    let compiled: ScriptEntryCompilation;
    try {
      compiled = host.compile(lowered);
    } catch {
      return fault("compile-threw");
    }
    if (!compiled.ok) return rejectUnsupportedExecution(realm);
    ensureDomain();
    const active = realm.agent.activeContext;
    const inherited =
      inheritActive && active !== undefined ? active.scriptOrModule : identity;
    const record = createScriptRecord(realm, inherited);
    const frame: ScriptEntryFrame = {
      $imports: host.table(),
      $argument0: global,
      $argument1: record,
    };
    const outer = realm.agent.activeContext;
    let raw: unknown;
    try {
      raw = host.invoke(compiled.address, frame);
    } catch {
      return fault("invoke-threw");
    }
    if (realm.agent.activeContext !== outer) return fault("context-leak");
    const done = host.completion(raw);
    if (done === undefined) return fault("completion-view");
    return done;
  }
  return { ensureDomain, fault, run };
}
function createEntryEvaluator(
  context: ScriptEvaluationContext,
  host: ScriptEvaluationHost,
  kind: "script" | "indirect-eval",
): ScriptEvaluator {
  const realm = context.realm,
    runner = createEntryRunner(context, host);
  return (source: unknown): unknown => {
    if (realm.unsupported || typeof source !== "string")
      return rejectUnsupportedExecution(realm);
    runner.ensureDomain();
    // Source strings are UTF-16, including lone surrogates inside literals.
    // Encoding them as UTF-8 here would silently replace those code units.
    const parsed = parseScript(createSourceTextView(source));
    if (!parsed.ok) return rejectSource(realm, parsed.error.code);
    if (kind === "indirect-eval" && parsed.value.statements.length === 0)
      return undefined;
    const lowered =
      kind === "script"
        ? lowerScript(parsed.value, source)
        : lowerEvalScript(parsed.value, source);
    if (!lowered.ok) return rejectLowering(realm, lowered.error.code);
    const done = runner.run(lowered.value, undefined, kind === "indirect-eval");
    return completeEntry(realm, runner, done);
  };
}

function rejectSource(realm: ErrorRealm, code: string): never {
  if (code === "SYNTAX_ERROR" || code === "LEXICAL_ERROR")
    throw createRuntimeError(realm, "syntax");
  return rejectUnsupportedExecution(realm);
}
function rejectLowering(realm: ErrorRealm, code: string): never {
  if (code === "EARLY_ERROR") throw createRuntimeError(realm, "syntax");
  return rejectUnsupportedExecution(realm);
}
function completeEntry(
  realm: ErrorRealm,
  runner: EntryRunner,
  done: ScriptCompletionRecord,
): unknown {
  if (done.error === "none") return done.value;
  if (done.error === "throw") throw done.value;
  if (done.error === "unsupported") return rejectUnsupportedExecution(realm);
  return runner.fault("completion-kind");
}
