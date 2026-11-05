import { optionValue } from "./options.ts";
import type { TzifDisambiguation } from "@tint/foundation/chrono/tzif";
import type { ObjectHooks } from "./operations.ts";
import { stringValue } from "./coercion.ts";
import {
  createRuntimeError,
  rejectUnsupportedExecution,
  type ErrorRealm,
} from "./errors.ts";

/** GetOptionsObject followed by a single observable string-valued option read. */
export function temporalStringOption(
  options: unknown,
  name: string,
  fallback: string,
  allowed: readonly string[],
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): string {
  const value = optionValue(options, name, realm, hooks);
  if (value === undefined) return fallback;
  const converted = stringValue(value, hooks, realm);
  if (converted.error === "unsupported")
    return rejectUnsupportedExecution(realm);
  if (converted.error !== "none") throw createRuntimeError(realm, "type");
  if (!allowed.includes(converted.value))
    throw createRuntimeError(realm, "range");
  return converted.value;
}

/** Preserve the checked union for local-time resolution without an assertion. */
export function temporalDisambiguationOption(
  options: unknown,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): TzifDisambiguation {
  const mode = temporalStringOption(
    options,
    "disambiguation",
    "compatible",
    ["compatible", "earlier", "later", "reject"],
    realm,
    hooks,
  );
  if (
    mode === "compatible" ||
    mode === "earlier" ||
    mode === "later" ||
    mode === "reject"
  )
    return mode;
  throw "TEMPORAL_DISAMBIGUATION_INVARIANT";
}
