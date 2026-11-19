export const typedNodeErrorsSource = `
import { createHash } from "node:crypto";
import { deflateSync, gunzipSync, inflateSync } from "node:zlib";

function checkError(error: unknown, expected: string, status: number): boolean {
  if (!(error instanceof Error)) return false;
  if (!("code" in error) || typeof error.code !== "string") return false;
  const code: string = error.code;
  if (code !== expected) return false;
  if (status === 0) return !("errno" in error);
  if (!("errno" in error) || typeof error.errno !== "number") return false;
  const errno: number = error.errno;
  return errno === status;
}

export function run(): number {
  try { createHash("tint-unknown-digest"); return 1; }
  catch (error) {
    if (!(error instanceof Error) || error instanceof TypeError || "code" in error ||
        error.message !== "Digest method not supported") return 1;
  }
  const hash = createHash("sha256");
  hash.digest();
  try { hash.digest(); return 2; }
  catch (error) { if (!checkError(error, "ERR_CRYPTO_HASH_FINALIZED", 0)) return 2; }
  try { hash.update("data"); return 3; }
  catch (error) { if (!checkError(error, "ERR_CRYPTO_HASH_FINALIZED", 0)) return 3; }
  try { gunzipSync(new Uint8Array(0)); return 4; }
  catch (error) { if (!checkError(error, "Z_BUF_ERROR", -5)) return 4; }
  try { inflateSync(new Uint8Array([0, 0])); return 5; }
  catch (error) { if (!checkError(error, "Z_DATA_ERROR", -3)) return 5; }
  // A zlib header with FDICT set, followed by an Adler-32 dictionary ID.
  try { inflateSync(new Uint8Array([120, 32, 0, 0, 0, 1])); return 6; }
  catch (error) { if (!checkError(error, "Z_NEED_DICT", 2)) return 6; }
  try { deflateSync("abc", { level: 10 }); return 7; }
  catch (error) {
    if (!(error instanceof RangeError) || !checkError(error, "ERR_OUT_OF_RANGE", 0)) return 7;
  }
  try { deflateSync("abc", { maxOutputLength: 1 }); return 8; }
  catch (error) {
    if (!(error instanceof RangeError) || !checkError(error, "ERR_BUFFER_TOO_LARGE", 0)) return 8;
  }
  const obj: { value: number; absent?: number } = { value: 1 };
  if (!("value" in obj) || "absent" in obj || "extra" in obj) return 9;
  const ordinary: { readonly message: string; readonly code: string; readonly errno?: number } =
    {message: "ordinary", code: "Z_DATA_ERROR", errno: -3};
  if (checkError(ordinary, "Z_DATA_ERROR", -3)) return 10;
  try { hash.digest("tint-unknown-encoding"); return 11; }
  catch (error) { if (!checkError(error, "ERR_CRYPTO_HASH_FINALIZED", 0)) return 11; }
  return 42;
}
`;

export const typedNodeErrorProducers = `
import { createHash } from "node:crypto";
import { deflateSync, gunzipSync, inflateSync } from "node:zlib";
export function digest(): unknown {
  const hash = createHash("sha256");
  hash.digest();
  return hash.digest();
}
export function unsupported(): unknown { return createHash("tint-unknown-digest").digest(); }
export function truncated(): unknown { return gunzipSync(new Uint8Array(0)); }
export function invalid(): unknown { return inflateSync(new Uint8Array([0, 0])); }
export function missingDictionary(): unknown {
  return inflateSync(new Uint8Array([120, 32, 0, 0, 0, 1]));
}
export function invalidRange(): unknown { return deflateSync("abc", {level: 10}); }
export function outputLimit(): unknown { return deflateSync("abc", {maxOutputLength: 1}); }
export function echo(value: unknown): unknown { return value; }
export function caughtCode(value: unknown): unknown {
  try { throw value; } catch (error) {
    if (error instanceof Error && "code" in error && typeof error.code === "string") return error.code;
  }
  return undefined;
}
export function typedCode(value: unknown): string {
  if (value instanceof Error && "code" in value && typeof value.code === "string") {
    const code: string = value.code;
    return code;
  }
  return "";
}
`;

export const mixedNodeErrorsSource = `
import {
  digest, unsupported, truncated, invalid, missingDictionary, invalidRange, outputLimit,
  caughtCode, typedCode, echo,
} from "./producers.ts";

function capture(call) {
  try { call(); } catch (error) { return error; }
  return undefined;
}
function shape(error, prototype, fields, codeFirst = false) {
  if (!prototype.isPrototypeOf(error) ||
      Object.prototype.toString.call(error) !== "[object Error]") return false;
  if (Object.getOwnPropertyNames(error).filter(key => key !== "stack").join(",") !==
      (codeFirst ? "code,message" : ["message", ...Object.keys(fields)].join(","))) return false;
  const message = Object.getOwnPropertyDescriptor(error, "message");
  if (message.enumerable || !message.configurable || !message.writable) return false;
  for (const key of Object.keys(fields)) {
    const desc = Object.getOwnPropertyDescriptor(error, key);
    if (!desc.enumerable || !desc.configurable || !desc.writable || desc.value !== fields[key])
      return false;
  }
  return typeof error.stack === "string";
}
export function run(checkContract = false) {
  if (!shape(capture(unsupported), Error.prototype, {})) return 1;
  if (!shape(capture(digest), Error.prototype, {code: "ERR_CRYPTO_HASH_FINALIZED"})) return 2;
  if (!shape(capture(truncated), Error.prototype, {errno: -5, code: "Z_BUF_ERROR"})) return 3;
  if (!shape(capture(invalid), Error.prototype, {errno: -3, code: "Z_DATA_ERROR"})) return 4;
  if (!shape(capture(missingDictionary), Error.prototype, {errno: 2, code: "Z_NEED_DICT"})) return 5;
  if (!shape(capture(invalidRange), RangeError.prototype, {code: "ERR_OUT_OF_RANGE"}, true)) return 6;
  if (!shape(capture(outputLimit), RangeError.prototype, {code: "ERR_BUFFER_TOO_LARGE"})) return 7;
  const error = capture(digest);
  const log = [];
  let reads = 0;
  const proxy = new Proxy(error, {
    has(target, key) { log.push("has:" + key); return Reflect.has(target, key); },
    get(target, key) { log.push("get:" + key); return ++reads === 1 ? "first" : 17; },
  });
  if (caughtCode(proxy) !== 17 || log.join(",") !== "has:code,get:code,get:code") return 8;
  reads = 0;
  if (checkContract) {
    try { typedCode(proxy); return 9; }
    catch (thrown) { if (!(thrown instanceof TypeError)) return 9; }
  }
  const marker = {};
  const rejects = new Proxy(error, { has() { throw marker; } });
  try { caughtCode(rejects); return 10; } catch (thrown) { if (thrown !== marker) return 10; }
  delete error.code;
  if (caughtCode(error) !== undefined) return 11;
  Object.setPrototypeOf(error, Object.create(Error.prototype, { code: { value: "inherited" } }));
  if (caughtCode(error) !== "inherited") return 12;
  const realmError = new Error("realm");
  realmError.code = "E_REALM";
  if (caughtCode(realmError) !== "E_REALM") return 13;
  if (echo(error) !== error) return 14;
  return 42;
}
`;
