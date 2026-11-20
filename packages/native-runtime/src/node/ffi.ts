import { nodeFfiSignatureKey, type CCallLayout } from "@tint/abi/c";
import { encodeUTF8 } from "@tint/foundation/text/text-encoding";
import {
  builtinAccessor,
  builtinFunction,
  builtinFunctionMetadata,
  builtinProperty,
  callObjectValueOrThrow,
  constructObjectValueOrThrow,
  createConstructorObject,
  createDataProperty,
  createObject,
  createRuntimeError,
  getObjectValuePropertyOrThrow,
  getOwnProperty,
  getProperty,
  hostFinalizationRegistry,
  installWeakRefIntrinsics,
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
  type WeakStorageService,
} from "@tint/js-runtime/objects";
import { Cell, DynamicScalarFrame, TARGET_AAPCS64 } from "tint:c/dl";
import { abort, pthread_self } from "tint:c/ffi-callbacks";
import { callbackState, external } from "tint:ffi";
import { consoleError } from "../intrinsics/console.ts";
import {
  allocateCallbackStub,
  bytesAtWords,
  callbackDispatcher,
  callScalarForeign,
  callScalarForeignCallbacks,
  closeLibrary,
  findSymbolWords,
  foreignFunction,
  hasRegisteredCallbacks,
  invoke,
  openLibrary,
  openProgram,
  releaseCallbackStub,
  rethrowCallbackFailure,
  resultHigh,
  resultLow,
  resultNumber,
  setBytes,
  setNumber,
  setWords,
  stableAddressWords,
  type CallbackDispatcher,
  type ForeignFunction,
  type LibraryHandle,
  type SymbolAddress,
} from "tint:ffi/unsafe";
import {
  clearWeakSlot,
  createWeakSlot,
  setWeakSlotValue,
  weakSlotKey,
  weakSlotValue,
} from "../intrinsics/weak.ts";
import {
  classifyScalarCall,
  ffiError,
  ffiObject,
  ffiString,
  parseFfiSignature,
  sameFfiSignature,
  scalarKind,
  type FfiObject,
  type FfiSignature,
  type FfiType,
} from "./ffi-signature.ts";

import { createFfiCallbacks, type FfiCallback } from "./ffi-callbacks.ts";

import {
  ffiWeakProcessing,
  staticFfiCall,
  staticFfiIndex,
} from "./ffi-static.ts";

interface ScalarWorkspace {
  readonly frame: Uint8Array;
  readonly scratch: Uint8Array;
  readonly loans: Uint8Array[];
}

interface Binding {
  readonly name: string;
  readonly signature: FfiSignature;
  readonly address: SymbolAddress;
  readonly frame: ForeignFunction | undefined;
  readonly staticCall: number;
  wideLayout: CCallLayout | undefined;
  leafWorkspace: ScalarWorkspace | undefined;
  callbackWorkspace: ScalarWorkspace | undefined;
  scalarDepth: number;
  wrapper: unknown;
}
interface DynamicLibraryState {
  readonly serial: number;
  readonly identity: unknown;
  readonly path: string;
  handle: LibraryHandle | undefined;
  readonly symbols: Map<string, SymbolAddress>;
  readonly bindings: Map<string, Binding>;
  readonly callbacks: Map<number, FfiCallback>;
}
interface NodeFfi {
  readonly constructor: FfiObject;
  readonly dlopen: FfiObject;
  readonly dlclose: FfiObject;
  readonly dlsym: FfiObject;
  readonly types: FfiObject;
  readonly defaultExport: FfiObject;
}

import {
  ffiSharedAddress,
  installFfiMemory,
  readScalar,
  stableFfiBacking,
  writeScalar,
} from "./ffi-memory.ts";

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
interface FfiPointer {
  readonly low: number;
  readonly high: number;
  readonly bytes: Uint8Array | undefined;
}

function ffiPointer(bits: bigint, bytes: Uint8Array | undefined): FfiPointer {
  return {
    low: Number(bits & wordMask),
    high: Number((bits >> 32n) & wordMask),
    bytes,
  };
}

function pointerArgument(
  core: ProgramRealmCore,
  index: number,
  argument: unknown,
  stable: boolean,
): FfiPointer {
  if (argument === undefined || argument === null)
    return ffiPointer(0n, undefined);
  if (typeof argument === "bigint") {
    if (argument < 0n || argument > maxPointer)
      return invalidArgument(
        core,
        index,
        "must be a non-negative pointer bigint",
      );
    return ffiPointer(argument, undefined);
  }
  if (typeof argument === "string") {
    ffiString(core, argument, "Argument " + index);
    const encoded = encodeUTF8(argument);
    const terminated = stable
      ? external(encoded.length + 1)
      : new Uint8Array(encoded.length + 1);
    terminated.set(encoded);
    return ffiPointer(0n, terminated);
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
      const bytes = window.bytes,
        storage = window.storage;
      if (storage.kind === "shared")
        return ffiPointer(
          ffiSharedAddress(core, storage, window.byteOffset, window.byteLength),
          undefined,
        );
      if (bytes !== undefined) {
        const backing = stableFfiBacking(core, storage, bytes);
        return ffiPointer(
          0n,
          backing.subarray(
            window.byteOffset,
            window.byteOffset + window.byteLength,
          ),
        );
      }
    }
    const storage = object.internalArrayBufferData;
    if (storage !== undefined) {
      const bytes = storage.data;
      if (bytes === undefined)
        return invalidArgument(core, index, "is a detached ArrayBuffer");
      return ffiPointer(0n, stableFfiBacking(core, storage, bytes));
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
  if (type === "pointer") {
    const pointer = pointerArgument(core, index, argument, false);
    const bytes = pointer.bytes;
    if (bytes === undefined) setWords(frame, index, pointer.low, pointer.high);
    else setBytes(frame, index, bytes);
    return;
  }
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

function invokeScalar(
  core: ProgramRealmCore,
  binding: Binding,
  layout: CCallLayout,
  args: readonly unknown[],
  dispatcher: CallbackDispatcher | undefined,
): unknown {
  const header = DynamicScalarFrame.size;
  // The outer call owns its binding's workspace. Reentrant calls get private
  // frames so they cannot overwrite saved arguments or borrowed byte roots.
  const reusable = binding.scalarDepth === 0;
  let workspace = reusable
    ? dispatcher === undefined
      ? binding.leafWorkspace
      : binding.callbackWorkspace
    : undefined;
  if (workspace === undefined) {
    workspace = {
      frame:
        dispatcher === undefined
          ? new Uint8Array(header + layout.stackBytes)
          : external(header + layout.stackBytes),
      scratch: new Uint8Array(Cell.size),
      loans: [],
    };
    if (reusable) {
      if (dispatcher === undefined) binding.leafWorkspace = workspace;
      else binding.callbackWorkspace = workspace;
    }
  }
  const frame = workspace.frame;
  const loans = workspace.loans;
  const bytes = workspace.scratch;
  const view = DynamicScalarFrame.view(frame);
  view.target.low = binding.address.low;
  view.target.high = binding.address.high;
  view.stackBytes = layout.stackBytes;
  const cell = Cell.view(bytes);
  const types = binding.signature.parameters;
  binding.scalarDepth++;
  try {
    for (let index = 0; index < types.length; index++) {
      const type = types[index],
        location = layout.arguments[index];
      if (type === undefined || location === undefined)
        throw "FFI_SCALAR_ARGUMENT_INVARIANT";
      let argument = args[index];
      if (type === "pointer") {
        const pointer = pointerArgument(core, index, argument, true);
        const loan = pointer.bytes;
        if (loan === undefined) argument = word(pointer.low, pointer.high);
        else {
          loans.push(loan);
          argument = stableAddressWords(loan);
        }
      }
      cell.u64 = 0;
      writeScalar(core, cell, scalarKind(type), argument, index);
      const stackOffset = location.stackOffset;
      let offset: number, width: number;
      if (stackOffset >= 0) {
        offset = header + stackOffset;
        width = location.size;
      } else {
        offset = location.gp >= 0 ? location.gp * 8 : 64 + location.fp * 8;
        width = 8;
        if (location.extend === "sign" && typeof argument === "number")
          cell.i64 = argument;
      }
      for (let byte = 0; byte < width; byte++)
        frame[offset + byte] = bytes[byte] ?? 0;
    }
    const fixed = binding.staticCall;
    const completed =
      dispatcher !== undefined
        ? callScalarForeignCallbacks(callbackState(), dispatcher, frame)
        : fixed < 0
          ? callScalarForeign(frame)
          : staticFfiCall(fixed, frame);
    if (!completed)
      return ffiError(
        core,
        "range",
        "ERR_FFI_CALL_FAILED",
        "Insufficient native stack for FFI arguments",
      );
    if (dispatcher !== undefined) rethrowCallbackFailure();
    const result = binding.signature.result;
    if (result === "void") return undefined;
    const offset = result === "f32" || result === "f64" ? 64 : 0;
    for (let byte = 0; byte < Cell.size; byte++)
      bytes[byte] = frame[offset + byte] ?? 0;
    return readScalar(cell, scalarKind(result));
  } finally {
    // C holds only raw words. Keep the true storage roots live across the loan.
    while (loans.length !== 0) loans.pop();
    binding.scalarDepth--;
  }
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
  let serial = 0;
  const prototype = createObject<ScriptPropertyKey, unknown>(
    realm.objectPrototype,
  );
  const dispose = wellKnownSymbol(realm.symbolRegistry, "dispose");
  const charSigned = TARGET_AAPCS64 !== 1;
  const callbacks = createFfiCallbacks(core, {
    allocate: (id): number => allocateCallbackStub(id, pthread_self()),
    release: releaseCallbackStub,
    view: bytesAtWords,
    abort: (message: string): never => {
      consoleError(message);
      abort();
      throw "FFI_ABORT_RETURNED";
    },
  });
  const dispatcher: CallbackDispatcher = (
    id,
    a0,
    a1,
    a2,
    a3,
    a4,
    a5,
    a6,
  ): number =>
    id < 0
      ? callbacks.dispatch(id, a0)
      : callbackDispatcher()(id, a0, a1, a2, a3, a4, a5, a6);

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
    for (const [, callback] of state.callbacks)
      if (callback.executing !== 0)
        return ffiError(
          core,
          "type",
          "ERR_INVALID_ARG_VALUE",
          "Cannot close a library with an active FFI callback",
        );
    state.handle = undefined;
    for (const [, callback] of state.callbacks) callbacks.release(callback);
    state.callbacks.clear();
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
    let pointers = 0;
    for (const type of signature.parameters) if (type === "pointer") pointers++;
    // Keep the existing scalar leaf trampoline for signatures it can carry.
    const staticCall = staticFfiIndex(
      nodeFfiSignatureKey(signature.result, signature.parameters),
    );
    const wide =
      staticCall >= 0 ||
      signature.parameters.length > 64 ||
      pointers > 8 ||
      (address.high >= 2097152 && !Number.isSafeInteger(numeric));
    const frame =
      numeric === 0 || wide
        ? undefined
        : foreignFunction(numeric, signature.abi);
    const wideLayout =
      numeric === 0 || !wide ? undefined : classifyScalarCall(core, signature);
    return {
      name,
      signature,
      address,
      frame,
      staticCall,
      wideLayout,
      leafWorkspace: undefined,
      callbackWorkspace: undefined,
      scalarDepth: 0,
      wrapper: undefined,
    };
  }
  function wrapper(
    owner: FfiObject,
    state: DynamicLibraryState,
    binding: Binding,
  ): unknown {
    const slot = binding.wrapper;
    const existing = slot === undefined ? undefined : weakSlotKey(slot);
    if (existing !== undefined) return existing;
    const call = builtinFunction(
      realm.functionPrototype,
      binding.name,
      0,
      (_receiver, args): unknown => {
        requireOpen(state);
        // The wrapper retains its owner while the library caches the wrapper
        // weakly. Validate this single identity without searching the realm.
        if (weakSlotKey(state.identity) !== owner)
          throw "FFI_WRAPPER_OWNER_INVARIANT";
        const frame = binding.frame;
        let wideLayout = binding.wideLayout;
        if (frame === undefined && wideLayout === undefined) return closed();
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
        const mayCallback = callbacks.active() || hasRegisteredCallbacks();
        if (mayCallback && wideLayout === undefined) {
          wideLayout = classifyScalarCall(core, binding.signature);
          binding.wideLayout = wideLayout;
        }
        if ((mayCallback || frame === undefined) && wideLayout !== undefined)
          return invokeScalar(
            core,
            binding,
            wideLayout,
            args,
            mayCallback ? dispatcher : undefined,
          );
        if (frame === undefined) throw "FFI_SCALAR_BINDING_INVARIANT";
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
          wrapper(owner, state, binding),
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
        wrapper(owner, state, binding),
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
  function forget(index: number, state: DynamicLibraryState): void {
    close(state);
    clearWeakSlot(state.identity);
    states.splice(index, 1);
  }
  const weakStorage: WeakStorageService = {
    create: (key, value, ephemeron): unknown =>
      createWeakSlot(key, value, ephemeron),
    key: (cell): unknown => weakSlotKey(cell),
    value: (cell): unknown => weakSlotValue(cell),
    setValue: (cell, value): void => setWeakSlotValue(cell, value),
    clear: (cell): void => clearWeakSlot(cell),
  };
  if (ffiWeakProcessing()) {
    if (realm.agent.weakStorage === undefined)
      realm.agent.weakStorage = weakStorage;
    if (!core.installed.has("installWeakRefIntrinsics")) {
      installWeakRefIntrinsics(core.object, realm, hooks);
      core.installed.add("installWeakRefIntrinsics");
    }
  }
  const trackLibrary = hostFinalizationRegistry(
    realm,
    weakStorage,
    method("release FFI library", 1, (_receiver, args): unknown => {
      const expired = args[0];
      for (let index = 0; index < states.length; index++) {
        const state = states[index];
        if (state !== undefined && state.serial === expired) {
          forget(index, state);
          break;
        }
      }
      return undefined;
    }),
  );
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
    if (!ffiWeakProcessing())
      return ffiError(
        core,
        "error",
        "ERR_FFI_CALL_FAILED",
        "node:ffi DynamicLibrary requires a runtime that processes weak slots",
      );
    for (let index = states.length - 1; index >= 0; index--) {
      const old = states[index];
      if (old !== undefined && weakSlotKey(old.identity) === undefined)
        forget(index, old);
    }
    let handle: LibraryHandle;
    try {
      handle = path === null ? openProgram() : openLibrary(text);
    } catch (error) {
      return checkedLoaderError(error);
    }
    const object = createObject<ScriptPropertyKey, unknown>(parent);
    const identity = createWeakSlot(object, undefined, false);
    serial++;
    states.push({
      serial,
      identity,
      path: text,
      handle,
      symbols: new Map<string, SymbolAddress>(),
      bindings: new Map<string, Binding>(),
      callbacks: new Map<number, FfiCallback>(),
    });
    trackLibrary(object, serial);
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
  builtinFunctionMetadata(constructor, "DynamicLibrary", 1, hooks);
  builtinProperty(constructor, "prototype", prototype, true, false, hooks);
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
    method("getFunction", 2, (receiver, args): unknown => {
      const state = requireState(receiver);
      const owner = ffiObject(core, receiver, "DynamicLibrary receiver");
      const name = ffiString(core, args[0], "Function name");
      const definition = ffiObject(core, args[1], "Function signature");
      const binding = prepare(state, name, definition);
      publish(state, binding);
      return wrapper(owner, state, binding);
    }),
    true,
    true,
    hooks,
  );
  builtinProperty(
    prototype,
    "getFunctions",
    method("getFunctions", 1, (receiver, args): unknown =>
      functions(receiver, args[0]),
    ),
    true,
    true,
    hooks,
  );
  getter(prototype, "functions", (receiver, _args): unknown =>
    functions(receiver, undefined),
  );

  function callableCallback(value: unknown): boolean {
    return viewObjectValue(value, core.object)?.internalCall !== undefined;
  }
  builtinProperty(
    prototype,
    "registerCallback",
    method("registerCallback", 0, (receiver, args): unknown => {
      const state = requireState(receiver);
      const first = args[0];
      const implicit = callableCallback(first);
      const definition = implicit
        ? createObject<ScriptPropertyKey, unknown>(undefined)
        : ffiObject(core, first, "First callback argument");
      const callback = implicit ? first : args[1];
      if (!implicit && !callableCallback(callback))
        return ffiError(
          core,
          "type",
          "ERR_INVALID_ARG_TYPE",
          "Second argument must be a function",
        );
      const signature = parseFfiSignature(
        core,
        definition,
        "<callback>",
        charSigned,
      );
      requireOpen(state);
      const entry = callbacks.register(signature, callback);
      state.callbacks.set(entry.address, entry);
      return BigInt(entry.address);
    }),
    true,
    true,
    hooks,
  );
  for (const name of ["unregisterCallback", "refCallback", "unrefCallback"]) {
    if (name === undefined) throw "FFI_CALLBACK_METHOD_INVARIANT";
    builtinProperty(
      prototype,
      name,
      method(name, 0, (receiver, args): unknown => {
        const state = requireState(receiver);
        requireOpen(state);
        const address = args[0];
        if (typeof address !== "bigint")
          return ffiError(
            core,
            "type",
            "ERR_INVALID_ARG_TYPE",
            "The first argument must be a bigint",
          );
        if (address < 0n || address > maxPointer)
          return ffiError(
            core,
            "type",
            "ERR_INVALID_ARG_VALUE",
            "The first argument must be a non-negative bigint",
          );
        const entry = state.callbacks.get(Number(address));
        if (entry === undefined || BigInt(entry.address) !== address)
          return ffiError(
            core,
            "type",
            "ERR_INVALID_ARG_VALUE",
            "Callback not found",
          );
        if (name === "unregisterCallback") {
          callbacks.release(entry);
          state.callbacks.delete(entry.address);
        } else callbacks.ref(entry, name === "refCallback");
        return undefined;
      }),
      true,
      true,
      hooks,
    );
  }

  function disposeLibrary(lib: unknown): void {
    const close = getObjectValuePropertyOrThrow(lib, "close", hooks, realm);
    callObjectValueOrThrow(close, lib, [], core.object, realm);
  }
  const dlclose = method("dlclose", 1, (_receiver, args): unknown => {
    disposeLibrary(args[0]);
    return undefined;
  });
  const dlopen = method("dlopen", 2, (_receiver, args): unknown => {
    const lib = constructObjectValueOrThrow(
      realm,
      constructor,
      [args[0]],
      core.object,
    );
    const definitions = args[1];
    let table: unknown;
    try {
      if (definitions === undefined) {
        const empty = createObject<ScriptPropertyKey, unknown>(undefined);
        setIntegrityLevel<ScriptPropertyKey, unknown>(
          empty,
          true,
          hooks,
          scriptPropertyKeyOrder,
        );
        table = empty;
      } else {
        const get = getObjectValuePropertyOrThrow(
          lib,
          "getFunctions",
          hooks,
          realm,
        );
        table = callObjectValueOrThrow(
          get,
          lib,
          [definitions],
          core.object,
          realm,
        );
      }
    } catch (error) {
      disposeLibrary(lib);
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
        disposeLibrary(lib);
        return undefined;
      }),
      hooks,
    );
    return result;
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
  installFfiMemory(
    core,
    { view: bytesAtWords, address: stableAddressWords },
    defaultExport,
  );
  createDataProperty<ScriptPropertyKey, unknown>(
    defaultExport,
    "getCurrentEventLoop",
    method("getCurrentEventLoop", 0, (_receiver, _args): unknown =>
      ffiError(
        core,
        "error",
        "ERR_FFI_CALL_FAILED",
        "getCurrentEventLoop requires a libuv embedding",
      ),
    ),
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
function ffiExport(name: string): unknown {
  return getOwnProperty<ScriptPropertyKey, unknown>(
    nativeNodeFfi.defaultExport,
    name,
  )?.value;
}
export const getInt8: unknown = ffiExport("getInt8");
export const getUint8: unknown = ffiExport("getUint8");
export const getInt16: unknown = ffiExport("getInt16");
export const getUint16: unknown = ffiExport("getUint16");
export const getInt32: unknown = ffiExport("getInt32");
export const getUint32: unknown = ffiExport("getUint32");
export const getInt64: unknown = ffiExport("getInt64");
export const getUint64: unknown = ffiExport("getUint64");
export const getFloat32: unknown = ffiExport("getFloat32");
export const getFloat64: unknown = ffiExport("getFloat64");
export const setInt8: unknown = ffiExport("setInt8");
export const setUint8: unknown = ffiExport("setUint8");
export const setInt16: unknown = ffiExport("setInt16");
export const setUint16: unknown = ffiExport("setUint16");
export const setInt32: unknown = ffiExport("setInt32");
export const setUint32: unknown = ffiExport("setUint32");
export const setInt64: unknown = ffiExport("setInt64");
export const setUint64: unknown = ffiExport("setUint64");
export const setFloat32: unknown = ffiExport("setFloat32");
export const setFloat64: unknown = ffiExport("setFloat64");
export const exportBuffer: unknown = ffiExport("exportBuffer");
export const exportString: unknown = ffiExport("exportString");
export const exportArrayBuffer: unknown = ffiExport("exportArrayBuffer");
export const exportArrayBufferView: unknown = ffiExport(
  "exportArrayBufferView",
);
export const toBuffer: unknown = ffiExport("toBuffer");
export const toArrayBuffer: unknown = ffiExport("toArrayBuffer");
export const toString: unknown = ffiExport("toString");
export const getRawPointer: unknown = ffiExport("getRawPointer");
export const getCurrentEventLoop: unknown = ffiExport("getCurrentEventLoop");
const defaultExport: unknown = nativeNodeFfi.defaultExport;
export { defaultExport as default };
