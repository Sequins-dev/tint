import {
  sine,
  cosine,
  tangent,
} from "@tint/foundation/numeric/binary64-trigonometry";
import {
  createExactSum,
  addExactSum,
  finishExactSum,
} from "@tint/foundation/numeric/exact-sum";
import {
  getScriptIterator,
  stepScriptIterator,
  closeScriptIterator,
} from "./iteration.ts";
import { roundFloat } from "@tint/foundation/binary/bytes";
import {
  numberAtan,
  numberAtan2,
  numberAsin,
  numberAcos,
} from "./number-angle.ts";
import {
  numberSinh,
  numberCosh,
  numberTanh,
  numberAsinh,
  numberAcosh,
  numberAtanh,
} from "./number-hyperbolic.ts";
import { numberExp, numberExpm1 } from "./number-exp.ts";
import { numberLog, numberLog1p } from "./number-log.ts";
import { numberCbrt } from "./number-cbrt.ts";
import { numberHypot } from "./number-hypot.ts";
import { wellKnownSymbol, type ScriptPropertyKey } from "./symbols.ts";
import { numberPower } from "./number-power.ts";
import {
  createObject,
  type OrdinaryObject,
  type ObjectHooks,
} from "./operations.ts";
import { builtinFunction, builtinProperty } from "./intrinsics.ts";
import { numberValue } from "./coercion.ts";
import {
  createRuntimeError,
  rejectUnsupportedExecution,
  type ErrorRealm,
} from "./errors.ts";

/** Script numeric intrinsics reuse the checked native numeric operations. */
export function installMathIntrinsics(
  global: OrdinaryObject<ScriptPropertyKey, unknown>,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
  random: (() => number) | undefined,
): void {
  function number(value: unknown): number {
    const converted = numberValue(value, hooks, realm);
    if (converted.error === "unsupported") rejectUnsupportedExecution(realm);
    if (converted.error === "type") throw createRuntimeError(realm, "type");
    return converted.value;
  }
  const math = createObject<ScriptPropertyKey, unknown>(realm.objectPrototype);
  builtinProperty(
    math,
    wellKnownSymbol(realm.symbolRegistry, "toStringTag"),
    "Math",
    false,
    true,
    hooks,
  );
  function constant(name: string, value: number): void {
    builtinProperty(math, name, value, false, false, hooks);
  }
  constant("E", 2.718281828459045);
  constant("LN10", 2.302585092994046);
  constant("LN2", 0.6931471805599453);
  constant("LOG10E", 0.4342944819032518);
  constant("LOG2E", 1.4426950408889634);
  constant("PI", 3.141592653589793);
  constant("SQRT1_2", 0.7071067811865476);
  constant("SQRT2", 1.4142135623730951);
  function unary(
    name: string,
    operation: (value: number) => number,
  ): OrdinaryObject<ScriptPropertyKey, unknown> {
    const method = builtinFunction(
      realm.functionPrototype,
      name,
      1,
      (receiver, args): unknown => operation(number(args[0])),
      hooks,
    );
    builtinProperty(math, name, method, true, true, hooks);
    return method;
  }
  // Generated calls perform these inline on Numbers (intrinsic-functions.ts)
  // with the same typed operations.
  const intrinsics = realm.intrinsicFunctions;
  intrinsics.mathAbs = unary("abs", (value: number): number => Math.abs(value));
  intrinsics.mathCeil = unary("ceil", (value: number): number =>
    Math.ceil(value),
  );
  intrinsics.mathFloor = unary("floor", (value: number): number =>
    Math.floor(value),
  );
  intrinsics.mathTrunc = unary("trunc", (value: number): number =>
    Math.trunc(value),
  );
  intrinsics.mathRound = unary("round", (value: number): number =>
    Math.round(value),
  );
  intrinsics.mathSign = unary("sign", (value: number): number =>
    Math.sign(value),
  );
  unary("sin", (value: number): number => sine(value));
  unary("cos", (value: number): number => cosine(value));
  unary("tan", (value: number): number => tangent(value));
  unary("atan", (value: number): number => numberAtan(value));
  unary("asin", (value: number): number => numberAsin(value));
  unary("acos", (value: number): number => numberAcos(value));
  unary("sinh", (value: number): number => numberSinh(value));
  unary("cosh", (value: number): number => numberCosh(value));
  unary("tanh", (value: number): number => numberTanh(value));
  unary("asinh", (value: number): number => numberAsinh(value));
  unary("acosh", (value: number): number => numberAcosh(value));
  unary("atanh", (value: number): number => numberAtanh(value));
  unary("exp", (value: number): number => numberExp(value));
  unary("expm1", (value: number): number => numberExpm1(value));
  unary("log", (value: number): number => numberLog(value, 0));
  unary("log2", (value: number): number => numberLog(value, 2));
  unary("log10", (value: number): number => numberLog(value, 10));
  unary("log1p", (value: number): number => numberLog1p(value));
  unary("cbrt", (value: number): number => numberCbrt(value));
  intrinsics.mathSqrt = unary("sqrt", (value: number): number =>
    Math.sqrt(value),
  );
  intrinsics.mathClz32 = unary("clz32", (value: number): number =>
    Math.clz32(value),
  );
  unary("fround", (value: number): number => roundFloat(value, 4));
  unary("f16round", (value: number): number => roundFloat(value, 2));
  function extremum(
    name: string,
    maximum: boolean,
  ): OrdinaryObject<ScriptPropertyKey, unknown> {
    const method = builtinFunction(
      realm.functionPrototype,
      name,
      2,
      (receiver, args): unknown => {
        let result = maximum ? -Infinity : Infinity,
          nan = false;
        // Conversion remains observable after a NaN has been encountered.
        for (let index = 0; index < args.length; index++) {
          const value = number(args[index]);
          if (value !== value) nan = true;
          else if (
            (maximum ? value > result : value < result) ||
            (value === 0 &&
              result === 0 &&
              (maximum ? 1 / value === Infinity : 1 / value === -Infinity))
          )
            result = value;
        }
        return nan ? NaN : result;
      },
      hooks,
    );
    builtinProperty(math, name, method, true, true, hooks);
    return method;
  }
  intrinsics.mathMin = extremum("min", false);
  intrinsics.mathMax = extremum("max", true);
  function binary(
    name: string,
    operation: (left: number, right: number) => number,
  ): OrdinaryObject<ScriptPropertyKey, unknown> {
    const method = builtinFunction(
      realm.functionPrototype,
      name,
      2,
      (receiver, args): unknown => {
        const left = number(args[0]);
        const right = number(args[1]);
        return operation(left, right);
      },
      hooks,
    );
    builtinProperty(math, name, method, true, true, hooks);
    return method;
  }
  intrinsics.mathImul = binary("imul", (left: number, right: number): number =>
    Math.imul(left, right),
  );
  binary("atan2", (y: number, x: number): number => numberAtan2(y, x));
  builtinProperty(
    math,
    "hypot",
    builtinFunction(
      realm.functionPrototype,
      "hypot",
      2,
      (receiver, args): unknown => {
        const values: number[] = [];
        for (let i = 0; i < args.length; i++) values.push(number(args[i]));
        return numberHypot(values);
      },
      hooks,
    ),
    true,
    true,
    hooks,
  );
  builtinProperty(
    math,
    "sumPrecise",
    builtinFunction(
      realm.functionPrototype,
      "sumPrecise",
      1,
      (receiver, args): unknown => {
        const iterator = getScriptIterator(args[0], realm, hooks);
        const state = createExactSum();
        let count = 0;
        while (true) {
          const step = stepScriptIterator(iterator);
          if (step.done) return finishExactSum(state);
          const value = step.value;
          if (count >= 9007199254740991 || typeof value !== "number") {
            const error = createRuntimeError(
              realm,
              count >= 9007199254740991 ? "range" : "type",
            );
            closeScriptIterator(iterator, true);
            throw error;
          }
          addExactSum(state, value);
          count++;
        }
      },
      hooks,
    ),
    true,
    true,
    hooks,
  );
  binary("pow", numberPower);
  builtinProperty(
    math,
    "random",
    builtinFunction(
      realm.functionPrototype,
      "random",
      0,
      (receiver, args): unknown => {
        if (random === undefined) return rejectUnsupportedExecution(realm);
        return random();
      },
      hooks,
    ),
    true,
    true,
    hooks,
  );
  builtinProperty(global, "Math", math, true, true, hooks);
}
