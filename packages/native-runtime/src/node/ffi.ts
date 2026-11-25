import {
  nodeFfiScalarKind,
  nodeFfiSignatureKey,
  type CCallLayout,
} from "@tint/abi/c";
import type { ByteStorage } from "@tint/js-runtime/bytes";
import { encodeUTF8 } from "@tint/foundation/text/text-encoding";
import {
  builtinAccessor,
  builtinFunction,
  builtinFunctionMetadata,
  builtinProperty,
  callObjectValueOrThrow,
  constructObjectValueOrThrow,
  createCallableObject,
  createConstructorObject,
  createDataProperty,
  createExoticObject,
  createObject,
  createRuntimeError,
  ensureRareSlots,
  exoticSlots,
  getObjectValuePropertyOrThrow,
  getOwnProperty,
  getProperty,
  hostFinalizationRegistry,
  installWeakRefIntrinsics,
  ownKeys,
  programRealmCore,
  projectArrayBufferViewRange,
  activeInRealm,
  runRealmBoundCall,
  scriptPropertyKeyOrder,
  setIntegrityLevel,
  viewBigIntValue,
  viewObjectValue,
  wellKnownSymbol,
  type ObjectCall,
  type ObjectCallDispatch,
  type ObjectExecutionContext,
  type ProgramRealmCore,
  type ScriptExecutionContext,
  type ScriptPropertyKey,
  type WeakStorageService,
} from "@tint/js-runtime/objects";
import { Cell, DynamicScalarFrame, TARGET_AAPCS64 } from "tint:c/dl";
import { abort, pthread_self } from "tint:c/ffi-callbacks";
import { callbackState, external, stableBytes } from "tint:ffi";
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
  openLibrary,
  openProgram,
  registeredCallbackActivity,
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
  type FfiObject,
  type FfiSignature,
} from "./ffi-signature.ts";

import { createFfiCallbacks, type FfiCallback } from "./ffi-callbacks.ts";

import {
  ffiWeakProcessing,
  staticFfiBytesCall,
  staticFfiCall,
  staticFfiIndex,
  staticFfiNumberCall,
  staticFfiScriptBinaryCall,
  staticFfiScriptNumberCall,
  staticFfiScriptUnaryCall,
  typedFfiIndex,
  type StaticFfiBytesCall,
  type StaticFfiNumberCall,
} from "./ffi-static.ts";

interface ScalarCallPlan {
  readonly parameters: FfiScalarParameter[];
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
  readonly typedCall: number;
  readonly staticNumberCall: StaticFfiNumberCall | undefined;
  readonly staticBytesCall: StaticFfiBytesCall | undefined;
  /** One lent pointer argument and a Number result. */
  readonly unaryPointerNumber: boolean;
  /** `(pointer, i32) => i32`, the shape of a callback trampoline call. */
  readonly pointerI32: boolean;
  readonly numericAddress: number;
  leafWorkspace: TypedFfiWorkspace | undefined;
  callbackWorkspace: TypedFfiWorkspace | undefined;
  scalarDepth: number;
  wrapper: unknown;
}
interface DynamicLibraryState {
  readonly serial: number;
  readonly identity: unknown;
  readonly path: string;
  handle: LibraryHandle | undefined;
  readonly lifetime: FfiLibraryLifetime;
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
  checkedTypedFfiNumber,
  readTypedFfiNumber,
  ffiSharedAddress,
  installFfiMemory,
  projectFfiPointerAddress,
  readScalar,
  stableFfiBacking,
  writeFfiBigInt,
  writeScalar,
  writeTypedFfiNumber,
  type FfiLibraryLifetime,
  type FfiScalarParameter,
  type TypedFfiCall,
  type TypedFfiWorkspace,
} from "./ffi-memory.ts";

const maxPointer = 0xffffffffffffffffn;

function word(low: number, high: number): bigint {
  return (BigInt(high) << 32n) | BigInt(low);
}
/** The identity slot is created for the library object and is cleared only
 * after that object is collected. Every wrapper entry captures the object,
 * so while one runs a live slot names its owner. Testing presence avoids an
 * object identity comparison, which realm error views make costly, on every
 * call. */
function ownerLive(state: DynamicLibraryState): boolean {
  return weakSlotKey(state.identity) !== undefined;
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
  const object = viewObjectValue(argument, core.object);
  if (object !== undefined) {
    const slots = exoticSlots(object);
    const array = slots.internalTypedArrayData;
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
    const storage = slots.internalArrayBufferData;
    if (storage !== undefined) {
      const bytes = storage.data;
      if (bytes === undefined)
        return invalidArgument(core, index, "is a detached ArrayBuffer");
      return lendPointer(core, storage, bytes, 0, destination);
    }
  }
  // A BigInt view avoids the realm typeof classifier on every pointer call.
  if (viewBigIntValue(argument) !== undefined) {
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
  const parameters: FfiScalarParameter[] = [];
  for (let index = 0; index < signature.parameters.length; index++) {
    const type = signature.parameters[index],
      location = layout.arguments[index];
    if (type === undefined || location === undefined)
      throw "FFI_SCALAR_ARGUMENT_INVARIANT";
    const register = location.stackOffset < 0;
    parameters.push({
      kind: nodeFfiScalarKind(type),
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
    resultKind: result === "void" ? -1 : nodeFfiScalarKind(result),
  };
}

function scalarWorkspace(
  plan: ScalarCallPlan,
  address: SymbolAddress,
  stable: boolean,
): TypedFfiWorkspace {
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

function acquireScalarWorkspace(
  binding: Binding,
  plan: ScalarCallPlan,
  mayCallback: boolean,
): TypedFfiWorkspace {
  // Reentrant calls cannot overwrite an enclosing call's arguments or roots.
  const reusable = binding.scalarDepth === 0;
  let workspace = reusable
    ? mayCallback
      ? binding.callbackWorkspace
      : binding.leafWorkspace
    : undefined;
  if (workspace === undefined) {
    workspace = scalarWorkspace(plan, binding.address, mayCallback);
    if (reusable) {
      if (mayCallback) binding.callbackWorkspace = workspace;
      else binding.leafWorkspace = workspace;
    }
  }
  binding.scalarDepth++;
  return workspace;
}

function releaseScalarWorkspace(
  binding: Binding,
  workspace: TypedFfiWorkspace,
): void {
  const loans = workspace.loans;
  while (loans.length !== 0) loans.pop();
  binding.scalarDepth--;
}

function writeScalarArgument(
  core: ProgramRealmCore,
  plan: ScalarCallPlan,
  workspace: TypedFfiWorkspace,
  index: number,
  argument: unknown,
): void {
  const parameter = plan.parameters[index],
    bytes = workspace.cells[index];
  if (parameter === undefined || bytes === undefined)
    throw "FFI_SCALAR_ARGUMENT_INVARIANT";
  if (parameter.pointer) {
    const loan = writePointerArgument(core, index, argument, bytes);
    if (loan !== undefined) workspace.loans.push(loan);
    return;
  }
  const cell = Cell.view(bytes);
  // A narrow stack value can share its cell with a neighbouring operand.
  if (parameter.register) cell.u64 = 0;
  writeScalar(core, cell, parameter.kind, argument, index);
  if (parameter.signExtend && typeof argument === "number") cell.i64 = argument;
}

function runScalarFrame(
  core: ProgramRealmCore,
  binding: Binding,
  frame: Uint8Array,
  dispatcher: CallbackDispatcher | undefined,
): void {
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
}

function invokeScalar(
  core: ProgramRealmCore,
  binding: Binding,
  plan: ScalarCallPlan,
  args: readonly unknown[],
  dispatcher: CallbackDispatcher | undefined,
): unknown {
  const workspace = acquireScalarWorkspace(
    binding,
    plan,
    dispatcher !== undefined,
  );
  const cells = workspace.cells;
  const loans = workspace.loans;
  try {
    // Keep the generic adapter's marshaling loop direct. The positional
    // writer is used by typed callers with no argument list.
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
      if (
        parameter.kind === 4 &&
        typeof argument === "number" &&
        (argument | 0) === argument
      ) {
        // An exact int32 needs no further checks. A register word holds the
        // same bits as the general path writes; a stack operand keeps to its
        // four bytes because a neighbour can share the cell.
        if (!parameter.register) cell.i32 = argument;
        else if (parameter.signExtend) cell.i64 = argument;
        else cell.u64 = argument >>> 0;
        continue;
      }
      if (parameter.register) cell.u64 = 0;
      writeScalar(core, cell, parameter.kind, argument, index);
      if (parameter.signExtend && typeof argument === "number")
        cell.i64 = argument;
    }
    runScalarFrame(core, binding, workspace.frame, dispatcher);
    return plan.resultKind < 0
      ? undefined
      : readScalar(Cell.view(workspace.result), plan.resultKind);
  } finally {
    releaseScalarWorkspace(binding, workspace);
  }
}

function invokeUnaryPointerLeaf(
  core: ProgramRealmCore,
  binding: Binding,
  plan: ScalarCallPlan,
  input: unknown,
): number {
  const direct = binding.staticBytesCall;
  if (direct !== undefined) {
    const object = viewObjectValue(input, core.object);
    const view =
      object === undefined
        ? undefined
        : exoticSlots(object).internalTypedArrayData;
    const length = view?.length;
    const storage = view?.storage;
    if (
      view?.kind === "Uint8" &&
      view.byteOffset === 0 &&
      length !== undefined &&
      length !== 0 &&
      storage?.kind === "ordinary"
    ) {
      const bytes = storage.data;
      if (bytes !== undefined && length <= bytes.length && stableBytes(bytes))
        return direct(binding.numericAddress, bytes);
    }
  }
  const workspace = acquireScalarWorkspace(binding, plan, false);
  try {
    const bytes = workspace.cells[0];
    if (bytes === undefined) throw "FFI_SCALAR_ARGUMENT_INVARIANT";
    const loan = writePointerArgument(core, 0, input, bytes);
    if (loan !== undefined) workspace.loans.push(loan);
    runScalarFrame(core, binding, workspace.frame, undefined);
    return readTypedFfiNumber(workspace.result, plan.resultKind);
  } finally {
    releaseScalarWorkspace(binding, workspace);
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
  const agent = realm.agent;
  const nativeCaller: ScriptExecutionContext = {
    realm,
    scriptOrModule: undefined,
  };
  // Bound calls use the existing active Script/module when it belongs to this
  // realm. Typed callers with no active Script/module use one shared context.
  const callContext: ObjectExecutionContext<unknown> = {
    getRealm: () => realm,
    run: (action): unknown =>
      runRealmBoundCall(agent, realm, nativeCaller, action),
  };
  const states: DynamicLibraryState[] = [];
  let serial = 0;
  const prototype = createObject<ScriptPropertyKey, unknown>(
    realm.objectPrototype,
  );
  const dispose = wellKnownSymbol(realm.symbolRegistry, "dispose");
  const charSigned = TARGET_AAPCS64 !== 1;
  const callbacks = createFfiCallbacks(core, {
    allocate: (id, unaryI32): number =>
      allocateCallbackStub(id, pthread_self(), unaryI32),
    release: releaseCallbackStub,
    view: bytesAt,
    abort: (message: string): never => {
      consoleError(message);
      abort();
      throw "FFI_ABORT_RETURNED";
    },
  });
  const nativeCallbacks = registeredCallbackActivity();
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

  function invokeCallbackFrame(binding: Binding, frame: Uint8Array): void {
    const caller = agent.activeContext;
    const depth = agent.executionContextDepth;
    agent.activeContext =
      caller === undefined
        ? nativeCaller
        : caller.realm === realm
          ? caller
          : { realm, scriptOrModule: caller.scriptOrModule };
    agent.executionContextDepth = depth + 1;
    try {
      runScalarFrame(core, binding, frame, dispatcher);
    } finally {
      agent.activeContext = caller;
      agent.executionContextDepth = depth;
    }
  }

  function invokePointerI32Callback(
    binding: Binding,
    plan: ScalarCallPlan,
    pointer: unknown,
    input: number,
  ): number | undefined {
    const address = projectFfiPointerAddress(pointer);
    if (address === undefined) return undefined;
    const workspace = acquireScalarWorkspace(binding, plan, true);
    try {
      const first = workspace.cells[0],
        second = workspace.cells[1];
      if (first === undefined || second === undefined)
        throw "FFI_SCALAR_ARGUMENT_INVARIANT";
      Cell.view(first).u64 = address;
      Cell.view(second).i64 = input;
      invokeCallbackFrame(binding, workspace.frame);
      return Cell.view(workspace.result).i32;
    } finally {
      releaseScalarWorkspace(binding, workspace);
    }
  }

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
    state.lifetime.open = false;
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
    const key = nodeFfiSignatureKey(signature.result, signature.parameters);
    const staticCall = staticFfiIndex(key);
    const plan =
      address.low === 0 && address.high === 0
        ? undefined
        : planScalarCall(signature, classifyScalarCall(core, signature));
    const numericAddress = address.high * 4294967296 + address.low;
    const addressFits = Number.isSafeInteger(numericAddress);
    const typedIndex = addressFits
      ? staticCall >= 0
        ? staticCall
        : typedFfiIndex(key)
      : -1;
    // The common prototypes compiled for the program's call arities serve
    // any binding whose runtime signature has the same key.
    const staticNumberCall =
      typedIndex >= 0 ? staticFfiNumberCall(typedIndex) : undefined;
    const parameters = signature.parameters;
    return {
      name,
      signature,
      address,
      staticCall,
      typedCall: typedIndex,
      staticNumberCall,
      staticBytesCall: staticFfiBytesCall(typedIndex),
      unaryPointerNumber:
        plan !== undefined &&
        plan.parameters.length === 1 &&
        plan.parameters[0]?.pointer === true &&
        plan.resultKind >= 0 &&
        plan.resultKind !== 6 &&
        plan.resultKind !== 7,
      pointerI32:
        signature.result === "i32" &&
        parameters.length === 2 &&
        parameters[0] === "pointer" &&
        parameters[1] === "i32",
      numericAddress,
      plan,
      leafWorkspace: undefined,
      callbackWorkspace: undefined,
      scalarDepth: 0,
      wrapper: undefined,
    };
  }
  /** `retained` is the library object each entry captures, so a wrapper keeps
   * its library reachable while the library caches the wrapper weakly. */
  function callBinding(
    retained: FfiObject,
    state: DynamicLibraryState,
    binding: Binding,
    args: readonly unknown[],
  ): unknown {
    if (state.handle === undefined) return closed();
    if (!ownerLive(state)) throw "FFI_WRAPPER_OWNER_INVARIANT";
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
    const mayCallback = callbacks.activity.active || nativeCallbacks.active;
    // General callers share the typed callers' entries for these shapes.
    if (!mayCallback) {
      const numberCall = binding.staticNumberCall;
      if (numberCall !== undefined)
        return numberCall(core, binding.numericAddress, args);
      if (binding.unaryPointerNumber)
        return invokeUnaryPointerLeaf(core, binding, plan, args[0]);
    } else if (binding.pointerI32 && binding.scalarDepth === 0) {
      // Invalid or unprojected operands take the ordinary path, which
      // reports them in argument order.
      const input = args[1];
      if (typeof input === "number" && (input | 0) === input) {
        const result = invokePointerI32Callback(binding, plan, args[0], input);
        if (result !== undefined) return result;
      }
    }
    return invokeScalar(
      core,
      binding,
      plan,
      args,
      mayCallback ? dispatcher : undefined,
    );
  }
  /** Positional calls from the creating Script or module enter the binding
   * directly. The ordinary entry runs in the caller's own context, which the
   * register guard has already matched, so only the argument list, the realm
   * thunk and the call result record are skipped. One argument list per
   * wrapper is reused outside reentrant calls and cleared after each call. */
  function installRegisterCall(
    call: FfiObject,
    owner: FfiObject,
    state: DynamicLibraryState,
    binding: Binding,
  ): void {
    const active = agent.activeContext;
    if (active === undefined || active.realm !== realm) return;
    const arity = binding.signature.parameters.length;
    const plan = binding.plan;
    const fallback = (args: readonly unknown[]): unknown => {
      const depth = agent.executionContextDepth;
      agent.executionContextDepth = depth + 1;
      try {
        return callBinding(owner, state, binding, args);
      } finally {
        agent.executionContextDepth = depth;
      }
    };
    const scriptInvoke =
      binding.staticNumberCall !== undefined && binding.typedCall >= 0
        ? staticFfiScriptNumberCall(
            binding.typedCall,
            core,
            binding.numericAddress,
            state.lifetime,
            callbacks.activity,
            nativeCallbacks,
            fallback,
          )
        : binding.unaryPointerNumber && plan !== undefined
          ? staticFfiScriptUnaryCall((arg0): unknown => {
              if (
                state.handle === undefined ||
                callbacks.activity.active ||
                nativeCallbacks.active
              )
                return fallback([arg0]);
              return invokeUnaryPointerLeaf(core, binding, plan, arg0);
            }, fallback)
          : binding.pointerI32 && plan !== undefined
            ? staticFfiScriptBinaryCall((arg0, arg1): unknown => {
                if (
                  state.handle !== undefined &&
                  binding.scalarDepth === 0 &&
                  (callbacks.activity.active || nativeCallbacks.active) &&
                  typeof arg1 === "number" &&
                  (arg1 | 0) === arg1
                ) {
                  const result = invokePointerI32Callback(
                    binding,
                    plan,
                    arg0,
                    arg1,
                  );
                  if (result !== undefined) return result;
                }
                return fallback([arg0, arg1]);
              }, fallback)
            : undefined;
    if (arity > 6 && scriptInvoke === undefined) return;
    let invoke:
      | ((
          callee: unknown,
          receiver: unknown,
          newTarget: unknown,
          count: number,
          first: unknown,
          second: unknown,
        ) => unknown)
      | undefined;
    let invokeWide:
      | ((
          callee: unknown,
          receiver: unknown,
          newTarget: unknown,
          count: number,
          first: unknown,
          second: unknown,
          third: unknown,
          fourth: unknown,
          fifth: unknown,
          sixth: unknown,
        ) => unknown)
      | undefined;
    if (arity <= 6) {
      const reusable: unknown[] = [];
      for (let index = 0; index < arity; index++) reusable.push(undefined);
      let reusing = false;
      const enter = (
        count: number,
        first: unknown,
        second: unknown,
        third: unknown,
        fourth: unknown,
        fifth: unknown,
        sixth: unknown,
      ): unknown => {
        const reuse = count === arity && !reusing;
        const args: unknown[] = reuse ? reusable : [];
        if (reuse) reusing = true;
        if (count > 0) args[0] = first;
        if (count > 1) args[1] = second;
        if (count > 2) args[2] = third;
        if (count > 3) args[3] = fourth;
        if (count > 4) args[4] = fifth;
        if (count > 5) args[5] = sixth;
        const depth = agent.executionContextDepth;
        agent.executionContextDepth = depth + 1;
        try {
          return callBinding(owner, state, binding, args);
        } finally {
          agent.executionContextDepth = depth;
          if (reuse) {
            for (let index = 0; index < arity; index++)
              reusable[index] = undefined;
            reusing = false;
          }
        }
      };
      invoke = (
        _callee,
        _receiver,
        _newTarget,
        count,
        first,
        second,
      ): unknown =>
        enter(count, first, second, undefined, undefined, undefined, undefined);
      invokeWide = (
        _callee,
        _receiver,
        _newTarget,
        count,
        first,
        second,
        third,
        fourth,
        fifth,
        sixth,
      ): unknown => enter(count, first, second, third, fourth, fifth, sixth);
    }
    call.internalRegisterCall = {
      context: active,
      traceName: binding.name,
      callerPolicy: "opaque",
      constructible: false,
      scriptInvoke,
      invoke,
      invokeWide,
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
    const invoke: ObjectCall<unknown> = (_receiver, args): unknown =>
      callBinding(owner, state, binding, args);
    // The call step runs in the context `callContext.run` would select,
    // without the thunk and context frame of the ordinary entry.
    const dispatch = (
      _receiver: unknown,
      args: readonly unknown[],
    ): ObjectCallDispatch<ScriptPropertyKey, unknown> => {
      if (!activeInRealm(agent, realm))
        return {
          kind: "return",
          value: runRealmBoundCall(agent, realm, nativeCaller, (): unknown =>
            callBinding(owner, state, binding, args),
          ),
        };
      const depth = agent.executionContextDepth;
      agent.executionContextDepth = depth + 1;
      try {
        return {
          kind: "return",
          value: callBinding(owner, state, binding, args),
        };
      } finally {
        agent.executionContextDepth = depth;
      }
    };
    const plan = binding.plan;
    const typed: TypedFfiCall | undefined =
      plan === undefined ||
      plan.resultKind < 0 ||
      plan.resultKind === 6 ||
      plan.resultKind === 7
        ? undefined
        : {
            arity: plan.parameters.length,
            staticIndex: binding.typedCall,
            address: binding.numericAddress,
            lifetime: state.lifetime,
            nodeCallbacks: callbacks.activity,
            nativeCallbacks,
            numbersOnly: !plan.parameters.some(
              (parameter) =>
                parameter.pointer ||
                parameter.kind === 6 ||
                parameter.kind === 7,
            ),
            unaryPointerLeaf:
              plan.parameters.length === 1 && plan.parameters[0]?.pointer
                ? (input): number =>
                    invokeUnaryPointerLeaf(core, binding, plan, input)
                : undefined,
            pointerI32Callback:
              binding.signature.result === "i32" &&
              plan.parameters.length === 2 &&
              binding.signature.parameters[0] === "pointer" &&
              binding.signature.parameters[1] === "i32"
                ? (pointer, input): number | undefined =>
                    invokePointerI32Callback(binding, plan, pointer, input)
                : undefined,
            mode: (): number => {
              if (
                state.handle === undefined ||
                !ownerLive(state) ||
                binding.scalarDepth !== 0
              )
                return 0;
              return callbacks.activity.active || nativeCallbacks.active
                ? 2
                : 1;
            },
            workspace: (mayCallback): TypedFfiWorkspace =>
              acquireScalarWorkspace(binding, plan, mayCallback),
            checkNumber: (kind, input, index): number =>
              checkedTypedFfiNumber(core, kind, input, index),
            writeNumber: (workspace, index, input): void =>
              writeTypedFfiNumber(
                core,
                plan.parameters,
                workspace,
                index,
                input,
              ),
            writeArgument: (workspace, index, input): void =>
              writeScalarArgument(core, plan, workspace, index, input),
            complete: (workspace, mayCallback): number => {
              if (!mayCallback)
                runScalarFrame(core, binding, workspace.frame, undefined);
              else invokeCallbackFrame(binding, workspace.frame);
              return readTypedFfiNumber(workspace.result, plan.resultKind);
            },
            release: (workspace): void =>
              releaseScalarWorkspace(binding, workspace),
          };
    // The typed record's general view never changes. Typed call entries
    // read it from `typedView` without calling `typedRecord`.
    const readTyped = (): unknown => typed;
    const call =
      typed === undefined
        ? createCallableObject<ScriptPropertyKey, unknown>(
            realm.functionPrototype,
            invoke,
            callContext,
          )
        : createExoticObject<ScriptPropertyKey, unknown>(
            realm.functionPrototype,
            { typedRecord: readTyped, typedView: { value: readTyped() } },
            invoke,
            undefined,
            callContext,
          );
    builtinFunctionMetadata(call, binding.name, 0, hooks);
    createDataProperty<ScriptPropertyKey, unknown>(
      call,
      "pointer",
      word(binding.address.low, binding.address.high),
      hooks,
    );
    ensureRareSlots<ScriptPropertyKey, unknown>(call).internalTailDispatch =
      dispatch;
    installRegisterCall(call, owner, state, binding);
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
      lifetime: { open: true },
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
