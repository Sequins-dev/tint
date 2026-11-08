import { createSourceTextView } from "@tint/source/text";
import {
  parseScript,
  parseEvalScript,
  type Module,
  type Expression,
  type DynamicFunctionSyntax,
} from "@tint/typescript/syntax";
import { collectScriptDeclarations } from "@tint/typescript/binding";
import {
  admitGlobalDeclarations,
  type GlobalEnvironment,
} from "@tint/js-runtime/environments/global";
import {
  createScriptRecord,
  viewObjectValue,
  type OrdinaryObject,
  createRuntimeError,
  createRegExpLiteral,
  rejectUnsupportedExecution,
  throwIfRuntimeError,
  type ErrorRealm,
  type ScriptPropertyKey,
  type ScriptCompletionRecord,
  type DirectEvalCompiler,
  type ShadowRealmEvaluation,
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
/** `literals` are the parse's string-literal values when the entry is shared
 * with other parses of the same shape; the evaluator places them in the
 * ScriptRecord the entry receives. */
export type ScriptEntryCompilation =
  | {
      readonly ok: true;
      readonly address: number;
      readonly literals?: readonly string[];
    }
  | { readonly ok: false; readonly stage: ScriptCompileFailure };
/** Everything that selected the lowered module besides its own syntax: the
 * entry kind and, for direct eval, the caller capability flags and context.
 * A compiler may share entries only between equal shapes and equal syntax. */
export type ScriptEntryShape = string;
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
  readonly compile: (
    lowered: Module,
    shape?: ScriptEntryShape,
  ) => ScriptEntryCompilation;
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
/** ShadowRealm uses the existing eval lexical/variable environments, with a
 * fresh lexical environment and no inherited Script/module referrer. Parsing
 * and early errors remain distinct from exceptions produced by execution. */
export function createShadowRealmEvaluator(
  context: ScriptEvaluationContext,
  host: ScriptEvaluationHost,
): (source: string) => ShadowRealmEvaluation {
  const realm = context.realm,
    runner = createEntryRunner(context, host);
  return (source: string): ShadowRealmEvaluation => {
    if (realm.unsupported) return rejectUnsupportedExecution(realm);
    runner.ensureDomain();
    const parsed = parseScript(createSourceTextView(source));
    if (!parsed.ok) {
      if (
        parsed.error.code === "SYNTAX_ERROR" ||
        parsed.error.code === "LEXICAL_ERROR"
      )
        return { error: "syntax", value: undefined };
      return rejectUnsupportedExecution(realm);
    }
    if (parsed.value.statements.length === 0)
      return { error: "none", value: undefined };
    const lowered = lowerEvalScript(parsed.value, source);
    if (!lowered.ok) {
      if (lowered.error.code === "EARLY_ERROR")
        return { error: "syntax", value: undefined };
      return rejectUnsupportedExecution(realm);
    }
    const done = runner.run(lowered.value, undefined, false, "shadow-realm");
    if (done.error === "none" || done.error === "throw")
      return { error: done.error, value: done.value };
    if (done.error === "unsupported") return rejectUnsupportedExecution(realm);
    return runner.fault("completion-kind");
  };
}
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
    const regexp = soleRegExpLiteral(parsed.value);
    if (regexp !== undefined) return evaluateRegExpLiteral(context, regexp);
    const lowered = lowerDirectEvalScript(parsed.value, source, flags, {
      privateEnvironment: (flags & directEvalInPrivateEnvironment) !== 0,
      fieldInitializer: (flags & directEvalInClassFieldInitializer) !== 0,
    });
    if (!lowered.ok) return rejectLowering(realm, lowered.error.code);
    // Lowering's only inputs are the source, these flags and this context;
    // caller bindings are reached at run time through the site.
    const shape =
      "direct-eval:" +
      String(flags) +
      ":" +
      String((flags & directEvalInPrivateEnvironment) !== 0) +
      ":" +
      String((flags & directEvalInClassFieldInitializer) !== 0);
    return completeEntry(
      realm,
      runner,
      runner.run(lowered.value, site, false, shape),
    );
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
    const done = runner.run(lowered.value, identity, false, "function-body");
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
    shape: ScriptEntryShape,
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
    shape: ScriptEntryShape,
  ): ScriptCompletionRecord {
    let compiled: ScriptEntryCompilation;
    try {
      compiled = host.compile(lowered, shape);
    } catch {
      return fault("compile-threw");
    }
    if (!compiled.ok) return rejectUnsupportedExecution(realm);
    ensureDomain();
    const active = realm.agent.activeContext;
    const inherited =
      inheritActive && active !== undefined ? active.scriptOrModule : identity;
    const record = createScriptRecord(realm, inherited, compiled.literals);
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
    const regexp = soleRegExpLiteral(parsed.value);
    if (regexp !== undefined) return evaluateRegExpLiteral(context, regexp);
    const lowered =
      kind === "script"
        ? lowerScript(parsed.value, source, { runtimeCompiled: true })
        : lowerEvalScript(parsed.value, source);
    if (!lowered.ok) return rejectLowering(realm, lowered.error.code);
    // GlobalDeclarationInstantiation admission only reads the ordinary global
    // object, so a Script rejected by it fails here without compiling a body
    // that could never run; compiled code repeats the same checks otherwise.
    if (kind === "script")
      throwIfRuntimeError(
        realm,
        admitGlobalDeclarations<ScriptPropertyKey, unknown>(
          context.global,
          collectScriptDeclarations(parsed.value),
        ),
      );
    const done = runner.run(
      lowered.value,
      undefined,
      kind === "indirect-eval",
      kind,
    );
    return completeEntry(realm, runner, done);
  };
}

type RegExpLiteral = Expression & { readonly kind: "regexp" };
/** A program consisting only of one RegExp literal statement has no bindings,
 * declarations or binding-phase early errors; the parser has already validated
 * its pattern and flags. Its completion is one fresh RegExpCreate result, so
 * entries skip native compilation, whose cost would dominate eval of such
 * sources. Other literal programs stay on the shared compiled path. */
function soleRegExpLiteral(script: Module): RegExpLiteral | undefined {
  if (script.statements.length !== 1) return undefined;
  const statement = script.statements[0];
  if (statement === undefined || statement.kind !== "expression")
    return undefined;
  const expression = statement.expression;
  return expression.kind === "regexp" ? expression : undefined;
}
function evaluateRegExpLiteral(
  context: ScriptEvaluationContext,
  literal: RegExpLiteral,
): unknown {
  return createRegExpLiteral(
    literal.pattern,
    literal.flags,
    context.realm,
    context.global.hooks,
  );
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
