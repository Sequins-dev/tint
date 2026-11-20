export const generalCallTypedSource = `
export function ordered(fn: unknown, next: unknown): unknown {
  if ("function" !== typeof fn || !(typeof next === "function")) return undefined;
  return fn(next(1), next(2));
}

export function invoke(fn: unknown, argument: unknown): unknown {
  if (typeof fn === "function") return fn(argument);
  return undefined;
}

export function omitted(fn: unknown): unknown {
  if (typeof fn !== "function") return undefined;
  return fn();
}

export function snapshot(fn: unknown, replacement: unknown): unknown {
  let callee: unknown = fn;
  const replace = (): number => { callee = replacement; return 42; };
  if (typeof callee !== "function") return undefined;
  return callee(replace());
}

export function spread(fn: unknown, token: unknown): unknown {
  if (typeof fn !== "function") return undefined;
  const args: unknown[] = [1, token];
  return fn(...args);
}

export function method(fn: unknown): boolean {
  const holder: { readonly call: unknown } = { call: fn };
  if (typeof holder.call !== "function") return false;
  return (holder.call)() === holder;
}
`;

export const generalCallEntrySource = `
import { invoke, method, omitted, ordered, snapshot, spread } from "trusted";
export function run(): number {
  let trace = "";
  const token = { identity: true };
  const next = (n: number) => { trace += n; return n; };
  function call(this: unknown, a: unknown, b: unknown) {
    trace += "c";
    return this === undefined && a === 1 && b === 2 ? token : undefined;
  }
  if (ordered(call, next) !== token || trace !== "12c") return 1;
  function arity(value?: unknown) {
    return arguments.length === 0 && value === undefined ? token : undefined;
  }
  if (omitted(arity) !== token) return 2;
  class Class {}
  trace = "";
  try { ordered(Class, next); return 3; }
  catch (error) {
    if (!(error instanceof TypeError) || trace !== "12") return 4;
  }
  function recur(n: number): unknown {
    return n <= 0 ? token : invoke(recur, n - 1);
  }
  if (invoke(recur, 5) !== token) return 5;
  try { invoke(() => { throw token; }, 0); return 6; }
  catch (error) { if (error !== token) return 7; }
  if (!method(function (this: unknown) { return this; })) return 8;
  trace = "";
  try {
    ordered(call, (n: number) => {
      trace += n;
      if (n === 1) throw token;
      return n;
    });
    return 9;
  } catch (error) { if (error !== token || trace !== "1") return 10; }
  if (snapshot((value: unknown) => value, () => -1) !== 42) return 11;
  if (spread((a: unknown, b: unknown) => a === 1 ? b : undefined, token) !== token) return 12;
  return 42;
}
`;
