import type { DeclarativeEnvironment } from "../records/index.ts";
import type {
  DerivedConstruction,
  OrdinaryObject,
  ScriptPropertyKey,
  PrivateName,
} from "../../objects/index.ts";
import type { EnvironmentScope } from "./scope.ts";

/** Catch records exempted from eval's intervening lexical conflict walk.
 * A linked chain needs no collection runtime when transported in a managed site. */
export interface DirectEvalCatch<Value> {
  readonly record: DeclarativeEnvironment<Value>;
  readonly outer: DirectEvalCatch<Value> | undefined;
}

/** Caller state transported through a managed entry's opaque host data. */
export interface DirectEvalSite {
  readonly scriptOrModule: unknown;
  readonly lexical: EnvironmentScope<ScriptPropertyKey, unknown>;
  readonly variables: EnvironmentScope<ScriptPropertyKey, unknown>;
  readonly catches: DirectEvalCatch<unknown> | undefined;
  readonly thisValue: unknown;
  readonly newTarget: unknown;
  readonly home: OrdinaryObject<ScriptPropertyKey, unknown> | undefined;
  /** Per-invocation state; reading this remains lazy in derived eval code. */
  readonly derived: DerivedConstruction<ScriptPropertyKey, unknown> | undefined;
  readonly activeFunction:
    OrdinaryObject<ScriptPropertyKey, unknown> | undefined;
  readonly privateEnvironment: DirectEvalPrivateName | undefined;
}

/** The compiler binds this declaration to an exact record descriptor check. */
export function viewDirectEvalSite(value: unknown): DirectEvalSite | undefined {
  throw "UNBOUND_DIRECT_EVAL_SITE_VIEW";
}

/** Innermost-first caller PrivateEnvironment, without exposing names as JS values. */
export interface DirectEvalPrivateName {
  readonly name: PrivateName;
  readonly outer: DirectEvalPrivateName | undefined;
}
export function resolveDirectEvalPrivateName(
  environment: DirectEvalPrivateName | undefined,
  description: string,
): PrivateName | undefined {
  let cursor = environment;
  while (cursor !== undefined) {
    if (cursor.name.description === description) return cursor.name;
    cursor = cursor.outer;
  }
  return undefined;
}
