import { byteStorageData } from "@tint/js-runtime/bytes";
import {
  builtinAccessor,
  builtinFunction,
  builtinProperty,
  builtinRegisterFunction,
  callObjectValue,
  createArrayFromList,
  createCodedRuntimeError,
  createDataProperty,
  createObject,
  createRuntimeError,
  ensureRareSlots,
  exoticSlots,
  getProperty,
  isArrayValue,
  isCallableObject,
  programRealmCore,
  projectArrayBufferViewRange,
  stringValueOrThrow,
  typedArrayElementWidth,
  viewObjectValue,
  type ObjectCall,
  type ObjectRegisterCall,
  type OrdinaryObject,
  type ProgramRealmCore,
  type ScriptPropertyKey,
} from "@tint/js-runtime/objects";
import { adoptNodeBuffer } from "./buffer.ts";
import {
  digestFinished,
  finishDigestAs,
  openDigest,
  trackDigest,
  updateDigest,
  randomBytes as nativeRandomBytes,
  pbkdf2 as nativePbkdf2,
  type DigestLifetime,
} from "./crypto.ts";
import { encodeUTF8 } from "@tint/foundation/text/text-encoding";
import { bufferEncoding, bufferText } from "./buffer-codecs.ts";
export { closeDigestContexts } from "./crypto.ts";

type RealmObject = OrdinaryObject<ScriptPropertyKey, unknown>;

function fail(
  core: ProgramRealmCore,
  kind: string,
  message: string,
  code: string,
): never {
  throw createCodedRuntimeError(
    core.realm,
    core.hooks,
    kind,
    message,
    code,
    undefined,
    false,
  );
}

function invalid(
  core: ProgramRealmCore,
  argument: string,
  expected: string,
  input: unknown,
): never {
  let received = "an instance of Object";
  if (input === null) received = "null";
  else if (input === undefined) received = "undefined";
  else if (typeof input === "string")
    received = "type string ('" + input + "')";
  else if (typeof input === "number")
    received = "type number (" + String(input) + ")";
  else if (typeof input === "boolean")
    received = input ? "type boolean (true)" : "type boolean (false)";
  else if (isArrayValue(input, core.realm)) received = "an instance of Array";
  return fail(
    core,
    "type",
    'The "' +
      argument +
      '" argument must be of type ' +
      expected +
      ". Received " +
      received,
    "ERR_INVALID_ARG_TYPE",
  );
}

function unavailableDigest(
  core: ProgramRealmCore,
  operation: string,
  message: string,
): never {
  const library = "digital envelope routines";
  const error = createRuntimeError(core.realm, "error");
  builtinProperty(error, "message", message, true, true, core.hooks);
  if (operation === "createHash") {
    const stack = createArrayFromList(
      ["error:03000086:" + library + "::initialization error"],
      0,
      core.realm.arrayPrototype,
      core.realm,
      core.hooks,
    );
    createDataProperty<ScriptPropertyKey, unknown>(
      error,
      "opensslErrorStack",
      stack,
      core.hooks,
    );
  }
  createDataProperty<ScriptPropertyKey, unknown>(
    error,
    "library",
    library,
    core.hooks,
  );
  createDataProperty<ScriptPropertyKey, unknown>(
    error,
    "reason",
    "unsupported",
    core.hooks,
  );
  createDataProperty<ScriptPropertyKey, unknown>(
    error,
    "code",
    "ERR_OSSL_EVP_UNSUPPORTED",
    core.hooks,
  );
  throw error;
}

/** Borrow an ordinary, fixed-length, in-bounds typed array's bytes for one
 * synchronous step without projecting a range record. Other views (DataView,
 * shared, length-tracking, detached or out of bounds) return undefined. */
function typedArrayBytes(object: RealmObject): Uint8Array | undefined {
  const exotic = object.internalRareSlots?.internalExoticSlots;
  const data = exotic === undefined ? undefined : exotic.internalTypedArrayData;
  if (data === undefined) return undefined;
  const storage = data.storage;
  const length = data.length;
  if (storage.kind !== "ordinary" || length === undefined) return undefined;
  const bytes = storage.data;
  if (bytes === undefined) return undefined;
  const start = data.byteOffset;
  const kind = data.kind;
  const width =
    kind === "Uint8" || kind === "Uint8Clamped" || kind === "Int8"
      ? 1
      : typedArrayElementWidth(kind);
  const end = start + length * width;
  if (end > bytes.length) return undefined;
  return start === 0 && end === bytes.length
    ? bytes
    : bytes.subarray(start, end);
}

function inputBytes(
  core: ProgramRealmCore,
  input: unknown,
  name: string,
  allowArrayBuffer: boolean,
): string | Uint8Array {
  if (typeof input === "string") return input;
  const view = viewObjectValue(input, core.object);
  const direct = view === undefined ? undefined : typedArrayBytes(view);
  if (direct !== undefined) return direct;
  const range =
    view === undefined ? undefined : projectArrayBufferViewRange(view);
  if (range !== undefined) {
    const bytes = range.bytes;
    if (bytes !== undefined) {
      if (range.byteOffset === 0 && range.byteLength === bytes.length)
        return bytes;
      return bytes.subarray(
        range.byteOffset,
        range.byteOffset + range.byteLength,
      );
    }
  }
  if (allowArrayBuffer && view !== undefined) {
    const storage = exoticSlots(view).internalArrayBufferData;
    if (storage !== undefined) {
      const bytes = byteStorageData(storage);
      if (bytes !== undefined) return bytes;
    }
  }
  return invalid(core, name, "string, Buffer, TypedArray, or DataView", input);
}

function registerMethod(
  core: ProgramRealmCore,
  object: RealmObject,
  name: string,
  length: number,
  body: ObjectCall<unknown>,
  invoke: ObjectRegisterCall<unknown>,
): void {
  const fn = builtinRegisterFunction(
    core.realm.functionPrototype,
    core.realm,
    name,
    length,
    body,
    invoke,
    core.hooks,
  );
  builtinProperty(object, name, fn, true, true, core.hooks);
}

function unsupportedProperty(
  core: ProgramRealmCore,
  object: RealmObject,
  key: string,
  operation: string,
): void {
  const getter = builtinFunction(
    core.realm.functionPrototype,
    "get " + key,
    0,
    (_receiver, _args): unknown => unsupported(core, operation),
    core.hooks,
  );
  builtinAccessor(object, key, getter, undefined, core.hooks);
}

/** Bound by the image compiler to an exact DigestLifetime record check. */
export function viewDigestLifetime(value: unknown): DigestLifetime | undefined {
  throw "UNBOUND_DIGEST_LIFETIME_VIEW";
}

function viewDigestState(
  core: ProgramRealmCore,
  receiver: unknown,
): DigestLifetime {
  let object = viewObjectValue(receiver, core.object);
  // Shared methods can be borrowed, including by an object with a digest
  // instance on its prototype chain.
  while (object !== undefined) {
    const rare = object.internalRareSlots;
    const raw = rare === undefined ? undefined : rare.internalCryptoDigest;
    if (raw !== undefined) {
      const lifetime = viewDigestLifetime(raw);
      if (lifetime === undefined) throw "CRYPTO_DIGEST_STATE_INVARIANT";
      return lifetime;
    }
    object = object.prototype;
  }
  let message =
    "Cannot read properties of undefined (reading 'Symbol(kFinalized)')";
  if (receiver === undefined)
    message = "Cannot read properties of undefined (reading 'Symbol(kState)')";
  else if (receiver === null)
    message = "Cannot read properties of null (reading 'Symbol(kState)')";
  const error = createRuntimeError(core.realm, "type");
  builtinProperty(error, "message", message, true, true, core.hooks);
  throw error;
}

function digestView(
  core: ProgramRealmCore,
  lifetime: DigestLifetime,
): RealmObject {
  const object = createObject<ScriptPropertyKey, unknown>(
    digestPrototype(core, lifetime.hmac),
  );
  ensureRareSlots<ScriptPropertyKey, unknown>(object).internalCryptoDigest =
    lifetime;
  trackDigest(lifetime, object);
  return object;
}

function finalizedError(core: ProgramRealmCore): never {
  return fail(
    core,
    "error",
    "Digest already called",
    "ERR_CRYPTO_HASH_FINALIZED",
  );
}

function updateView(
  core: ProgramRealmCore,
  lifetime: DigestLifetime,
  data: unknown,
  encoding: unknown,
): void {
  if (digestFinished(lifetime)) finalizedError(core);
  updateDigest(
    lifetime,
    inputBytes(core, data, "data", false),
    typeof encoding === "string" ? encoding : undefined,
  );
}

/** As in Node, the method decides finished-digest behavior: Hmac's digest
 * returns an empty result even for a borrowed Hash receiver. */
function digestOfView(
  core: ProgramRealmCore,
  lifetime: DigestLifetime,
  encoding: unknown,
  hmacMethod: boolean,
): unknown {
  if (digestFinished(lifetime)) {
    if (!hmacMethod) return finalizedError(core);
    return encoding && encoding !== "buffer"
      ? ""
      : adoptNodeBuffer(core, new Uint8Array(0));
  }
  const text = encoding
    ? stringValueOrThrow(encoding, core.hooks, core.realm)
    : undefined;
  const result = finishDigestAs(lifetime, text);
  return typeof result === "string" ? result : adoptNodeBuffer(core, result);
}

const streamProperties: readonly string[] = [
  "on",
  "once",
  "addListener",
  "removeListener",
  "off",
  "emit",
  "pipe",
  "unpipe",
  "write",
  "end",
  "read",
  "push",
  "pause",
  "resume",
  "destroy",
  "setEncoding",
  "setDefaultEncoding",
  "cork",
  "uncork",
];

// The isolate has one program realm. Cache its digest prototypes so each
// createHash allocates only the Hash object.
let prototypeCore: ProgramRealmCore | undefined = undefined;
let hashPrototype: RealmObject | undefined = undefined;
let hmacPrototype: RealmObject | undefined = undefined;

function digestPrototype(core: ProgramRealmCore, hmac: boolean): RealmObject {
  if (prototypeCore !== core) {
    hashPrototype = undefined;
    hmacPrototype = undefined;
    prototypeCore = core;
  }
  const cached = hmac ? hmacPrototype : hashPrototype;
  if (cached !== undefined) return cached;
  const kind = hmac ? "Hmac" : "Hash";
  const brand = "node:crypto." + kind;
  const prototype =
    core.realm.prototypes.get(brand) ??
    createDigestPrototype(core, hmac, kind, brand);
  if (hmac) hmacPrototype = prototype;
  else hashPrototype = prototype;
  return prototype;
}

function createDigestPrototype(
  core: ProgramRealmCore,
  hmac: boolean,
  kind: string,
  brand: string,
): RealmObject {
  const prototype = createObject<ScriptPropertyKey, unknown>(
    core.realm.objectPrototype,
  );
  if (hmac) {
    const hashPrototype = digestPrototype(core, false);
    const update = getProperty<ScriptPropertyKey, unknown>(
      hashPrototype,
      "update",
      hashPrototype,
      core.hooks,
    );
    builtinProperty(prototype, "update", update, true, true, core.hooks);
  } else {
    registerMethod(
      core,
      prototype,
      "update",
      2,
      (receiver, args): unknown => {
        updateView(core, viewDigestState(core, receiver), args[0], args[1]);
        return receiver;
      },
      (_callee, receiver, _newTarget, _count, first, second): unknown => {
        updateView(core, viewDigestState(core, receiver), first, second);
        return receiver;
      },
    );
  }
  registerMethod(
    core,
    prototype,
    "digest",
    1,
    (receiver, args): unknown =>
      digestOfView(core, viewDigestState(core, receiver), args[0], hmac),
    (_callee, receiver, _newTarget, _count, first, _second): unknown =>
      digestOfView(core, viewDigestState(core, receiver), first, hmac),
  );
  for (const stream of streamProperties)
    unsupportedProperty(core, prototype, stream, kind + "." + stream);
  if (!hmac) unsupportedProperty(core, prototype, "copy", "Hash.copy");
  core.realm.prototypes.set(brand, prototype);
  return prototype;
}

function unsupported(core: ProgramRealmCore, operation: string): never {
  return fail(
    core,
    "error",
    "node:crypto " + operation + " is outside Tint's crypto proof of concept",
    "ERR_CRYPTO_UNSUPPORTED_OPERATION",
  );
}

function createHashInRealm(
  core: ProgramRealmCore,
  algorithm: unknown,
  options: unknown,
): unknown {
  if (typeof algorithm !== "string")
    return invalid(core, "algorithm", "string", algorithm);
  if (options !== undefined && options !== null)
    return unsupported(core, "createHash options");
  if (xofName(algorithm)) return unsupported(core, "XOF hashing");
  return digestView(core, openDigest(algorithm, undefined));
}

export function createHash(algorithm: unknown, options: unknown): unknown {
  return createHashInRealm(programRealmCore(), algorithm, options);
}

/** ASCII case-insensitive prefix test against a lowercase `prefix`, without
 * allocating a lowercase copy of `name`. */
function asciiPrefix(name: string, prefix: string): boolean {
  if (name.length < prefix.length) return false;
  for (let index = 0; index < prefix.length; index++) {
    const code = name.charCodeAt(index);
    const lower = code >= 65 && code <= 90 ? code + 32 : code;
    if (lower !== prefix.charCodeAt(index)) return false;
  }
  return true;
}

/** Node maps the historical DSS1 name to SHA-1 for HMAC. */
function isDss1(algorithm: string): boolean {
  return algorithm.length === 4 && asciiPrefix(algorithm, "dss1");
}

function xofName(algorithm: string): boolean {
  const length = algorithm.length;
  if (length < 5) return false;
  const first = algorithm.charCodeAt(0) | 32;
  if (first === 115)
    return (
      (algorithm.charCodeAt(3) | 32) === 107 && asciiPrefix(algorithm, "shake")
    );
  if (first === 99 && length >= 6)
    return (
      (algorithm.charCodeAt(4) | 32) === 107 && asciiPrefix(algorithm, "cshake")
    );
  return false;
}

function createHmacInRealm(
  core: ProgramRealmCore,
  algorithm: unknown,
  key: unknown,
  options: unknown,
): unknown {
  if (typeof algorithm !== "string")
    return invalid(core, "hmac", "string", algorithm);
  if (options !== undefined && options !== null)
    return unsupported(core, "createHmac options");
  const bytes = inputBytes(core, key, "key", true);
  const name = isDss1(algorithm) ? "sha1" : algorithm;
  return digestView(
    core,
    openDigest(name, typeof bytes === "string" ? encodeUTF8(bytes) : bytes),
  );
}

export function createHmac(
  algorithm: unknown,
  key: unknown,
  options: unknown,
): unknown {
  return createHmacInRealm(programRealmCore(), algorithm, key, options);
}

function randomBytesInRealm(
  core: ProgramRealmCore,
  size: unknown,
  callback: unknown,
): unknown {
  if (typeof size !== "number") return invalid(core, "size", "number", size);
  if (callback !== undefined) return unsupported(core, "randomBytes callbacks");
  return adoptNodeBuffer(core, nativeRandomBytes(size));
}

export function randomBytes(size: unknown, callback: unknown): unknown {
  return randomBytesInRealm(programRealmCore(), size, callback);
}

export function pbkdf2(
  password: unknown,
  salt: unknown,
  iterations: unknown,
  keyLength: unknown,
  digest: unknown,
  callback: unknown,
): void {
  const core = programRealmCore();
  const digestObject = viewObjectValue(digest, core.object);
  if (
    digestObject !== undefined &&
    isCallableObject<ScriptPropertyKey, unknown>(digestObject)
  )
    invalid(core, "digest", "string", undefined);
  if (typeof digest !== "string") invalid(core, "digest", "string", digest);
  const pass = inputBytes(core, password, "password", true);
  const seasoning = inputBytes(core, salt, "salt", true);
  if (typeof iterations !== "number")
    invalid(core, "iterations", "number", iterations);
  if (typeof keyLength !== "number")
    invalid(core, "keylen", "number", keyLength);
  if (!Number.isInteger(keyLength))
    fail(
      core,
      "range",
      'The value of "keylen" is out of range. It must be an integer. Received ' +
        String(keyLength),
      "ERR_OUT_OF_RANGE",
    );
  const fn = viewObjectValue(callback, core.object);
  if (fn === undefined || !isCallableObject<ScriptPropertyKey, unknown>(fn))
    invalid(core, "callback", "function", callback);
  nativePbkdf2(
    pass,
    seasoning,
    iterations,
    keyLength,
    digest,
    (error: unknown, result: Uint8Array | undefined): void => {
      const args: unknown[] = [error];
      if (result !== undefined) args.push(adoptNodeBuffer(core, result));
      const called = callObjectValue(callback, undefined, args, core.object);
      if (called.error !== "none") throw called.value;
    },
  );
}

const unsupportedCryptoExports: readonly string[] = [
  "Certificate",
  "Cipheriv",
  "Decipheriv",
  "DiffieHellman",
  "DiffieHellmanGroup",
  "ECDH",
  "Hash",
  "Hmac",
  "KeyObject",
  "Sign",
  "Verify",
  "X509Certificate",
  "argon2",
  "argon2Sync",
  "checkPrime",
  "checkPrimeSync",
  "constants",
  "createCipheriv",
  "createDecipheriv",
  "createDiffieHellman",
  "createDiffieHellmanGroup",
  "createECDH",
  "createMac",
  "createPrivateKey",
  "createPublicKey",
  "createSecretKey",
  "createSign",
  "createVerify",
  "decapsulate",
  "diffieHellman",
  "encapsulate",
  "fips",
  "generateKey",
  "generateKeyPair",
  "generateKeyPairSync",
  "generateKeySync",
  "generatePrime",
  "generatePrimeSync",
  "getCipherInfo",
  "getCiphers",
  "getCurves",
  "getDiffieHellman",
  "getFips",
  "getHashes",
  "getMacs",
  "getRandomValues",
  "hkdf",
  "hkdfSync",
  "parsePKCS12",
  "pbkdf2Sync",
  "privateDecrypt",
  "privateEncrypt",
  "prng",
  "pseudoRandomBytes",
  "publicDecrypt",
  "publicEncrypt",
  "randomFill",
  "randomFillSync",
  "randomInt",
  "randomUUIDv7",
  "rng",
  "scrypt",
  "scryptSync",
  "secureHeapUsed",
  "setEngine",
  "setFips",
  "sign",
  "subtle",
  "timingSafeEqual",
  "verify",
  "webcrypto",
];

export interface NodeCryptoModules {
  readonly crypto: RealmObject;
  readonly exportValue: (module: RealmObject, name: string) => unknown;
  readonly reportMissingExport: (name: string) => void;
}

/** Construct the public ESM exports in the owning realm. */
export function createNodeCryptoModules(
  core: ProgramRealmCore,
  toRealmError: (value: unknown) => unknown,
): NodeCryptoModules {
  const crypto = createObject<ScriptPropertyKey, unknown>(
    core.realm.objectPrototype,
  );
  function adaptError(name: string, error: unknown): never {
    const adapted = toRealmError(error);
    const object = viewObjectValue(adapted, core.object);
    if (object !== undefined) {
      const code = getProperty<ScriptPropertyKey, unknown>(
        object,
        "code",
        object,
        core.hooks,
      );
      if (
        code === "ERR_CRYPTO_INVALID_DIGEST" ||
        code === "ERR_OSSL_EVP_UNSUPPORTED"
      ) {
        const message = getProperty<ScriptPropertyKey, unknown>(
          object,
          "message",
          object,
          core.hooks,
        );
        if (typeof message === "string") {
          if (code === "ERR_CRYPTO_INVALID_DIGEST")
            return fail(core, "type", message, code);
          return unavailableDigest(core, name, message);
        }
      }
    }
    throw adapted;
  }
  registerMethod(
    core,
    crypto,
    "createHash",
    2,
    (_receiver, args): unknown => {
      try {
        return createHashInRealm(core, args[0], args[1]);
      } catch (error) {
        return adaptError("createHash", error);
      }
    },
    (_callee, _receiver, _newTarget, _count, first, second): unknown => {
      try {
        return createHashInRealm(core, first, second);
      } catch (error) {
        return adaptError("createHash", error);
      }
    },
  );
  registerMethod(
    core,
    crypto,
    "createHmac",
    3,
    (_receiver, args): unknown => {
      try {
        return createHmacInRealm(core, args[0], args[1], args[2]);
      } catch (error) {
        return adaptError("createHmac", error);
      }
    },
    (_callee, _receiver, _newTarget, _count, first, second): unknown => {
      try {
        return createHmacInRealm(core, first, second, undefined);
      } catch (error) {
        return adaptError("createHmac", error);
      }
    },
  );
  registerMethod(
    core,
    crypto,
    "randomBytes",
    2,
    (_receiver, args): unknown => {
      try {
        return randomBytesInRealm(core, args[0], args[1]);
      } catch (error) {
        return adaptError("randomBytes", error);
      }
    },
    (_callee, _receiver, _newTarget, _count, first, second): unknown => {
      try {
        return randomBytesInRealm(core, first, second);
      } catch (error) {
        return adaptError("randomBytes", error);
      }
    },
  );
  const pbkdf2Fn = builtinFunction(
    core.realm.functionPrototype,
    "pbkdf2",
    6,
    (_receiver, args): unknown => {
      try {
        pbkdf2(args[0], args[1], args[2], args[3], args[4], args[5]);
        return undefined;
      } catch (error) {
        return adaptError("pbkdf2", error);
      }
    },
    core.hooks,
  );
  builtinProperty(crypto, "pbkdf2", pbkdf2Fn, true, true, core.hooks);
  builtinProperty(
    crypto,
    "hash",
    builtinFunction(
      core.realm.functionPrototype,
      "hash",
      2,
      (_receiver, args): unknown => {
        const algorithm = args[0];
        if (typeof algorithm !== "string")
          return invalid(core, "algorithm", "string", algorithm);
        let encoding = args[2];
        if (typeof encoding === "object" && encoding !== null) {
          const options = viewObjectValue(encoding, core.object);
          if (options !== undefined)
            encoding = getProperty<ScriptPropertyKey, unknown>(
              options,
              "outputEncoding",
              options,
              core.hooks,
            );
        }
        if (encoding === undefined) encoding = "hex";
        if (typeof encoding !== "string")
          return invalid(core, "outputEncoding", "string", encoding);
        if (encoding !== "buffer" && bufferEncoding(encoding) === undefined)
          return fail(
            core,
            "type",
            "Unknown encoding: " + encoding,
            "ERR_UNKNOWN_ENCODING",
          );
        const data = inputBytes(core, args[1], "data", false);
        try {
          const object = createHashInRealm(core, algorithm, undefined);
          const lifetime = viewDigestState(core, object);
          updateDigest(lifetime, data, undefined);
          return digestOfView(core, lifetime, encoding, false);
        } catch (error) {
          return adaptError("hash", error);
        }
      },
      core.hooks,
    ),
    true,
    true,
    core.hooks,
  );
  builtinProperty(
    crypto,
    "randomUUID",
    builtinFunction(
      core.realm.functionPrototype,
      "randomUUID",
      1,
      (_receiver, args): unknown => {
        const options = args[0];
        if (options !== undefined) {
          const object = viewObjectValue(options, core.object);
          if (object === undefined || isArrayValue(options, core.realm))
            return invalid(core, "options", "object", options);
          const disable = getProperty<ScriptPropertyKey, unknown>(
            object,
            "disableEntropyCache",
            object,
            core.hooks,
          );
          if (disable !== undefined && typeof disable !== "boolean")
            return invalid(
              core,
              "options.disableEntropyCache",
              "boolean",
              disable,
            );
        }
        try {
          const bytes = nativeRandomBytes(16);
          bytes[6] = ((bytes[6] ?? 0) & 15) | 64;
          bytes[8] = ((bytes[8] ?? 0) & 63) | 128;
          const hex = bufferText(bytes, "hex");
          return (
            hex.slice(0, 8) +
            "-" +
            hex.slice(8, 12) +
            "-" +
            hex.slice(12, 16) +
            "-" +
            hex.slice(16, 20) +
            "-" +
            hex.slice(20)
          );
        } catch (error) {
          return adaptError("randomUUID", error);
        }
      },
      core.hooks,
    ),
    true,
    true,
    core.hooks,
  );
  for (const key of unsupportedCryptoExports)
    unsupportedProperty(core, crypto, key, key);
  return {
    crypto,
    exportValue: (module: RealmObject, name: string): unknown =>
      getProperty<ScriptPropertyKey, unknown>(module, name, module, core.hooks),
    reportMissingExport: (name: string): void => {
      if (unsupportedCryptoExports.includes(name)) unsupported(core, name);
    },
  };
}
