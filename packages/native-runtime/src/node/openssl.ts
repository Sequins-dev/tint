// System OpenSSL selected by the Node crypto adapter. Bind against the chosen
// handle so opaque contexts and their deleters always use the same library.
import { TARGET_AAPCS64 } from "tint:c/dl";
import {
  closeLibrary,
  cStringAt,
  findSymbol,
  foreignFunction,
  invoke,
  openLibrary,
  openProgram,
  registerOptionalLibrary,
  resultNumber,
  setBytes,
  setNumber,
  type ForeignFunction,
  type ForeignType,
  type LibraryHandle,
} from "tint:ffi/unsafe";
import {
  createUTF8Decoder,
  decodeUTF8,
  encodeUTF8,
} from "@tint/foundation/text/text-encoding";
import { codedError } from "./errors.ts";

const voidType: ForeignType = { kind: "void" };
const pointer: ForeignType = { kind: "pointer", pointee: voidType };
const integer: ForeignType = { kind: "scalar", scalar: "i32" };
const major: ForeignType = { kind: "scalar", scalar: "u32" };

function bind(
  library: LibraryHandle,
  name: string,
  result: ForeignType,
  parameters: readonly ForeignType[],
): ForeignFunction {
  return foreignFunction(findSymbol(library, name), {
    parameters,
    result,
    fixedParameters: parameters.length,
    callClass: "leaf",
    errno: "none",
  });
}

function environment(name: string): string | undefined {
  const program = openProgram();
  try {
    const getenv = bind(program, "getenv", pointer, [pointer]);
    setBytes(getenv, 0, encodeUTF8(name + String.fromCharCode(0)));
    invoke(getenv);
    const value = resultNumber(getenv);
    return value === 0 ? undefined : cStringAt(value);
  } finally {
    closeLibrary(program);
  }
}

function resolveMacLibrary(path: string): string {
  if (
    !path.startsWith("/") ||
    !path.endsWith("/libcrypto.3.dylib") ||
    path.startsWith("/usr/lib/") ||
    path.includes(String.fromCharCode(0))
  )
    throw new Error(
      "expected an absolute path to libcrypto.3.dylib outside /usr/lib",
    );
  const program = openProgram();
  try {
    const realpath = bind(program, "realpath", pointer, [pointer, pointer]);
    const result = new Uint8Array(1024); // PATH_MAX on Darwin.
    setBytes(realpath, 0, encodeUTF8(path + String.fromCharCode(0)));
    setBytes(realpath, 1, result);
    invoke(realpath);
    if (resultNumber(realpath) === 0)
      throw new Error("could not resolve library path");
    let end = 0;
    while (end < result.length && result[end] !== 0) end++;
    const filename = decodeUTF8(
      createUTF8Decoder(false, true),
      result.subarray(0, end),
    );
    if (
      filename === undefined ||
      filename.startsWith("/usr/lib/") ||
      !filename.endsWith("/libcrypto.3.dylib")
    )
      throw new Error("library path does not resolve to an OpenSSL 3 dylib");
    return filename;
  } finally {
    closeLibrary(program);
  }
}

export interface OpenSSL {
  readonly libraryContext: number;
  readonly digestFetch: ForeignFunction;
  readonly digestFree: ForeignFunction;
  readonly clearErrors: ForeignFunction;
  readonly pbkdf2: ForeignFunction;
  readonly setThreadContext: ForeignFunction;
}

function loadLibrary(path: string): OpenSSL {
  const library = openLibrary(
    TARGET_AAPCS64 === 0 ? resolveMacLibrary(path) : path,
  );
  try {
    const version = bind(library, "OPENSSL_version_major", major, []);
    invoke(version);
    if (resultNumber(version) !== 3)
      throw new Error("expected OpenSSL major version 3");
    const contextNew = bind(library, "OSSL_LIB_CTX_new", pointer, []);
    const contextFree = bind(library, "OSSL_LIB_CTX_free", voidType, [pointer]);
    const loadProvider = bind(library, "OSSL_PROVIDER_load", pointer, [
      pointer,
      pointer,
    ]);
    for (const symbol of [
      "RAND_bytes_ex",
      "EVP_get_digestbyname",
      "EVP_md_null",
      "EVP_MD_CTX_new",
      "EVP_MD_CTX_free",
      "EVP_MD_CTX_reset",
      "EVP_MD_get_flags",
      "EVP_DigestInit_ex2",
      "EVP_DigestUpdate",
      "EVP_DigestFinal_ex",
      "HMAC_CTX_new",
      "HMAC_CTX_free",
      "HMAC_CTX_reset",
      "HMAC_Init_ex",
      "HMAC_Update",
      "HMAC_Final",
    ]) {
      if (symbol === undefined || findSymbol(library, symbol) === 0)
        throw new Error("OpenSSL symbol is unavailable");
    }
    const backend: OpenSSL = {
      libraryContext: 0,
      digestFetch: bind(library, "EVP_MD_fetch", pointer, [
        pointer,
        pointer,
        pointer,
      ]),
      digestFree: bind(library, "EVP_MD_free", voidType, [pointer]),
      clearErrors: bind(library, "ERR_clear_error", voidType, []),
      pbkdf2: bind(library, "PKCS5_PBKDF2_HMAC", integer, [
        pointer,
        integer,
        pointer,
        integer,
        integer,
        pointer,
        integer,
        pointer,
      ]),
      setThreadContext: bind(library, "OSSL_LIB_CTX_set0_default", pointer, [
        pointer,
      ]),
    };
    invoke(contextNew);
    const context = resultNumber(contextNew);
    if (context === 0)
      throw new Error("could not create OpenSSL library context");
    try {
      setNumber(loadProvider, 0, context);
      setBytes(loadProvider, 1, encodeUTF8("default\0"));
      invoke(loadProvider);
      if (resultNumber(loadProvider) === 0) {
        invoke(backend.clearErrors);
        throw new Error("could not load the OpenSSL default provider");
      }
    } catch (error) {
      disposeAddress(contextFree, context);
      throw error;
    }
    registerOptionalLibrary("tint:system-openssl3", library);
    return { ...backend, libraryContext: context };
  } catch (error) {
    closeLibrary(library);
    throw error;
  }
}

let selected: OpenSSL | undefined = undefined;

export function systemOpenSSL(): OpenSSL {
  const loaded = selected;
  if (loaded !== undefined) return loaded;
  const mac = TARGET_AAPCS64 === 0;
  const candidates: string[] = [];
  if (mac) {
    const override = environment("TINT_OPENSSL_LIBRARY");
    if (override !== undefined) candidates.push(override);
    else {
      const brewPrefix = environment("HOMEBREW_PREFIX");
      if (
        brewPrefix !== undefined &&
        brewPrefix !== "/opt/homebrew" &&
        brewPrefix !== "/usr/local"
      )
        candidates.push(brewPrefix + "/opt/openssl@3/lib/libcrypto.3.dylib");
      candidates.push("/opt/homebrew/opt/openssl@3/lib/libcrypto.3.dylib");
      candidates.push("/usr/local/opt/openssl@3/lib/libcrypto.3.dylib");
    }
  } else candidates.push("libcrypto.so.3");
  let failures = "";
  for (const path of candidates) {
    if (path === undefined) throw "OpenSSL candidate invariant";
    try {
      const backend = loadLibrary(path);
      selected = backend;
      return backend;
    } catch (error) {
      failures +=
        " " +
        path +
        ": " +
        (error instanceof Error ? error.message : "loader failed");
    }
  }
  const guidance = mac
    ? "Install Homebrew openssl@3 or set TINT_OPENSSL_LIBRARY."
    : "Install the distribution package providing libcrypto.so.3.";
  throw codedError(
    "node:crypto requires OpenSSL 3. " + guidance + failures,
    "ERR_NO_CRYPTO",
  );
}

export function disposeAddress(fn: ForeignFunction, address: number): void {
  setNumber(fn, 0, address);
  invoke(fn);
}

export function fetchDigest(ffi: OpenSSL, algorithm: string): number {
  invoke(ffi.clearErrors);
  setNumber(ffi.digestFetch, 0, ffi.libraryContext);
  setBytes(ffi.digestFetch, 1, encodeUTF8(algorithm + String.fromCharCode(0)));
  setBytes(ffi.digestFetch, 2, encodeUTF8("provider=default\0"));
  invoke(ffi.digestFetch);
  const digest = resultNumber(ffi.digestFetch);
  setNumber(ffi.digestFetch, 1, 0);
  setNumber(ffi.digestFetch, 2, 0);
  if (digest === 0) invoke(ffi.clearErrors);
  return digest;
}

/** Node's OpenSSL bindings pass digest names as C strings. */
export function digestName(value: string): string {
  const end = value.indexOf(String.fromCharCode(0));
  return end === -1 ? value : value.slice(0, end);
}
