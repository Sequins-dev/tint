import {
  adoptArrayBuffer,
  bufferStorageByteLength,
  builtinFunction,
  builtinFunctionMetadata,
  builtinProperty,
  createCodedRuntimeError,
  createConstructorObject,
  createObject,
  createRuntimeError,
  createTypedArrayView,
  defineOwnProperty,
  exoticSlots,
  getProperty,
  hasProperty,
  hasPrototype,
  installProgramTypedArrayIntrinsics,
  lengthOfArrayLike,
  numberValue,
  programRealmCore,
  projectArrayBufferViewRange,
  rejectUnsupportedExecution,
  viewObjectValue,
  type BufferStorage,
  type ObjectCall,
  type OrdinaryObject,
  type ProgramRealmCore,
  type ScriptPropertyKey,
} from "@tint/js-runtime/objects";
import {
  bufferBytes,
  bufferEncoding,
  bufferText,
  type NodeBufferEncoding,
} from "./buffer-codecs.ts";
type RealmObject = OrdinaryObject<ScriptPropertyKey, unknown>;
const bufferBrand = "node:buffer";

function bufferError(
  core: ProgramRealmCore,
  kind: "type" | "range",
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

function encodingName(
  core: ProgramRealmCore,
  value: unknown,
): NodeBufferEncoding {
  if (typeof value !== "string" || value === "") return "utf8";
  const encoding = bufferEncoding(value);
  if (encoding === undefined)
    return bufferError(
      core,
      "type",
      "Unknown encoding: " + value,
      "ERR_UNKNOWN_ENCODING",
    );
  return encoding;
}

function number(core: ProgramRealmCore, value: unknown): number {
  const result = numberValue(value, core.hooks, core.realm);
  if (result.error === "unsupported")
    return rejectUnsupportedExecution(core.realm);
  if (result.error !== "none") throw createRuntimeError(core.realm, "type");
  return result.value;
}

function integer(core: ProgramRealmCore, value: unknown): number {
  const converted = number(core, value);
  return Number.isNaN(converted) ? 0 : Math.trunc(converted);
}

function index(core: ProgramRealmCore, value: unknown, length: number): number {
  const offset = integer(core, value);
  return offset < 0 ? Math.max(length + offset, 0) : Math.min(offset, length);
}

function read(
  core: ProgramRealmCore,
  object: RealmObject,
  key: string,
): unknown {
  return getProperty<ScriptPropertyKey, unknown>(
    object,
    key,
    object,
    core.hooks,
  );
}

function view(
  core: ProgramRealmCore,
  prototype: RealmObject,
  buffer: RealmObject,
  storage: BufferStorage,
  byteOffset: number,
  length: number,
): RealmObject {
  return createTypedArrayView(
    prototype,
    { buffer, storage, byteOffset, length, kind: "Uint8", endian: "little" },
    core.realm,
    core.hooks,
  );
}

/** Buffer identity is shared between the host constructor and FFI results. */
export function isNodeBuffer(core: ProgramRealmCore, value: unknown): boolean {
  const prototype = core.realm.prototypes.get(bufferBrand);
  const object = viewObjectValue(value, core.object);
  return (
    prototype !== undefined &&
    object !== undefined &&
    hasPrototype<ScriptPropertyKey, unknown>(object, prototype)
  );
}

/** Wrap bytes without copying them. The storage owner retains the backing. */
export function adoptNodeBuffer(
  core: ProgramRealmCore,
  bytes: Uint8Array,
): RealmObject {
  installNodeBuffer(core);
  const prototype = core.realm.prototypes.get(bufferBrand);
  const buffer = adoptArrayBuffer(bytes, core.realm);
  const storage = exoticSlots(buffer).internalArrayBufferData;
  if (prototype === undefined || storage === undefined)
    throw "BUFFER_ADOPTION_INVARIANT";
  return view(core, prototype, buffer, storage, 0, bytes.length);
}

export function installNodeBuffer(core: ProgramRealmCore): RealmObject {
  const realm = core.realm,
    hooks = core.hooks;
  const existing = realm.constructors.get(bufferBrand);
  if (existing !== undefined) return existing;
  installProgramTypedArrayIntrinsics(core);
  const parent = realm.typedArrayPrototypes.get("Uint8");
  if (parent === undefined) throw "BUFFER_PROTOTYPE_INVARIANT";
  const typedConstructor = viewObjectValue(
    read(core, parent, "constructor"),
    core.object,
  );
  const prototype = createObject<ScriptPropertyKey, unknown>(parent);

  function backingLength(size: number): number {
    if (size < 0 || size > realm.bufferMaxBytes || !Number.isFinite(size))
      return bufferError(
        core,
        "range",
        "The buffer size is out of range",
        "ERR_OUT_OF_RANGE",
      );
    return Math.floor(size);
  }
  function from(
    input: unknown,
    encoding: unknown,
    length: unknown,
  ): RealmObject {
    if (typeof input === "string")
      return adoptNodeBuffer(
        core,
        bufferBytes(input, encodingName(core, encoding)),
      );
    const object = viewObjectValue(input, core.object);
    if (object === undefined)
      return bufferError(
        core,
        "type",
        "Expected a string, ArrayBuffer, Array, or array-like object",
        "ERR_INVALID_ARG_TYPE",
      );
    const slots = exoticSlots(object);
    const backing =
      slots.internalArrayBufferData ?? slots.internalSharedArrayBufferData;
    if (backing !== undefined) {
      const offset = integer(core, encoding);
      const total = bufferStorageByteLength(backing);
      const count =
        length === undefined ? (total ?? 0) - offset : integer(core, length);
      if (total === undefined) throw createRuntimeError(realm, "type");
      if (offset < 0 || offset > total || count < 0 || count > total - offset)
        return bufferError(
          core,
          "range",
          "The buffer view is out of range",
          "ERR_BUFFER_OUT_OF_BOUNDS",
        );
      return view(core, prototype, object, backing, offset, count);
    }
    if (!hasProperty<ScriptPropertyKey, unknown>(object, "length"))
      return bufferError(
        core,
        "type",
        "Expected an Array or array-like object",
        "ERR_INVALID_ARG_TYPE",
      );
    const count = backingLength(lengthOfArrayLike(object, realm, hooks));
    const bytes = new Uint8Array(count);
    for (let position = 0; position < count; position++)
      bytes[position] =
        number(core, read(core, object, String(position))) & 255;
    return adoptNodeBuffer(core, bytes);
  }
  function alloc(size: unknown, fill: unknown, encoding: unknown): RealmObject {
    if (typeof size !== "number")
      return bufferError(
        core,
        "type",
        "The size must be a number",
        "ERR_INVALID_ARG_TYPE",
      );
    const count = backingLength(size);
    const bytes = new Uint8Array(count);
    if (fill !== undefined && count > 0) {
      if (typeof fill === "string") {
        const pattern = bufferBytes(fill, encodingName(core, encoding));
        if (pattern.length > 0)
          for (let position = 0; position < count; position++)
            bytes[position] = pattern[position % pattern.length] ?? 0;
      } else {
        const byte = number(core, fill) & 255;
        for (let position = 0; position < count; position++)
          bytes[position] = byte;
      }
    }
    return adoptNodeBuffer(core, bytes);
  }
  function construct(args: readonly unknown[]): RealmObject {
    const first = args[0];
    return typeof first === "number"
      ? alloc(first, undefined, undefined)
      : from(first, args[1], args[2]);
  }
  function method(
    object: RealmObject,
    name: string,
    length: number,
    body: ObjectCall<unknown>,
  ): void {
    builtinProperty(
      object,
      name,
      builtinFunction(realm.functionPrototype, name, length, body, hooks),
      true,
      true,
      hooks,
    );
  }
  function subarray(receiver: unknown, args: readonly unknown[]): unknown {
    const object = viewObjectValue(receiver, core.object);
    const data =
      object === undefined
        ? undefined
        : exoticSlots(object).internalTypedArrayData;
    if (object === undefined || data === undefined || data.kind !== "Uint8")
      throw createRuntimeError(realm, "type");
    const range = projectArrayBufferViewRange(object);
    const total = range?.byteLength ?? 0;
    const start = index(core, args[0], total);
    const end = args[1] === undefined ? total : index(core, args[1], total);
    return view(
      core,
      prototype,
      data.buffer,
      data.storage,
      (range?.byteOffset ?? 0) + start,
      Math.max(end - start, 0),
    );
  }

  const constructor = createConstructorObject<ScriptPropertyKey, unknown>(
    typedConstructor,
    (_receiver, args): unknown => construct(args),
    (args, _target): unknown => construct(args),
  );
  builtinFunctionMetadata(constructor, "Buffer", 3, hooks);
  builtinProperty(constructor, "prototype", prototype, true, false, hooks);
  builtinProperty(prototype, "constructor", constructor, true, true, hooks);
  method(constructor, "from", 3, (_receiver, args): unknown =>
    from(args[0], args[1], args[2]),
  );
  method(constructor, "alloc", 3, (_receiver, args): unknown =>
    alloc(args[0], args[1], args[2]),
  );
  method(constructor, "isBuffer", 1, (_receiver, args): unknown =>
    isNodeBuffer(core, args[0]),
  );
  method(constructor, "byteLength", 2, (_receiver, args): unknown => {
    const input = args[0];
    if (typeof input === "string") {
      const encoding = args[1];
      const selected =
        typeof encoding === "string" ? bufferEncoding(encoding) : undefined;
      return bufferBytes(input, selected ?? "utf8").length;
    }
    const object = viewObjectValue(input, core.object);
    if (object !== undefined) {
      const range = projectArrayBufferViewRange(object);
      if (range !== undefined) return range.byteLength;
      const slots = exoticSlots(object);
      const backing =
        slots.internalArrayBufferData ?? slots.internalSharedArrayBufferData;
      if (backing !== undefined) return bufferStorageByteLength(backing);
    }
    return bufferError(
      core,
      "type",
      "The string must be a string, Buffer, or ArrayBuffer",
      "ERR_INVALID_ARG_TYPE",
    );
  });
  method(prototype, "subarray", 2, subarray);
  method(prototype, "slice", 2, subarray);
  method(prototype, "toString", 0, (receiver, args): unknown => {
    const object = viewObjectValue(receiver, core.object);
    if (object === undefined) throw createRuntimeError(realm, "type");
    const range = projectArrayBufferViewRange(object);
    const bytes = range?.bytes;
    if (range === undefined || bytes === undefined) return "";
    const total = range.byteLength;
    if (total === 0) return "";
    const start = index(core, args[1], total);
    const end = args[2] === undefined ? total : index(core, args[2], total);
    if (end <= start) return "";
    return bufferText(
      bytes.subarray(range.byteOffset + start, range.byteOffset + end),
      encodingName(core, args[0]),
    );
  });
  realm.prototypes.set(bufferBrand, prototype);
  realm.constructors.set(bufferBrand, constructor);
  builtinProperty(core.object, "Buffer", constructor, true, true, hooks);
  return constructor;
}

export const Buffer: unknown = installNodeBuffer(programRealmCore());

function bufferConstants(core: ProgramRealmCore): RealmObject {
  const object = createObject<ScriptPropertyKey, unknown>(
    core.realm.objectPrototype,
  );
  function constant(name: string, value: number): void {
    if (
      defineOwnProperty<ScriptPropertyKey, unknown>(
        object,
        name,
        {
          fields: 51,
          value,
          writable: false,
          enumerable: true,
          configurable: false,
          get: undefined,
          set: undefined,
        },
        core.hooks,
      ) !== "accepted"
    )
      throw "BUFFER_CONSTANT_INVARIANT";
  }
  constant("MAX_LENGTH", Number.MAX_SAFE_INTEGER);
  constant("MAX_STRING_LENGTH", 536870888);
  return object;
}

export const constants: unknown = bufferConstants(programRealmCore());
