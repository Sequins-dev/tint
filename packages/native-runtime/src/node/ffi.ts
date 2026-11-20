import { encodeUTF8 } from "@tint/foundation/text/text-encoding";
import {
  builtinAccessor,
  builtinFunction,
  builtinFunctionMetadata,
  builtinProperty,
  callObjectValueOrThrow,
  createConstructorObject,
  createDataProperty,
  createObject,
  createRuntimeError,
  getObjectValuePropertyOrThrow,
  getOwnProperty,
  getProperty,
  ownKeys,
  programRealmCore,
  projectArrayBufferViewRange,
  scriptPropertyKeyOrder,
  setIntegrityLevel,
  viewObjectValue,
  wellKnownSymbol,
  type ObjectCall,
  type ProgramRealmCore,
  type ScriptPropertyKey,
} from "@tint/js-runtime/objects";
import { TARGET_AAPCS64 } from "tint:c/dl";
import {
  closeLibrary,
  findSymbolWords,
  foreignFunction,
  invoke,
  openLibrary,
  openProgram,
  resultHigh,
  resultLow,
  resultNumber,
  setBytes,
  setNumber,
  setWords,
  type ForeignFunction,
  type LibraryHandle,
  type SymbolAddress,
} from "tint:ffi/unsafe";
import {
  clearWeakSlot,
  createWeakSlot,
  weakSlotKey,
} from "../intrinsics/weak.ts";
import {
  ffiError,
  ffiObject,
  ffiString,
  parseFfiSignature,
  sameFfiSignature,
  type FfiObject,
  type FfiSignature,
  type FfiType,
} from "./ffi-signature.ts";

interface Binding {
  readonly name: string;
  readonly signature: FfiSignature;
  readonly address: SymbolAddress;
  readonly frame: ForeignFunction | undefined;
  wrapper: unknown;
}
interface DynamicLibraryState {
  readonly identity: unknown;
  readonly path: string;
  handle: LibraryHandle | undefined;
  readonly symbols: Map<string, SymbolAddress>;
  readonly bindings: Map<string, Binding>;
}
interface NodeFfi {
  readonly constructor: FfiObject;
  readonly dlopen: FfiObject;
  readonly dlclose: FfiObject;
  readonly dlsym: FfiObject;
  readonly types: FfiObject;
  readonly defaultExport: FfiObject;
}

const wordMask = 0xffffffffn;
const maxPointer = 0xffffffffffffffffn;
const minSigned = -0x8000000000000000n;
const maxSigned = 0x7fffffffffffffffn;

function word(low: number, high: number): bigint {
  return (BigInt(high) << 32n) | BigInt(low);
}
function setWord(frame: ForeignFunction, index: number, bits: bigint): void {
  setWords(
    frame,
    index,
    Number(bits & wordMask),
    Number((bits >> 32n) & wordMask),
  );
}

function invalidArgument(
  core: ProgramRealmCore,
  index: number,
  detail: string,
): never {
  return ffiError(
    core,
    "type",
    "ERR_INVALID_ARG_VALUE",
    "Argument " + index + " " + detail,
  );
}
function setPointer(
  core: ProgramRealmCore,
  frame: ForeignFunction,
  index: number,
  argument: unknown,
): void {
  if (argument === undefined || argument === null) {
    setWords(frame, index, 0, 0);
    return;
  }
  if (typeof argument === "bigint") {
    if (argument < 0n || argument > maxPointer)
      return invalidArgument(
        core,
        index,
        "must be a non-negative pointer bigint",
      );
    setWord(frame, index, argument);
    return;
  }
  if (typeof argument === "string") {
    ffiString(core, argument, "Argument " + index);
    const encoded = encodeUTF8(argument);
    const terminated = new Uint8Array(encoded.length + 1);
    terminated.set(encoded);
    setBytes(frame, index, terminated);
    return;
  }
  const object = viewObjectValue(argument, core.object);
  if (object !== undefined) {
    const window = projectArrayBufferViewRange(object);
    if (window !== undefined) {
      if (window.kind === "detached")
        return invalidArgument(
          core,
          index,
          "is an ArrayBufferView backed by a detached ArrayBuffer",
        );
      const bytes = window.bytes;
      if (bytes !== undefined) {
        setBytes(
          frame,
          index,
          bytes.subarray(
            window.byteOffset,
            window.byteOffset + window.byteLength,
          ),
        );
        return;
      }
    }
    const storage = object.internalArrayBufferData;
    if (storage !== undefined) {
      const bytes = storage.data;
      if (bytes === undefined)
        return invalidArgument(core, index, "is a detached ArrayBuffer");
      setBytes(frame, index, bytes);
      return;
    }
  }
  return invalidArgument(
    core,
    index,
    "must be a buffer, an ArrayBuffer, a string, or a bigint",
  );
}

function numberType(type: FfiType): string {
  switch (type) {
    case "i8":
      return "an int8";
    case "u8":
      return "a uint8";
    case "i16":
      return "an int16";
    case "u16":
      return "a uint16";
    case "i32":
      return "an int32";
    case "u32":
      return "a uint32";
    case "f32":
      return "a float";
    case "f64":
      return "a double";
    default:
      throw "FFI_NUMBER_TYPE_INVARIANT";
  }
}

function marshal(
  core: ProgramRealmCore,
  frame: ForeignFunction,
  index: number,
  type: FfiType,
  argument: unknown,
): void {
  if (type === "pointer") return setPointer(core, frame, index, argument);
  if (type === "i64" || type === "u64") {
    const signed = type === "i64";
    const bits =
      typeof argument === "bigint"
        ? argument
        : typeof argument === "number" && Number.isSafeInteger(argument)
          ? BigInt(argument)
          : undefined;
    if (
      bits === undefined ||
      bits < (signed ? minSigned : 0n) ||
      bits > (signed ? maxSigned : maxPointer)
    )
      return invalidArgument(
        core,
        index,
        signed ? "must be an int64" : "must be a uint64",
      );
    setWord(frame, index, bits);
    return;
  }
  const label = numberType(type);
  if (typeof argument !== "number")
    return invalidArgument(core, index, "must be " + label);
  try {
    setNumber(frame, index, argument);
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    return invalidArgument(core, index, "must be " + label);
  }
}

function unmarshal(frame: ForeignFunction, type: FfiType): unknown {
  if (type === "void") return undefined;
  if (type === "u64" || type === "i64" || type === "pointer") {
    const bits = word(resultLow(frame), resultHigh(frame));
    return type === "i64" && bits > maxSigned ? bits - (1n << 64n) : bits;
  }
  return resultNumber(frame);
}

function nodeFfiTypeTable(core: ProgramRealmCore): FfiObject {
  const object = createObject<ScriptPropertyKey, unknown>(undefined);
  const pairs: string[] = [
    "VOID",
    "void",
    "POINTER",
    "pointer",
    "BUFFER",
    "buffer",
    "ARRAY_BUFFER",
    "arraybuffer",
    "FUNCTION",
    "function",
    "BOOL",
    "bool",
    "CHAR",
    "char",
    "STRING",
    "string",
    "FLOAT",
    "float",
    "DOUBLE",
    "double",
    "INT_8",
    "int8",
    "UINT_8",
    "uint8",
    "INT_16",
    "int16",
    "UINT_16",
    "uint16",
    "INT_32",
    "int32",
    "UINT_32",
    "uint32",
    "INT_64",
    "int64",
    "UINT_64",
    "uint64",
    "FLOAT_32",
    "float32",
    "FLOAT_64",
    "float64",
  ];
  for (let index = 0; index < pairs.length; index += 2) {
    const name = pairs[index],
      value = pairs[index + 1];
    if (name === undefined || value === undefined) throw "FFI_TYPE_INVARIANT";
    createDataProperty<ScriptPropertyKey, unknown>(
      object,
      name,
      value,
      core.hooks,
    );
  }
  setIntegrityLevel<ScriptPropertyKey, unknown>(
    object,
    true,
    core.hooks,
    scriptPropertyKeyOrder,
  );
  return object;
}

function createNodeFfi(core: ProgramRealmCore, suffix: string): NodeFfi {
  const realm = core.realm,
    hooks = core.hooks;
  const states: DynamicLibraryState[] = [];
  const prototype = createObject<ScriptPropertyKey, unknown>(
    realm.objectPrototype,
  );
  const dispose = wellKnownSymbol(realm.symbolRegistry, "dispose");
  const charSigned = TARGET_AAPCS64 !== 1;

  function closed(): never {
    return ffiError(
      core,
      "error",
      "ERR_FFI_LIBRARY_CLOSED",
      "Library is closed",
    );
  }
  function requireOpen(state: DynamicLibraryState): LibraryHandle {
    const handle = state.handle;
    if (handle === undefined) return closed();
    return handle;
  }
  function requireState(receiver: unknown): DynamicLibraryState {
    if (viewObjectValue(receiver, core.object) !== undefined)
      for (const state of states)
        if (state !== undefined && weakSlotKey(state.identity) === receiver)
          return state;
    const error = createRuntimeError(realm, "type");
    builtinProperty(error, "message", "Illegal invocation", true, true, hooks);
    throw error;
  }
  function close(state: DynamicLibraryState): void {
    const handle = state.handle;
    if (handle === undefined) return;
    state.handle = undefined;
    state.symbols.clear();
    state.bindings.clear();
    try {
      closeLibrary(handle);
    } catch (error) {
      /* Node close is idempotent. */
    }
  }
  function checkedLoaderError(error: unknown): never {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "ERR_FFI_CALL_FAILED"
    )
      return ffiError(core, "error", "ERR_FFI_CALL_FAILED", error.message);
    throw error;
  }
  function resolve(state: DynamicLibraryState, name: string): SymbolAddress {
    const handle = requireOpen(state);
    const cached = state.symbols.get(name);
    if (cached !== undefined) return cached;
    try {
      return findSymbolWords(handle, name);
    } catch (error) {
      return checkedLoaderError(error);
    }
  }
  function prepare(
    state: DynamicLibraryState,
    name: string,
    definition: FfiObject,
  ): Binding {
    const signature = parseFfiSignature(core, definition, name, charSigned);
    requireOpen(state);
    const existing = state.bindings.get(name);
    if (existing !== undefined) {
      if (!sameFfiSignature(signature, existing.signature))
        return ffiError(
          core,
          "type",
          "ERR_INVALID_ARG_VALUE",
          "Function " +
            name +
            " was already requested with a different signature",
        );
      return existing;
    }
    const address = resolve(state, name);
    const numeric = address.high * 4294967296 + address.low;
    const frame =
      numeric === 0 ? undefined : foreignFunction(numeric, signature.abi);
    return { name, signature, address, frame, wrapper: undefined };
  }
  function wrapper(owner: FfiObject, binding: Binding): unknown {
    const slot = binding.wrapper;
    const existing = slot === undefined ? undefined : weakSlotKey(slot);
    if (existing !== undefined) return existing;
    const call = builtinFunction(
      realm.functionPrototype,
      binding.name,
      0,
      (_receiver, args): unknown => {
        requireOpen(requireState(owner));
        const frame = binding.frame;
        if (frame === undefined) return closed();
        const parameters = binding.signature.parameters;
        if (args.length !== parameters.length)
          return ffiError(
            core,
            "type",
            "ERR_INVALID_ARG_VALUE",
            "Invalid argument count: expected " +
              parameters.length +
              ", got " +
              args.length,
          );
        try {
          for (let index = 0; index < parameters.length; index++) {
            const type = parameters[index];
            if (type === undefined) throw "FFI_PARAMETER_INVARIANT";
            marshal(core, frame, index, type, args[index]);
          }
          invoke(frame);
          return unmarshal(frame, binding.signature.result);
        } finally {
          for (let index = 0; index < parameters.length; index++)
            if (parameters[index] === "pointer") setWords(frame, index, 0, 0);
        }
      },
      hooks,
    );
    createDataProperty<ScriptPropertyKey, unknown>(
      call,
      "pointer",
      word(binding.address.low, binding.address.high),
      hooks,
    );
    binding.wrapper = createWeakSlot(call, undefined, false);
    return call;
  }
  function publish(state: DynamicLibraryState, binding: Binding): void {
    if (!state.symbols.has(binding.name))
      state.symbols.set(binding.name, binding.address);
    if (!state.bindings.has(binding.name))
      state.bindings.set(binding.name, binding);
  }
  function functions(receiver: unknown, definitions: unknown): FfiObject {
    const state = requireState(receiver);
    const owner = ffiObject(core, receiver, "DynamicLibrary receiver");
    requireOpen(state);
    const table = createObject<ScriptPropertyKey, unknown>(undefined);
    if (definitions === undefined) {
      for (const [name, binding] of state.bindings)
        createDataProperty<ScriptPropertyKey, unknown>(
          table,
          name,
          wrapper(owner, binding),
          hooks,
        );
      return table;
    }
    const input = ffiObject(core, definitions, "Functions signatures");
    const keys = ownKeys<ScriptPropertyKey, unknown>(
      input,
      scriptPropertyKeyOrder,
    );
    const names: string[] = [];
    for (const key of keys) {
      if (typeof key !== "string") continue;
      const descriptor = getOwnProperty<ScriptPropertyKey, unknown>(input, key);
      if (descriptor !== undefined && descriptor.enumerable) names.push(key);
    }
    const pending = new Map<string, Binding>();
    for (const name of names) {
      if (name === undefined) throw "FFI_DEFINITION_INVARIANT";
      ffiString(core, name, "Function name");
      const definition = getProperty<ScriptPropertyKey, unknown>(
        input,
        name,
        input,
        hooks,
      );
      pending.set(
        name,
        prepare(
          state,
          name,
          ffiObject(core, definition, "Signature of function " + name),
        ),
      );
    }
    requireOpen(state);
    for (const [name, binding] of pending) {
      publish(state, binding);
      createDataProperty<ScriptPropertyKey, unknown>(
        table,
        name,
        wrapper(owner, binding),
        hooks,
      );
    }
    return table;
  }
  function symbols(receiver: unknown): FfiObject {
    const state = requireState(receiver);
    requireOpen(state);
    const table = createObject<ScriptPropertyKey, unknown>(undefined);
    for (const [name, address] of state.symbols)
      createDataProperty<ScriptPropertyKey, unknown>(
        table,
        name,
        word(address.low, address.high),
        hooks,
      );
    return table;
  }
  function method(
    name: string,
    length: number,
    body: ObjectCall<unknown>,
  ): FfiObject {
    return builtinFunction(realm.functionPrototype, name, length, body, hooks);
  }
  function getter(
    object: FfiObject,
    name: string,
    body: ObjectCall<unknown>,
  ): void {
    builtinAccessor(
      object,
      name,
      method("get " + name, 0, body),
      undefined,
      hooks,
    );
  }
  function load(path: unknown, parent: FfiObject): FfiObject {
    if (path !== null && typeof path !== "string")
      return ffiError(
        core,
        "type",
        "ERR_INVALID_ARG_TYPE",
        "Library path must be a string or null",
      );
    const text = path === null ? "" : ffiString(core, path, "Library path");
    for (let index = states.length - 1; index >= 0; index--) {
      const old = states[index];
      if (old !== undefined && weakSlotKey(old.identity) === undefined) {
        close(old);
        clearWeakSlot(old.identity);
        states.splice(index, 1);
      }
    }
    let handle: LibraryHandle;
    try {
      handle = path === null ? openProgram() : openLibrary(text);
    } catch (error) {
      return checkedLoaderError(error);
    }
    const object = createObject<ScriptPropertyKey, unknown>(parent);
    states.push({
      identity: createWeakSlot(object, undefined, false),
      path: text,
      handle,
      symbols: new Map<string, SymbolAddress>(),
      bindings: new Map<string, Binding>(),
    });
    getter(
      object,
      "path",
      (receiver, _args): unknown => requireState(receiver).path,
    );
    getter(object, "symbols", (receiver, _args): unknown => symbols(receiver));
    return object;
  }
  const constructor = createConstructorObject<ScriptPropertyKey, unknown>(
    realm.functionPrototype,
    (_receiver, _args): unknown =>
      ffiError(
        core,
        "type",
        "ERR_CONSTRUCT_CALL_REQUIRED",
        "Class constructor DynamicLibrary cannot be invoked without 'new'",
      ),
    (args, target): unknown => {
      const parent = viewObjectValue(
        getObjectValuePropertyOrThrow(target, "prototype", hooks, realm),
        core.object,
      );
      return load(args[0], parent ?? prototype);
    },
  );
  builtinFunctionMetadata(constructor, "DynamicLibrary", 0, hooks);
  builtinProperty(constructor, "prototype", prototype, false, false, hooks);
  builtinProperty(prototype, "constructor", constructor, true, true, hooks);
  const closeMethod = method("close", 0, (receiver, _args): unknown => {
    close(requireState(receiver));
    return undefined;
  });
  builtinProperty(prototype, "close", closeMethod, true, true, hooks);
  builtinProperty(prototype, dispose, closeMethod, true, true, hooks);
  builtinProperty(
    prototype,
    "getSymbol",
    method("getSymbol", 0, (receiver, args): unknown => {
      const state = requireState(receiver);
      const name = ffiString(core, args[0], "Symbol name");
      const address = resolve(state, name);
      state.symbols.set(name, address);
      return word(address.low, address.high);
    }),
    true,
    true,
    hooks,
  );
  builtinProperty(
    prototype,
    "getSymbols",
    method("getSymbols", 0, (receiver, _args): unknown => symbols(receiver)),
    true,
    true,
    hooks,
  );
  builtinProperty(
    prototype,
    "getFunction",
    method("getFunction", 0, (receiver, args): unknown => {
      const state = requireState(receiver);
      const owner = ffiObject(core, receiver, "DynamicLibrary receiver");
      const name = ffiString(core, args[0], "Function name");
      const definition = ffiObject(core, args[1], "Function signature");
      const binding = prepare(state, name, definition);
      publish(state, binding);
      return wrapper(owner, binding);
    }),
    true,
    true,
    hooks,
  );
  builtinProperty(
    prototype,
    "getFunctions",
    method("getFunctions", 0, (receiver, args): unknown =>
      functions(receiver, args[0]),
    ),
    true,
    true,
    hooks,
  );
  getter(prototype, "functions", (receiver, _args): unknown =>
    functions(receiver, undefined),
  );

  const dlopen = method("dlopen", 2, (_receiver, args): unknown => {
    const lib = load(args[0], prototype);
    const definitions = args[1];
    let table: FfiObject;
    try {
      table = functions(lib, definitions);
      if (definitions === undefined)
        setIntegrityLevel<ScriptPropertyKey, unknown>(
          table,
          true,
          hooks,
          scriptPropertyKeyOrder,
        );
    } catch (error) {
      close(requireState(lib));
      throw error;
    }
    const result = createObject<ScriptPropertyKey, unknown>(
      realm.objectPrototype,
    );
    createDataProperty<ScriptPropertyKey, unknown>(result, "lib", lib, hooks);
    createDataProperty<ScriptPropertyKey, unknown>(
      result,
      "functions",
      table,
      hooks,
    );
    createDataProperty<ScriptPropertyKey, unknown>(
      result,
      dispose,
      method("[Symbol.dispose]", 0, (_receiver, _args): unknown => {
        close(requireState(lib));
        return undefined;
      }),
      hooks,
    );
    return result;
  });
  const dlclose = method("dlclose", 1, (_receiver, args): unknown => {
    const handle = args[0];
    const close = getObjectValuePropertyOrThrow(handle, "close", hooks, realm);
    callObjectValueOrThrow(close, handle, [], core.object, realm);
    return undefined;
  });
  const dlsym = method("dlsym", 2, (_receiver, args): unknown => {
    const handle = args[0];
    const getSymbol = getObjectValuePropertyOrThrow(
      handle,
      "getSymbol",
      hooks,
      realm,
    );
    return callObjectValueOrThrow(
      getSymbol,
      handle,
      [args[1]],
      core.object,
      realm,
    );
  });
  const types = nodeFfiTypeTable(core);
  const defaultExport = createObject<ScriptPropertyKey, unknown>(
    realm.objectPrototype,
  );
  createDataProperty<ScriptPropertyKey, unknown>(
    defaultExport,
    "DynamicLibrary",
    constructor,
    hooks,
  );
  createDataProperty<ScriptPropertyKey, unknown>(
    defaultExport,
    "dlopen",
    dlopen,
    hooks,
  );
  createDataProperty<ScriptPropertyKey, unknown>(
    defaultExport,
    "dlclose",
    dlclose,
    hooks,
  );
  createDataProperty<ScriptPropertyKey, unknown>(
    defaultExport,
    "dlsym",
    dlsym,
    hooks,
  );
  createDataProperty<ScriptPropertyKey, unknown>(
    defaultExport,
    "types",
    types,
    hooks,
  );
  createDataProperty<ScriptPropertyKey, unknown>(
    defaultExport,
    "suffix",
    suffix,
    hooks,
  );
  return { constructor, dlopen, dlclose, dlsym, types, defaultExport };
}

export const suffix: string = TARGET_AAPCS64 === 0 ? "dylib" : "so";
const nativeNodeFfi: NodeFfi = createNodeFfi(programRealmCore(), suffix);
export const DynamicLibrary: unknown = nativeNodeFfi.constructor;
export const dlopen: unknown = nativeNodeFfi.dlopen;
export const dlclose: unknown = nativeNodeFfi.dlclose;
export const dlsym: unknown = nativeNodeFfi.dlsym;
export const types: unknown = nativeNodeFfi.types;
const defaultExport: unknown = nativeNodeFfi.defaultExport;
export { defaultExport as default };
