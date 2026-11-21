import { sysVCallbackFrame } from "@tint/abi/c/sysv";
import type { CCallLayout } from "@tint/abi/c";
import {
  callObjectValueOrThrow,
  viewObjectValue,
  type ProgramRealmCore,
} from "@tint/js-runtime/objects";
import { Cell, TARGET_AAPCS64 } from "tint:c/dl";
import { callbackGuard, callbackState, retargetCallbackView } from "tint:ffi";
import {
  clearWeakSlot,
  createWeakSlot,
  weakSlotKey,
} from "../intrinsics/weak.ts";
import { readScalar, writeScalar } from "./ffi-memory.ts";
import {
  classifyScalarCall,
  ffiError,
  scalarKind,
  type FfiSignature,
} from "./ffi-signature.ts";

export interface FfiCallbackHost {
  readonly allocate: (id: number) => number;
  readonly release: (address: number) => void;
  readonly view: (address: number, length: number) => Uint8Array;
  readonly abort: (message: string) => never;
}
interface CallbackArgument {
  readonly kind: number;
  readonly offset: number;
  readonly width: number;
}

interface CallbackWorkspace {
  readonly frame: Uint8Array;
  readonly scratch: Uint8Array;
}

export interface FfiCallback {
  readonly id: number;
  readonly address: number;
  readonly signature: FfiSignature;
  readonly layout: CCallLayout;
  readonly parameters: CallbackArgument[];
  readonly guard: number;
  readonly workspaces: CallbackWorkspace[];
  readonly weak: unknown;
  strong: unknown;
  executing: number;
}
export interface FfiCallbacks {
  readonly register: (
    signature: FfiSignature,
    callback: unknown,
  ) => FfiCallback;
  readonly release: (callback: FfiCallback) => void;
  readonly ref: (callback: FfiCallback, enabled: boolean) => void;
  readonly dispatch: (id: number, frame: number) => number;
  readonly active: () => boolean;
}

export function createFfiCallbacks(
  core: ProgramRealmCore,
  host: FfiCallbackHost,
): FfiCallbacks {
  const entries = new Map<number, FfiCallback>();
  let currentId = 0;
  const registers = TARGET_AAPCS64 === 2 ? sysVCallbackFrame.registers : 64;
  const floats = TARGET_AAPCS64 === 2 ? sysVCallbackFrame.floats : 128;
  const stack = TARGET_AAPCS64 === 2 ? sysVCallbackFrame.stack : 192;

  function newWorkspace(guard: number, stackBytes: number): CallbackWorkspace {
    return {
      frame: host.view(guard, stack + stackBytes),
      scratch: new Uint8Array(Cell.size),
    };
  }

  function register(signature: FfiSignature, callback: unknown): FfiCallback {
    const layout = classifyScalarCall(core, signature);
    callbackState();
    const id = currentId - 1;
    if (!Number.isSafeInteger(id))
      return ffiError(
        core,
        "error",
        "ERR_FFI_CALL_FAILED",
        "FFI callback identity space exhausted",
      );
    const parameters: CallbackArgument[] = [];
    for (let index = 0; index < signature.parameters.length; index++) {
      const parameter = signature.parameters[index],
        location = layout.arguments[index];
      if (parameter === undefined || location === undefined)
        throw "FFI_CALLBACK_LAYOUT_INVARIANT";
      parameters.push({
        kind: scalarKind(parameter),
        offset:
          location.stackOffset >= 0
            ? stack + location.stackOffset
            : location.gp >= 0
              ? registers + location.gp * 8
              : floats + location.fp * 8,
        width: location.size,
      });
    }
    const guard = callbackGuard();
    const workspace = newWorkspace(guard, layout.stackBytes);
    const address = host.allocate(id);
    if (address <= 0)
      return ffiError(
        core,
        "error",
        address === -12 ? "ERR_FFI_CALL_FAILED" : "ERR_RX_MEMORY_NOT_SUPPORTED",
        address === -12
          ? "FFI callback allocation failed"
          : "Executable memory is not supported in this environment, but is required for FFI callbacks",
      );
    currentId = id;
    const entry: FfiCallback = {
      id,
      address,
      signature,
      layout,
      parameters,
      guard,
      workspaces: [workspace],
      weak: createWeakSlot(callback, undefined, false),
      strong: callback,
      executing: 0,
    };
    entries.set(id, entry);
    return entry;
  }
  function release(callback: FfiCallback): void {
    if (callback.executing !== 0)
      return ffiError(
        core,
        "type",
        "ERR_INVALID_ARG_VALUE",
        "Cannot unregister an active FFI callback",
      );
    entries.delete(callback.id);
    clearWeakSlot(callback.weak);
    callback.strong = undefined;
    host.release(callback.address);
  }
  function ref(callback: FfiCallback, enabled: boolean): void {
    const strong = callback.strong;
    const value = strong === undefined ? weakSlotKey(callback.weak) : strong;
    if (value === undefined)
      return ffiError(
        core,
        "type",
        "ERR_INVALID_ARG_VALUE",
        "Callback not found",
      );
    callback.strong = enabled ? value : undefined;
  }
  function dispatch(id: number, address: number): number {
    const callback = entries.get(id);
    if (callback === undefined)
      return host.abort("Unknown FFI callback registration");
    const strong = callback.strong;
    const fn = strong === undefined ? weakSlotKey(callback.weak) : strong;
    const depth = callback.executing;
    let workspace = callback.workspaces[depth];
    if (workspace === undefined) {
      // Recursive entry needs a different view of the register capture.
      workspace = newWorkspace(callback.guard, callback.layout.stackBytes);
      callback.workspaces.push(workspace);
    }
    const raw = workspace.frame,
      scratch = workspace.scratch;
    const cell = Cell.view(scratch);
    callback.executing = depth + 1;
    retargetCallbackView(raw, address);
    try {
      // SysV consumes the status as zero for a collected callback. Both
      // ABIs load their result registers from the same capture when present.
      if (fn === undefined) {
        for (let byte = 0; byte < 8; byte++) {
          raw[registers + byte] = 0;
          raw[floats + byte] = 0;
        }
        return 0;
      }
      const args: unknown[] = [];
      for (const parameter of callback.parameters) {
        for (let byte = 0; byte < parameter.width; byte++)
          scratch[byte] = raw[parameter.offset + byte] ?? 0;
        args.push(readScalar(cell, parameter.kind));
      }
      let value: unknown;
      try {
        value = callObjectValueOrThrow(
          fn,
          undefined,
          args,
          core.object,
          core.realm,
        );
      } catch (error) {
        return host.abort("Callbacks cannot throw an exception");
      }
      if (
        viewObjectValue(value, core.object)?.internalPromiseData !== undefined
      )
        return host.abort("Callbacks cannot return promises");
      const result = callback.signature.result;
      if (result === "void") return 1;
      if (result === "pointer" && (value === undefined || value === null))
        value = 0n;
      if (
        (result === "pointer" || result === "i64" || result === "u64") &&
        typeof value !== "bigint"
      )
        return host.abort(
          "Callback returned invalid value for declared FFI type",
        );
      cell.u64 = 0;
      try {
        writeScalar(core, cell, scalarKind(result), value);
      } catch (error) {
        return host.abort(
          "Callback returned invalid value for declared FFI type",
        );
      }
      if (callback.layout.result.extend === "sign" && typeof value === "number")
        cell.i64 = value;
      const offset = result === "f32" || result === "f64" ? floats : registers;
      for (let byte = 0; byte < Cell.size; byte++)
        raw[offset + byte] = scratch[byte] ?? 0;
      return 1;
    } finally {
      retargetCallbackView(raw, callback.guard);
      callback.executing = depth;
    }
  }
  return { register, release, ref, dispatch, active: () => entries.size !== 0 };
}
