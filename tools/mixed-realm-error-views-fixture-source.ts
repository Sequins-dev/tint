export const errorProducerSource = `
const original = new TypeError("original");

export function cached(): unknown { return original; }
export function empty(): unknown { return new RangeError(""); }
export function absent(): unknown { return new Error(); }
export function maybe(message: string | undefined): unknown { return new Error(message); }
export function raise(): unknown { throw original; }
export function rethrow(value: unknown): boolean {
  try { throw value; } catch (error) { return error === original; }
}
export function message(): string { return original.message; }
export function catchesNativeAlias(): boolean {
  try { original.message; } catch (error) { return error === original; }
  return false;
}
export function typedMessage(error: Error): string { return error.message; }
export function kind(error: unknown): boolean { return error instanceof TypeError; }
export interface ErrorHolder { value: unknown }
export function hold(value: unknown): ErrorHolder { return { value }; }
export function readHolder(holder: ErrorHolder): unknown { return holder.value; }
export function divideByZero(zero: unknown): unknown { return 1n / (zero as bigint); }
export function explicitContract(value: unknown): string { return value as string; }
`;

export const mixedRealmErrorViewsSource = `
import {
  cached, empty, absent, maybe, raise, rethrow, message, typedMessage, kind, catchesNativeAlias,
  divideByZero, explicitContract, hold, readHolder,
} from "./trusted.ts";

export function run(checkContract = false) {
  const error = cached();
  if (cached() !== error) return 1;
  const stack = error.stack;
  if (typeof stack !== "string") return 18;
  if (Object.getPrototypeOf(error) !== TypeError.prototype) return 2;
  if (!(error instanceof TypeError) || !(error instanceof Error)) return 3;
  if (Object.prototype.toString.call(error) !== "[object Error]") return 4;
  const descriptor = Object.getOwnPropertyDescriptor(error, "message");
  if (!descriptor || descriptor.value !== "original" || descriptor.enumerable ||
      !descriptor.writable || !descriptor.configurable || Object.hasOwn(error, "name")) return 5;
  const blank = empty();
  if (!(blank instanceof RangeError) || !Object.hasOwn(blank, "message") || blank.message !== "") return 6;
  const holder = hold(error);
  if (holder.value !== error || readHolder(holder) !== error) return 22;
  holder.value = blank;
  if (holder.value !== blank || readHolder(holder) !== blank) return 23;
  const omitted = absent();
  if (Object.hasOwn(omitted, "message") || omitted.message !== "") return 7;
  if (Object.hasOwn(maybe(undefined), "message") || !Object.hasOwn(maybe(""), "message")) return 8;
  error.message = "changed";
  if (message() !== "changed" || typedMessage(error) !== "changed") return 9;

  let reads = 0;
  const marker = {};
  Object.defineProperty(error, "message", {
    configurable: true,
    get() { if (++reads === 1) return "getter"; throw marker; },
  });
  if (message() !== "getter" || reads !== 1) return 10;
  try { message(); return 11; } catch (thrown) { if (thrown !== marker) return 11; }
  Object.defineProperty(error, "message", { configurable: true, get() { throw error; } });
  if (!catchesNativeAlias()) return 21;
  delete error.message;
  if (message() !== "") return 12;

  function relay() {
    try { raise(); } catch (thrown) {
      if (thrown !== error) throw "wrong error";
      throw thrown;
    }
  }
  try { relay(); return 13; } catch (thrown) {
    if (thrown !== error || !rethrow(thrown)) return 13;
  }
  Object.setPrototypeOf(error, Error.prototype);
  if (error instanceof TypeError || kind(error) || kind(cached())) return 14;
  Object.defineProperty(TypeError, Symbol.hasInstance, { value: (value) => value === error, configurable: true });
  try {
    if (!(error instanceof TypeError) || !kind(error)) return 15;
  } finally {
    delete TypeError[Symbol.hasInstance];
  }
  let causes = 0;
  const Alias = Error;
  const realmError = new Alias("realm", { get cause() { causes++; return error; } });
  if (causes !== 1 || realmError.cause !== error || typedMessage(realmError) !== "realm") return 16;
  if (typedMessage({ name: "Structural", message: "value" }) !== "value") return 17;
  function exposeAgain() { return cached(); }
  if (exposeAgain().stack !== stack) return 18;
  function createInsideRuntime() { return divideByZero(0n); }
  try { createInsideRuntime(); return 19; } catch (thrown) {
    if (!(thrown instanceof RangeError) || thrown.message !== "Division by zero" ||
        typeof thrown.stack !== "string") return 19;
  }
  if (checkContract) {
    try { explicitContract(0); return 20; } catch (thrown) {
      if (!(thrown instanceof TypeError) || thrown.message !== "value does not match the asserted type") return 20;
    }
  }
  return 42;
}
`;
