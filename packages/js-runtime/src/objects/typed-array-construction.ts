import { createByteStorage } from "../bytes/index.ts";
import { copyTypedArrayElements } from "./typed-array-storage.ts";
import type { Endian } from "@tint/foundation/binary/bytes";
import {
  getIteratorFromMethod,
  iteratorStepValue,
} from "../iterators/index.ts";
import { createScriptIteratorHooks } from "./iteration.ts";
import { lengthOfArrayLike } from "./array-like.ts";
import {
  createObject,
  getProperty,
  setProperty,
  type OrdinaryObject,
  type ObjectHooks,
} from "./operations.ts";
import { wellKnownSymbol, type ScriptPropertyKey } from "./symbols.ts";
import { createRuntimeError, type ErrorRealm } from "./errors.ts";
import {
  createTypedArrayView,
  typedArrayWindow,
  typedArrayElementWidth,
  type TypedArrayElementKind,
} from "./typed-array-data.ts";

export function allocateTypedArray(
  kind: TypedArrayElementKind,
  length: number,
  prototype: OrdinaryObject<ScriptPropertyKey, unknown>,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
  endian: Endian,
): OrdinaryObject<ScriptPropertyKey, unknown> {
  const width = typedArrayElementWidth(kind);
  if (length > Math.floor(realm.bufferMaxBytes / width))
    throw createRuntimeError(realm, "range");
  const allocated = createByteStorage(
    length * width,
    length * width,
    false,
    realm.bufferMaxBytes,
  );
  if (!allocated.ok) throw createRuntimeError(realm, "range");
  const buffer = createObject<ScriptPropertyKey, unknown>(
    realm.arrayBufferPrototype,
  );
  buffer.internalArrayBufferData = allocated.value;
  return createTypedArrayView(
    prototype,
    { buffer, storage: allocated.value, byteOffset: 0, length, kind, endian },
    realm,
    hooks,
  );
}
export function storeTypedArrayElement(
  target: OrdinaryObject<ScriptPropertyKey, unknown>,
  index: number,
  value: unknown,
  hooks: ObjectHooks<unknown>,
): void {
  if (
    !setProperty<ScriptPropertyKey, unknown>(
      target,
      String(index),
      value,
      { object: target, value: target },
      hooks,
    )
  )
    throw "TYPED_ARRAY_INITIALIZE_INVARIANT";
}
/** Constructors consume iterables completely before converting their values;
 * array-like input instead interleaves each property read with conversion. */
export function typedArrayFromObject(
  source: OrdinaryObject<ScriptPropertyKey, unknown>,
  kind: TypedArrayElementKind,
  prototype: OrdinaryObject<ScriptPropertyKey, unknown>,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
  endian: Endian,
): OrdinaryObject<ScriptPropertyKey, unknown> {
  const sourceData = source.internalTypedArrayData;
  if (sourceData !== undefined) {
    const window = typedArrayWindow(sourceData);
    if (window === undefined) throw createRuntimeError(realm, "type");
    const target = allocateTypedArray(
      kind,
      window.length,
      prototype,
      realm,
      hooks,
      endian,
    );
    const data = target.internalTypedArrayData;
    if (data === undefined) throw "TYPED_ARRAY_INITIALIZE_INVARIANT";
    if (kind === sourceData.kind) {
      copyTypedArrayElements(sourceData, data, 0, 0, window.length, true);
    } else {
      const sourceBigInt =
        sourceData.kind === "BigInt64" || sourceData.kind === "BigUint64";
      const targetBigInt = kind === "BigInt64" || kind === "BigUint64";
      if (sourceBigInt !== targetBigInt)
        throw createRuntimeError(realm, "type");
      for (let i = 0; i < window.length; i++)
        storeTypedArrayElement(
          target,
          i,
          getProperty<ScriptPropertyKey, unknown>(
            source,
            String(i),
            source,
            hooks,
          ),
          hooks,
        );
    }
    return target;
  }
  const method = getProperty<ScriptPropertyKey, unknown>(
    source,
    wellKnownSymbol(realm.symbolRegistry, "iterator"),
    source,
    hooks,
  );
  if (method !== undefined && method !== null) {
    const iteratorHooks = createScriptIteratorHooks(realm, hooks);
    const iterator = getIteratorFromMethod<unknown>(
      source,
      method,
      iteratorHooks,
    );
    const values: unknown[] = [];
    while (true) {
      const step = iteratorStepValue<unknown>(iterator, iteratorHooks);
      if (step.done) break;
      values.push(step.value);
    }
    const target = allocateTypedArray(
      kind,
      values.length,
      prototype,
      realm,
      hooks,
      endian,
    );
    for (let i = 0; i < values.length; i++)
      storeTypedArrayElement(target, i, values[i], hooks);
    return target;
  }
  const length = lengthOfArrayLike(source, realm, hooks);
  const target = allocateTypedArray(
    kind,
    length,
    prototype,
    realm,
    hooks,
    endian,
  );
  for (let i = 0; i < length; i++)
    storeTypedArrayElement(
      target,
      i,
      getProperty<ScriptPropertyKey, unknown>(source, String(i), source, hooks),
      hooks,
    );
  return target;
}
