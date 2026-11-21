import { nodeFfiSignatureKey, type CCallLayout } from "@tint/abi/c";
import type { ByteStorage } from "@tint/js-runtime/bytes";
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
import { byteAddressInto } from "../ffi/address-words.ts";
import { consoleError } from "../intrinsics/console.ts";
import {
  allocateCallbackStub,
  bytesAt,
  bytesAtWords,
  callbackDispatcher,
  callScalarForeign,
  callScalarForeignCallbacks,
  closeLibrary,
  findSymbolWords,
  hasRegisteredCallbacks,
  openLibrary,
  openProgram,
  releaseCallbackStub,
  rethrowCallbackFailure,
  stableAddressWords,
  type CallbackDispatcher,
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
} from "./ffi-signature.ts";

import { createFfiCallbacks, type FfiCallback } from "./ffi-callbacks.ts";

import {
  ffiWeakProcessing,
  staticFfiCall,
  staticFfiIndex,
  staticFfiNumberCall,
  type StaticFfiNumberCall,
} from "./ffi-static.ts";

interface ScalarWorkspace {
  readonly frame: Uint8Array;
  readonly cells: Uint8Array[];
  readonly result: Uint8Array;
  readonly loans: Uint8Array[];
}

interface ScalarParameter {
  readonly kind: number;
  readonly pointer: boolean;
  readonly offset: number;
  readonly register: boolean;
  readonly signExtend: boolean;
}

interface ScalarCallPlan {
  readonly parameters: ScalarParameter[];
  readonly stackBytes: number;
  readonly resultOffset: number;
  readonly resultKind: number;
}

interface Binding {
  readonly name: string;
  readonly signature: FfiSignature;
  readonly address: SymbolAddress;
  readonly plan: ScalarCallPlan | undefined;
  readonly staticCall: number;
  readonly staticNumberCall: StaticFfiNumberCall | undefined;
  readonly numericAddress: number;
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
  writeFfiBigInt,
  writeScalar,
} from "./ffi-memory.ts";

const maxPointer = 0xffffffffffffffffn;

function word(low: number, high: number): bigint {
  return (BigInt(high) << 32n) | BigInt(low);
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
function lendPointer(
  core: ProgramRealmCore,
  storage: ByteStorage,
  bytes: Uint8Array,
  offset: number,
  destination: Uint8Array,
): Uint8Array {
  const backing = stableFfiBacking(core, storage, bytes);
  byteAddressInto(backing, destination);
  if (offset !== 0) {
    const cell = Cell.view(destination);
    const low = cell.halves.low + offset;
    cell.halves.low = low % 4294967296;
    if (low >= 4294967296) cell.halves.high = cell.halves.high + 1;
  }
  return backing;
}

/** Keep the storage owner rooted through the call. The native frame gets
 * the exact backing address and offset, without constructing a subview or
 * routing through a JavaScript BigInt. */
function writePointerArgument(
  core: ProgramRealmCore,
  index: number,
  argument: unknown,
  destination: Uint8Array,
): Uint8Array | undefined {
  const cell = Cell.view(destination);
  if (argument === undefined || argument === null) {
    cell.u64 = 0;
    return undefined;
  }
  if (typeof argument === "bigint") {
    if (!writeFfiBigInt(cell, argument, false))
      return invalidArgument(
        core,
        index,
        "must be a non-negative pointer bigint",
      );
    return undefined;
  }
  if (typeof argument === "string") {
    ffiString(core, argument, "Argument " + index);
    const encoded = encodeUTF8(argument);
    const terminated = external(encoded.length + 1);
    terminated.set(encoded);
    byteAddressInto(terminated, destination);
    return terminated;
  }
  const object = viewObjectValue(argument, core.object);
  if (object !== undefined) {
    const array = object.internalTypedArrayData;
    if (array !== undefined && array.kind === "Uint8") {
      const storage = array.storage;
      if (storage.kind === "ordinary") {
        const bytes = storage.data,
          length = array.length,
          offset = array.byteOffset;
        if (
          bytes !== undefined &&
          length !== undefined &&
          offset + length <= bytes.length
        )
          return lendPointer(core, storage, bytes, offset, destination);
      }
    }
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
      if (storage.kind === "shared") {
        const address = ffiSharedAddress(
          core,
          storage,
          window.byteOffset,
          window.byteLength,
        );
        if (!writeFfiBigInt(cell, address, false))
          throw "FFI_SHARED_ADDRESS_INVARIANT";
        return undefined;
      }
      if (bytes !== undefined)
        return lendPointer(
          core,
          storage,
          bytes,
          window.byteOffset,
          destination,
        );
    }
    const storage = object.internalArrayBufferData;
    if (storage !== undefined) {
      const bytes = storage.data;
      if (bytes === undefined)
        return invalidArgument(core, index, "is a detached ArrayBuffer");
      return lendPointer(core, storage, bytes, 0, destination);
    }
  }
  return invalidArgument(
    core,
    index,
    "must be a buffer, an ArrayBuffer, a string, or a bigint",
  );
}

function planScalarCall(
  signature: FfiSignature,
  layout: CCallLayout,
): ScalarCallPlan {
  const parameters: ScalarParameter[] = [];
  for (let index = 0; index < signature.parameters.length; index++) {
    const type = signature.parameters[index],
      location = layout.arguments[index];
    if (type === undefined || location === undefined)
      throw "FFI_SCALAR_ARGUMENT_INVARIANT";
    const register = location.stackOffset < 0;
    parameters.push({
      kind: scalarKind(type),
      pointer: type === "pointer",
      offset: register
        ? location.gp >= 0
          ? location.gp * 8
          : 64 + location.fp * 8
        : DynamicScalarFrame.size + location.stackOffset,
      register,
      signExtend: register && location.extend === "sign",
    });
  }
  const result = signature.result;
  return {
    parameters,
    stackBytes: layout.stackBytes,
    resultOffset: result === "f32" || result === "f64" ? 64 : 0,
    resultKind: result === "void" ? -1 : scalarKind(result),
  };
}

function scalarWorkspace(
  plan: ScalarCallPlan,
  address: SymbolAddress,
  stable: boolean,
): ScalarWorkspace {
  // Narrow Darwin stack operands can begin fewer than eight bytes from the
  // end. Padding allows an eight-byte cell view even for the final operand.
  const size = DynamicScalarFrame.size + plan.stackBytes + Cell.size - 1;
  const frame = stable ? external(size) : new Uint8Array(size);
  const view = DynamicScalarFrame.view(frame);
  view.target.low = address.low;
  view.target.high = address.high;
  view.stackBytes = plan.stackBytes;
  const args: Uint8Array[] = [];
  for (const parameter of plan.parameters)
    args.push(frame.subarray(parameter.offset, parameter.offset + Cell.size));
  return {
    frame,
    cells: args,
    result: frame.subarray(plan.resultOffset, plan.resultOffset + Cell.size),
    loans: [],
  };
}

function invokeScalar(
  core: ProgramRealmCore,
  binding: Binding,
  plan: ScalarCallPlan,
  args: readonly unknown[],
  dispatcher: CallbackDispatcher | undefined,
): unknown {
  // The outer call owns its binding's workspace. Reentrant calls get private
  // frames so they cannot overwrite saved arguments or borrowed byte roots.
  const reusable = binding.scalarDepth === 0;
  let workspace = reusable
    ? dispatcher === undefined
      ? binding.leafWorkspace
      : binding.callbackWorkspace
    : undefined;
  if (workspace === undefined) {
    workspace = scalarWorkspace(
      plan,
      binding.address,
      dispatcher !== undefined,
    );
    if (reusable) {
      if (dispatcher === undefined) binding.leafWorkspace = workspace;
      else binding.callbackWorkspace = workspace;
    }
  }
  const frame = workspace.frame;
  const cells = workspace.cells;
  const result = workspace.result;
  const loans = workspace.loans;
  binding.scalarDepth++;
  try {
    for (let index = 0; index < plan.parameters.length; index++) {
      const parameter = plan.parameters[index],
        bytes = cells[index];
      if (parameter === undefined || bytes === undefined)
        throw "FFI_SCALAR_ARGUMENT_INVARIANT";
      const argument = args[index];
      if (parameter.pointer) {
        const loan = writePointerArgument(core, index, argument, bytes);
        if (loan !== undefined) loans.push(loan);
        continue;
      }
      const cell = Cell.view(bytes);
      // A narrow stack value shares the cell with neighbouring operands.
      // Register cells own all eight bytes and may hold a prior result.
      if (parameter.register) cell.u64 = 0;
      writeScalar(core, cell, parameter.kind, argument, index);
      if (parameter.signExtend && typeof argument === "number")
        cell.i64 = argument;
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
    return plan.resultKind < 0
      ? undefined
      : readScalar(Cell.view(result), plan.resultKind);
  } finally {
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
    view: bytesAt,
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
    const staticCall = staticFfiIndex(
      nodeFfiSignatureKey(signature.result, signature.parameters),
    );
    const plan =
      address.low === 0 && address.high === 0
        ? undefined
        : planScalarCall(signature, classifyScalarCall(core, signature));
    const numericAddress = address.high * 4294967296 + address.low;
    const staticNumberCall =
      staticCall >= 0 && Number.isSafeInteger(numericAddress)
        ? staticFfiNumberCall(staticCall)
        : undefined;
    return {
      name,
      signature,
      address,
      staticCall,
      staticNumberCall,
      numericAddress,
      plan,
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
        const plan = binding.plan;
        if (plan === undefined) return closed();
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
        const numberCall = binding.staticNumberCall;
        if (!mayCallback && numberCall !== undefined)
          return numberCall(core, binding.numericAddress, args);

        return invokeScalar(
          core,
          binding,
          plan,
          args,
          mayCallback ? dispatcher : undefined,
        );
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
