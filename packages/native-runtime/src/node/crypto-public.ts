import { byteStorageData } from "@tint/js-runtime/bytes";
import {
  addPrivateField,
  builtinAccessor,
  builtinFunction,
  builtinProperty,
  callObjectValue,
  createArrayFromList,
  createCallableObject,
  createCodedRuntimeError,
  createDataProperty,
  createObject,
  createPrivateName,
  createRuntimeError,
  getPrivateElement,
  getProperty,
  isArrayValue,
  isCallableObject,
  programRealmCore,
  projectArrayBufferView,
  stringValueOrThrow,
  viewObjectValue,
  type ObjectCall,
  type OrdinaryObject,
  type ProgramRealmCore,
  type ScriptPropertyKey,
} from "@tint/js-runtime/objects";
import { adoptNodeBuffer, installNodeBuffer } from "./buffer.ts";
import {
  createHash as nativeHash,
  createHmac as nativeHmac,
  randomBytes as nativeRandomBytes,
  pbkdf2 as nativePbkdf2,
  type Hash,
} from "./crypto.ts";

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

function inputBytes(
  core: ProgramRealmCore,
  input: unknown,
  name: string,
  allowArrayBuffer: boolean,
): string | Uint8Array {
  if (typeof input === "string") return input;
  const range = projectArrayBufferView(input, core.object);
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
  if (allowArrayBuffer) {
    const object = viewObjectValue(input, core.object);
    const storage = object?.internalArrayBufferData;
    if (storage !== undefined) {
      const bytes = byteStorageData(storage);
      if (bytes !== undefined) return bytes;
    }
  }
  return invalid(core, name, "string, Buffer, TypedArray, or DataView", input);
}

function method(
  core: ProgramRealmCore,
  object: RealmObject,
  name: string,
  length: number,
  body: ObjectCall<unknown>,
): void {
  const fn = builtinFunction(
    core.realm.functionPrototype,
    name,
    length,
    body,
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

const digestState = createPrivateName("node:crypto digest");

function viewDigestState(
  core: ProgramRealmCore,
  receiver: unknown,
): ObjectCall<unknown> {
  let object = viewObjectValue(receiver, core.object);
  // Shared methods can be borrowed, including by an object with a digest
  // instance on its prototype chain.
  while (object !== undefined) {
    const field = getPrivateElement<ScriptPropertyKey, unknown>(
      { object, value: receiver },
      digestState,
      core.hooks,
    );
    if (field.error === "none") {
      const handle = viewObjectValue(field.value, core.object);
      if (handle === undefined) throw "CRYPTO_DIGEST_STATE_INVARIANT";
      const call = handle.internalCall;
      if (call === undefined) throw "CRYPTO_DIGEST_STATE_INVARIANT";
      return call;
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
  hash: Hash,
  hmac: boolean,
): RealmObject {
  const object = createObject<ScriptPropertyKey, unknown>(
    digestPrototype(core, hmac),
  );
  let finalized = false;
  const state = createCallableObject<ScriptPropertyKey, unknown>(
    undefined,
    (operation, args): unknown => {
      if (finalized) {
        if (operation === "hmac") {
          const encoding = args[0];
          return encoding && encoding !== "buffer"
            ? ""
            : adoptNodeBuffer(core, new Uint8Array(0));
        }
        return fail(
          core,
          "error",
          "Digest already called",
          "ERR_CRYPTO_HASH_FINALIZED",
        );
      }
      if (operation === "update") {
        const data = inputBytes(core, args[0], "data", false);
        const encoding = args[1];
        hash.update(data, typeof encoding === "string" ? encoding : undefined);
        return undefined;
      }
      const encoding = args[0];
      const text = encoding
        ? stringValueOrThrow(encoding, core.hooks, core.realm)
        : undefined;
      const result = hash.digest(text);
      finalized = true;
      return typeof result === "string"
        ? result
        : adoptNodeBuffer(core, result);
    },
  );
  if (
    addPrivateField<ScriptPropertyKey, unknown>(object, digestState, state) !==
    "none"
  )
    throw "CRYPTO_DIGEST_STATE_INVARIANT";
  return object;
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

function digestPrototype(core: ProgramRealmCore, hmac: boolean): RealmObject {
  const kind = hmac ? "Hmac" : "Hash";
  const brand = "node:crypto." + kind;
  const existing = core.realm.prototypes.get(brand);
  if (existing !== undefined) return existing;
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
    method(core, prototype, "update", 2, (receiver, args): unknown => {
      viewDigestState(core, receiver)("update", args);
      return receiver;
    });
  }
  method(core, prototype, "digest", 1, (receiver, args): unknown =>
    viewDigestState(core, receiver)(hmac ? "hmac" : "hash", args),
  );
  for (const stream of streamProperties)
    unsupportedProperty(core, prototype, stream, kind + "." + stream);
  if (!hmac) unsupportedProperty(core, prototype, "copy", "Hash.copy");
  core.realm.prototypes.set(brand, prototype);
  return prototype;
}

function asciiLower(text: string): string {
  let result = "";
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    result += String.fromCharCode(code >= 65 && code <= 90 ? code + 32 : code);
  }
  return result;
}

function unsupported(core: ProgramRealmCore, operation: string): never {
  return fail(
    core,
    "error",
    "node:crypto " + operation + " is outside Tint's crypto proof of concept",
    "ERR_CRYPTO_UNSUPPORTED_OPERATION",
  );
}

export function createHash(algorithm: unknown, options: unknown): unknown {
  const core = programRealmCore();
  if (typeof algorithm !== "string")
    return invalid(core, "algorithm", "string", algorithm);
  if (options !== undefined && options !== null)
    return unsupported(core, "createHash options");
  const lower = asciiLower(algorithm);
  if (lower.startsWith("shake") || lower.startsWith("cshake"))
    return unsupported(core, "XOF hashing");
  return digestView(core, nativeHash(algorithm), false);
}

export function createHmac(
  algorithm: unknown,
  key: unknown,
  options: unknown,
): unknown {
  const core = programRealmCore();
  if (typeof algorithm !== "string")
    return invalid(core, "hmac", "string", algorithm);
  if (options !== undefined && options !== null)
    return unsupported(core, "createHmac options");
  const bytes = inputBytes(core, key, "key", true);
  const name = asciiLower(algorithm) === "dss1" ? "sha1" : algorithm;
  return digestView(core, nativeHmac(name, bytes), true);
}

export function randomBytes(size: unknown, callback: unknown): unknown {
  const core = programRealmCore();
  if (typeof size !== "number") return invalid(core, "size", "number", size);
  if (callback !== undefined) return unsupported(core, "randomBytes callbacks");
  return adoptNodeBuffer(core, nativeRandomBytes(size));
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
  "hash",
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
  "randomUUID",
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
  readonly buffer: RealmObject;
  readonly exportValue: (module: RealmObject, name: string) => unknown;
  readonly require: RealmObject;
  readonly reportMissingExport: (name: string) => void;
}

/** CommonJS and ESM get the same functions and Buffer in this realm. */
export function createNodeCryptoModules(
  core: ProgramRealmCore,
  toRealmError: (value: unknown) => unknown,
): NodeCryptoModules {
  const crypto = createObject<ScriptPropertyKey, unknown>(
    core.realm.objectPrototype,
  );
  const buffer = createObject<ScriptPropertyKey, unknown>(
    core.realm.objectPrototype,
  );
  function operation(
    name: string,
    length: number,
    body: ObjectCall<unknown>,
  ): void {
    method(core, crypto, name, length, (receiver, args): unknown => {
      try {
        return body(receiver, args);
      } catch (error) {
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
    });
  }
  operation("createHash", 2, (_receiver, args): unknown =>
    createHash(args[0], args[1]),
  );
  operation("createHmac", 3, (_receiver, args): unknown =>
    createHmac(args[0], args[1], args[2]),
  );
  operation("randomBytes", 2, (_receiver, args): unknown =>
    randomBytes(args[0], args[1]),
  );
  operation("pbkdf2", 6, (_receiver, args): unknown => {
    pbkdf2(args[0], args[1], args[2], args[3], args[4], args[5]);
    return undefined;
  });
  for (const key of unsupportedCryptoExports)
    unsupportedProperty(core, crypto, key, key);
  const constructor = installNodeBuffer(core);
  builtinProperty(buffer, "Buffer", constructor, true, true, core.hooks);
  builtinProperty(
    buffer,
    "kMaxLength",
    Number.MAX_SAFE_INTEGER,
    true,
    true,
    core.hooks,
  );
  return {
    crypto,
    buffer,
    exportValue: (module: RealmObject, name: string): unknown =>
      getProperty<ScriptPropertyKey, unknown>(module, name, module, core.hooks),
    reportMissingExport: (name: string): void => {
      if (unsupportedCryptoExports.includes(name)) unsupported(core, name);
    },
    require: builtinFunction(
      core.realm.functionPrototype,
      "require",
      1,
      (_receiver, args): unknown => {
        const name = args[0];
        if (name === "node:crypto" || name === "crypto") return crypto;
        if (name === "node:buffer" || name === "buffer") return buffer;
        if (typeof name !== "string")
          return invalid(core, "id", "string", name);
        return fail(
          core,
          "error",
          "Cannot find module '" + name + "'",
          "MODULE_NOT_FOUND",
        );
      },
      core.hooks,
    ),
  };
}
