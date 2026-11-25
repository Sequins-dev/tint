import type {
  ActivationField,
  ArrayAtomicOperation,
  Block,
  Environment,
  EnvironmentCell,
  FunctionDebug,
  FunctionIR,
  GeneralTest,
  InlineSite,
  Instruction,
  ReturnType,
  ScalarType,
  SlotBinding,
  SourceVariable,
  Terminator,
  ValueBinding,
} from "../scalar/model.ts";
import type { HostOperation } from "../scalar/host.ts";
import type { ForeignCall, ForeignMemoryAccess } from "../scalar/foreign.ts";
import {
  createByteReader,
  readByte,
  readNumber,
  readSigned,
  readString,
  readUnsigned,
  writeByte,
  writeNumber,
  writeSigned,
  writeString,
  writeUnsigned,
  type ByteReader,
  type ByteWriter,
} from "./bytes.ts";
/** Packed function encoding, version 1 (docs/compiler-memory.md, "Binary
 * format"). Every field is written in a fixed order; optional fields are
 * flagged, so decoding restores exactly the fields that were present
 * (absent and undefined are the same field). */
export const packedFunctionVersion = 2;
/** Values the encoding refers to by index instead of serializing: foreign
 * descriptors (their vocabulary belongs to the FFI), host operations and
 * operator spellings. All are bounded by the language and the program's
 * bindings, not by its size. The tables live as long as the store; packed
 * bytes are only meaningful with the tables that encoded them. */
export interface PackedVocabulary {
  readonly hostOperations: HostOperation[];
  readonly hostOperationIndexes: Map<HostOperation, number>;
  readonly operators: string[];
  readonly operatorIndexes: Map<string, number>;
  readonly foreignCalls: ForeignCall[];
  readonly foreignCallIndexes: Map<ForeignCall, number>;
  readonly foreignAccesses: ForeignMemoryAccess[];
  readonly foreignAccessIndexes: Map<ForeignMemoryAccess, number>;
}
export function createPackedVocabulary(): PackedVocabulary {
  return {
    hostOperations: [],
    hostOperationIndexes: new Map<HostOperation, number>(),
    operators: [],
    operatorIndexes: new Map<string, number>(),
    foreignCalls: [],
    foreignCallIndexes: new Map<ForeignCall, number>(),
    foreignAccesses: [],
    foreignAccessIndexes: new Map<ForeignMemoryAccess, number>(),
  };
}
function hostOperationIndex(
  vocabulary: PackedVocabulary,
  operation: HostOperation,
): number {
  const known = vocabulary.hostOperationIndexes.get(operation);
  if (known !== undefined) return known;
  const index = vocabulary.hostOperations.length;
  vocabulary.hostOperations.push(operation);
  vocabulary.hostOperationIndexes.set(operation, index);
  return index;
}
function operatorIndex(vocabulary: PackedVocabulary, operator: string): number {
  const known = vocabulary.operatorIndexes.get(operator);
  if (known !== undefined) return known;
  const index = vocabulary.operators.length;
  vocabulary.operators.push(operator);
  vocabulary.operatorIndexes.set(operator, index);
  return index;
}
function foreignCallIndex(
  vocabulary: PackedVocabulary,
  call: ForeignCall,
): number {
  const known = vocabulary.foreignCallIndexes.get(call);
  if (known !== undefined) return known;
  const index = vocabulary.foreignCalls.length;
  vocabulary.foreignCalls.push(call);
  vocabulary.foreignCallIndexes.set(call, index);
  return index;
}
function foreignAccessIndex(
  vocabulary: PackedVocabulary,
  access: ForeignMemoryAccess,
): number {
  const known = vocabulary.foreignAccessIndexes.get(access);
  if (known !== undefined) return known;
  const index = vocabulary.foreignAccesses.length;
  vocabulary.foreignAccesses.push(access);
  vocabulary.foreignAccessIndexes.set(access, index);
  return index;
}
function scalarCode(type: ReturnType): number {
  switch (type) {
    case "general":
      return 0;
    case "optional-boolean":
      return 1;
    case "primitive":
      return 2;
    case "string":
      return 3;
    case "reference":
      return 4;
    case "optional-reference":
      return 5;
    case "optional-string":
      return 6;
    case "number":
      return 7;
    case "boolean":
      return 8;
    case "Uint8Array":
      return 9;
    case "Uint16Array":
      return 10;
    case "Uint32Array":
      return 11;
    case "Float64Array":
      return 12;
    case "optional-number":
      return 13;
    case "void":
      return 14;
  }
}
function scalarType(code: number): ScalarType {
  switch (code) {
    case 0:
      return "general";
    case 1:
      return "optional-boolean";
    case 2:
      return "primitive";
    case 3:
      return "string";
    case 4:
      return "reference";
    case 5:
      return "optional-reference";
    case 6:
      return "optional-string";
    case 7:
      return "number";
    case 8:
      return "boolean";
    case 9:
      return "Uint8Array";
    case 10:
      return "Uint16Array";
    case 11:
      return "Uint32Array";
    case 12:
      return "Float64Array";
    case 13:
      return "optional-number";
  }
  throw "packed IR scalar type";
}
function returnType(code: number): ReturnType {
  return code === 14 ? "void" : scalarType(code);
}
function arrayType(
  code: number,
): "Uint8Array" | "Uint16Array" | "Uint32Array" | "Float64Array" {
  switch (code) {
    case 9:
      return "Uint8Array";
    case 10:
      return "Uint16Array";
    case 11:
      return "Uint32Array";
    case 12:
      return "Float64Array";
  }
  throw "packed IR array type";
}
function referenceValueType(
  code: number,
): "reference" | "Uint8Array" | "Uint16Array" | "Uint32Array" | "Float64Array" {
  return code === 4 ? "reference" : arrayType(code);
}
function generalValueType(
  code: number,
):
  | "number"
  | "boolean"
  | "string"
  | "reference"
  | "Uint8Array"
  | "Uint16Array"
  | "Uint32Array"
  | "Float64Array" {
  switch (code) {
    case 7:
      return "number";
    case 8:
      return "boolean";
    case 3:
      return "string";
    case 4:
      return "reference";
  }
  return arrayType(code);
}
function errorName(code: number): "Error" | "TypeError" | "RangeError" {
  if (code === 0) return "TypeError";
  if (code === 1) return "RangeError";
  if (code === 2) return "Error";
  throw "packed IR error name";
}
function cellOperation(code: number): "initialize" | "read" | "write" {
  if (code === 0) return "initialize";
  if (code === 1) return "read";
  if (code === 2) return "write";
  throw "packed IR cell operation";
}
function cellCode(operation: "initialize" | "read" | "write"): number {
  return operation === "initialize" ? 0 : operation === "read" ? 1 : 2;
}
function recordOperation(code: number): "read" | "write" {
  if (code === 1) return "read";
  if (code === 2) return "write";
  throw "packed IR record operation";
}
const atomicOperations: readonly ArrayAtomicOperation[] = [
  "load",
  "store",
  "add",
  "sub",
  "and",
  "or",
  "xor",
  "exchange",
  "compare-exchange",
];
function writeList(writer: ByteWriter, values: readonly number[]): void {
  writeUnsigned(writer, values.length);
  for (const value of values) {
    if (value === undefined) throw "packed IR list invariant";
    writeSigned(writer, value);
  }
}
function readList(reader: ByteReader): number[] {
  const count = readUnsigned(reader);
  const values: number[] = [];
  for (let index = 0; index < count; index++) values.push(readSigned(reader));
  return values;
}
/** 0 for an absent element, otherwise the zigzag value plus one. */
function writeOptionalList(
  writer: ByteWriter,
  values: readonly (number | undefined)[],
): void {
  writeUnsigned(writer, values.length);
  for (let index = 0; index < values.length; index++) {
    const value = values[index];
    if (value === undefined) writeUnsigned(writer, 0);
    else writeUnsigned(writer, (value >= 0 ? value * 2 : -value * 2 - 1) + 1);
  }
}
function readOptionalList(reader: ByteReader): (number | undefined)[] {
  const count = readUnsigned(reader);
  const values: (number | undefined)[] = [];
  for (let index = 0; index < count; index++) {
    const encoded = readUnsigned(reader);
    if (encoded === 0) values.push(undefined);
    else {
      const zigzag = encoded - 1;
      values.push(zigzag % 2 === 0 ? zigzag / 2 : -(zigzag + 1) / 2);
    }
  }
  return values;
}
/** Instruction prefix: opcode, flags (bit 0: inline site; higher bits are
 * the kind's optional fields), span and inline site. */
function writePrefix(
  writer: ByteWriter,
  opcode: number,
  op: {
    readonly start: number;
    readonly end: number;
    readonly inline?: number | undefined;
  },
  flags: number,
): void {
  const inline = op.inline;
  writeByte(writer, opcode);
  writeByte(writer, flags + (inline === undefined ? 0 : 1));
  writeSigned(writer, op.start - writer.spanBase);
  writeSigned(writer, op.end - op.start);
  writer.spanBase = op.start;
  if (inline !== undefined) writeSigned(writer, inline);
}
function bit(present: boolean, value: number): number {
  return present ? value : 0;
}
/** General-value tests by their packed index; append only. */
const generalTests: readonly GeneralTest[] = [
  "undefined",
  "number",
  "boolean",
  "string",
  "null",
  "Uint8Array",
  "Uint16Array",
  "Uint32Array",
  "Float64Array",
  "object",
  "nullish",
  "absent",
];
/** Activation fields by their packed index; append only. */
const activationFields: readonly ActivationField[] = [
  "top",
  "previous",
  "kind",
  "callee",
  "count",
  "argument",
];
export function encodeInstruction(
  writer: ByteWriter,
  vocabulary: PackedVocabulary,
  op: Instruction,
): boolean {
  switch (op.kind) {
    case "general-record-is":
    case "general-record-descriptor":
      writePrefix(writer, op.kind === "general-record-is" ? 0 : 1, op, 0);
      writeSigned(writer, op.id);
      writeSigned(writer, op.value);
      writeSigned(writer, op.record);
      return true;
    case "function-address":
      writePrefix(writer, 2, op, 0);
      writeSigned(writer, op.id);
      writeSigned(writer, op.target);
      writeByte(writer, op.part === "entry" ? 0 : 1);
      return true;
    case "record-descriptor-address":
      writePrefix(writer, 3, op, 0);
      writeSigned(writer, op.id);
      writeSigned(writer, op.record);
      return true;
    case "general-kind":
      writePrefix(writer, 4, op, 0);
      writeSigned(writer, op.id);
      writeSigned(writer, op.value);
      return true;
    case "general-is":
      writePrefix(writer, 80, op, op.branch === true ? 2 : 0);
      writeSigned(writer, op.id);
      writeSigned(writer, op.value);
      writeByte(writer, generalTests.indexOf(op.type));
      return true;
    case "general-equal":
      writePrefix(writer, 5, op, 0);
      writeSigned(writer, op.id);
      writeSigned(writer, op.left);
      writeSigned(writer, op.right);
      return true;
    case "general-none":
      writePrefix(writer, 6, op, 0);
      writeSigned(writer, op.id);
      return true;
    case "general-null":
      writePrefix(writer, 7, op, 0);
      writeSigned(writer, op.id);
      return true;
    case "general-wrap":
      writePrefix(writer, 8, op, 0);
      writeSigned(writer, op.id);
      writeSigned(writer, op.value);
      return true;
    case "general-value":
      writePrefix(writer, 9, op, op.unchecked === true ? 2 : 0);
      writeSigned(writer, op.id);
      writeSigned(writer, op.value);
      writeByte(writer, scalarCode(op.type));
      return true;
    case "record-has":
    case "record-read":
      writePrefix(writer, op.kind === "record-has" ? 10 : 11, op, 0);
      writeSigned(writer, op.id);
      writeSigned(writer, op.object);
      writeSigned(writer, op.record);
      writeSigned(writer, op.field);
      return true;
    case "boolean-none":
      writePrefix(writer, 12, op, 0);
      writeSigned(writer, op.id);
      return true;
    case "boolean-wrap":
    case "boolean-value":
    case "boolean-present":
      writePrefix(
        writer,
        op.kind === "boolean-wrap" ? 13 : op.kind === "boolean-value" ? 14 : 15,
        op,
        0,
      );
      writeSigned(writer, op.id);
      writeSigned(writer, op.value);
      return true;
    case "primitive-wrap":
    case "primitive-reference":
      writePrefix(writer, op.kind === "primitive-wrap" ? 16 : 17, op, 0);
      writeSigned(writer, op.id);
      writeSigned(writer, op.value);
      return true;
    case "function-environment":
      writePrefix(writer, 18, op, 0);
      writeSigned(writer, op.id);
      writeSigned(writer, op.callee);
      return true;
    case "function-new": {
      const environment = op.environment;
      writePrefix(writer, 19, op, bit(environment !== undefined, 2));
      writeSigned(writer, op.id);
      writeSigned(writer, op.target);
      if (environment !== undefined) writeSigned(writer, environment);
      return true;
    }
    case "call-indirect": {
      const receiver = op.receiver,
        id = op.id;
      writePrefix(
        writer,
        20,
        op,
        bit(receiver !== undefined, 2) +
          bit(id !== undefined, 4) +
          bit(op.discardResult === true, 8) +
          bit(op.scriptArguments !== undefined, 16) +
          bit(op.tail === true, 32),
      );
      if (receiver !== undefined) writeSigned(writer, receiver);
      if (id !== undefined) writeSigned(writer, id);
      writeSigned(writer, op.target);
      writeSigned(writer, op.callee);
      writeList(writer, op.arguments);
      if (op.scriptArguments !== undefined)
        writeList(writer, op.scriptArguments);
      return true;
    }
    case "script-argument":
      writePrefix(writer, 82, op, 0);
      writeSigned(writer, op.id);
      writeSigned(writer, op.index);
      return true;
    case "activation-read": {
      const record = op.record,
        index = op.index;
      writePrefix(
        writer,
        117,
        op,
        bit(record !== undefined, 2) + bit(index !== undefined, 4),
      );
      writeSigned(writer, op.id);
      writeByte(writer, activationFields.indexOf(op.field));
      if (record !== undefined) writeSigned(writer, record);
      if (index !== undefined) writeSigned(writer, index);
      return true;
    }
    case "script-argument-count":
      writePrefix(writer, 83, op, 0);
      writeSigned(writer, op.id);
      return true;
    case "record-slot-read":
      writePrefix(writer, 114, op, 0);
      writeSigned(writer, op.id);
      writeSigned(writer, op.object);
      writeSigned(writer, op.record);
      writeSigned(writer, op.field);
      writeSigned(writer, op.count);
      writeSigned(writer, op.index);
      return true;
    case "property-load": {
      const spillRecord = op.spillRecord,
        spillField = op.spillField;
      writePrefix(
        writer,
        115,
        op,
        bit(op.inherited, 2) |
          bit(spillRecord !== undefined && spillField !== undefined, 4),
      );
      writeSigned(writer, op.id);
      writeSigned(writer, op.object);
      writeSigned(writer, op.site);
      writeSigned(writer, op.record);
      writeSigned(writer, op.field);
      writeSigned(writer, op.count);
      writeSigned(writer, op.siteRecord);
      writeSigned(writer, op.siteField);
      writeSigned(writer, op.entries);
      writeSigned(writer, op.epochRecord);
      writeSigned(writer, op.epochField);
      if (spillRecord !== undefined && spillField !== undefined) {
        writeSigned(writer, spillRecord);
        writeSigned(writer, spillField);
      }
      return true;
    }
    case "property-store":
      writePrefix(writer, 116, op, 0);
      writeSigned(writer, op.id);
      writeSigned(writer, op.object);
      writeSigned(writer, op.value);
      writeSigned(writer, op.site);
      writeSigned(writer, op.record);
      writeSigned(writer, op.field);
      writeSigned(writer, op.count);
      writeSigned(writer, op.siteRecord);
      writeSigned(writer, op.siteField);
      writeSigned(writer, op.epochRecord);
      writeSigned(writer, op.epochField);
      return true;
    case "script-entry":
      writePrefix(writer, 118, op, bit(op.construct, 2));
      writeSigned(writer, op.id);
      writeSigned(writer, op.callee);
      writeSigned(writer, op.realm);
      writeSigned(writer, op.realmRecord);
      writeSigned(writer, op.agentField);
      writeSigned(writer, op.agentRecord);
      writeSigned(writer, op.activeField);
      writeSigned(writer, op.objectRecord);
      writeSigned(writer, op.registerCallField);
      writeSigned(writer, op.entryRecord);
      writeSigned(writer, op.invokeField);
      writeSigned(writer, op.contextField);
      writeSigned(writer, op.constructibleField);
      writeSigned(writer, op.contextRecord);
      writeSigned(writer, op.realmField);
      writeSigned(writer, op.scriptOrModuleField);
      return true;
    case "global-cell":
      writePrefix(writer, 119, op, 0);
      writeSigned(writer, op.id);
      writeSigned(writer, op.scope);
      writeSigned(writer, op.cache);
      writeSigned(writer, op.scopeRecord);
      writeSigned(writer, op.declarativeField);
      writeSigned(writer, op.objectField);
      writeSigned(writer, op.globalField);
      writeSigned(writer, op.globalRecord);
      writeSigned(writer, op.lexicalEpochField);
      writeSigned(writer, op.globalObjectField);
      writeSigned(writer, op.globalObjectRecord);
      writeSigned(writer, op.propertyEpochField);
      writeSigned(writer, op.cacheRecord);
      writeSigned(writer, op.cacheGlobalField);
      writeSigned(writer, op.cacheLexicalEpochField);
      writeSigned(writer, op.cacheObjectEpochField);
      writeSigned(writer, op.cacheCellField);
      return true;
    case "element-load":
    case "element-store": {
      const cachedStorage = op.cachedStorage,
        cachedCount = op.cachedCount;
      const hasCache = cachedStorage !== undefined && cachedCount !== undefined;
      writePrefix(
        writer,
        op.kind === "element-load" ? 120 : 121,
        op,
        hasCache ? 2 : 0,
      );
      writeSigned(writer, op.id);
      writeSigned(writer, op.object);
      writeSigned(writer, op.index);
      if (op.kind === "element-store") writeSigned(writer, op.value);
      writeSigned(writer, op.record);
      writeSigned(writer, op.field);
      writeSigned(writer, op.elementsRecord);
      writeSigned(writer, op.countField);
      writeSigned(writer, op.storageField);
      if (cachedStorage !== undefined && cachedCount !== undefined) {
        writeSigned(writer, cachedStorage);
        writeSigned(writer, cachedCount);
      }
      return true;
    }
    case "element-length":
      writePrefix(writer, 122, op, 0);
      writeSigned(writer, op.id);
      writeSigned(writer, op.object);
      writeSigned(writer, op.record);
      writeSigned(writer, op.field);
      writeSigned(writer, op.elementsRecord);
      writeSigned(writer, op.lengthField);
      return true;
    case "element-storage":
    case "element-count":
      writePrefix(writer, op.kind === "element-storage" ? 123 : 124, op, 0);
      writeSigned(writer, op.id);
      writeSigned(writer, op.object);
      writeSigned(writer, op.record);
      writeSigned(writer, op.field);
      writeSigned(writer, op.elementsRecord);
      writeSigned(writer, op.countField);
      writeSigned(writer, op.storageField);
      return true;
    case "closure-environment":
      writePrefix(writer, 21, op, 0);
      writeSigned(writer, op.id);
      return true;
    case "string-none":
      writePrefix(writer, 22, op, 0);
      writeSigned(writer, op.id);
      return true;
    case "string-wrap":
    case "string-value":
    case "string-present":
      writePrefix(
        writer,
        op.kind === "string-wrap" ? 23 : op.kind === "string-value" ? 24 : 25,
        op,
        0,
      );
      writeSigned(writer, op.id);
      writeSigned(writer, op.value);
      return true;
    case "reference-none":
      writePrefix(writer, 26, op, 0);
      writeSigned(writer, op.id);
      return true;
    case "string-reference":
    case "reference-string":
      writePrefix(writer, op.kind === "string-reference" ? 27 : 28, op, 0);
      writeSigned(writer, op.id);
      writeSigned(writer, op.value);
      return true;
    case "reference-wrap":
      writePrefix(writer, 29, op, 0);
      writeSigned(writer, op.id);
      writeSigned(writer, op.value);
      return true;
    case "reference-value": {
      const type = op.type;
      writePrefix(writer, 30, op, bit(type !== undefined, 2));
      writeSigned(writer, op.id);
      writeSigned(writer, op.value);
      if (type !== undefined) writeByte(writer, scalarCode(type));
      return true;
    }
    case "string-literal":
      writePrefix(writer, 31, op, 0);
      writeSigned(writer, op.id);
      writeString(writer, op.value);
      return true;
    case "string-length":
      writePrefix(writer, 32, op, 0);
      writeSigned(writer, op.id);
      writeSigned(writer, op.string);
      return true;
    case "string-two-byte":
      writePrefix(writer, 85, op, 0);
      writeSigned(writer, op.id);
      writeSigned(writer, op.string);
      return true;
    case "string-code-unit": {
      const inBounds = op.inBounds,
        unitKind = op.unitKind;
      writePrefix(
        writer,
        33,
        op,
        bit(inBounds !== undefined, 2) +
          bit(inBounds === true, 4) +
          bit(unitKind !== undefined, 8) +
          bit(unitKind === "two-byte", 16),
      );
      writeSigned(writer, op.id);
      writeSigned(writer, op.string);
      writeSigned(writer, op.index);
      return true;
    }
    case "string-starts-with":
      writePrefix(writer, 34, op, 0);
      writeSigned(writer, op.id);
      writeSigned(writer, op.string);
      writeSigned(writer, op.search);
      writeSigned(writer, op.position);
      return true;
    case "string-from-latin1":
    case "bytes-ascii-prefix":
      writePrefix(writer, op.kind === "string-from-latin1" ? 87 : 90, op, 0);
      writeSigned(writer, op.id);
      writeSigned(writer, op.bytes);
      writeSigned(writer, op.begin);
      writeSigned(writer, op.limit);
      return true;
    case "number-string-cached":
      writePrefix(writer, 97, op, 0);
      writeSigned(writer, op.id);
      writeSigned(writer, op.value);
      return true;
    case "number-string-cache":
      writePrefix(writer, 98, op, 0);
      writeSigned(writer, op.value);
      writeSigned(writer, op.string);
      return true;
    case "string-index-cached":
      writePrefix(writer, 99, op, 0);
      writeSigned(writer, op.id);
      writeSigned(writer, op.string);
      return true;
    case "string-index-cache":
      writePrefix(writer, 100, op, 0);
      writeSigned(writer, op.string);
      writeSigned(writer, op.value);
      return true;
    case "string-split-cached":
      writePrefix(writer, 101, op, 0);
      writeSigned(writer, op.id);
      writeSigned(writer, op.string);
      writeSigned(writer, op.separator);
      writeSigned(writer, op.template);
      return true;
    case "string-split-cache":
      writePrefix(writer, 102, op, 0);
      writeSigned(writer, op.string);
      writeSigned(writer, op.separator);
      writeSigned(writer, op.value);
      return true;
    case "string-utf8-length":
      writePrefix(writer, 94, op, 0);
      writeSigned(writer, op.id);
      writeSigned(writer, op.string);
      writeSigned(writer, op.begin);
      writeSigned(writer, op.limit);
      return true;
    case "string-write-utf8":
      writePrefix(writer, 95, op, bit(op.written === true, 2));
      writeSigned(writer, op.id);
      writeSigned(writer, op.string);
      writeSigned(writer, op.begin);
      writeSigned(writer, op.limit);
      writeSigned(writer, op.bytes);
      writeSigned(writer, op.offset);
      return true;
    case "string-from-utf8":
      writePrefix(writer, 96, op, bit(op.whole === true, 2));
      writeSigned(writer, op.id);
      writeSigned(writer, op.bytes);
      writeSigned(writer, op.begin);
      writeSigned(writer, op.limit);
      return true;
    case "string-copy-latin1":
      writePrefix(writer, 88, op, 0);
      writeSigned(writer, op.id);
      writeSigned(writer, op.string);
      writeSigned(writer, op.begin);
      writeSigned(writer, op.limit);
      writeSigned(writer, op.bytes);
      writeSigned(writer, op.offset);
      return true;
    case "string-ascii-case":
      writePrefix(writer, 91, op, bit(op.upper, 2));
      writeSigned(writer, op.id);
      writeSigned(writer, op.string);
      return true;
    case "string-flat":
      writePrefix(writer, 92, op, 0);
      writeSigned(writer, op.id);
      writeSigned(writer, op.string);
      return true;
    case "string-flatten-into":
      writePrefix(writer, 93, op, 0);
      writeSigned(writer, op.id);
      writeSigned(writer, op.address);
      writeSigned(writer, op.byteLength);
      writeSigned(writer, op.string);
      return true;
    case "string-ascii-prefix":
      writePrefix(writer, 89, op, 0);
      writeSigned(writer, op.id);
      writeSigned(writer, op.string);
      writeSigned(writer, op.begin);
      writeSigned(writer, op.limit);
      return true;
    case "string-index-of":
      writePrefix(writer, 86, op, bit(op.reverse, 2));
      writeSigned(writer, op.id);
      writeSigned(writer, op.string);
      writeSigned(writer, op.search);
      writeSigned(writer, op.position);
      return true;
    case "string-slice":
      writePrefix(writer, 35, op, 0);
      writeSigned(writer, op.id);
      writeSigned(writer, op.string);
      writeSigned(writer, op.begin);
      writeSigned(writer, op.limit);
      return true;
    case "string-from-code-units":
      writePrefix(writer, 36, op, 0);
      writeSigned(writer, op.id);
      writeList(writer, op.values);
      return true;
    case "string-concat":
      writePrefix(writer, 37, op, 0);
      writeSigned(writer, op.id);
      writeSigned(writer, op.left);
      writeSigned(writer, op.right);
      return true;
    case "string-allocate":
      writePrefix(writer, 38, op, 0);
      writeSigned(writer, op.id);
      writeSigned(writer, op.length);
      writeSigned(writer, op.twoByte);
      return true;
    case "string-write":
      writePrefix(writer, 39, op, 0);
      writeSigned(writer, op.target);
      writeSigned(writer, op.offset);
      writeSigned(writer, op.source);
      return true;
    case "record-new": {
      const presence = op.presence;
      writePrefix(writer, 40, op, bit(presence !== undefined, 2));
      writeSigned(writer, op.id);
      writeSigned(writer, op.record);
      writeOptionalList(writer, op.arguments);
      if (presence !== undefined) writeOptionalList(writer, presence);
      return true;
    }
    case "constant": {
      const value = op.value;
      writePrefix(writer, 41, op, 0);
      writeSigned(writer, op.id);
      if (typeof value === "boolean") writeByte(writer, value ? 3 : 2);
      else writeNumber(writer, value);
      return true;
    }
    case "error-message":
      writePrefix(writer, 81, op, 0);
      writeSigned(writer, op.id);
      writeSigned(writer, op.value);
      return true;
    case "error-new":
    case "error-is":
      writePrefix(writer, op.kind === "error-new" ? 42 : 43, op, 0);
      writeByte(
        writer,
        op.error === "TypeError" ? 0 : op.error === "RangeError" ? 1 : 2,
      );
      writeSigned(writer, op.id);
      writeSigned(writer, op.kind === "error-new" ? op.message : op.value);
      return true;
    case "host-call": {
      const id = op.id;
      writePrefix(writer, 44, op, bit(id !== undefined, 2));
      writeUnsigned(writer, hostOperationIndex(vocabulary, op.operation));
      if (id !== undefined) writeSigned(writer, id);
      writeList(writer, op.arguments);
      return true;
    }
    case "c-call": {
      const id = op.id;
      writePrefix(writer, 45, op, bit(id !== undefined, 2));
      writeUnsigned(writer, foreignCallIndex(vocabulary, op.call));
      if (id !== undefined) writeSigned(writer, id);
      writeList(writer, op.arguments);
      return true;
    }
    case "c-memory": {
      const id = op.id;
      writePrefix(writer, 46, op, bit(id !== undefined, 2));
      writeUnsigned(writer, foreignAccessIndex(vocabulary, op.access));
      if (id !== undefined) writeSigned(writer, id);
      writeList(writer, op.arguments);
      return true;
    }
    case "array-subarray":
      writePrefix(writer, 47, op, 0);
      writeSigned(writer, op.id);
      writeSigned(writer, op.array);
      writeSigned(writer, op.begin);
      writeSigned(writer, op.length);
      return true;
    case "array-view":
      writePrefix(writer, 103, op, 0);
      writeSigned(writer, op.id);
      writeByte(writer, scalarCode(op.type));
      writeSigned(writer, op.buffer);
      writeSigned(writer, op.byteOffset);
      writeSigned(writer, op.length);
      return true;
    case "array-buffer-byte-length":
      writePrefix(writer, 104, op, 0);
      writeSigned(writer, op.id);
      writeSigned(writer, op.buffer);
      return true;
    case "array-atomic": {
      const id = op.id;
      writePrefix(writer, 105, op, bit(id !== undefined, 2));
      writeByte(writer, atomicOperations.indexOf(op.operation));
      if (id !== undefined) writeSigned(writer, id);
      writeSigned(writer, op.array);
      writeSigned(writer, op.index);
      writeList(writer, op.operands);
      return true;
    }
    case "weak-slot-new":
      writePrefix(writer, 48, op, 0);
      writeSigned(writer, op.id);
      writeSigned(writer, op.key);
      writeSigned(writer, op.value);
      writeSigned(writer, op.ephemeron);
      return true;
    case "weak-slot-key":
    case "weak-slot-value":
      writePrefix(writer, op.kind === "weak-slot-key" ? 49 : 50, op, 0);
      writeSigned(writer, op.id);
      writeSigned(writer, op.cell);
      return true;
    case "weak-slot-set-value":
      writePrefix(writer, 51, op, 0);
      writeSigned(writer, op.cell);
      writeSigned(writer, op.value);
      return true;
    case "weak-slot-clear":
      writePrefix(writer, 52, op, 0);
      writeSigned(writer, op.cell);
      return true;
    case "reference-vector-new":
      writePrefix(writer, 53, op, 0);
      writeSigned(writer, op.id);
      writeSigned(writer, op.length);
      return true;
    case "reference-vector-length":
    case "reference-vector-is":
      writePrefix(
        writer,
        op.kind === "reference-vector-length" ? 54 : 55,
        op,
        0,
      );
      writeSigned(writer, op.id);
      writeSigned(writer, op.vector);
      return true;
    case "reference-vector-read":
      writePrefix(writer, 56, op, 0);
      writeSigned(writer, op.id);
      writeSigned(writer, op.vector);
      writeSigned(writer, op.index);
      return true;
    case "reference-vector-write":
      writePrefix(writer, 57, op, 0);
      writeSigned(writer, op.vector);
      writeSigned(writer, op.index);
      writeSigned(writer, op.value);
      return true;
    case "reference-vector-copy":
      writePrefix(writer, 58, op, bit(op.rebase, 2));
      writeSigned(writer, op.source);
      writeSigned(writer, op.target);
      writeSigned(writer, op.count);
      return true;
    case "array-new":
      writePrefix(writer, 59, op, 0);
      writeSigned(writer, op.id);
      writeByte(writer, scalarCode(op.type));
      writeSigned(writer, op.length);
      return true;
    case "array-length":
    case "array-buffer":
    case "array-byte-offset":
    case "array-byte-length":
      writePrefix(
        writer,
        op.kind === "array-length"
          ? 60
          : op.kind === "array-buffer"
            ? 61
            : op.kind === "array-byte-offset"
              ? 62
              : 63,
        op,
        0,
      );
      writeSigned(writer, op.id);
      writeSigned(writer, op.array);
      return true;
    case "array-valid":
    case "array-read":
    case "array-element":
      writePrefix(
        writer,
        op.kind === "array-valid" ? 64 : op.kind === "array-read" ? 65 : 66,
        op,
        0,
      );
      writeSigned(writer, op.id);
      writeSigned(writer, op.array);
      writeSigned(writer, op.index);
      return true;
    case "array-copy":
      writePrefix(writer, 67, op, 0);
      writeSigned(writer, op.id);
      writeSigned(writer, op.array);
      writeSigned(writer, op.source);
      writeSigned(writer, op.offset);
      return true;
    case "array-write":
    case "array-store":
      writePrefix(writer, op.kind === "array-write" ? 68 : 69, op, 0);
      writeSigned(writer, op.array);
      writeSigned(writer, op.index);
      writeSigned(writer, op.value);
      return true;
    case "undefined":
      writePrefix(writer, 70, op, 0);
      writeSigned(writer, op.id);
      return true;
    case "optional-wrap":
    case "optional-present":
    case "optional-value":
      writePrefix(
        writer,
        op.kind === "optional-wrap"
          ? 71
          : op.kind === "optional-present"
            ? 72
            : 73,
        op,
        0,
      );
      writeSigned(writer, op.id);
      writeSigned(writer, op.value);
      return true;
    case "optional-value-or":
      writePrefix(writer, 74, op, 0);
      writeSigned(writer, op.id);
      writeSigned(writer, op.value);
      writeSigned(writer, op.fallback);
      return true;
    case "load":
      writePrefix(writer, 75, op, 0);
      writeSigned(writer, op.id);
      writeSigned(writer, op.slot);
      return true;
    case "store":
      writePrefix(writer, 76, op, 0);
      writeSigned(writer, op.slot);
      writeSigned(writer, op.value);
      return true;
    case "unary":
      writePrefix(writer, 77, op, 0);
      writeSigned(writer, op.id);
      writeUnsigned(writer, operatorIndex(vocabulary, op.operator));
      writeSigned(writer, op.operand);
      return true;
    case "binary":
      writePrefix(writer, 78, op, 0);
      writeSigned(writer, op.id);
      writeUnsigned(writer, operatorIndex(vocabulary, op.operator));
      writeSigned(writer, op.left);
      writeSigned(writer, op.right);
      return true;
    case "call": {
      const receiver = op.receiver,
        id = op.id,
        environment = op.environment;
      writePrefix(
        writer,
        79,
        op,
        bit(receiver !== undefined, 2) +
          bit(id !== undefined, 4) +
          bit(environment !== undefined, 8),
      );
      if (receiver !== undefined) writeSigned(writer, receiver);
      if (id !== undefined) writeSigned(writer, id);
      writeSigned(writer, op.target);
      writeList(writer, op.arguments);
      return true;
    }
  }
  // Every kind has a case; the codec test fails to type-check when the IR
  // gains a kind it does not list.
  throw "packed IR cannot encode this instruction kind";
}
interface Prefix {
  readonly flags: number;
  readonly start: number;
  readonly end: number;
  readonly inline: number | undefined;
}
function readPrefix(reader: ByteReader): Prefix {
  const flags = readByte(reader),
    start = reader.spanBase + readSigned(reader),
    end = start + readSigned(reader);
  reader.spanBase = start;
  return {
    flags,
    start,
    end,
    inline: flags % 2 === 1 ? readSigned(reader) : undefined,
  };
}
function flagged(flags: number, value: number): boolean {
  return Math.floor(flags / value) % 2 === 1;
}
/** The span and, when present, the inline site, spread into each decoded
 * instruction after its kind-specific fields. */
function origin(
  prefix: Prefix,
):
  | { readonly start: number; readonly end: number }
  | { readonly start: number; readonly end: number; readonly inline: number } {
  const inline = prefix.inline;
  return inline === undefined
    ? { start: prefix.start, end: prefix.end }
    : { start: prefix.start, end: prefix.end, inline };
}
export function decodeInstruction(
  reader: ByteReader,
  vocabulary: PackedVocabulary,
): Instruction {
  const opcode = readByte(reader),
    prefix = readPrefix(reader),
    flags = prefix.flags,
    span = origin(prefix);
  switch (opcode) {
    case 0:
    case 1: {
      const id = readSigned(reader),
        value = readSigned(reader),
        record = readSigned(reader);
      return opcode === 0
        ? { kind: "general-record-is", id, value, record, ...span }
        : { kind: "general-record-descriptor", id, value, record, ...span };
    }
    case 2: {
      const id = readSigned(reader),
        target = readSigned(reader),
        part = readByte(reader);
      return {
        kind: "function-address",
        id,
        target,
        part: part === 0 ? "entry" : "signature",
        ...span,
      };
    }
    case 3: {
      const id = readSigned(reader),
        record = readSigned(reader);
      return { kind: "record-descriptor-address", id, record, ...span };
    }
    case 4: {
      const id = readSigned(reader),
        value = readSigned(reader);
      return { kind: "general-kind", id, value, ...span };
    }
    case 5: {
      const id = readSigned(reader),
        left = readSigned(reader),
        right = readSigned(reader);
      return { kind: "general-equal", id, left, right, ...span };
    }
    case 6:
      return { kind: "general-none", id: readSigned(reader), ...span };
    case 7:
      return { kind: "general-null", id: readSigned(reader), ...span };
    case 8: {
      const id = readSigned(reader),
        value = readSigned(reader);
      return { kind: "general-wrap", id, value, ...span };
    }
    case 9: {
      const id = readSigned(reader),
        value = readSigned(reader),
        type = generalValueType(readByte(reader));
      return flagged(flags, 2)
        ? { kind: "general-value", id, value, type, unchecked: true, ...span }
        : { kind: "general-value", id, value, type, ...span };
    }
    case 10:
    case 11: {
      const id = readSigned(reader),
        object = readSigned(reader),
        record = readSigned(reader),
        field = readSigned(reader);
      return opcode === 10
        ? { kind: "record-has", id, object, record, field, ...span }
        : { kind: "record-read", id, object, record, field, ...span };
    }
    case 12:
      return { kind: "boolean-none", id: readSigned(reader), ...span };
    case 13:
    case 14:
    case 15: {
      const id = readSigned(reader),
        value = readSigned(reader);
      return opcode === 13
        ? { kind: "boolean-wrap", id, value, ...span }
        : opcode === 14
          ? { kind: "boolean-value", id, value, ...span }
          : { kind: "boolean-present", id, value, ...span };
    }
    case 16:
    case 17: {
      const id = readSigned(reader),
        value = readSigned(reader);
      return opcode === 16
        ? { kind: "primitive-wrap", id, value, ...span }
        : { kind: "primitive-reference", id, value, ...span };
    }
    case 18: {
      const id = readSigned(reader),
        callee = readSigned(reader);
      return { kind: "function-environment", id, callee, ...span };
    }
    case 19: {
      const id = readSigned(reader),
        target = readSigned(reader);
      if (!flagged(flags, 2))
        return { kind: "function-new", id, target, ...span };
      const environment = readSigned(reader);
      return { kind: "function-new", id, target, environment, ...span };
    }
    case 20: {
      const receiver = flagged(flags, 2) ? readSigned(reader) : undefined,
        id = flagged(flags, 4) ? readSigned(reader) : undefined,
        target = readSigned(reader),
        callee = readSigned(reader),
        args = readList(reader),
        scriptArguments = flagged(flags, 16) ? readList(reader) : undefined;
      // A tail call is a script call: no receiver, its result used.
      if (flagged(flags, 32)) {
        if (scriptArguments === undefined) throw "packed tail call invariant";
        return {
          kind: "call-indirect",
          id,
          target,
          callee,
          arguments: args,
          scriptArguments,
          tail: true,
          ...span,
        };
      }
      return {
        kind: "call-indirect",
        ...(receiver === undefined ? {} : { receiver }),
        ...(flagged(flags, 8) ? { discardResult: true } : {}),
        id,
        target,
        callee,
        arguments: args,
        ...(scriptArguments === undefined ? {} : { scriptArguments }),
        ...span,
      };
    }
    case 21:
      return { kind: "closure-environment", id: readSigned(reader), ...span };
    case 22:
      return { kind: "string-none", id: readSigned(reader), ...span };
    case 23:
    case 24:
    case 25: {
      const id = readSigned(reader),
        value = readSigned(reader);
      return opcode === 23
        ? { kind: "string-wrap", id, value, ...span }
        : opcode === 24
          ? { kind: "string-value", id, value, ...span }
          : { kind: "string-present", id, value, ...span };
    }
    case 26:
      return { kind: "reference-none", id: readSigned(reader), ...span };
    case 27:
    case 28: {
      const id = readSigned(reader),
        value = readSigned(reader);
      return opcode === 27
        ? { kind: "string-reference", id, value, ...span }
        : { kind: "reference-string", id, value, ...span };
    }
    case 29: {
      const id = readSigned(reader),
        value = readSigned(reader);
      return { kind: "reference-wrap", id, value, ...span };
    }
    case 30: {
      const id = readSigned(reader),
        value = readSigned(reader);
      if (!flagged(flags, 2))
        return { kind: "reference-value", id, value, ...span };
      const type = referenceValueType(readByte(reader));
      return { kind: "reference-value", id, value, type, ...span };
    }
    case 31: {
      const id = readSigned(reader),
        value = readString(reader);
      return { kind: "string-literal", id, value, ...span };
    }
    case 32: {
      const id = readSigned(reader),
        string = readSigned(reader);
      return { kind: "string-length", id, string, ...span };
    }
    case 33: {
      const id = readSigned(reader),
        string = readSigned(reader),
        index = readSigned(reader);
      const unitKind: "one-byte" | "two-byte" = flagged(flags, 16)
        ? "two-byte"
        : "one-byte";
      if (!flagged(flags, 2)) {
        if (flagged(flags, 8))
          return {
            kind: "string-code-unit",
            id,
            string,
            index,
            unitKind,
            ...span,
          };
        return { kind: "string-code-unit", id, string, index, ...span };
      }
      const inBounds = flagged(flags, 4);
      if (flagged(flags, 8))
        return {
          kind: "string-code-unit",
          id,
          string,
          index,
          inBounds,
          unitKind,
          ...span,
        };
      return { kind: "string-code-unit", id, string, index, inBounds, ...span };
    }
    case 34: {
      const id = readSigned(reader),
        string = readSigned(reader),
        search = readSigned(reader),
        position = readSigned(reader);
      return {
        kind: "string-starts-with",
        id,
        string,
        search,
        position,
        ...span,
      };
    }
    case 35: {
      const id = readSigned(reader),
        string = readSigned(reader),
        begin = readSigned(reader),
        limit = readSigned(reader);
      return { kind: "string-slice", id, string, begin, limit, ...span };
    }
    case 36: {
      const id = readSigned(reader),
        values = readList(reader);
      return { kind: "string-from-code-units", id, values, ...span };
    }
    case 37: {
      const id = readSigned(reader),
        left = readSigned(reader),
        right = readSigned(reader);
      return { kind: "string-concat", id, left, right, ...span };
    }
    case 38: {
      const id = readSigned(reader),
        length = readSigned(reader),
        twoByte = readSigned(reader);
      return { kind: "string-allocate", id, length, twoByte, ...span };
    }
    case 39: {
      const target = readSigned(reader),
        offset = readSigned(reader),
        source = readSigned(reader);
      return { kind: "string-write", target, offset, source, ...span };
    }
    case 40: {
      const id = readSigned(reader),
        record = readSigned(reader),
        args = readOptionalList(reader);
      if (!flagged(flags, 2))
        return { kind: "record-new", id, record, arguments: args, ...span };
      const presence = readOptionalList(reader);
      return {
        kind: "record-new",
        id,
        record,
        arguments: args,
        presence,
        ...span,
      };
    }
    case 41: {
      const id = readSigned(reader),
        tag = reader.bytes[reader.offset] ?? 0;
      if (tag === 2 || tag === 3) {
        reader.offset++;
        return { kind: "constant", id, value: tag === 3, ...span };
      }
      const value = readNumber(reader);
      return { kind: "constant", id, value, ...span };
    }
    case 42:
    case 43: {
      const error = errorName(readByte(reader)),
        id = readSigned(reader),
        operand = readSigned(reader);
      return opcode === 42
        ? { kind: "error-new", error, id, message: operand, ...span }
        : { kind: "error-is", error, id, value: operand, ...span };
    }
    case 44: {
      const operation = vocabulary.hostOperations[readUnsigned(reader)];
      if (operation === undefined) throw "packed IR host operation";
      const id = flagged(flags, 2) ? readSigned(reader) : undefined,
        args = readList(reader);
      return { kind: "host-call", operation, id, arguments: args, ...span };
    }
    case 45: {
      const call = vocabulary.foreignCalls[readUnsigned(reader)];
      if (call === undefined) throw "packed IR foreign call";
      const id = flagged(flags, 2) ? readSigned(reader) : undefined,
        args = readList(reader);
      return { kind: "c-call", call, id, arguments: args, ...span };
    }
    case 46: {
      const access = vocabulary.foreignAccesses[readUnsigned(reader)];
      if (access === undefined) throw "packed IR foreign access";
      const id = flagged(flags, 2) ? readSigned(reader) : undefined,
        args = readList(reader);
      return { kind: "c-memory", access, id, arguments: args, ...span };
    }
    case 47: {
      const id = readSigned(reader),
        array = readSigned(reader),
        begin = readSigned(reader),
        length = readSigned(reader);
      return { kind: "array-subarray", id, array, begin, length, ...span };
    }
    case 103: {
      const id = readSigned(reader),
        type = arrayType(readByte(reader)),
        buffer = readSigned(reader),
        byteOffset = readSigned(reader),
        length = readSigned(reader);
      return {
        kind: "array-view",
        id,
        type,
        buffer,
        byteOffset,
        length,
        ...span,
      };
    }
    case 104: {
      const id = readSigned(reader),
        buffer = readSigned(reader);
      return { kind: "array-buffer-byte-length", id, buffer, ...span };
    }
    case 105: {
      const operation = atomicOperations[readByte(reader)];
      if (operation === undefined) throw "packed IR atomic operation";
      const id = flagged(flags, 2) ? readSigned(reader) : undefined,
        array = readSigned(reader),
        index = readSigned(reader),
        operands = readList(reader);
      return {
        kind: "array-atomic",
        operation,
        id,
        array,
        index,
        operands,
        ...span,
      };
    }
    case 48: {
      const id = readSigned(reader),
        key = readSigned(reader),
        value = readSigned(reader),
        ephemeron = readSigned(reader);
      return { kind: "weak-slot-new", id, key, value, ephemeron, ...span };
    }
    case 49:
    case 50: {
      const id = readSigned(reader),
        cell = readSigned(reader);
      return opcode === 49
        ? { kind: "weak-slot-key", id, cell, ...span }
        : { kind: "weak-slot-value", id, cell, ...span };
    }
    case 51: {
      const cell = readSigned(reader),
        value = readSigned(reader);
      return { kind: "weak-slot-set-value", cell, value, ...span };
    }
    case 52:
      return { kind: "weak-slot-clear", cell: readSigned(reader), ...span };
    case 53: {
      const id = readSigned(reader),
        length = readSigned(reader);
      return { kind: "reference-vector-new", id, length, ...span };
    }
    case 54:
    case 55: {
      const id = readSigned(reader),
        vector = readSigned(reader);
      return opcode === 54
        ? { kind: "reference-vector-length", id, vector, ...span }
        : { kind: "reference-vector-is", id, vector, ...span };
    }
    case 56: {
      const id = readSigned(reader),
        vector = readSigned(reader),
        index = readSigned(reader);
      return { kind: "reference-vector-read", id, vector, index, ...span };
    }
    case 57: {
      const vector = readSigned(reader),
        index = readSigned(reader),
        value = readSigned(reader);
      return { kind: "reference-vector-write", vector, index, value, ...span };
    }
    case 58: {
      const source = readSigned(reader),
        target = readSigned(reader),
        count = readSigned(reader);
      return {
        kind: "reference-vector-copy",
        source,
        target,
        count,
        rebase: flagged(flags, 2),
        ...span,
      };
    }
    case 59: {
      const id = readSigned(reader),
        type = arrayType(readByte(reader)),
        length = readSigned(reader);
      return { kind: "array-new", id, type, length, ...span };
    }
    case 60:
    case 61:
    case 62:
    case 63: {
      const id = readSigned(reader),
        array = readSigned(reader);
      return opcode === 60
        ? { kind: "array-length", id, array, ...span }
        : opcode === 61
          ? { kind: "array-buffer", id, array, ...span }
          : opcode === 62
            ? { kind: "array-byte-offset", id, array, ...span }
            : { kind: "array-byte-length", id, array, ...span };
    }
    case 64:
    case 65:
    case 66: {
      const id = readSigned(reader),
        array = readSigned(reader),
        index = readSigned(reader);
      return opcode === 64
        ? { kind: "array-valid", id, array, index, ...span }
        : opcode === 65
          ? { kind: "array-read", id, array, index, ...span }
          : { kind: "array-element", id, array, index, ...span };
    }
    case 67: {
      const id = readSigned(reader),
        array = readSigned(reader),
        source = readSigned(reader),
        offset = readSigned(reader);
      return { kind: "array-copy", id, array, source, offset, ...span };
    }
    case 68:
    case 69: {
      const array = readSigned(reader),
        index = readSigned(reader),
        value = readSigned(reader);
      return opcode === 68
        ? { kind: "array-write", array, index, value, ...span }
        : { kind: "array-store", array, index, value, ...span };
    }
    case 70:
      return { kind: "undefined", id: readSigned(reader), ...span };
    case 71:
    case 72:
    case 73: {
      const id = readSigned(reader),
        value = readSigned(reader);
      return opcode === 71
        ? { kind: "optional-wrap", id, value, ...span }
        : opcode === 72
          ? { kind: "optional-present", id, value, ...span }
          : { kind: "optional-value", id, value, ...span };
    }
    case 74: {
      const id = readSigned(reader),
        value = readSigned(reader),
        fallback = readSigned(reader);
      return { kind: "optional-value-or", id, value, fallback, ...span };
    }
    case 75: {
      const id = readSigned(reader),
        slot = readSigned(reader);
      return { kind: "load", id, slot, ...span };
    }
    case 76: {
      const slot = readSigned(reader),
        value = readSigned(reader);
      return { kind: "store", slot, value, ...span };
    }
    case 77: {
      const id = readSigned(reader),
        operator = vocabulary.operators[readUnsigned(reader)],
        operand = readSigned(reader);
      if (operator === undefined) throw "packed IR operator";
      return { kind: "unary", id, operator, operand, ...span };
    }
    case 78: {
      const id = readSigned(reader),
        operator = vocabulary.operators[readUnsigned(reader)],
        left = readSigned(reader),
        right = readSigned(reader);
      if (operator === undefined) throw "packed IR operator";
      return { kind: "binary", id, operator, left, right, ...span };
    }
    case 82:
      return {
        kind: "script-argument",
        id: readSigned(reader),
        index: readSigned(reader),
        ...span,
      };
    case 83:
      return { kind: "script-argument-count", id: readSigned(reader), ...span };
    case 117: {
      const id = readSigned(reader),
        field = activationFields[readByte(reader)];
      if (field === undefined) throw "packed activation field invariant";
      const record = flagged(flags, 2) ? readSigned(reader) : undefined,
        index = flagged(flags, 4) ? readSigned(reader) : undefined;
      if (record === undefined)
        return { kind: "activation-read", id, field, ...span };
      if (index === undefined)
        return { kind: "activation-read", id, field, record, ...span };
      return { kind: "activation-read", id, field, record, index, ...span };
    }
    case 114: {
      const id = readSigned(reader),
        object = readSigned(reader),
        record = readSigned(reader),
        field = readSigned(reader),
        count = readSigned(reader),
        index = readSigned(reader);
      return {
        kind: "record-slot-read",
        id,
        object,
        record,
        field,
        count,
        index,
        ...span,
      };
    }
    case 115: {
      const id = readSigned(reader),
        object = readSigned(reader),
        site = readSigned(reader),
        record = readSigned(reader),
        field = readSigned(reader),
        count = readSigned(reader),
        siteRecord = readSigned(reader),
        siteField = readSigned(reader),
        entries = readSigned(reader),
        epochRecord = readSigned(reader),
        epochField = readSigned(reader),
        hasSpill = flagged(flags, 4),
        spillRecord = hasSpill ? readSigned(reader) : undefined,
        spillField = hasSpill ? readSigned(reader) : undefined;
      return {
        kind: "property-load",
        id,
        object,
        site,
        record,
        field,
        count,
        siteRecord,
        siteField,
        inherited: flagged(flags, 2),
        entries,
        epochRecord,
        epochField,
        ...(spillRecord !== undefined && spillField !== undefined
          ? { spillRecord, spillField }
          : {}),
        ...span,
      };
    }
    case 116: {
      const id = readSigned(reader),
        object = readSigned(reader),
        value = readSigned(reader),
        site = readSigned(reader),
        record = readSigned(reader),
        field = readSigned(reader),
        count = readSigned(reader),
        siteRecord = readSigned(reader),
        siteField = readSigned(reader),
        epochRecord = readSigned(reader),
        epochField = readSigned(reader);
      return {
        kind: "property-store",
        id,
        object,
        value,
        site,
        record,
        field,
        count,
        siteRecord,
        siteField,
        epochRecord,
        epochField,
        ...span,
      };
    }
    case 118: {
      const id = readSigned(reader),
        callee = readSigned(reader),
        realm = readSigned(reader),
        realmRecord = readSigned(reader),
        agentField = readSigned(reader),
        agentRecord = readSigned(reader),
        activeField = readSigned(reader),
        objectRecord = readSigned(reader),
        registerCallField = readSigned(reader),
        entryRecord = readSigned(reader),
        invokeField = readSigned(reader),
        contextField = readSigned(reader),
        constructibleField = readSigned(reader),
        contextRecord = readSigned(reader),
        realmField = readSigned(reader),
        scriptOrModuleField = readSigned(reader);
      return {
        kind: "script-entry",
        id,
        callee,
        realm,
        construct: flagged(flags, 2),
        realmRecord,
        agentField,
        agentRecord,
        activeField,
        objectRecord,
        registerCallField,
        entryRecord,
        invokeField,
        contextField,
        constructibleField,
        contextRecord,
        realmField,
        scriptOrModuleField,
        ...span,
      };
    }
    case 119: {
      const id = readSigned(reader),
        scope = readSigned(reader),
        cache = readSigned(reader),
        scopeRecord = readSigned(reader),
        declarativeField = readSigned(reader),
        objectField = readSigned(reader),
        globalField = readSigned(reader),
        globalRecord = readSigned(reader),
        lexicalEpochField = readSigned(reader),
        globalObjectField = readSigned(reader),
        globalObjectRecord = readSigned(reader),
        propertyEpochField = readSigned(reader),
        cacheRecord = readSigned(reader),
        cacheGlobalField = readSigned(reader),
        cacheLexicalEpochField = readSigned(reader),
        cacheObjectEpochField = readSigned(reader),
        cacheCellField = readSigned(reader);
      return {
        kind: "global-cell",
        id,
        scope,
        cache,
        scopeRecord,
        declarativeField,
        objectField,
        globalField,
        globalRecord,
        lexicalEpochField,
        globalObjectField,
        globalObjectRecord,
        propertyEpochField,
        cacheRecord,
        cacheGlobalField,
        cacheLexicalEpochField,
        cacheObjectEpochField,
        cacheCellField,
        ...span,
      };
    }
    case 120: {
      const id = readSigned(reader),
        object = readSigned(reader),
        index = readSigned(reader),
        record = readSigned(reader),
        field = readSigned(reader),
        elementsRecord = readSigned(reader),
        countField = readSigned(reader),
        storageField = readSigned(reader);
      if ((flags & 2) !== 0) {
        const cachedStorage = readSigned(reader),
          cachedCount = readSigned(reader);
        return {
          kind: "element-load",
          id,
          object,
          index,
          record,
          field,
          elementsRecord,
          countField,
          storageField,
          cachedStorage,
          cachedCount,
          ...span,
        };
      }
      return {
        kind: "element-load",
        id,
        object,
        index,
        record,
        field,
        elementsRecord,
        countField,
        storageField,
        ...span,
      };
    }
    case 121: {
      const id = readSigned(reader),
        object = readSigned(reader),
        index = readSigned(reader),
        value = readSigned(reader),
        record = readSigned(reader),
        field = readSigned(reader),
        elementsRecord = readSigned(reader),
        countField = readSigned(reader),
        storageField = readSigned(reader);
      if ((flags & 2) !== 0) {
        const cachedStorage = readSigned(reader),
          cachedCount = readSigned(reader);
        return {
          kind: "element-store",
          id,
          object,
          index,
          value,
          record,
          field,
          elementsRecord,
          countField,
          storageField,
          cachedStorage,
          cachedCount,
          ...span,
        };
      }
      return {
        kind: "element-store",
        id,
        object,
        index,
        value,
        record,
        field,
        elementsRecord,
        countField,
        storageField,
        ...span,
      };
    }
    case 85: {
      const id = readSigned(reader),
        string = readSigned(reader);
      return { kind: "string-two-byte", id, string, ...span };
    }
    case 87:
    case 90: {
      const id = readSigned(reader),
        bytes = readSigned(reader),
        begin = readSigned(reader),
        limit = readSigned(reader);
      return opcode === 87
        ? { kind: "string-from-latin1", id, bytes, begin, limit, ...span }
        : { kind: "bytes-ascii-prefix", id, bytes, begin, limit, ...span };
    }
    case 88: {
      const id = readSigned(reader),
        string = readSigned(reader),
        begin = readSigned(reader),
        limit = readSigned(reader),
        bytes = readSigned(reader),
        offset = readSigned(reader);
      return {
        kind: "string-copy-latin1",
        id,
        string,
        begin,
        limit,
        bytes,
        offset,
        ...span,
      };
    }
    case 97: {
      const id = readSigned(reader),
        value = readSigned(reader);
      return { kind: "number-string-cached", id, value, ...span };
    }
    case 98: {
      const value = readSigned(reader),
        string = readSigned(reader);
      return { kind: "number-string-cache", value, string, ...span };
    }
    case 99: {
      const id = readSigned(reader),
        string = readSigned(reader);
      return { kind: "string-index-cached", id, string, ...span };
    }
    case 100: {
      const string = readSigned(reader),
        value = readSigned(reader);
      return { kind: "string-index-cache", string, value, ...span };
    }
    case 101: {
      const id = readSigned(reader),
        string = readSigned(reader),
        separator = readSigned(reader),
        template = readSigned(reader);
      return {
        kind: "string-split-cached",
        id,
        string,
        separator,
        template,
        ...span,
      };
    }
    case 102: {
      const string = readSigned(reader),
        separator = readSigned(reader),
        value = readSigned(reader);
      return { kind: "string-split-cache", string, separator, value, ...span };
    }
    case 94: {
      const id = readSigned(reader),
        string = readSigned(reader),
        begin = readSigned(reader),
        limit = readSigned(reader);
      return { kind: "string-utf8-length", id, string, begin, limit, ...span };
    }
    case 95: {
      const id = readSigned(reader),
        string = readSigned(reader),
        begin = readSigned(reader),
        limit = readSigned(reader),
        bytes = readSigned(reader),
        offset = readSigned(reader);
      if (flagged(flags, 2))
        return {
          kind: "string-write-utf8",
          id,
          string,
          begin,
          limit,
          bytes,
          offset,
          written: true,
          ...span,
        };
      return {
        kind: "string-write-utf8",
        id,
        string,
        begin,
        limit,
        bytes,
        offset,
        ...span,
      };
    }
    case 96: {
      const id = readSigned(reader),
        bytes = readSigned(reader),
        begin = readSigned(reader),
        limit = readSigned(reader);
      if (flagged(flags, 2))
        return {
          kind: "string-from-utf8",
          id,
          bytes,
          begin,
          limit,
          whole: true,
          ...span,
        };
      return { kind: "string-from-utf8", id, bytes, begin, limit, ...span };
    }
    case 92: {
      const id = readSigned(reader),
        string = readSigned(reader);
      return { kind: "string-flat", id, string, ...span };
    }
    case 93: {
      const id = readSigned(reader),
        address = readSigned(reader),
        byteLength = readSigned(reader),
        string = readSigned(reader);
      return {
        kind: "string-flatten-into",
        id,
        address,
        byteLength,
        string,
        ...span,
      };
    }
    case 91: {
      const id = readSigned(reader),
        string = readSigned(reader);
      return {
        kind: "string-ascii-case",
        id,
        string,
        upper: flagged(flags, 2),
        ...span,
      };
    }
    case 89: {
      const id = readSigned(reader),
        string = readSigned(reader),
        begin = readSigned(reader),
        limit = readSigned(reader);
      return { kind: "string-ascii-prefix", id, string, begin, limit, ...span };
    }
    case 86: {
      const id = readSigned(reader),
        string = readSigned(reader),
        search = readSigned(reader),
        position = readSigned(reader);
      return {
        kind: "string-index-of",
        id,
        string,
        search,
        position,
        reverse: flagged(flags, 2),
        ...span,
      };
    }
    case 122: {
      const id = readSigned(reader),
        object = readSigned(reader),
        record = readSigned(reader),
        field = readSigned(reader),
        elementsRecord = readSigned(reader),
        lengthField = readSigned(reader);
      return {
        kind: "element-length",
        id,
        object,
        record,
        field,
        elementsRecord,
        lengthField,
        ...span,
      };
    }
    case 123: {
      const id = readSigned(reader),
        object = readSigned(reader),
        record = readSigned(reader),
        field = readSigned(reader),
        elementsRecord = readSigned(reader),
        countField = readSigned(reader),
        storageField = readSigned(reader);
      return {
        kind: "element-storage",
        id,
        object,
        record,
        field,
        elementsRecord,
        countField,
        storageField,
        ...span,
      };
    }
    case 124: {
      const id = readSigned(reader),
        object = readSigned(reader),
        record = readSigned(reader),
        field = readSigned(reader),
        elementsRecord = readSigned(reader),
        countField = readSigned(reader),
        storageField = readSigned(reader);
      return {
        kind: "element-count",
        id,
        object,
        record,
        field,
        elementsRecord,
        countField,
        storageField,
        ...span,
      };
    }
    case 81: {
      const id = readSigned(reader),
        value = readSigned(reader);
      return { kind: "error-message", id, value, ...span };
    }
    case 80: {
      const id = readSigned(reader),
        value = readSigned(reader),
        type = generalTests[readByte(reader)];
      if (type === undefined) throw "packed general test invariant";
      return flagged(flags, 2)
        ? { kind: "general-is", id, value, type, branch: true, ...span }
        : { kind: "general-is", id, value, type, ...span };
    }
    case 79: {
      const receiver = flagged(flags, 2) ? readSigned(reader) : undefined,
        id = flagged(flags, 4) ? readSigned(reader) : undefined,
        inherit = flagged(flags, 8),
        target = readSigned(reader),
        args = readList(reader);
      if (receiver === undefined)
        return inherit
          ? {
              kind: "call",
              id,
              target,
              environment: "inherit",
              arguments: args,
              ...span,
            }
          : { kind: "call", id, target, arguments: args, ...span };
      return inherit
        ? {
            kind: "call",
            receiver,
            id,
            target,
            environment: "inherit",
            arguments: args,
            ...span,
          }
        : { kind: "call", receiver, id, target, arguments: args, ...span };
    }
  }
  throw "packed IR opcode " + String(opcode);
}
export function encodeTerminator(
  writer: ByteWriter,
  terminator: Terminator,
): boolean {
  switch (terminator.kind) {
    case "record":
      writePrefix(writer, 0, terminator, 0);
      writeSigned(writer, terminator.object);
      writeSigned(writer, terminator.record);
      writeSigned(writer, terminator.field);
      writeByte(writer, terminator.operation === "read" ? 1 : 2);
      writeSigned(writer, terminator.slot);
      writeSigned(writer, terminator.consequent);
      writeSigned(writer, terminator.alternate);
      return true;
    case "record-cell":
      writePrefix(
        writer,
        1,
        terminator,
        bit(terminator.initialized === true, 2),
      );
      writeSigned(writer, terminator.object);
      writeSigned(writer, terminator.record);
      writeSigned(writer, terminator.field);
      writeByte(writer, cellCode(terminator.operation));
      writeSigned(writer, terminator.slot);
      writeSigned(writer, terminator.consequent);
      writeSigned(writer, terminator.alternate);
      return true;
    case "trap":
      writePrefix(writer, 2, terminator, 0);
      return true;
    case "throw-literal":
      writePrefix(writer, 3, terminator, 0);
      writeString(writer, terminator.value);
      return true;
    case "throw":
      writePrefix(writer, 4, terminator, 0);
      writeSigned(writer, terminator.value);
      return true;
    case "jump":
      writePrefix(writer, 5, terminator, 0);
      writeSigned(writer, terminator.target);
      return true;
    case "cell":
      writePrefix(writer, 6, terminator, 0);
      writeSigned(writer, terminator.cell);
      writeByte(writer, cellCode(terminator.operation));
      writeSigned(writer, terminator.slot);
      writeSigned(writer, terminator.consequent);
      writeSigned(writer, terminator.alternate);
      return true;
    case "branch":
      writePrefix(writer, 7, terminator, 0);
      writeSigned(writer, terminator.condition);
      writeSigned(writer, terminator.consequent);
      writeSigned(writer, terminator.alternate);
      return true;
    case "return": {
      const value = terminator.value;
      writePrefix(writer, 8, terminator, bit(value !== undefined, 2));
      if (value !== undefined) writeSigned(writer, value);
      return true;
    }
  }
  throw "packed IR cannot encode this terminator kind";
}
export function decodeTerminator(reader: ByteReader): Terminator {
  const opcode = readByte(reader),
    prefix = readPrefix(reader),
    flags = prefix.flags,
    span = origin(prefix);
  switch (opcode) {
    case 0: {
      const object = readSigned(reader),
        record = readSigned(reader),
        field = readSigned(reader),
        operation = recordOperation(readByte(reader)),
        slot = readSigned(reader),
        consequent = readSigned(reader),
        alternate = readSigned(reader);
      return {
        kind: "record",
        object,
        record,
        field,
        operation,
        slot,
        consequent,
        alternate,
        ...span,
      };
    }
    case 1: {
      const object = readSigned(reader),
        record = readSigned(reader),
        field = readSigned(reader),
        operation = cellOperation(readByte(reader)),
        slot = readSigned(reader),
        consequent = readSigned(reader),
        alternate = readSigned(reader);
      if (flagged(flags, 2))
        return {
          kind: "record-cell",
          object,
          record,
          field,
          operation,
          slot,
          consequent,
          alternate,
          initialized: true,
          ...span,
        };
      return {
        kind: "record-cell",
        object,
        record,
        field,
        operation,
        slot,
        consequent,
        alternate,
        ...span,
      };
    }
    case 2:
      return { kind: "trap", ...span };
    case 3:
      return { kind: "throw-literal", value: readString(reader), ...span };
    case 4:
      return { kind: "throw", value: readSigned(reader), ...span };
    case 5:
      return { kind: "jump", target: readSigned(reader), ...span };
    case 6: {
      const cell = readSigned(reader),
        operation = cellOperation(readByte(reader)),
        slot = readSigned(reader),
        consequent = readSigned(reader),
        alternate = readSigned(reader);
      return {
        kind: "cell",
        cell,
        operation,
        slot,
        consequent,
        alternate,
        ...span,
      };
    }
    case 7: {
      const condition = readSigned(reader),
        consequent = readSigned(reader),
        alternate = readSigned(reader);
      return { kind: "branch", condition, consequent, alternate, ...span };
    }
    case 8: {
      const value: number | undefined = flagged(flags, 2)
        ? readSigned(reader)
        : undefined;
      return { kind: "return", value, ...span };
    }
  }
  throw "packed IR terminator opcode " + String(opcode);
}
function encodeBlock(
  writer: ByteWriter,
  vocabulary: PackedVocabulary,
  block: Block,
): void {
  const exception = block.exception;
  writeSigned(writer, block.id);
  writeByte(writer, exception === undefined ? 0 : 1);
  if (exception !== undefined) {
    writeSigned(writer, exception.target);
    writeSigned(writer, exception.slot);
  }
  writeUnsigned(writer, block.instructions.length);
  for (const op of block.instructions) {
    if (op === undefined) throw "packed IR instruction invariant";
    encodeInstruction(writer, vocabulary, op);
  }
  encodeTerminator(writer, block.terminator);
}
function decodeBlock(reader: ByteReader, vocabulary: PackedVocabulary): Block {
  const id = readSigned(reader),
    hasException = readByte(reader) === 1,
    exceptionTarget = hasException ? readSigned(reader) : 0,
    exceptionSlot = hasException ? readSigned(reader) : 0,
    count = readUnsigned(reader);
  const instructions: Instruction[] = [];
  for (let index = 0; index < count; index++)
    instructions.push(decodeInstruction(reader, vocabulary));
  const terminator = decodeTerminator(reader);
  return hasException
    ? {
        id,
        instructions,
        terminator,
        exception: { target: exceptionTarget, slot: exceptionSlot },
      }
    : { id, instructions, terminator };
}
function encodeEnvironment(writer: ByteWriter, environment: Environment): void {
  writeSigned(writer, environment.byteLength);
  writeUnsigned(writer, environment.cells.length);
  for (const cell of environment.cells) {
    if (cell === undefined) throw "packed IR environment invariant";
    writeByte(writer, scalarCode(cell.type));
    writeByte(writer, bit(cell.borrowed === true, 1) + bit(cell.mutable, 2));
    writeSigned(writer, cell.stateOffset);
    writeSigned(writer, cell.valueOffset);
  }
}
function decodeEnvironment(reader: ByteReader): Environment {
  const byteLength = readSigned(reader),
    count = readUnsigned(reader);
  const cells: EnvironmentCell[] = [];
  for (let index = 0; index < count; index++) {
    const type = scalarType(readByte(reader)),
      flags = readByte(reader),
      stateOffset = readSigned(reader),
      valueOffset = readSigned(reader),
      mutable = flagged(flags, 2);
    cells.push(
      flags % 2 === 1
        ? { type, borrowed: true, stateOffset, valueOffset, mutable }
        : { type, stateOffset, valueOffset, mutable },
    );
  }
  return { byteLength, cells };
}
function encodeDebug(writer: ByteWriter, debug: FunctionDebug): void {
  writeUnsigned(writer, debug.variables.length);
  for (const variable of debug.variables) {
    if (variable === undefined) throw "packed IR debug invariant";
    const record = variable.record,
      inline = variable.inline;
    writeString(writer, variable.name);
    writeSigned(writer, variable.start);
    writeSigned(writer, variable.end);
    writeByte(
      writer,
      bit(variable.parameter, 1) +
        bit(record !== undefined, 2) +
        bit(inline !== undefined, 4),
    );
    if (record !== undefined) writeSigned(writer, record);
    if (inline !== undefined) writeSigned(writer, inline);
  }
  writeUnsigned(writer, debug.slots.length);
  for (const binding of debug.slots) {
    if (binding === undefined) throw "packed IR debug invariant";
    writeSigned(writer, binding.slot);
    writeSigned(writer, binding.variable);
  }
  writeUnsigned(writer, debug.values.length);
  for (const binding of debug.values) {
    if (binding === undefined) throw "packed IR debug invariant";
    writeSigned(writer, binding.variable);
    writeSigned(writer, binding.value);
    writeSigned(writer, binding.after);
  }
  writeUnsigned(writer, debug.inlineSites.length);
  for (const site of debug.inlineSites) {
    if (site === undefined) throw "packed IR debug invariant";
    const parent = site.parent;
    writeString(writer, site.callee);
    writeSigned(writer, site.start);
    writeSigned(writer, site.end);
    writeByte(writer, parent === undefined ? 0 : 1);
    if (parent !== undefined) writeSigned(writer, parent);
  }
}
function decodeDebug(reader: ByteReader): FunctionDebug {
  const variables: SourceVariable[] = [],
    slots: SlotBinding[] = [],
    values: ValueBinding[] = [],
    inlineSites: InlineSite[] = [];
  const variableCount = readUnsigned(reader);
  for (let index = 0; index < variableCount; index++) {
    const name = readString(reader),
      start = readSigned(reader),
      end = readSigned(reader),
      flags = readByte(reader),
      parameter = flags % 2 === 1,
      record = flagged(flags, 2) ? readSigned(reader) : undefined,
      inline = flagged(flags, 4) ? readSigned(reader) : undefined;
    if (record === undefined) {
      if (inline === undefined) variables.push({ name, start, end, parameter });
      else variables.push({ name, start, end, parameter, inline });
    } else if (inline === undefined)
      variables.push({ name, start, end, parameter, record });
    else variables.push({ name, start, end, parameter, record, inline });
  }
  const slotCount = readUnsigned(reader);
  for (let index = 0; index < slotCount; index++) {
    const slot = readSigned(reader),
      variable = readSigned(reader);
    slots.push({ slot, variable });
  }
  const valueCount = readUnsigned(reader);
  for (let index = 0; index < valueCount; index++) {
    const variable = readSigned(reader),
      value = readSigned(reader),
      after = readSigned(reader);
    values.push({ variable, value, after });
  }
  const siteCount = readUnsigned(reader);
  for (let index = 0; index < siteCount; index++) {
    const callee = readString(reader),
      start = readSigned(reader),
      end = readSigned(reader),
      parent = readByte(reader) === 1 ? readSigned(reader) : undefined;
    inlineSites.push(
      parent === undefined
        ? { callee, start, end }
        : { callee, start, end, parent },
    );
  }
  return { variables, slots, values, inlineSites };
}
/** Function flags: which optional FunctionIR fields follow. */
const importFlag = 1,
  exportedFlag = 2,
  receiverFlag = 4,
  closureFlag = 8,
  environmentFlag = 16,
  integerSlotsFlag = 32,
  debugFlag = 64,
  scriptEntryFlag = 128;
/** Second function flags byte. */
const safeIntegerSlotsFlag = 1,
  nonzeroSlotsFlag = 2;
/** Appends one function record to `writer`. */
export function encodeFunction(
  writer: ByteWriter,
  vocabulary: PackedVocabulary,
  fn: FunctionIR,
): void {
  const receiver = fn.receiverSlot,
    closure = fn.closureEnvironment,
    environment = fn.environment,
    integerSlots = fn.integerSlots,
    safeIntegerSlots = fn.safeIntegerSlots,
    safeIntegerBounds = fn.safeIntegerBounds,
    nonzeroSlots = fn.nonzeroSlots,
    debug = fn.debug;
  writer.spanBase = 0;
  writeByte(writer, packedFunctionVersion);
  writeByte(
    writer,
    bit(fn.import === true, importFlag) +
      bit(fn.exported, exportedFlag) +
      bit(receiver !== undefined, receiverFlag) +
      bit(closure !== undefined, closureFlag) +
      bit(environment !== undefined, environmentFlag) +
      bit(integerSlots !== undefined, integerSlotsFlag) +
      bit(debug !== undefined, debugFlag) +
      bit(fn.scriptEntry === true, scriptEntryFlag),
  );
  writeByte(
    writer,
    bit(safeIntegerSlots !== undefined, safeIntegerSlotsFlag) +
      bit(nonzeroSlots !== undefined, nonzeroSlotsFlag),
  );
  writeSigned(writer, fn.id);
  writeString(writer, fn.name);
  writeByte(writer, scalarCode(fn.returnType));
  writeSigned(writer, fn.entry);
  if (receiver !== undefined) writeSigned(writer, receiver);
  if (closure !== undefined) writeSigned(writer, closure);
  if (environment !== undefined) encodeEnvironment(writer, environment);
  writeList(writer, fn.parameters);
  writeUnsigned(writer, fn.slots.length);
  for (const type of fn.slots) {
    if (type === undefined) throw "packed IR slot invariant";
    writeByte(writer, scalarCode(type));
  }
  if (integerSlots !== undefined) writeList(writer, integerSlots);
  if (safeIntegerSlots !== undefined) {
    const bounds = safeIntegerBounds ?? [];
    if (bounds.length !== safeIntegerSlots.length)
      throw "packed IR safe integer slot invariant";
    writeList(writer, safeIntegerSlots);
    // Bounds reach 2^53 - 1, beyond writeSigned's range.
    for (let index = 0; index < bounds.length; index++) {
      const bound = bounds[index];
      if (bound === undefined) throw "packed IR safe integer bound invariant";
      writeUnsigned(writer, bound);
    }
  }
  if (nonzeroSlots !== undefined) writeList(writer, nonzeroSlots);
  writeUnsigned(writer, fn.blocks.length);
  for (const block of fn.blocks) {
    if (block === undefined) throw "packed IR block invariant";
    encodeBlock(writer, vocabulary, block);
  }
  if (debug !== undefined) encodeDebug(writer, debug);
}
/** Decodes the function record at `offset` (see encodeFunction). */
export function decodeFunction(
  bytes: Uint8Array,
  offset: number,
  end: number,
  vocabulary: PackedVocabulary,
): FunctionIR {
  const reader = createByteReader(bytes, offset, end);
  if (readByte(reader) !== packedFunctionVersion)
    throw "packed IR version mismatch";
  const flags = readByte(reader),
    moreFlags = readByte(reader),
    id = readSigned(reader),
    name = readString(reader),
    returns = returnType(readByte(reader)),
    entry = readSigned(reader),
    receiverSlot = flagged(flags, receiverFlag)
      ? readSigned(reader)
      : undefined,
    closureEnvironment = flagged(flags, closureFlag)
      ? readSigned(reader)
      : undefined,
    environment = flagged(flags, environmentFlag)
      ? decodeEnvironment(reader)
      : undefined,
    parameters = readList(reader),
    slotCount = readUnsigned(reader);
  const slots: ScalarType[] = [];
  for (let index = 0; index < slotCount; index++)
    slots.push(scalarType(readByte(reader)));
  const integerSlots = flagged(flags, integerSlotsFlag)
    ? readList(reader)
    : undefined;
  const safeIntegerSlots = flagged(moreFlags, safeIntegerSlotsFlag)
    ? readList(reader)
    : undefined;
  const safeIntegerBounds: number[] = [];
  for (let index = 0; index < (safeIntegerSlots?.length ?? 0); index++)
    safeIntegerBounds.push(readUnsigned(reader));
  const nonzeroSlots = flagged(moreFlags, nonzeroSlotsFlag)
    ? readList(reader)
    : undefined;
  const blockCount = readUnsigned(reader);
  const blocks: Block[] = [];
  for (let index = 0; index < blockCount; index++)
    blocks.push(decodeBlock(reader, vocabulary));
  const debug = flagged(flags, debugFlag) ? decodeDebug(reader) : undefined;
  if (reader.offset !== end) throw "packed IR record length";
  let fn: FunctionIR = {
    id,
    name,
    exported: flagged(flags, exportedFlag),
    parameters,
    slots,
    returnType: returns,
    entry,
    blocks,
  };
  if (flagged(flags, importFlag)) fn = { ...fn, import: true };
  if (flagged(flags, scriptEntryFlag)) fn = { ...fn, scriptEntry: true };
  if (receiverSlot !== undefined) fn = { ...fn, receiverSlot };
  if (closureEnvironment !== undefined) fn = { ...fn, closureEnvironment };
  if (environment !== undefined) fn = { ...fn, environment };
  if (integerSlots !== undefined) fn = { ...fn, integerSlots };
  if (safeIntegerSlots !== undefined)
    fn = { ...fn, safeIntegerSlots, safeIntegerBounds };
  if (nonzeroSlots !== undefined) fn = { ...fn, nonzeroSlots };
  if (debug !== undefined) fn = { ...fn, debug };
  return fn;
}
