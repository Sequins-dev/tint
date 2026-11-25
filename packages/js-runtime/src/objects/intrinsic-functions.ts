import {
  getMap,
  hasMap,
  setMap,
  type LinkedMap,
} from "@tint/foundation/collections/linked-map";
import type { OrdinaryObject } from "./operations.ts";
import type { ScriptPropertyKey } from "./symbols.ts";

type IntrinsicFunction = OrdinaryObject<ScriptPropertyKey, unknown> | undefined;

/** Builtin functions whose calls generated code performs inline when the
 * callee is exactly the realm's function (an identity compare) and the
 * operands have the types the inline form assumes (Numbers for Math and
 * Number, a String receiver and Number position for the String methods, a
 * Map or Set receiver for their methods). Any other callee or operand takes
 * the ordinary call with the same evaluated operands, so replacing or
 * deleting a builtin, calling another realm's, or passing other values keeps
 * JavaScript semantics. The installers record each function here; a field
 * stays undefined in a realm that never installs it, which no callee's object
 * view matches. */
export interface IntrinsicFunctions {
  mathAbs: IntrinsicFunction;
  mathCeil: IntrinsicFunction;
  mathFloor: IntrinsicFunction;
  mathTrunc: IntrinsicFunction;
  mathRound: IntrinsicFunction;
  mathSign: IntrinsicFunction;
  mathSqrt: IntrinsicFunction;
  mathClz32: IntrinsicFunction;
  mathMin: IntrinsicFunction;
  mathMax: IntrinsicFunction;
  mathImul: IntrinsicFunction;
  /** %Number% called as a function. */
  number: IntrinsicFunction;
  stringCharCodeAt: IntrinsicFunction;
  stringCharAt: IntrinsicFunction;
  mapGet: IntrinsicFunction;
  mapHas: IntrinsicFunction;
  mapSet: IntrinsicFunction;
  setHas: IntrinsicFunction;
  setAdd: IntrinsicFunction;
  arrayPush: IntrinsicFunction;
  arrayPop: IntrinsicFunction;
}

export function createIntrinsicFunctions(): IntrinsicFunctions {
  return {
    mathAbs: undefined,
    mathCeil: undefined,
    mathFloor: undefined,
    mathTrunc: undefined,
    mathRound: undefined,
    mathSign: undefined,
    mathSqrt: undefined,
    mathClz32: undefined,
    mathMin: undefined,
    mathMax: undefined,
    mathImul: undefined,
    number: undefined,
    stringCharCodeAt: undefined,
    stringCharAt: undefined,
    mapGet: undefined,
    mapHas: undefined,
    mapSet: undefined,
    setHas: undefined,
    setAdd: undefined,
    arrayPush: undefined,
    arrayPop: undefined,
  };
}

// The inline forms of the collection methods on a receiver's storage
// (Map.prototype.get and friends after their receiver check): keys compare
// with SameValueZero, so -0 is stored and found as +0.

export function scriptMapGet(
  data: LinkedMap<unknown, unknown>,
  key: unknown,
): unknown {
  return getMap<unknown, unknown>(data, key === 0 ? 0 : key);
}

export function scriptMapHas(
  data: LinkedMap<unknown, unknown>,
  key: unknown,
): boolean {
  return hasMap<unknown, unknown>(data, key === 0 ? 0 : key);
}

export function scriptMapSet(
  data: LinkedMap<unknown, unknown>,
  key: unknown,
  value: unknown,
): void {
  setMap<unknown, unknown>(data, key === 0 ? 0 : key, value);
}

export function scriptSetAdd(
  data: LinkedMap<unknown, unknown>,
  value: unknown,
): void {
  const key = value === 0 ? 0 : value;
  setMap<unknown, unknown>(data, key, key);
}
