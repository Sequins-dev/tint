import { installUint8ArrayCodecs } from "./uint8array-codecs.ts";
import { installTypedArrayRanges } from "./typed-array-ranges.ts";
import { installTypedArraySorting } from "./typed-array-sorting.ts";
import { installTypedArrayCopying } from "./typed-array-copying.ts";
import { installTypedArrayComposition } from "./typed-array-composition.ts";
import { installTypedArrayCallbacks } from "./typed-array-callbacks.ts";
import { installTypedArrayCopyWithin } from "./typed-array-copywithin.ts";
import { installTypedArrayFill } from "./typed-array-fill.ts";
import { installTypedArrayReverse } from "./typed-array-reverse.ts";
import { installTypedArrayText } from "./typed-array-text.ts";
import { installTypedArraySet } from "./typed-array-set.ts";
import { installTypedArraySearch } from "./typed-array-search.ts";
import { installTypedArrayStatic } from "./typed-array-static.ts";
import { installTypedArrayIterators } from "./typed-array-iterators.ts";
import {
  allocateTypedArray,
  typedArrayFromObject,
} from "./typed-array-construction.ts";
import {
  bufferStorageByteLength,
  bufferStorageResizable,
  type BufferStorage,
} from "./buffer-storage.ts";
import type { Endian } from "@tint/foundation/binary/bytes";
import {
  createTypedArrayView,
  typedArrayWindow,
  typedArrayElementWidth,
  requireTypedArray,
  type TypedArrayElementKind,
} from "./typed-array-data.ts";
import { bufferIndex } from "./array-buffer.ts";
import {
  createObject,
  createConstructorObject,
  type OrdinaryObject,
  type ObjectHooks,
  type ObjectCall,
} from "./operations.ts";
import {
  builtinProperty,
  builtinAccessor,
  builtinFunction,
  builtinFunctionMetadata,
} from "./intrinsics.ts";
import { constructorPrototype } from "./functions.ts";
import { viewObjectValue } from "./values.ts";
import { wellKnownSymbol, type ScriptPropertyKey } from "./symbols.ts";
import { createRuntimeError, type ErrorRealm } from "./errors.ts";
/** Install after Array intrinsics: toString shares the exact Array function identity. */
export function installTypedArrayIntrinsics(
  global: OrdinaryObject<ScriptPropertyKey, unknown>,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
  endian: Endian,
): void {
  const prototype = realm.typedArrayPrototype;
  // Intrinsic constructors remain stable when source code replaces prototype.constructor.
  const constructors = new Map<
    string,
    OrdinaryObject<ScriptPropertyKey, unknown>
  >();
  function getter(
    object: OrdinaryObject<ScriptPropertyKey, unknown>,
    key: ScriptPropertyKey,
    name: string,
    implementation: ObjectCall<unknown>,
  ): void {
    builtinAccessor(
      object,
      key,
      builtinFunction(
        realm.functionPrototype,
        "get " + name,
        0,
        implementation,
        hooks,
      ),
      undefined,
      hooks,
    );
  }
  const abstract = createConstructorObject<ScriptPropertyKey, unknown>(
    realm.functionPrototype,
    (receiver, args): unknown => {
      throw createRuntimeError(realm, "type");
    },
    (args, target): unknown => {
      throw createRuntimeError(realm, "type");
    },
  );
  builtinFunctionMetadata(abstract, "TypedArray", 0, hooks);
  installTypedArrayStatic(abstract, realm, hooks);
  builtinProperty(abstract, "prototype", prototype, false, false, hooks);
  builtinProperty(prototype, "constructor", abstract, true, true, hooks);
  getter(
    abstract,
    wellKnownSymbol(realm.symbolRegistry, "species"),
    "[Symbol.species]",
    (receiver, args): unknown => receiver,
  );
  for (const name of ["buffer", "byteLength", "byteOffset", "length"]) {
    if (name === undefined) throw "TYPED_ARRAY_ACCESSOR_INVARIANT";
    getter(prototype, name, name, (receiver, args): unknown => {
      const data = requireTypedArray(receiver, realm);
      if (name === "buffer") return data.buffer;
      const window = typedArrayWindow(data);
      if (window === undefined) return 0;
      if (name === "byteOffset") return data.byteOffset;
      return name === "length"
        ? window.length
        : window.length * typedArrayElementWidth(data.kind);
    });
  }
  getter(
    prototype,
    wellKnownSymbol(realm.symbolRegistry, "toStringTag"),
    "[Symbol.toStringTag]",
    (receiver, args): unknown => {
      const object = viewObjectValue(receiver, realm.objectPrototype);
      const data =
        object === undefined ? undefined : object.internalTypedArrayData;
      return data === undefined ? undefined : data.kind + "Array";
    },
  );
  function install(kind: TypedArrayElementKind): void {
    const name = kind + "Array",
      width = typedArrayElementWidth(kind);
    const parent = createObject<ScriptPropertyKey, unknown>(prototype);
    realm.typedArrayPrototypes.set(kind, parent);
    const constructor = createConstructorObject<ScriptPropertyKey, unknown>(
      abstract,
      (receiver, args): unknown => {
        throw createRuntimeError(realm, "type");
      },
      (args, target): unknown => {
        const input = viewObjectValue(args[0], realm.objectPrototype);
        if (input === undefined) {
          const length = bufferIndex(args[0], realm, hooks);
          const selected = constructorPrototype(target, kind, realm, hooks);
          return allocateTypedArray(
            kind,
            length,
            selected,
            realm,
            hooks,
            endian,
          );
        }
        const selected = constructorPrototype(target, kind, realm, hooks);
        const storage: BufferStorage | undefined =
          input.internalArrayBufferData ?? input.internalSharedArrayBufferData;
        if (storage === undefined)
          return typedArrayFromObject(
            input,
            kind,
            selected,
            realm,
            hooks,
            endian,
          );
        const offset = bufferIndex(args[1], realm, hooks);
        if (offset % width !== 0) throw createRuntimeError(realm, "range");
        let length: number | undefined =
          args[2] === undefined
            ? undefined
            : bufferIndex(args[2], realm, hooks);
        const byteLength = bufferStorageByteLength(storage);
        if (byteLength === undefined) throw createRuntimeError(realm, "type");
        if (offset > byteLength) throw createRuntimeError(realm, "range");
        if (length === undefined) {
          if (!bufferStorageResizable(storage)) {
            if (byteLength % width !== 0)
              throw createRuntimeError(realm, "range");
            length = (byteLength - offset) / width;
          }
        } else if (length > Math.floor((byteLength - offset) / width))
          throw createRuntimeError(realm, "range");
        return createTypedArrayView(
          selected,
          { buffer: input, storage, byteOffset: offset, length, kind, endian },
          realm,
          hooks,
        );
      },
    );
    builtinFunctionMetadata(constructor, name, 3, hooks);
    builtinProperty(constructor, "prototype", parent, false, false, hooks);
    builtinProperty(
      constructor,
      "BYTES_PER_ELEMENT",
      width,
      false,
      false,
      hooks,
    );
    builtinProperty(parent, "BYTES_PER_ELEMENT", width, false, false, hooks);
    builtinProperty(parent, "constructor", constructor, true, true, hooks);
    builtinProperty(global, name, constructor, true, true, hooks);
    constructors.set(kind, constructor);
    if (kind === "Uint8")
      installUint8ArrayCodecs(constructor, parent, realm, hooks, endian);
  }
  install("Int8");
  install("Uint8");
  install("Uint8Clamped");
  install("Int16");
  install("Uint16");
  install("Int32");
  install("Uint32");
  install("Float16");
  install("Float32");
  install("Float64");
  install("BigInt64");
  install("BigUint64");
  installTypedArrayIterators(realm, hooks);
  installTypedArraySearch(realm, hooks);
  installTypedArraySet(realm, hooks);
  installTypedArrayText(realm, hooks);
  installTypedArrayReverse(realm, hooks);
  installTypedArrayFill(realm, hooks);
  installTypedArrayCopyWithin(realm, hooks);
  installTypedArrayCallbacks(realm, hooks);
  installTypedArrayComposition(realm, hooks, constructors);
  installTypedArrayCopying(realm, hooks, constructors);
  installTypedArraySorting(realm, hooks, constructors);
  installTypedArrayRanges(realm, hooks, constructors);
}
