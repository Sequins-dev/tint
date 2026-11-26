import type {
  DebugInlineScope,
  DebugLocationRange,
  DebugMember,
  DebugPiece,
  DebugType,
  DebugVariable,
  DebugWord,
} from "@tint/image/dwarf";
import type {
  NativeDebugLocation,
  NativeDebugWord,
} from "@tint/codegen/aarch64/scalar";
import type { ScalarType } from "@tint/ir/scalar";
import {
  nativeHeaderByteLength,
  nativeStringLengthOffset,
  nativeStringIndexFieldOffset,
  nativeStringDataOffset,
  nativeStringSlicedByteLength,
  nativeStringSlicedStartOffset,
  nativeStringParentOffset,
} from "@tint/abi/host";
import {
  nativeTypedArrayKind,
  nativeTypedArrayKinds,
} from "@tint/abi/typed-array";
import type {
  DebugHeapRecord,
  DebugRecordFlag,
  DebugRecordType,
  DebugValueType,
  ProgramDebugVariable,
  ProgramFunctionDebug,
  ProgramInlineScope,
} from "./native/debug-functions.ts";

/** DWARF types and inline origins shared by every function of one image.
 * Managed values are described by their realized storage: numbers are
 * binary64 (or int64 when the emitter keeps an integer), references point
 * at managed objects whose two-word header precedes their fields. */
export interface DebugTypeTable {
  readonly types: DebugType[];
  readonly origins: string[];
  readonly keys: Map<string, number>;
  readonly originIds: Map<string, number>;
  readonly structureNames: Map<string, string>;
}
export function createDebugTypeTable(): DebugTypeTable {
  return {
    types: [],
    origins: [],
    keys: new Map<string, number>(),
    originIds: new Map<string, number>(),
    structureNames: new Map<string, string>(),
  };
}
function intern(
  table: DebugTypeTable,
  key: string,
  create: () => DebugType,
): number {
  const known = table.keys.get(key);
  if (known !== undefined) return known;
  const id = table.types.length;
  // Reserve the index first: structures may point back at themselves.
  table.keys.set(key, id);
  table.types.push({ kind: "pointer", target: undefined });
  table.types[id] = create();
  return id;
}
function baseType(
  table: DebugTypeTable,
  name: string,
  byteSize: number,
  encoding: "float" | "signed" | "unsigned" | "boolean" | "utf",
): number {
  return intern(table, "base:" + name, () => ({
    kind: "base",
    name,
    byteSize,
    encoding,
  }));
}
function pointer(table: DebugTypeTable, target: number): number {
  return intern(table, "pointer:" + String(target), () => ({
    kind: "pointer",
    target,
  }));
}
/** Distinct layouts never share a structure name: debuggers unique types by
 * name and size. */
function structureName(
  table: DebugTypeTable,
  name: string,
  key: string,
): string {
  let candidate = name,
    suffix = 1;
  while (true) {
    const owner = table.structureNames.get(candidate);
    if (owner === undefined) {
      table.structureNames.set(candidate, key);
      return candidate;
    }
    if (owner === key) return candidate;
    suffix++;
    candidate = name + "#" + String(suffix);
  }
  throw "debug structure name invariant";
}
function structure(
  table: DebugTypeTable,
  key: string,
  name: string,
  byteSize: number,
  members: () => DebugMember[],
): number {
  return intern(table, key, () => ({
    kind: "structure",
    name: structureName(table, name, key),
    byteSize,
    members: members(),
  }));
}
function word(table: DebugTypeTable): number {
  return baseType(table, "uint64", 8, "unsigned");
}
/** Adds a string's 32-bit length and index field (see @tint/abi/host). */
function pushStringLength(table: DebugTypeTable, members: DebugMember[]): void {
  const uint32 = baseType(table, "uint32", 4, "unsigned");
  members.push({
    name: "length",
    type: uint32,
    offset: nativeStringLengthOffset,
  });
  members.push({
    name: "index",
    type: uint32,
    offset: nativeStringIndexFieldOffset,
  });
}
/** The one-word object header: the layout marker or descriptor address in
 * bits 0-47 and the kind flags in bits 48-50 (see @tint/abi/host). */
function header(table: DebugTypeTable): DebugMember[] {
  return [{ name: "__header", type: word(table), offset: 0 }];
}
/** A flat string: header, length, then the code units. `units` describes a
 * two-byte string's data (header kind flags 0) and `bytes` a one-byte
 * string's (kind flag 1); both overlay the same storage. */
function stringStructure(table: DebugTypeTable): number {
  return structure(table, "string", "string", nativeStringDataOffset, () => {
    const members = header(table);
    pushStringLength(table, members);
    members.push({
      name: "units",
      type: intern(table, "array:char16_t", () => ({
        kind: "array",
        element: baseType(table, "char16_t", 2, "utf"),
        count: undefined,
      })),
      offset: nativeStringDataOffset,
    });
    members.push({
      name: "bytes",
      type: intern(table, "array:latin1", () => ({
        kind: "array",
        element: baseType(table, "latin1", 1, "unsigned"),
        count: undefined,
      })),
      offset: nativeStringDataOffset,
    });
    return members;
  });
}
function objectPointer(table: DebugTypeTable, name: string): number {
  return pointer(
    table,
    structure(table, "opaque:" + name, name, nativeHeaderByteLength, () =>
      header(table),
    ),
  );
}
function generalType(table: DebugTypeTable): number {
  const tag = intern(table, "general-tag", () => ({
    kind: "enumeration",
    name: "general.tag",
    byteSize: 8,
    base: word(table),
    values: [
      { name: "undefined", value: 0 },
      { name: "number", value: 1 },
      { name: "boolean", value: 2 },
      { name: "string", value: 3 },
      { name: "null", value: 4 },
      { name: "object", value: 5 },
      { name: "symbol", value: 6 },
      { name: "bigint", value: 7 },
    ],
  }));
  const payload = intern(table, "general-payload", () => ({
    kind: "union",
    name: "general.payload",
    byteSize: 8,
    members: [
      {
        name: "number",
        type: baseType(table, "number", 8, "float"),
        offset: 0,
      },
      {
        name: "boolean",
        type: baseType(table, "boolean", 1, "boolean"),
        offset: 0,
      },
      {
        name: "string",
        type: pointer(table, stringStructure(table)),
        offset: 0,
      },
      { name: "object", type: objectPointer(table, "object"), offset: 0 },
    ],
  }));
  return structure(table, "general", "general", 16, () => [
    { name: "tag", type: tag, offset: 0 },
    { name: "payload", type: payload, offset: 8 },
  ]);
}
function recordPointer(table: DebugTypeTable, record: DebugRecordType): number {
  return pointer(table, recordStructure(table, record, []));
}
/** The structure of objects with this layout: header words, fields and
 * any presence/cell-state bytes. */
function recordStructure(
  table: DebugTypeTable,
  record: DebugRecordType,
  flags: readonly DebugRecordFlag[],
): number {
  let key = "record:" + record.name + ":" + String(record.byteLength);
  for (const field of record.fields) {
    if (field === undefined) throw "debug record field invariant";
    key += "|" + field.name + "@" + String(field.offset) + ":" + field.type;
  }
  for (const flag of flags) {
    if (flag === undefined) throw "debug record flag invariant";
    key += "|" + flag.name + "@" + String(flag.offset);
  }
  return structure(table, key, record.name, record.byteLength, () => {
    const members = header(table);
    for (const field of record.fields) {
      if (field === undefined) throw "debug record field invariant";
      members.push({
        name: field.name,
        type: storageType(table, field.type, false, undefined),
        offset: field.offset,
      });
    }
    for (const flag of flags) {
      if (flag === undefined) throw "debug record flag invariant";
      members.push({
        name: flag.name,
        type: baseType(table, "uint8", 1, "unsigned"),
        offset: flag.offset,
      });
    }
    return members;
  });
}
/** The structure type of one heap record layout (see DebugHeapRecord). */
export function heapRecordType(
  table: DebugTypeTable,
  record: DebugHeapRecord,
): number {
  return recordStructure(table, record, record.flags);
}
function flexibleArray(table: DebugTypeTable, element: number): number {
  return intern(table, "array:" + String(element), () => ({
    kind: "array",
    element,
    count: undefined,
  }));
}
function bufferElement(table: DebugTypeTable, scalar: string): number {
  const entry = nativeTypedArrayKind(scalar);
  if (entry === undefined) throw "debug buffer kind invariant";
  const bytes = entry.elementBytes,
    bits = String(bytes * 8);
  switch (entry.element) {
    case "float":
      return bytes === 8
        ? baseType(table, "number", 8, "float")
        : baseType(table, "float" + bits, bytes, "float");
    case "signed":
    case "bigint-signed":
      return baseType(table, "int" + bits, bytes, "signed");
    case "unsigned":
    case "clamped":
    case "bigint-unsigned":
      return baseType(table, "uint" + bits, bytes, "unsigned");
  }
}
/** A typed buffer owning its elements: header, length, the data
 * pointer (derived: it points at the elements), then the elements. */
function bufferStructure(table: DebugTypeTable, scalar: string): number {
  return structure(table, "array:" + scalar, scalar, 24, () => {
    const element = bufferElement(table, scalar),
      members = header(table);
    members.push({ name: "length", type: word(table), offset: 8 });
    members.push({ name: "data", type: pointer(table, element), offset: 16 });
    members.push({
      name: "elements",
      type: flexibleArray(table, element),
      offset: 24,
    });
    return members;
  });
}
/** Every built-in heap object kind (heapDebugKinds) as a named structure,
 * and the function record, so tools can decode any object by name. */
export function heapKindTypes(table: DebugTypeTable): void {
  const flat = stringStructure(table);
  // A sliced string: its length, the byte offset of its first unit in the
  // flat parent's units (one-byte with kind flag 1), and the parent.
  structure(
    table,
    "heap:string.slice",
    "string.slice",
    nativeStringSlicedByteLength,
    () => {
      const members = header(table);
      pushStringLength(table, members);
      members.push({
        name: "start",
        type: word(table),
        offset: nativeStringSlicedStartOffset,
      });
      members.push({
        name: "parent",
        type: pointer(table, flat),
        offset: nativeStringParentOffset,
      });
      return members;
    },
  );
  structure(table, "heap:vector", "vector", 24, () => {
    const members = header(table);
    members.push({ name: "capacity", type: word(table), offset: 8 });
    members.push({ name: "reserved", type: word(table), offset: 16 });
    members.push({
      name: "slots",
      type: flexibleArray(table, objectPointer(table, "object")),
      offset: 24,
    });
    return members;
  });
  for (const entry of nativeTypedArrayKinds) {
    if (entry === undefined) throw "debug buffer kind invariant";
    const scalar = entry.name;
    const owner = bufferStructure(table, scalar);
    structure(
      table,
      "heap:external:" + scalar,
      scalar + ".external",
      24,
      () => {
        const element = bufferElement(table, scalar),
          members = header(table);
        members.push({ name: "length", type: word(table), offset: 8 });
        members.push({
          name: "data",
          type: pointer(table, element),
          offset: 16,
        });
        return members;
      },
    );
    structure(table, "heap:view:" + scalar, scalar + ".view", 40, () => {
      const element = bufferElement(table, scalar),
        members = header(table);
      members.push({ name: "length", type: word(table), offset: 8 });
      members.push({ name: "data", type: pointer(table, element), offset: 16 });
      members.push({ name: "owner", type: pointer(table, owner), offset: 24 });
      members.push({ name: "reserved", type: word(table), offset: 32 });
      return members;
    });
  }
  for (const name of ["weak-slot", "ephemeron-slot"]) {
    if (name === undefined) throw "debug weak kind invariant";
    structure(table, "heap:" + name, name, 40, () => {
      const members = header(table);
      members.push({ name: "key", type: generalType(table), offset: 8 });
      members.push({ name: "value", type: generalType(table), offset: 24 });
      return members;
    });
  }
  functionStructure(table);
}
/** The branded function record (@tint/abi/function). */
export function functionStructure(table: DebugTypeTable): number {
  return structure(table, "heap:function", "function", 40, () => {
    const members = header(table);
    members.push({ name: "entry", type: word(table), offset: 8 });
    members.push({
      name: "environment",
      type: objectPointer(table, "object"),
      offset: 16,
    });
    members.push({ name: "signature", type: word(table), offset: 24 });
    members.push({ name: "reserved", type: word(table), offset: 32 });
    return members;
  });
}
/** The DWARF type of a value stored with this encoding. */
function storageType(
  table: DebugTypeTable,
  scalar: ScalarType,
  integer: boolean,
  record: DebugRecordType | undefined,
): number {
  switch (scalar) {
    case "number":
      return integer
        ? baseType(table, "int64", 8, "signed")
        : baseType(table, "number", 8, "float");
    case "boolean":
      return baseType(table, "boolean", 1, "boolean");
    case "string":
    case "optional-string":
      return pointer(table, stringStructure(table));
    case "reference":
    case "optional-reference":
      return record === undefined
        ? objectPointer(table, "object")
        : recordPointer(table, record);
    case "primitive":
      return objectPointer(table, "primitive");
    case "Uint8Array":
    case "Int8Array":
    case "Uint8ClampedArray":
    case "Uint16Array":
    case "Int16Array":
    case "Float16Array":
    case "Uint32Array":
    case "Int32Array":
    case "Float32Array":
    case "Float64Array":
    case "BigInt64Array":
    case "BigUint64Array":
      return pointer(table, bufferStructure(table, scalar));
    case "general":
      return generalType(table);
    case "optional-number":
      // One NaN-boxed word; `undefined` shows as a signalling NaN.
      return baseType(table, "number?", 8, "float");
    case "optional-boolean":
      return structure(table, "optional-boolean", "boolean?", 16, () => [
        {
          name: "value",
          type: baseType(table, "boolean", 1, "boolean"),
          offset: 0,
        },
        {
          name: "present",
          type: baseType(table, "boolean", 1, "boolean"),
          offset: 8,
        },
      ]);
  }
  throw "debug scalar type invariant";
}
function dwarfWord(source: NativeDebugWord): DebugWord {
  // AArch64 DWARF numbers x0-x30 as 0-30 and v0-v31 as 64-95; frame words
  // are fp-relative.
  if (source.kind === "frame")
    return { kind: "memory", register: 29, offset: source.offset };
  if (source.kind === "general")
    return { kind: "register", register: source.register };
  return { kind: "register", register: 64 + source.register };
}
function pieces(
  location: NativeDebugLocation,
  base: number,
): DebugLocationRange {
  const parts: DebugPiece[] = [];
  for (const source of location.words) {
    if (source === undefined) throw "debug word invariant";
    const part = dwarfWord(source);
    parts.push(location.words.length === 1 ? { part } : { part, byteSize: 8 });
  }
  return {
    offset: base + location.offset,
    byteLength: location.byteLength,
    pieces: parts,
  };
}
function variable(
  table: DebugTypeTable,
  source: ProgramDebugVariable,
  base: number,
): DebugVariable {
  const declaration = source.declaration,
    file = declaration === undefined ? undefined : declaration.file,
    line = declaration === undefined ? undefined : declaration.line;
  const type: DebugValueType = source.type;
  const locations: DebugLocationRange[] = [];
  for (const location of source.locations) {
    if (location === undefined) throw "debug location invariant";
    locations.push(pieces(location, base));
  }
  return {
    name: source.name,
    type: storageType(table, type.scalar, type.integer, type.record),
    parameter: source.parameter,
    file,
    line,
    locations,
  };
}
function inlineScope(
  table: DebugTypeTable,
  source: ProgramInlineScope,
  base: number,
): DebugInlineScope {
  const known = table.originIds.get(source.origin),
    origin = known === undefined ? table.origins.length : known;
  if (known === undefined) {
    table.origins.push(source.origin);
    table.originIds.set(source.origin, origin);
  }
  const variables: DebugVariable[] = [],
    inlined: DebugInlineScope[] = [],
    ranges: { offset: number; byteLength: number }[] = [];
  for (const range of source.ranges) {
    if (range === undefined) throw "debug scope range invariant";
    ranges.push({ offset: base + range.offset, byteLength: range.byteLength });
  }
  for (const item of source.variables) {
    if (item === undefined) throw "debug scope variable invariant";
    variables.push(variable(table, item, base));
  }
  for (const inner of source.inlined) {
    if (inner === undefined) throw "debug inner scope invariant";
    inlined.push(inlineScope(table, inner, base));
  }
  return {
    origin,
    callFile: source.call.file,
    callLine: source.call.line,
    callColumn: source.call.column,
    ranges,
    variables,
    inlined,
  };
}
/** DWARF variables and inline scopes of one function placed at `base`. */
export function debugFunctionParts(
  table: DebugTypeTable,
  source: ProgramFunctionDebug,
  base: number,
): {
  readonly variables: readonly DebugVariable[];
  readonly inlined: readonly DebugInlineScope[];
} {
  const variables: DebugVariable[] = [],
    inlined: DebugInlineScope[] = [];
  // Parameters first, as debuggers list them in signature order.
  for (const parameter of [true, false])
    for (const item of source.variables) {
      if (item === undefined) throw "debug variable invariant";
      if (item.parameter === parameter)
        variables.push(variable(table, item, base));
    }
  for (const scope of source.inlined) {
    if (scope === undefined) throw "debug scope invariant";
    inlined.push(inlineScope(table, scope, base));
  }
  return { variables, inlined };
}
