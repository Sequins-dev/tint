import {
  getScriptMap,
  hasScriptMap,
  setScriptMap,
  type ScriptMap,
} from "./collection-data.ts";
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
  /** `realm.arrayPrototype.internalPropertyEpoch` when `arrayPush` was last
   * verified as the own data property `"push"` on `Array.prototype` (-1 before
   * verification). */
  arrayPushEpoch: number;
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
    arrayPushEpoch: -1,
  };
}

// The inline forms of the collection methods on a receiver's storage
// (Map.prototype.get and friends after their receiver check): keys compare
// with SameValueZero, so -0 is stored and found as +0.

export function scriptMapGet(data: ScriptMap, key: unknown): unknown {
  return getScriptMap(data, key);
}

export function scriptMapHas(data: ScriptMap, key: unknown): boolean {
  return hasScriptMap(data, key);
}

export function scriptMapSet(
  data: ScriptMap,
  key: unknown,
  value: unknown,
): void {
  setScriptMap(data, key, value);
}

export function scriptSetAdd(data: ScriptMap, value: unknown): void {
  const key = value === 0 ? 0 : value;
  setScriptMap(data, key, key);
}
