import type {
  ObjectScriptCall,
  ProgramRealmCore,
} from "@tint/js-runtime/objects";
import type { CallbackActivity, FfiLibraryLifetime } from "./ffi-memory.ts";

export type StaticFfiNumberCall = (
  core: ProgramRealmCore,
  target: number,
  args: readonly unknown[],
) => unknown;
export type StaticFfiBytesCall = (target: number, bytes: Uint8Array) => number;

/** Hosts may supply fixed scalar call stubs and select the weak-slot policy. */
export function ffiWeakProcessing(): boolean {
  return true;
}

export function staticFfiIndex(key: string): number {
  return -1;
}

export function typedFfiIndex(key: string): number {
  return -1;
}

export function staticFfiCall(index: number, frame: Uint8Array): boolean {
  return false;
}

export function staticFfiNumberCall(
  index: number,
): StaticFfiNumberCall | undefined {
  return undefined;
}

export function staticFfiBytesCall(
  _index: number,
): StaticFfiBytesCall | undefined {
  return undefined;
}

export function staticFfiScriptNumberCall(
  _index: number,
  _core: ProgramRealmCore,
  _target: number,
  _lifetime: FfiLibraryLifetime,
  _nodeCallbacks: CallbackActivity,
  _nativeCallbacks: CallbackActivity,
  _fallback: (args: readonly unknown[]) => unknown,
): ObjectScriptCall<unknown> | undefined {
  return undefined;
}

export function staticFfiScriptUnaryCall(
  _unary: (arg0: unknown) => unknown,
  _fallback: (args: readonly unknown[]) => unknown,
): ObjectScriptCall<unknown> | undefined {
  return undefined;
}

export function staticFfiScriptBinaryCall(
  _binary: (arg0: unknown, arg1: unknown) => unknown,
  _fallback: (args: readonly unknown[]) => unknown,
): ObjectScriptCall<unknown> | undefined {
  return undefined;
}

export function staticFfiInvokeUnaryScript(
  _entry: ObjectScriptCall<unknown>,
  _callee: unknown,
  _input: number,
): unknown {
  throw "UNSUPPORTED_SCRIPT_CALL";
}
