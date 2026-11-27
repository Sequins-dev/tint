import { isWellFormedUTF16 } from "@tint/foundation/text/text-encoding";
import {
  readFloat,
  writeFloat,
  readWord64,
  writeWord64,
  type Endian,
} from "@tint/foundation/binary/bytes";
import { type Word64 } from "@tint/foundation/binary/word64";
import { integerFromDigits } from "@tint/foundation/numeric/big-integer";
import { address as externalAddress, external } from "tint:ffi";
import {
  createUTF8Decoder,
  decodeUTF8,
  encodeUTF8Into,
} from "@tint/foundation/text/text-encoding";
import {
  readSharedUnsigned,
  writeSharedUnsigned,
} from "@tint/js-runtime/bytes/shared";
import {
  adoptArrayBuffer,
  bufferStorageByteLength,
  builtinFunction,
  builtinFunctionMetadata,
  builtinProperty,
  createCodedRuntimeError,
  createBigIntValue,
  callObjectValueOrThrow,
  viewBigIntValue,
  createArrayFromList,
  createDataProperty,
  createConstructorObject,
  createObject,
  createRuntimeError,
  createTypedArrayView,
  defineOwnProperty,
  exoticSlots,
  getProperty,
  hasPrototype,
  installProgramTypedArrayIntrinsics,
  installProgramArrayIntrinsics,
  isArrayValue,
  isCallableObject,
  scriptBoolean,
  typedArrayElementWidth,
  wellKnownSymbol,
  lengthOfArrayLike,
  numberValue,
  programRealmCore,
  projectArrayBufferViewRange,
  rejectUnsupportedExecution,
  viewObjectValue,
  type BufferStorage,
  type ArrayBufferViewRange,
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
  kind: "type" | "range" | "error",
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
  key: ScriptPropertyKey,
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

// The isolate has one program realm. Cache its Buffer prototype so result
// adoption skips the brand registry lookup.
let prototypeCore: ProgramRealmCore | undefined = undefined;
let cachedPrototype: RealmObject | undefined = undefined;

function bufferPrototype(core: ProgramRealmCore): RealmObject | undefined {
  if (prototypeCore === core && cachedPrototype !== undefined)
    return cachedPrototype;
  const prototype = core.realm.prototypes.get(bufferBrand);
  if (prototype !== undefined) {
    prototypeCore = core;
    cachedPrototype = prototype;
  }
  return prototype;
}

/** Buffer identity is shared between the host constructor and FFI results. */
export function isNodeBuffer(core: ProgramRealmCore, value: unknown): boolean {
  const prototype = bufferPrototype(core);
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
  const realm = core.realm;
  let prototype = bufferPrototype(core);
  if (prototype === undefined) {
    installNodeBuffer(core);
    prototype = bufferPrototype(core);
  }
  const buffer = adoptArrayBuffer(bytes, realm);
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
    const objectSlots = exoticSlots(object);
    const backing =
      objectSlots.internalArrayBufferData ??
      objectSlots.internalSharedArrayBufferData;
    if (backing !== undefined) {
      const offset = integer(core, encoding);
      const total = bufferStorageByteLength(backing);
      const count =
        length === undefined
          ? (total ?? 0) - offset
          : Math.max(0, integer(core, length));
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
    const valueOf = read(core, object, "valueOf");
    if (scriptBoolean(valueOf, core.object)) {
      const value = callObjectValueOrThrow(
        valueOf,
        input,
        [],
        core.object,
        realm,
      );
      if (
        value !== input &&
        (typeof value === "string" ||
          viewObjectValue(value, core.object) !== undefined)
      )
        return from(value, encoding, length);
    }
    const size = read(core, object, "length");
    if (size !== undefined) return fromArrayLike(object, size);
    const possibleBuffer = viewObjectValue(
      read(core, object, "buffer"),
      core.object,
    );
    if (
      possibleBuffer !== undefined &&
      (exoticSlots(possibleBuffer).internalArrayBufferData !== undefined ||
        exoticSlots(possibleBuffer).internalSharedArrayBufferData !== undefined)
    )
      return fromArrayLike(object, size);
    if (read(core, object, "type") === "Buffer") {
      const list = viewObjectValue(read(core, object, "data"), core.object);
      if (list !== undefined && isArrayValue(list, realm))
        return fromArrayLike(list, read(core, list, "length"));
    }
    const converter = read(
      core,
      object,
      wellKnownSymbol(realm.symbolRegistry, "toPrimitive"),
    );
    const callable = viewObjectValue(converter, core.object);
    if (
      callable !== undefined &&
      isCallableObject<ScriptPropertyKey, unknown>(callable)
    ) {
      const value = callObjectValueOrThrow(
        converter,
        input,
        ["string"],
        core.object,
        realm,
      );
      if (typeof value === "string") return from(value, encoding, length);
    }
    return bufferError(
      core,
      "type",
      "Expected a string, ArrayBuffer, Array, or array-like object",
      "ERR_INVALID_ARG_TYPE",
    );
  }

  function fromArrayLike(object: RealmObject, size: unknown): RealmObject {
    const count =
      typeof size === "number" && size > 0 ? backingLength(size) : 0;
    const bytes = new Uint8Array(count);
    for (let position = 0; position < count; position++)
      bytes[position] =
        number(core, read(core, object, String(position))) & 255;
    return adoptNodeBuffer(core, bytes);
  }
  function alloc(
    size: unknown,
    value: unknown,
    encoding: unknown,
  ): RealmObject {
    if (typeof size !== "number")
      return bufferError(
        core,
        "type",
        "The size must be a number",
        "ERR_INVALID_ARG_TYPE",
      );
    const count = backingLength(size);
    const result = adoptNodeBuffer(core, new Uint8Array(count));
    if (value !== undefined && count > 0) {
      const args: unknown[] = [value, 0, count, encoding];
      fill(result, args);
    }
    return result;
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

  function byteView(value: unknown, name: string): ArrayBufferViewRange {
    const object = viewObjectValue(value, core.object);
    if (
      object !== undefined &&
      exoticSlots(object).internalTypedArrayData?.kind === "Uint8"
    ) {
      const range = projectArrayBufferViewRange(object);
      if (range !== undefined) return range;
    }
    return bufferError(
      core,
      "type",
      'The "' + name + '" argument must be a Buffer or Uint8Array',
      "ERR_INVALID_ARG_TYPE",
    );
  }

  function byteAt(range: ArrayBufferViewRange, offset: number): number {
    const at = range.byteOffset + offset;
    const bytes = range.bytes;
    if (bytes !== undefined) return bytes[at] ?? 0;
    const storage = range.storage;
    if (storage.kind === "shared") {
      const result = readSharedUnsigned(storage, at, 1, "unordered");
      if (result.ok) return result.value;
    }
    throw "BUFFER_READ_INVARIANT";
  }

  function storeByte(
    range: ArrayBufferViewRange,
    offset: number,
    value: number,
  ): void {
    if (!range.writable)
      return bufferError(
        core,
        "type",
        "Buffer is not writable",
        "ERR_INVALID_ARG_VALUE",
      );
    const at = range.byteOffset + offset;
    const bytes = range.bytes;
    if (bytes !== undefined) {
      bytes[at] = value;
      return;
    }
    const storage = range.storage;
    if (
      storage.kind === "shared" &&
      writeSharedUnsigned(storage, at, 1, value, "unordered") === "none"
    )
      return;
    throw "BUFFER_WRITE_INVARIANT";
  }

  function snapshot(
    range: ArrayBufferViewRange,
    start: number,
    count: number,
  ): Uint8Array {
    const bytes = new Uint8Array(count);
    for (let i = 0; i < count; i++) bytes[i] = byteAt(range, start + i);
    return bytes;
  }

  function bounded(
    value: unknown,
    name: string,
    defaultValue: number,
    max: number,
  ): number {
    if (value === undefined) return defaultValue;
    if (typeof value !== "number")
      return bufferError(
        core,
        "type",
        'The "' + name + '" argument must be of type number',
        "ERR_INVALID_ARG_TYPE",
      );
    if (!Number.isInteger(value) || value < 0 || value > max)
      return bufferError(
        core,
        "range",
        'The value of "' + name + '" is out of range',
        "ERR_OUT_OF_RANGE",
      );
    return value;
  }

  function compareRanges(
    left: ArrayBufferViewRange,
    right: ArrayBufferViewRange,
    leftStart: number,
    leftEnd: number,
    rightStart: number,
    rightEnd: number,
  ): number {
    const leftLength = Math.max(0, leftEnd - leftStart);
    const rightLength = Math.max(0, rightEnd - rightStart);
    const common = Math.min(leftLength, rightLength);
    for (let i = 0; i < common; i++) {
      const a = byteAt(left, leftStart + i);
      const b = byteAt(right, rightStart + i);
      if (a !== b) return a < b ? -1 : 1;
    }
    return leftLength === rightLength ? 0 : leftLength < rightLength ? -1 : 1;
  }

  function fill(receiver: unknown, args: readonly unknown[]): unknown {
    const value = args[0];
    let offset = args[1],
      end = args[2],
      encoding = args[3];
    if (typeof value === "string") {
      if (typeof offset === "string") {
        encoding = offset;
        offset = undefined;
        end = undefined;
      } else if (typeof end === "string") {
        encoding = end;
        end = undefined;
      }
    }
    const selected: NodeBufferEncoding =
      typeof value === "string" ? encodingName(core, encoding) : "utf8";
    const target = byteView(receiver, "this");
    const start = bounded(offset, "offset", 0, Number.MAX_SAFE_INTEGER);
    const stop = bounded(end, "end", target.byteLength, target.byteLength);
    if (start >= stop) return receiver;
    let pattern: Uint8Array;
    const valueObject = viewObjectValue(value, core.object);
    if (typeof value === "string") {
      pattern = value === "" ? new Uint8Array(1) : bufferBytes(value, selected);
    } else if (
      valueObject !== undefined &&
      exoticSlots(valueObject).internalTypedArrayData?.kind === "Uint8"
    ) {
      const source = byteView(value, "value");
      pattern = snapshot(source, 0, source.byteLength);
    } else {
      pattern = new Uint8Array(1);
      pattern[0] = number(core, value);
    }
    if (pattern.length === 0)
      return bufferError(
        core,
        "type",
        "The argument 'value' is invalid",
        "ERR_INVALID_ARG_VALUE",
      );
    // Coercion may have detached or resized the original backing.
    const current = byteView(receiver, "this");
    if (stop > current.byteLength)
      return bufferError(
        core,
        "range",
        "Attempt to access memory outside buffer bounds",
        "ERR_BUFFER_OUT_OF_BOUNDS",
      );
    for (let i = start; i < stop; i++)
      storeByte(current, i, pattern[(i - start) % pattern.length] ?? 0);
    return receiver;
  }

  function search(
    receiver: unknown,
    args: readonly unknown[],
    backwards: boolean,
  ): number {
    const value = args[0];
    const suppliedOffset = args[1];
    const offset =
      typeof suppliedOffset === "string" ? undefined : suppliedOffset;
    const suppliedEnd = args[2];
    const encoding =
      typeof suppliedOffset === "string"
        ? suppliedOffset
        : typeof suppliedEnd === "string"
          ? suppliedEnd
          : args[3];
    const converted = number(core, offset);
    const range = byteView(receiver, "this");
    const end =
      typeof suppliedEnd === "number"
        ? Math.max(0, Math.min(range.byteLength, Math.trunc(suppliedEnd)))
        : range.byteLength;
    const at = Number.isNaN(converted)
      ? backwards
        ? end
        : 0
      : Math.trunc(converted);
    const start = at < 0 ? range.byteLength + at : at;
    let pattern: Uint8Array;
    let step = 1;
    if (typeof value === "number") {
      pattern = new Uint8Array(1);
      pattern[0] = value;
    } else if (typeof value === "string") {
      if (encoding === "")
        return bufferError(
          core,
          "type",
          "Unknown encoding: ",
          "ERR_UNKNOWN_ENCODING",
        );
      const selected = encodingName(core, encoding);
      pattern = bufferBytes(value, selected);
      if (selected === "utf16le") step = 2;
    } else {
      const source = byteView(value, "value");
      pattern = snapshot(source, 0, source.byteLength);
      if (
        typeof encoding === "string" &&
        bufferEncoding(encoding) === "utf16le"
      )
        step = 2;
    }
    if (pattern.length === 0) return Math.min(Math.max(start, 0), end);
    const limit = end - pattern.length;
    const first = backwards ? Math.min(start, limit) : Math.max(start, 0);
    for (
      let i = first - (first % step);
      i >= 0 && i <= limit;
      i += backwards ? -step : step
    ) {
      let matched = 0;
      while (
        matched < pattern.length &&
        byteAt(range, i + matched) === pattern[matched]
      )
        matched++;
      if (matched === pattern.length) return i;
    }
    return -1;
  }

  function unsafeAlloc(size: unknown, alignment: unknown): RealmObject {
    if (typeof size !== "number") return alloc(size, undefined, undefined);
    const length = backingLength(size);
    const boundary = bounded(alignment, "alignment", 1, 1073741824);
    if (boundary === 0)
      return bufferError(
        core,
        "range",
        "Buffer alignment must be positive",
        "ERR_OUT_OF_RANGE",
      );
    if ((boundary & (boundary - 1)) !== 0)
      return bufferError(
        core,
        "type",
        "Buffer alignment must be a power of two",
        "ERR_INVALID_ARG_VALUE",
      );
    if (boundary === 1) return adoptNodeBuffer(core, new Uint8Array(length));
    // Store the base allocation as the ArrayBuffer's owner. The offset into
    // that owner stays aligned and its slices keep the mapping alive.
    const bytes = external(backingLength(length + boundary - 1));
    const start = (boundary - (externalAddress(bytes) % boundary)) % boundary;
    const buffer = adoptArrayBuffer(bytes, realm);
    const storage = exoticSlots(buffer).internalArrayBufferData;
    if (storage === undefined) throw "BUFFER_ALIGNED_STORAGE_INVARIANT";
    return view(core, prototype, buffer, storage, start, length);
  }

  function installByteMethods(constructor: RealmObject): void {
    method(constructor, "allocUnsafe", 2, (_receiver, args): unknown =>
      unsafeAlloc(args[0], args[1]),
    );
    method(constructor, "allocUnsafeSlow", 2, (_receiver, args): unknown =>
      unsafeAlloc(args[0], args[1]),
    );
    method(constructor, "copyBytesFrom", 3, (_receiver, args): unknown => {
      const object = viewObjectValue(args[0], core.object);
      if (object === undefined)
        return bufferError(
          core,
          "type",
          'The "view" argument must be a TypedArray',
          "ERR_INVALID_ARG_TYPE",
        );
      const data = exoticSlots(object).internalTypedArrayData;
      const range = projectArrayBufferViewRange(object);
      if (data === undefined || range === undefined)
        return bufferError(
          core,
          "type",
          'The "view" argument must be a TypedArray',
          "ERR_INVALID_ARG_TYPE",
        );
      const width = typedArrayElementWidth(data.kind);
      const length = range.byteLength / width;
      if (length === 0) return adoptNodeBuffer(core, new Uint8Array(0));
      const start = bounded(args[1], "offset", 0, kMaxLength);
      if (start >= length) return adoptNodeBuffer(core, new Uint8Array(0));
      const count = Math.min(
        length - start,
        bounded(args[2], "length", length - start, kMaxLength),
      );
      return adoptNodeBuffer(
        core,
        snapshot(range, start * width, count * width),
      );
    });
    method(constructor, "isEncoding", 1, (_receiver, args): unknown => {
      const name = args[0];
      return typeof name === "string" && bufferEncoding(name) !== undefined;
    });
    method(constructor, "compare", 2, (_receiver, args): unknown => {
      const left = byteView(args[0], "buf1"),
        right = byteView(args[1], "buf2");
      return compareRanges(
        left,
        right,
        0,
        left.byteLength,
        0,
        right.byteLength,
      );
    });
    method(constructor, "concat", 2, (_receiver, args): unknown => {
      const list = viewObjectValue(args[0], core.object);
      if (list === undefined || !isArrayValue(list, realm))
        return bufferError(
          core,
          "type",
          'The "list" argument must be an Array',
          "ERR_INVALID_ARG_TYPE",
        );
      const count = lengthOfArrayLike(list, realm, hooks);
      if (count === 0) return adoptNodeBuffer(core, new Uint8Array(0));
      const ranges: ArrayBufferViewRange[] = [];
      let total = 0;
      for (let i = 0; i < count; i++) {
        const range = byteView(read(core, list, String(i)), "list");
        ranges.push(range);
        total += range.byteLength;
      }
      const length = backingLength(
        bounded(args[1], "length", total, kMaxLength),
      );
      const bytes = new Uint8Array(length);
      let i = 0;
      for (const range of ranges) {
        if (range === undefined) throw "BUFFER_CONCAT_INVARIANT";
        for (let j = 0; i < length && j < range.byteLength; j++)
          bytes[i++] = byteAt(range, j);
      }
      return adoptNodeBuffer(core, bytes);
    });
    method(prototype, "compare", 5, (receiver, args): unknown => {
      const target = byteView(args[0], "target"),
        source = byteView(receiver, "this");
      const targetStart = bounded(args[1], "targetStart", 0, kMaxLength);
      const targetEnd = bounded(
        args[2],
        "targetEnd",
        target.byteLength,
        target.byteLength,
      );
      const sourceStart = bounded(args[3], "sourceStart", 0, kMaxLength);
      const sourceEnd = bounded(
        args[4],
        "sourceEnd",
        source.byteLength,
        source.byteLength,
      );
      return compareRanges(
        source,
        target,
        sourceStart,
        sourceEnd,
        targetStart,
        targetEnd,
      );
    });
    method(prototype, "equals", 1, (receiver, args): unknown => {
      const other = byteView(args[0], "otherBuffer"),
        source = byteView(receiver, "this");
      return (
        compareRanges(
          source,
          other,
          0,
          source.byteLength,
          0,
          other.byteLength,
        ) === 0
      );
    });
    method(prototype, "copy", 4, (receiver, args): unknown => {
      const to = args[1] === undefined ? 0 : integer(core, args[1]);
      const from = args[2] === undefined ? 0 : integer(core, args[2]);
      const end = args[3] === undefined ? undefined : integer(core, args[3]);
      const source = byteView(receiver, "source"),
        target = byteView(args[0], "target");
      if (
        to < 0 ||
        from < 0 ||
        from > source.byteLength ||
        (end !== undefined && end < 0)
      )
        return bufferError(
          core,
          "range",
          "Buffer copy range is out of bounds",
          "ERR_OUT_OF_RANGE",
        );
      const count = Math.max(
        0,
        Math.min(end ?? source.byteLength, source.byteLength) - from,
      );
      const length = Math.max(0, Math.min(count, target.byteLength - to));
      const bytes = snapshot(source, from, length);
      for (let i = 0; i < length; i++) storeByte(target, to + i, bytes[i] ?? 0);
      return length;
    });
    method(prototype, "fill", 4, fill);
    method(prototype, "write", 4, (receiver, args): unknown => {
      const text = args[0];
      if (typeof text !== "string")
        return bufferError(
          core,
          "type",
          'The "string" argument must be of type string',
          "ERR_INVALID_ARG_TYPE",
        );
      const range = byteView(receiver, "this");
      const supplied = args[1];
      const legacy = typeof supplied === "string" && args[2] === undefined;
      const offset = legacy
        ? 0
        : bounded(supplied, "offset", 0, range.byteLength);
      const requested = args[2];
      const remaining = range.byteLength - offset;
      const length =
        typeof requested === "string"
          ? remaining
          : Math.min(
              remaining,
              bounded(requested, "length", remaining, range.byteLength),
            );
      const encoding = encodingName(
        core,
        legacy ? supplied : typeof requested === "string" ? requested : args[3],
      );
      let bytes: Uint8Array;
      let count: number;
      if (encoding === "utf8") {
        bytes = new Uint8Array(Math.min(text.length * 3, length));
        count = encodeUTF8Into(text, bytes).written;
      } else {
        bytes = bufferBytes(text, encoding);
        count = Math.min(bytes.length, length);
        if (encoding === "utf16le") count -= count % 2;
      }
      for (let i = 0; i < count; i++)
        storeByte(range, offset + i, bytes[i] ?? 0);
      return count;
    });
    method(prototype, "indexOf", 4, (receiver, args): unknown =>
      search(receiver, args, false),
    );
    method(prototype, "lastIndexOf", 4, (receiver, args): unknown =>
      search(receiver, args, true),
    );
    method(
      prototype,
      "includes",
      4,
      (receiver, args): unknown => search(receiver, args, false) !== -1,
    );
    for (const width of [2, 4, 8]) {
      if (width === undefined) throw "BUFFER_SWAP_WIDTH_INVARIANT";
      method(
        prototype,
        "swap" + String(width * 8),
        0,
        (receiver, _args): unknown => {
          const range = byteView(receiver, "this");
          if (range.byteLength % width !== 0)
            return bufferError(
              core,
              "range",
              "Buffer size must be a multiple of " +
                String(width * 8) +
                "-bits",
              "ERR_INVALID_BUFFER_SIZE",
            );
          for (let i = 0; i < range.byteLength; i += width)
            for (let j = 0; j < width / 2; j++) {
              const a = i + j,
                b = i + width - j - 1;
              const previous = byteAt(range, a);
              storeByte(range, a, byteAt(range, b));
              storeByte(range, b, previous);
            }
          return receiver;
        },
      );
    }
    method(prototype, "toJSON", 0, (receiver, _args): unknown => {
      const range = byteView(receiver, "this");
      const values: unknown[] = [];
      for (let i = 0; i < range.byteLength; i++) values.push(byteAt(range, i));
      installProgramArrayIntrinsics(core);
      const array = realm.arrayPrototype;
      const result = createObject<ScriptPropertyKey, unknown>(
        realm.objectPrototype,
      );
      createDataProperty<ScriptPropertyKey, unknown>(
        result,
        "type",
        "Buffer",
        hooks,
      );
      createDataProperty<ScriptPropertyKey, unknown>(
        result,
        "data",
        createArrayFromList(values, 0, array, realm, hooks),
        hooks,
      );
      return result;
    });
  }

  function numericOffset(
    value: unknown,
    range: ArrayBufferViewRange,
    width: number,
    variable: boolean,
  ): number {
    if (variable && value === undefined)
      return bufferError(
        core,
        "type",
        'The "offset" argument must be of type number. Received undefined',
        "ERR_INVALID_ARG_TYPE",
      );
    const offset = bounded(value, "offset", 0, kMaxLength);
    if (range.byteLength < width)
      return bufferError(
        core,
        "range",
        "Attempt to access memory outside buffer bounds",
        "ERR_BUFFER_OUT_OF_BOUNDS",
      );
    return bounded(offset, "offset", 0, range.byteLength - width);
  }

  function numericWidth(value: unknown): number {
    if (typeof value !== "number")
      return bufferError(
        core,
        "type",
        'The "byteLength" argument must be of type number',
        "ERR_INVALID_ARG_TYPE",
      );
    if (!Number.isInteger(value) || value < 1 || value > 6)
      return bufferError(
        core,
        "range",
        'The value of "byteLength" is out of range',
        "ERR_OUT_OF_RANGE",
      );
    return value;
  }

  function numericWord(value: unknown, signed: boolean): Word64 {
    const bigint = viewBigIntValue(value);
    if (bigint === undefined) throw createRuntimeError(realm, "type");
    const { negative, len, d0, d1, d2 } = bigint;
    const low = d0 + (d1 % 64) * 67108864;
    const high = Math.floor(d1 / 64) + d2 * 1048576;
    if (
      len > 3 ||
      d2 >= 4096 ||
      (negative && !signed) ||
      (signed &&
        high >= 2147483648 &&
        (!negative || high !== 2147483648 || low !== 0))
    )
      return bufferError(
        core,
        "range",
        'The value of "value" is out of range',
        "ERR_OUT_OF_RANGE",
      );
    return {
      lo: negative ? (4294967296 - low) % 4294967296 : low,
      hi: negative ? 4294967295 - high + (low === 0 ? 1 : 0) : high,
    };
  }

  function readBigInt(word: Word64, signed: boolean): unknown {
    const negative = signed && word.hi >= 2147483648;
    const low = negative ? (4294967296 - word.lo) % 4294967296 : word.lo;
    const high = negative
      ? 4294967295 - word.hi + (word.lo === 0 ? 1 : 0)
      : word.hi;
    return createBigIntValue(
      integerFromDigits(negative, [
        low % 67108864,
        Math.floor(low / 67108864) + (high % 1048576) * 64,
        Math.floor(high / 1048576),
      ]),
    );
  }

  function installNumeric(
    name: string,
    fixedWidth: number,
    endian: Endian,
    signed: boolean,
    format: "integer" | "float" | "bigint",
  ): void {
    method(
      prototype,
      "read" + name,
      fixedWidth === 0 ? 2 : 0,
      (receiver, args): unknown => {
        const width = fixedWidth === 0 ? numericWidth(args[1]) : fixedWidth;
        const range = byteView(receiver, "this");
        const offset = numericOffset(args[0], range, width, fixedWidth === 0);
        if (format === "float") {
          const result = readFloat(
            snapshot(range, offset, width),
            0,
            width === 4 ? 4 : 8,
            endian,
          );
          if (result.ok) return result.value;
          throw "BUFFER_FLOAT_READ_INVARIANT";
        }
        if (format === "bigint") {
          const result = readWord64(snapshot(range, offset, width), 0, endian);
          if (result.ok) return readBigInt(result.value, signed);
          throw "BUFFER_BIGINT_READ_INVARIANT";
        }
        let value = 0;
        for (let i = 0; i < width; i++)
          value =
            value * 256 +
            byteAt(range, offset + (endian === "big" ? i : width - i - 1));
        let total = 1;
        for (let i = 0; i < width; i++) total *= 256;
        return signed && value >= total / 2 ? value - total : value;
      },
    );
    method(
      prototype,
      "write" + name,
      fixedWidth === 0 ? 3 : 1,
      (receiver, args): unknown => {
        const width = fixedWidth === 0 ? numericWidth(args[2]) : fixedWidth;
        const value = format === "bigint" ? 0 : number(core, args[0]);
        const range = byteView(receiver, "this");
        const offset = numericOffset(args[1], range, width, fixedWidth === 0);
        if (format !== "integer") {
          const bytes = new Uint8Array(width);
          const result =
            format === "bigint"
              ? writeWord64(bytes, 0, numericWord(args[0], signed), endian)
              : writeFloat(bytes, 0, width === 4 ? 4 : 8, value, endian);
          if (!result.ok) throw "BUFFER_NUMERIC_WRITE_INVARIANT";
          for (let i = 0; i < width; i++)
            storeByte(range, offset + i, bytes[i] ?? 0);
        } else {
          let total = 1;
          for (let i = 0; i < width; i++) total *= 256;
          const lower = signed ? -total / 2 : 0;
          const upper = signed ? total / 2 - 1 : total - 1;
          if (value < lower || value > upper)
            return bufferError(
              core,
              "range",
              'The value of "value" is out of range',
              "ERR_OUT_OF_RANGE",
            );
          let remaining = Number.isNaN(value) ? 0 : Math.trunc(value);
          if (remaining < 0) remaining += total;
          for (let i = 0; i < width; i++) {
            storeByte(
              range,
              offset + (endian === "little" ? i : width - i - 1),
              remaining % 256,
            );
            remaining = Math.floor(remaining / 256);
          }
        }
        return offset + width;
      },
    );
  }

  function installNumericMethods(): void {
    installNumeric("Int8", 1, "little", true, "integer");
    installNumeric("UInt8", 1, "little", false, "integer");
    const endiannesses: Endian[] = ["little", "big"];
    for (const endian of endiannesses) {
      if (endian === undefined) throw "BUFFER_ENDIAN_INVARIANT";
      const suffix = endian === "little" ? "LE" : "BE";
      installNumeric("Int" + suffix, 0, endian, true, "integer");
      installNumeric("UInt" + suffix, 0, endian, false, "integer");
      installNumeric("Int16" + suffix, 2, endian, true, "integer");
      installNumeric("UInt16" + suffix, 2, endian, false, "integer");
      installNumeric("Int32" + suffix, 4, endian, true, "integer");
      installNumeric("UInt32" + suffix, 4, endian, false, "integer");
      installNumeric("Float" + suffix, 4, endian, true, "float");
      installNumeric("Double" + suffix, 8, endian, true, "float");
      installNumeric("BigInt64" + suffix, 8, endian, true, "bigint");
      installNumeric("BigUInt64" + suffix, 8, endian, false, "bigint");
      for (const width of ["", "16", "32"])
        if (width !== undefined)
          aliasNumeric("Uint" + width + suffix, "UInt" + width + suffix);
      aliasNumeric("BigUint64" + suffix, "BigUInt64" + suffix);
    }
    aliasNumeric("Uint8", "UInt8");
  }

  function aliasNumeric(alias: string, original: string): void {
    builtinProperty(
      prototype,
      "read" + alias,
      read(core, prototype, "read" + original),
      true,
      true,
      hooks,
    );
    builtinProperty(
      prototype,
      "write" + alias,
      read(core, prototype, "write" + original),
      true,
      true,
      hooks,
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
      if (selected === "hex") return Math.floor(input.length / 2);
      if (selected === "base64" || selected === "base64url") {
        let length = input.length;
        if (input.charAt(length - 1) === "=") length--;
        if (input.charAt(length - 1) === "=") length--;
        return Math.floor((length * 3) / 4);
      }
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
  installByteMethods(constructor);
  installNumericMethods();
  realm.prototypes.set(bufferBrand, prototype);
  realm.constructors.set(bufferBrand, constructor);
  return constructor;
}

export const kMaxLength: number = Number.MAX_SAFE_INTEGER;
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
  constant("MAX_LENGTH", kMaxLength);
  constant("MAX_STRING_LENGTH", 536870888);
  return object;
}

export const constants: unknown = bufferConstants(programRealmCore());

export const kStringMaxLength: number = 536870888;
export const INSPECT_MAX_BYTES: number = 50;

function readableBytes(
  core: ProgramRealmCore,
  value: unknown,
  types: "all" | "uint8",
): Uint8Array {
  const object = viewObjectValue(value, core.object);
  if (object !== undefined) {
    const slots = exoticSlots(object);
    const data = slots.internalTypedArrayData;
    const direct =
      types === "all"
        ? (slots.internalArrayBufferData ?? slots.internalSharedArrayBufferData)
        : undefined;
    const range =
      data === undefined || (types === "uint8" && data.kind !== "Uint8")
        ? undefined
        : projectArrayBufferViewRange(object);
    const storage = direct ?? range?.storage;
    if (storage !== undefined) {
      const offset = range?.byteOffset ?? 0;
      const length = bufferStorageByteLength(storage);
      if (length === undefined)
        return bufferError(
          core,
          "type",
          "Cannot access a detached buffer",
          "ERR_INVALID_ARG_VALUE",
        );
      const count = range?.byteLength ?? length;
      if (storage.kind === "ordinary") {
        const bytes = storage.data;
        if (bytes !== undefined) return bytes.subarray(offset, offset + count);
      } else {
        const bytes = new Uint8Array(count);
        for (let i = 0; i < count; i++) {
          const result = readSharedUnsigned(
            storage,
            offset + i,
            1,
            "unordered",
          );
          if (!result.ok) throw "BUFFER_SHARED_READ";
          bytes[i] = result.value;
        }
        return bytes;
      }
    }
  }
  return bufferError(
    core,
    "type",
    "Expected a byte buffer",
    "ERR_INVALID_ARG_TYPE",
  );
}

function bufferExport(
  name: string,
  arity: number,
  call: ObjectCall<unknown>,
): RealmObject {
  const core = programRealmCore();
  return builtinFunction(
    core.realm.functionPrototype,
    name,
    arity,
    call,
    core.hooks,
  );
}
export const isUtf8: unknown = bufferExport(
  "isUtf8",
  1,
  (_receiver, args): unknown => {
    const bytes = readableBytes(programRealmCore(), args[0], "all");
    return decodeUTF8(createUTF8Decoder(true, true), bytes) !== undefined;
  },
);
export const isAscii: unknown = bufferExport(
  "isAscii",
  1,
  (_receiver, args): unknown => {
    const bytes = readableBytes(programRealmCore(), args[0], "all");
    for (const byte of bytes)
      if (byte !== undefined && byte > 127) return false;
    return true;
  },
);
function transcodingLabel(
  core: ProgramRealmCore,
  value: unknown,
): NodeBufferEncoding {
  const encoding =
    typeof value === "string" ? bufferEncoding(value) : undefined;
  if (
    encoding === "utf8" ||
    encoding === "utf16le" ||
    encoding === "ascii" ||
    encoding === "latin1"
  )
    return encoding;
  return bufferError(
    core,
    "error",
    "Unable to transcode Buffer [U_ILLEGAL_ARGUMENT_ERROR]",
    "U_ILLEGAL_ARGUMENT_ERROR",
  );
}
export const transcode: unknown = bufferExport(
  "transcode",
  3,
  (_receiver, args): unknown => {
    const core = programRealmCore();
    const bytes = readableBytes(core, args[0], "uint8");
    if (bytes.length === 0) return adoptNodeBuffer(core, bytes);
    const from = transcodingLabel(core, args[1]),
      to = transcodingLabel(core, args[2]);
    const text =
      from === "utf8" && to === "utf16le"
        ? decodeUTF8(createUTF8Decoder(true, true), bytes)
        : bufferText(bytes, from === "ascii" ? "latin1" : from);
    if (
      text === undefined ||
      (from === "utf16le" &&
        to === "utf8" &&
        (bytes.length % 2 !== 0 || !isWellFormedUTF16(text)))
    )
      return bufferError(
        core,
        "error",
        "Unable to transcode Buffer [U_INVALID_CHAR_FOUND]",
        "U_INVALID_CHAR_FOUND",
      );
    if (to === "utf8" || to === "utf16le")
      return adoptNodeBuffer(core, bufferBytes(text, to));
    const pieces: string[] = [];
    const limit = to === "ascii" ? 127 : 255;
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      pieces.push(code <= limit ? text.charAt(i) : "?");
      const next = text.charCodeAt(i + 1);
      if (code >= 0xd800 && code <= 0xdbff && next >= 0xdc00 && next <= 0xdfff)
        i++;
    }
    return adoptNodeBuffer(core, bufferBytes(pieces.join(""), to));
  },
);

const bufferModule = createObject<ScriptPropertyKey, unknown>(
  programRealmCore().realm.objectPrototype,
);
const moduleHooks = programRealmCore().hooks;
builtinProperty(bufferModule, "Buffer", Buffer, true, true, moduleHooks);
builtinProperty(bufferModule, "constants", constants, true, true, moduleHooks);
builtinProperty(
  bufferModule,
  "kMaxLength",
  kMaxLength,
  true,
  true,
  moduleHooks,
);
builtinProperty(
  bufferModule,
  "kStringMaxLength",
  kStringMaxLength,
  true,
  true,
  moduleHooks,
);
builtinProperty(
  bufferModule,
  "INSPECT_MAX_BYTES",
  INSPECT_MAX_BYTES,
  true,
  true,
  moduleHooks,
);
builtinProperty(bufferModule, "isUtf8", isUtf8, true, true, moduleHooks);
builtinProperty(bufferModule, "isAscii", isAscii, true, true, moduleHooks);
builtinProperty(bufferModule, "transcode", transcode, true, true, moduleHooks);
const bufferDefault: unknown = bufferModule;
export { bufferDefault as default };
