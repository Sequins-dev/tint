import {
  updateRegExpLegacyState,
  invalidateRegExpLegacyState,
} from "./regexp-legacy-state.ts";
import {
  compileRegExp,
  executeRegExp,
  type RegExpMatch,
} from "@tint/foundation/regexp/engine";
import { parseRegExpFlags } from "@tint/foundation/regexp/syntax";
import {
  createObject,
  createDataProperty,
  getProperty,
  setProperty,
  type OrdinaryObject,
  type ObjectHooks,
} from "./operations.ts";
import {
  createRuntimeError,
  rejectUnsupportedExecution,
  type ErrorRealm,
} from "./errors.ts";
import { numberValue, stringValue } from "./coercion.ts";
import { createArrayFromList } from "./array-like.ts";
import { builtinProperty } from "./intrinsics.ts";
import type { ScriptPropertyKey } from "./symbols.ts";
import { viewObjectValue } from "./values.ts";
import type { RegExpData } from "./regexp-data.ts";
export function regexpString(
  value: unknown,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): string {
  const converted = stringValue(value, hooks, realm);
  if (converted.error === "unsupported")
    return rejectUnsupportedExecution(realm);
  if (converted.error !== "none") throw createRuntimeError(realm, "type");
  return converted.value;
}
export function initializeRegExpObject(
  object: OrdinaryObject<ScriptPropertyKey, unknown>,
  pattern: unknown,
  flags: unknown,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
  legacyEnabled: boolean,
): void {
  const source =
    pattern === undefined ? "" : regexpString(pattern, realm, hooks);
  const text = flags === undefined ? "" : regexpString(flags, realm, hooks);
  const compiled = compileRegExp(source, text);
  if (!compiled.ok && compiled.error.kind !== "unsupported") {
    if (compiled.error.kind === "syntax")
      throw createRuntimeError(realm, "syntax");
    return rejectUnsupportedExecution(realm);
  }
  const parsedFlags = parseRegExpFlags(text);
  if (!parsedFlags.ok) throw "REGEXP_FLAGS_INVARIANT";
  object.internalRegExpData = {
    legacyState: realm.regexpLegacyState,
    legacyEnabled,
    originalSource: source,
    originalFlags: text,
    flags: parsedFlags.value,
    program: compiled.ok ? compiled.value : undefined,
  };
}
export function allocateRegExpObject(
  prototype: OrdinaryObject<ScriptPropertyKey, unknown>,
  hooks: ObjectHooks<unknown>,
): OrdinaryObject<ScriptPropertyKey, unknown> {
  const object = createObject<ScriptPropertyKey, unknown>(prototype);
  builtinProperty(object, "lastIndex", 0, true, false, hooks);
  return object;
}
/** Literal evaluation creates a fresh object and bypasses mutable global bindings. */
export function createRegExpLiteral(
  pattern: string,
  flags: string,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): OrdinaryObject<ScriptPropertyKey, unknown> {
  const object = allocateRegExpObject(realm.regexpPrototype, hooks);
  initializeRegExpObject(object, pattern, flags, realm, hooks, true);
  return object;
}
/** EscapeRegExpPattern. Unchanged runs are copied with one slice each and
 * the pieces joined once: appending per character copied the growing result
 * every time, quadratic in the pattern (generated property-escape patterns
 * run to tens of thousands of characters). */
export function regexpSource(source: string): string {
  if (source === "") return "(?:)";
  const pieces: string[] = [];
  // Start of the pending run of source text copied unchanged.
  let literal = 0,
    inClass = false;
  for (let i = 0; i < source.length; i++) {
    const code = source.charCodeAt(i);
    if (code === 92 /* \ */) {
      const next = source.charCodeAt(i + 1);
      if (next === 10 || next === 13 || next === 0x2028 || next === 0x2029) {
        // Drop the backslash; the terminator is escaped on its own turn.
        if (literal < i) pieces.push(source.slice(literal, i));
        literal = i + 1;
        continue;
      }
      // The escaped character is copied as is and never toggles a class.
      if (i + 1 < source.length) i++;
      continue;
    }
    if (code === 91 /* [ */) inClass = true;
    else if (code === 93 /* ] */) inClass = false;
    let escape: string | undefined;
    if (code === 47 /* / */ && !inClass) escape = "\\/";
    else if (code === 10) escape = "\\n";
    else if (code === 13) escape = "\\r";
    else if (code === 0x2028) escape = "\\u2028";
    else if (code === 0x2029) escape = "\\u2029";
    if (escape === undefined) continue;
    if (literal < i) pieces.push(source.slice(literal, i));
    pieces.push(escape);
    literal = i + 1;
  }
  if (literal === 0 && pieces.length === 0) return source;
  if (literal < source.length) pieces.push(source.slice(literal));
  return pieces.join("");
}
function matchArray(
  match: RegExpMatch,
  input: string,
  data: RegExpData,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): OrdinaryObject<ScriptPropertyKey, unknown> {
  const values: unknown[] = [],
    pairs: unknown[] = [];
  for (const range of match.captures) {
    values.push(
      range === undefined ? undefined : input.slice(range.start, range.end),
    );
    if (data.flags.indices)
      pairs.push(
        range === undefined
          ? undefined
          : createArrayFromList(
              [range.start, range.end],
              0,
              realm.arrayPrototype,
              realm,
              hooks,
            ),
      );
  }
  const result = createArrayFromList(
    values,
    0,
    realm.arrayPrototype,
    realm,
    hooks,
  );
  createDataProperty<ScriptPropertyKey, unknown>(
    result,
    "index",
    match.start,
    hooks,
  );
  createDataProperty<ScriptPropertyKey, unknown>(result, "input", input, hooks);
  const groups =
    data.program === undefined || data.program.names.length === 0
      ? undefined
      : createObject<ScriptPropertyKey, unknown>(undefined);
  const indexGroups =
    groups === undefined || !data.flags.indices
      ? undefined
      : createObject<ScriptPropertyKey, unknown>(undefined);
  const assigned = new Set<string>();
  if (groups !== undefined && data.program !== undefined) {
    for (const named of data.program.names) {
      if (named === undefined) throw "REGEXP_NAME_INVARIANT";
      if (assigned.has(named.name)) continue;
      if (values[named.capture] !== undefined) assigned.add(named.name);
      createDataProperty<ScriptPropertyKey, unknown>(
        groups,
        named.name,
        values[named.capture],
        hooks,
      );
      if (indexGroups !== undefined)
        createDataProperty<ScriptPropertyKey, unknown>(
          indexGroups,
          named.name,
          pairs[named.capture],
          hooks,
        );
    }
  }
  createDataProperty<ScriptPropertyKey, unknown>(
    result,
    "groups",
    groups,
    hooks,
  );
  if (data.flags.indices) {
    const indices = createArrayFromList(
      pairs,
      0,
      realm.arrayPrototype,
      realm,
      hooks,
    );
    createDataProperty<ScriptPropertyKey, unknown>(
      indices,
      "groups",
      indexGroups,
      hooks,
    );
    createDataProperty<ScriptPropertyKey, unknown>(
      result,
      "indices",
      indices,
      hooks,
    );
  }
  return result;
}
/** RegExpBuiltinExec after receiver validation and input ToString. */
export function executeRegExpObject(
  object: OrdinaryObject<ScriptPropertyKey, unknown>,
  input: string,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): OrdinaryObject<ScriptPropertyKey, unknown> | null {
  if (object.internalRegExpData === undefined)
    throw createRuntimeError(realm, "type");
  const index = numberValue(
    getProperty<ScriptPropertyKey, unknown>(object, "lastIndex", object, hooks),
    hooks,
    realm,
  );
  if (index.error === "unsupported") return rejectUnsupportedExecution(realm);
  if (index.error !== "none") throw createRuntimeError(realm, "type");
  // [[OriginalFlags]] and [[RegExpMatcher]] are read after ToLength(lastIndex):
  // a lastIndex valueOf may recompile this RegExp (Annex B compile), which
  // replaces its internal data.
  const data = object.internalRegExpData;
  if (data === undefined) throw createRuntimeError(realm, "type");
  const updates = data.flags.global || data.flags.sticky;
  const start =
    updates && index.value > 0
      ? Math.min(Math.floor(index.value), 9007199254740991)
      : 0;
  function writeIndex(value: number): void {
    setRegExpLastIndex(object, value, realm, hooks);
  }
  if (start > input.length) {
    if (updates) writeIndex(0);
    return null;
  }
  const program = data.program;
  if (program === undefined) return rejectUnsupportedExecution(realm);
  const result = executeRegExp(
    program,
    input,
    start,
    data.flags.sticky,
    realm.regexpMaxSteps,
  );
  if (result.kind === "limit" || result.kind === "invalid")
    return rejectUnsupportedExecution(realm);
  if (result.kind === "no-match") {
    if (updates) writeIndex(0);
    return null;
  }
  if (updates) writeIndex(result.match.end);
  const array = matchArray(result.match, input, data, realm, hooks);
  if (data.legacyState === realm.regexpLegacyState) {
    if (data.legacyEnabled)
      updateRegExpLegacyState(realm.regexpLegacyState, input, result.match);
    else invalidateRegExpLegacyState(realm.regexpLegacyState);
  }
  return array;
}

/** RegExpExec honors an overridden exec before requiring the RegExp brand. */
export function regexpExec(
  object: OrdinaryObject<ScriptPropertyKey, unknown>,
  input: string,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): OrdinaryObject<ScriptPropertyKey, unknown> | null {
  const method = getProperty<ScriptPropertyKey, unknown>(
    object,
    "exec",
    object,
    hooks,
  );
  const callable = viewObjectValue(method, realm.objectPrototype);
  if (callable === undefined || callable.internalCall === undefined)
    return executeRegExpObject(object, input, realm, hooks);
  const value = hooks.call(method, object, [input]);
  if (value === null) return null;
  const result = viewObjectValue(value, realm.objectPrototype);
  if (result === undefined) throw createRuntimeError(realm, "type");
  return result;
}

export function setRegExpLastIndex(
  object: OrdinaryObject<ScriptPropertyKey, unknown>,
  value: unknown,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): void {
  if (
    !setProperty<ScriptPropertyKey, unknown>(
      object,
      "lastIndex",
      value,
      { object, value: object },
      hooks,
    )
  )
    throw createRuntimeError(realm, "type");
}

/** Advance by one UTF-16 code unit or one Unicode code point. */
export function advanceStringIndex(
  input: string,
  index: number,
  unicode: boolean,
): number {
  if (!unicode || index + 1 >= input.length) return index + 1;
  const first = input.charCodeAt(index);
  if (first < 0xd800 || first > 0xdbff) return index + 1;
  const second = input.charCodeAt(index + 1);
  return second >= 0xdc00 && second <= 0xdfff ? index + 2 : index + 1;
}

export function regexpInteger(
  value: unknown,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): number {
  const number = numberValue(value, hooks, realm);
  if (number.error === "unsupported") return rejectUnsupportedExecution(realm);
  if (number.error !== "none") throw createRuntimeError(realm, "type");
  return number.value !== number.value ? 0 : Math.trunc(number.value);
}
export function regexpLength(
  value: unknown,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): number {
  return Math.min(
    Math.max(regexpInteger(value, realm, hooks), 0),
    9007199254740991,
  );
}
