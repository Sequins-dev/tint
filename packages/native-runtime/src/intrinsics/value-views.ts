import {
  cacheNativeView,
  callObjectValue,
  cachedNativeView,
  createNativeCallableView,
  createNativeListView,
  createRecordView,
  createNativeViewCache,
  createRuntimeError,
  installProgramArrayIntrinsics,
  programRealmCore,
  isCallableObject,
  typedRecordOf,
  viewObjectValue,
  type NativeViewCache,
  type ObjectCall,
  type ObjectConstruct,
  type RecordViewAccess,
  type ScriptPropertyKey,
} from "@tint/js-runtime/objects";
import {
  deleteNumberList,
  hasNumberList,
  lengthNumberList,
  readNumberList,
  resizeNumberList,
  writeNumberList,
  type NumberList,
} from "@tint/foundation/collections/number-list";
import {
  createWeakSlot,
  weakSlotKey,
  weakSlotValue,
  setWeakSlotValue,
  clearWeakSlot,
} from "./weak.ts";

let projections: NativeViewCache | undefined = undefined;

function cache(): NativeViewCache {
  const existing = projections;
  if (existing !== undefined) return existing;
  const initialized = createNativeViewCache({
    create: (key: unknown, value: unknown, ephemeron: boolean): unknown =>
      createWeakSlot(key, value, ephemeron),
    key: (cell: unknown): unknown => weakSlotKey(cell),
    value: (cell: unknown): unknown => weakSlotValue(cell),
    setValue: (cell: unknown, value: unknown): void =>
      setWeakSlotValue(cell, value),
    clear: (cell: unknown): void => clearWeakSlot(cell),
  });
  projections = initialized;
  return initialized;
}

export function nativeView(native: unknown): unknown {
  return cachedNativeView(cache(), native);
}

export function publishNativeCallable(
  native: unknown,
  reciprocal: unknown,
  invoke: ObjectCall<unknown>,
  construct: ObjectConstruct<unknown> | undefined,
  name: string,
  length: number,
): unknown {
  const realm = programRealmCore();
  const view = createNativeCallableView(
    reciprocal,
    invoke,
    construct,
    name,
    length,
    realm.realm,
    realm.hooks,
  );
  cacheNativeView(cache(), native, view);
  return view;
}

export function projectNativeCallback(
  native: unknown,
  invoke: ObjectCall<unknown>,
  name: string,
  length: number,
): unknown {
  const existing = nativeView(native);
  if (existing !== undefined) return existing;
  return publishNativeCallable(native, native, invoke, undefined, name, length);
}

export interface UnaryNumberClosure {
  readonly target: (value: number) => number;
}

/** The compiler authorizes this exact record witness at composition. */
export function viewUnaryNumberClosure(
  value: unknown,
): UnaryNumberClosure | undefined {
  throw "UNBOUND_UNARY_NUMBER_CLOSURE_VIEW";
}

export function nativeValueOfView(value: unknown): unknown {
  const core = programRealmCore();
  const object = viewObjectValue(value, core.object);
  return object === undefined ? undefined : typedRecordOf(object);
}

export function projectNativeRecord(
  native: unknown,
  access: () => RecordViewAccess,
): unknown {
  const existing = nativeView(native);
  if (existing !== undefined) return existing;
  const core = programRealmCore();
  const view = createRecordView(core.realm.objectPrototype, native, access());
  cacheNativeView(cache(), native, view);
  return view;
}

/** The number-list backend supplies the same descriptor as its typed ABI. */
export function viewNumberList(value: unknown): NumberList | undefined {
  throw "UNBOUND_NUMBER_LIST_VIEW";
}

export function projectNumberList(value: number[]): unknown {
  const existing = nativeView(value);
  if (existing !== undefined) return existing;
  const list = viewNumberList(value);
  if (list === undefined) throw "NATIVE_NUMBER_LIST_LAYOUT";
  const core = programRealmCore();
  installProgramArrayIntrinsics(core);
  const view = createNativeListView(
    value,
    {
      length: (): number => lengthNumberList(list),
      has: (index: number): boolean => hasNumberList(list, index),
      read: (index: number): unknown => readNumberList(list, index),
      resize: (size: number): void => resizeNumberList(list, size),
      write: (index: number, element: unknown): void => {
        if (typeof element !== "number")
          throw createRuntimeError(core.realm, "type");
        writeNumberList(list, index, element);
      },
      remove: (index: number): boolean =>
        !hasNumberList(list, index) || deleteNumberList(list, index),
    },
    core.realm,
  );
  cacheNativeView(cache(), value, view);
  return view;
}

/** An executable primitive ABI witness, shared by native source adapters. */
export function projectUnaryNumber(
  target: (value: number) => number,
  name: string,
): unknown {
  const existing = nativeView(target);
  if (existing !== undefined) return existing;
  const reciprocal: UnaryNumberClosure = { target };
  return publishNativeCallable(
    target,
    reciprocal,
    (_receiver: unknown, args: readonly unknown[]): unknown => {
      const value = args[0];
      if (typeof value !== "number")
        throw createRuntimeError(programRealmCore().realm, "type");
      return target(value);
    },
    undefined,
    name,
    1,
  );
}

/** Project the exact typed entry when this view originated from native code.
 * A realm-origin callable gets one native adapter with the same reciprocal view. */
export function nativeUnaryNumber(value: unknown): (value: number) => number {
  const original = viewUnaryNumberClosure(nativeValueOfView(value));
  if (original !== undefined) return original.target;
  const existing = viewUnaryNumberClosure(nativeView(value));
  if (existing !== undefined) return existing.target;
  const realm = programRealmCore();
  if (
    !isCallableObject<ScriptPropertyKey, unknown>(
      viewObjectValue(value, realm.object),
    )
  )
    throw createRuntimeError(realm.realm, "type");
  const target = (argument: number): number => {
    const completed = callObjectValue(
      value,
      undefined,
      [argument],
      realm.object,
    );
    const result = completed.value;
    if (completed.error !== "none" || typeof result !== "number")
      throw createRuntimeError(realm.realm, "type");
    return result;
  };
  const reciprocal: UnaryNumberClosure = { target };
  cacheNativeView(cache(), value, reciprocal);
  cacheNativeView(cache(), target, value);
  return target;
}
