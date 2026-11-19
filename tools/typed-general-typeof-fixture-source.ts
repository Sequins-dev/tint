export const classifierSource = `
export function kind(value: unknown): string { return typeof value; }
`;

export const typedGeneralTypeofSource =
  classifierSource +
  `
export function run(): number {
  const closed = 42;
  const closure = (): number => closed;
  if (kind(closure) !== "function") return 1;
  if (kind({ value: 1 }) !== "object") return 2;
  if (kind(null) !== "object") return 3;
  if (kind(undefined) !== "undefined") return 4;
  if (kind(42) !== "number") return 5;
  if (kind(false) !== "boolean") return 6;
  if (kind("test") !== "string") return 7;
  if (kind(42n) !== "bigint") return 8;
  return 42;
}
`;

export const mixedGeneralTypeofSource = `
import { kind } from "trusted";
export function run() {
  let effects = 0;
  const fail = () => { effects++; throw "typeof executed user code"; };
  const handler = { get apply() { fail(); }, get: fail, getPrototypeOf: fail };
  const fn = function () { fail(); };
  const callable = Proxy.revocable(fn, handler);
  const object = Proxy.revocable({}, handler);
  const bound = fn.bind(null);
  const Class = class { constructor() { fail(); } };
  if (kind((effects++, fn)) !== "function" || effects !== 1) return 1;
  if (kind(bound) !== "function") return 2;
  if (kind(Class) !== "function") return 3;
  if (kind(callable.proxy) !== "function") return 4;
  callable.revoke();
  if (kind(callable.proxy) !== "function") return 5;
  if (kind(object.proxy) !== "object") return 6;
  object.revoke();
  if (kind(object.proxy) !== "object") return 7;
  if (kind({ get internalCall() { fail(); } }) !== "object") return 8;
  if (kind(Symbol()) !== "symbol") return 9;
  if (kind(42n) !== "bigint") return 10;
  if (effects !== 1) return 11;
  return 42;
}
`;
