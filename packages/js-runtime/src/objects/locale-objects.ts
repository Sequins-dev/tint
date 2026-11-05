import { createArrayFromList, lengthOfArrayLike } from "./array-like.ts";
import { getProperty, hasProperty, type ObjectHooks } from "./operations.ts";
import { toObjectValue } from "./boxing.ts";
import { viewObjectValue } from "./values.ts";
import { stringValue } from "./coercion.ts";
import { canonicalizeLocaleId } from "./locale-canonicalization.ts";
import {
  createRuntimeError,
  rejectUnsupportedExecution,
  type ErrorRealm,
} from "./errors.ts";
import type { LocaleData } from "./locale-id.ts";
import type { ScriptPropertyKey } from "./symbols.ts";

/** Initial deterministic DefaultLocale policy, shared by formatter services. */
export const runtimeDefaultLocale = "en";

export function localeObjectTag(
  value: unknown,
  realm: ErrorRealm,
): string | undefined {
  const object = viewObjectValue(value, realm.objectPrototype);
  return object === undefined ? undefined : object.internalLocaleData?.locale;
}

export function requireLocale(value: unknown, realm: ErrorRealm): LocaleData {
  const object = viewObjectValue(value, realm.objectPrototype);
  const data = object === undefined ? undefined : object.internalLocaleData;
  if (data === undefined) throw createRuntimeError(realm, "type");
  return data;
}

export function canonicalLocaleList(
  locales: unknown,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): string[] {
  const seen: string[] = [];
  if (locales === undefined) return seen;
  const object =
    typeof locales === "string" || localeObjectTag(locales, realm) !== undefined
      ? createArrayFromList([locales], 0, realm.arrayPrototype, realm, hooks)
      : toObjectValue(locales, realm, hooks);
  const length = lengthOfArrayLike(object, realm, hooks);
  for (let index = 0; index < length; index++) {
    const key = String(index);
    if (!hasProperty<ScriptPropertyKey, unknown>(object, key)) continue;
    const value = getProperty<ScriptPropertyKey, unknown>(
      object,
      key,
      object,
      hooks,
    );
    if (
      typeof value !== "string" &&
      viewObjectValue(value, realm.objectPrototype) === undefined
    )
      throw createRuntimeError(realm, "type");
    const localeTag = localeObjectTag(value, realm);
    const converted = stringValue(localeTag ?? value, hooks, realm);
    if (converted.error === "unsupported")
      return rejectUnsupportedExecution(realm);
    if (converted.error !== "none") throw createRuntimeError(realm, "type");
    const canonical = canonicalizeLocaleId(converted.value);
    if (canonical === undefined) throw createRuntimeError(realm, "range");
    if (!seen.includes(canonical)) {
      seen.push(canonical);
    }
  }
  return seen;
}
