import { requestSourceTailCall } from "./functions.ts";
import { callObjectValue } from "./values.ts";
import type { OrdinaryObject, ObjectHooks } from "./operations.ts";
import type { ScriptPropertyKey } from "./symbols.ts";
import {
  rejectUnsupportedExecution,
  type ErrorRealm,
  type EvalCompiler,
  type DirectEvalCompiler,
} from "./errors.ts";
import { builtinProperty, builtinFunction } from "./intrinsics.ts";

/** The host's global this-value may differ from the global binding object. */
export function installGlobalProperties(
  global: OrdinaryObject<ScriptPropertyKey, unknown>,
  thisValue: unknown,
  hooks: ObjectHooks<unknown>,
): void {
  builtinProperty(global, "undefined", undefined, false, false, hooks);
  builtinProperty(global, "NaN", NaN, false, false, hooks);
  builtinProperty(global, "Infinity", Infinity, false, false, hooks);
  builtinProperty(global, "globalThis", thisValue, true, true, hooks);
}

/** Install the eval intrinsic independently of the Test262 host. Non-string
 * arguments are returned without coercion; strings use the embedding compiler. */
export function installEvalIntrinsic(
  global: OrdinaryObject<ScriptPropertyKey, unknown>,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): OrdinaryObject<ScriptPropertyKey, unknown> {
  if (realm.evalFunction !== undefined) throw "EVAL_INTRINSIC_INVARIANT";
  const evaluate = builtinFunction(
    realm.functionPrototype,
    "eval",
    1,
    (receiver, args): unknown => {
      const source = args[0];
      if (typeof source !== "string") return source;
      const compiler = realm.evalCompiler;
      return compiler === undefined
        ? rejectUnsupportedExecution(realm)
        : compiler(source);
    },
    hooks,
  );
  builtinProperty(global, "eval", evaluate, true, true, hooks);
  realm.evalFunction = evaluate;
  return evaluate;
}

/** Install this realm's indirect-eval compiler once, after its intrinsic. */
export function installEvalCompiler(
  realm: ErrorRealm,
  compiler: EvalCompiler,
): void {
  if (realm.evalFunction === undefined || realm.evalCompiler !== undefined)
    throw "EVAL_COMPILER_INVARIANT";
  realm.evalCompiler = compiler;
}

/** Install direct eval only after both the intrinsic and indirect service exist. */
export function installDirectEvalCompiler(
  realm: ErrorRealm,
  compiler: DirectEvalCompiler,
): void {
  if (
    realm.evalFunction === undefined ||
    realm.evalCompiler === undefined ||
    realm.directEvalCompiler !== undefined
  )
    throw "DIRECT_EVAL_COMPILER_INVARIANT";
  realm.directEvalCompiler = compiler;
}

/** Direct-eval selection after evaluating the reference and all arguments. Only
 * the running realm's intrinsic takes PerformEval; shadowed/foreign functions
 * retain the ordinary receiver, arguments and abrupt completion behavior.
 * The direct compiler receives opaque caller facts only for string input. */
export function callEvalCandidate(
  callee: unknown,
  receiver: unknown,
  arguments_: readonly unknown[],
  witness: OrdinaryObject<ScriptPropertyKey, unknown>,
  realm: ErrorRealm,
  flags: number,
  site: unknown,
): { readonly error: "none" | "type"; readonly value: unknown } {
  return evalCandidate(
    callee,
    receiver,
    arguments_,
    witness,
    realm,
    flags,
    site,
    false,
  );
}

/** The intrinsic still performs direct eval in the current source context;
 * only a shadowed/foreign function requests an ordinary call transfer. */
export function callEvalTailCandidate(
  callee: unknown,
  receiver: unknown,
  arguments_: readonly unknown[],
  witness: OrdinaryObject<ScriptPropertyKey, unknown>,
  realm: ErrorRealm,
  flags: number,
  site: unknown,
): { readonly error: "none" | "type"; readonly value: unknown } {
  return evalCandidate(
    callee,
    receiver,
    arguments_,
    witness,
    realm,
    flags,
    site,
    true,
  );
}

function evalCandidate(
  callee: unknown,
  receiver: unknown,
  arguments_: readonly unknown[],
  witness: OrdinaryObject<ScriptPropertyKey, unknown>,
  realm: ErrorRealm,
  flags: number,
  site: unknown,
  tailCall: boolean,
): { readonly error: "none" | "type"; readonly value: unknown } {
  const intrinsic = realm.evalFunction;
  if (intrinsic === undefined || callee !== intrinsic)
    return tailCall
      ? requestSourceTailCall(callee, receiver, arguments_, witness, realm)
      : callObjectValue(callee, receiver, arguments_, witness);
  if (arguments_.length === 0) return { error: "none", value: undefined };
  const source = arguments_[0];
  if (typeof source !== "string") return { error: "none", value: source };
  const compiler = realm.directEvalCompiler;
  if (compiler === undefined) return rejectUnsupportedExecution(realm);
  return { error: "none", value: compiler(source, flags, site) };
}
