import type { CScalar, CSignature, CType } from "@tint/abi/c";
import {
  functionHeader,
  instructionResult,
  type ForeignCall,
  type ForeignMemoryAccess,
  type ForeignOperand,
  type ForeignResult,
  type FunctionBodySource,
  type FunctionIR,
  type HostOperation,
  type ModuleIR,
  type RecordField,
  type RecordFlowFacts,
  type RecordLayout,
  type ScalarType,
} from "@tint/ir/scalar";
import {
  createByteReader,
  createByteWriter,
  createPackedVocabulary,
  decodeFunction,
  encodeFunction,
  readByte,
  readSigned,
  readString,
  readUnsigned,
  writeByte,
  writeSigned,
  writeString,
  writeUnsigned,
  type ByteReader,
  type ByteWriter,
  type PackedVocabulary,
} from "@tint/ir/storage";
import {
  createStringIndex,
  type KeyIndex,
} from "@tint/foundation/collections/key-index";
import { signatureLayout, type SignatureLayout } from "./abi.ts";
import type { LocalSignatureBinding } from "./signature-groups.ts";

export interface ListReadShape {
  readonly header: number;
  readonly field: number;
  readonly mode: "read" | "has" | "cached" | "unchecked";
}
export interface ListWriteShape {
  readonly header: number;
  readonly unchecked?: boolean;
}

export interface Preparation {
  readonly module: ModuleIR;
  readonly rootHeadBindings: Uint8Array;
  readonly listShapes: readonly (ListReadShape | undefined)[];
  readonly vectorShapes: readonly (number | undefined)[];
  readonly writeShapes: readonly (ListWriteShape | undefined)[];
  readonly hasPlainErrors: boolean;
  readonly hasReferenceErrors: boolean;
  readonly functionRecord: number;
  readonly hasFunctions: boolean;
  readonly recordLayouts: readonly RecordLayout[];
  readonly typeErrorRecord: number;
  readonly localGroups: readonly LocalSignatureBinding[];
  readonly signatureGroups: Uint32Array;
  readonly signatureIds: Uint32Array;
  readonly discardResultTargets: KeyIndex<string, number[]>;
  readonly parameterKeys: readonly string[];
  readonly stableLayouts: boolean;
  readonly stableGuards: boolean;
  readonly stableSlots: boolean;
  readonly wordReturns: Uint8Array;
  readonly wordArguments: readonly Uint8Array[] | undefined;
  readonly recordValues: RecordFlowFacts | undefined;
  readonly noSafepoints: Uint8Array | undefined;
  readonly directReturns: Uint8Array | undefined;
  readonly pureLeafNoActivation: Uint8Array;
  readonly signatures: readonly SignatureLayout[];
  readonly hasForeignCallbacks?: boolean;
}

export interface PreparedFragments {
  readonly preparation: Uint8Array;
  readonly bodies: Uint8Array;
}

export interface PackedPreparation {
  readonly input: PreparedFragments;
  readonly offsets: Uint32Array;
  readonly vocabulary: PackedVocabulary;
}

const preparationVersion = 2;

/** Bounded by the packet length. Each row encodes at least one byte. */
function count(reader: ByteReader): number {
  const length = readUnsigned(reader);
  if (length > reader.end - reader.offset) throw "truncated preparation";
  return length;
}
function writeRows<T>(
  writer: ByteWriter,
  rows: readonly T[],
  write: (writer: ByteWriter, row: T) => void,
): void {
  writeUnsigned(writer, rows.length);
  for (const row of rows) {
    if (row === undefined) throw "missing preparation row";
    write(writer, row);
  }
}
function readRows<T>(reader: ByteReader, read: (reader: ByteReader) => T): T[] {
  const rows: T[] = [];
  const length = count(reader);
  for (let i = 0; i < length; i++) rows.push(read(reader));
  return rows;
}
function writeRaw(writer: ByteWriter, bytes: Uint8Array): void {
  writeUnsigned(writer, bytes.length);
  const needed = writer.length + bytes.length;
  if (needed > writer.bytes.length) {
    let capacity = writer.bytes.length;
    while (needed > capacity) capacity *= 2;
    const grown = new Uint8Array(capacity);
    grown.set(writer.bytes.subarray(0, writer.length));
    writer.bytes = grown;
  }
  writer.bytes.set(bytes, writer.length);
  writer.length = needed;
}
function readRaw(reader: ByteReader): Uint8Array {
  const length = count(reader);
  const from = reader.offset;
  reader.offset += length;
  return reader.bytes.subarray(from, reader.offset);
}
function writeFlags(writer: ByteWriter, bytes: Uint8Array | undefined): void {
  writeByte(writer, bytes === undefined ? 0 : 1);
  if (bytes !== undefined) writeRaw(writer, bytes);
}
function readBool(reader: ByteReader): boolean {
  const tag = readByte(reader);
  if (tag > 1) throw "invalid preparation flag";
  return tag === 1;
}
function readFlags(reader: ByteReader): Uint8Array | undefined {
  return readBool(reader) ? readRaw(reader) : undefined;
}
function writeOptional(writer: ByteWriter, value: number | undefined): void {
  writeUnsigned(writer, value === undefined ? 0 : value + 1);
}
function readOptional(reader: ByteReader): number | undefined {
  const value = readUnsigned(reader);
  return value === 0 ? undefined : value - 1;
}
function writeTable(writer: ByteWriter, values: Uint32Array): void {
  writeUnsigned(writer, values.length);
  for (const value of values) writeUnsigned(writer, value);
}
function readTable(reader: ByteReader): Uint32Array {
  const values = new Uint32Array(count(reader));
  for (let i = 0; i < values.length; i++) values[i] = readUnsigned(reader);
  return values;
}
function tag<T>(values: readonly T[], index: number): T {
  const value = values[index];
  if (value === undefined) throw "invalid preparation tag";
  return value;
}
function indexOfOrThrow<T>(
  values: readonly T[],
  value: T,
  label: string,
): number {
  const index = values.indexOf(value);
  if (index < 0) throw "unknown preparation " + label;
  return index;
}
const scalarTypes: readonly ScalarType[] = [
  "general",
  "optional-boolean",
  "primitive",
  "string",
  "reference",
  "optional-reference",
  "optional-string",
  "number",
  "boolean",
  "Uint8Array",
  "Int8Array",
  "Uint8ClampedArray",
  "Uint16Array",
  "Int16Array",
  "Float16Array",
  "Uint32Array",
  "Int32Array",
  "Float32Array",
  "Float64Array",
  "BigInt64Array",
  "BigUint64Array",
  "optional-number",
];
const cScalars: readonly CScalar[] = [
  "bool",
  "char",
  "i8",
  "u8",
  "i16",
  "u16",
  "i32",
  "u32",
  "i64",
  "u64",
  "isize",
  "usize",
  "f32",
  "f64",
];
function writeCType(writer: ByteWriter, type: CType): void {
  switch (type.kind) {
    case "void":
      writeByte(writer, 0);
      return;
    case "scalar":
      writeByte(writer, 1);
      writeUnsigned(
        writer,
        indexOfOrThrow<CScalar>(cScalars, type.scalar, "C scalar"),
      );
      return;
    case "pointer":
      writeByte(writer, 2);
      writeCType(writer, type.pointee);
      return;
    case "array":
      writeByte(writer, 3);
      writeUnsigned(writer, type.length);
      writeCType(writer, type.element);
      return;
    case "record":
      writeByte(writer, 4);
      writeString(writer, type.name);
      writeByte(writer, type.union ? 1 : 0);
      writeByte(writer, type.packed ? 1 : 0);
      writeUnsigned(writer, type.alignment);
      writeUnsigned(writer, type.fields.length);
      for (const field of type.fields) {
        if (field === undefined) throw "missing C field";
        writeString(writer, field.name);
        writeCType(writer, field.type);
      }
  }
}
function readCType(reader: ByteReader): CType {
  switch (readByte(reader)) {
    case 0:
      return { kind: "void" };
    case 1:
      return {
        kind: "scalar",
        scalar: tag<CScalar>(cScalars, readUnsigned(reader)),
      };
    case 2:
      return { kind: "pointer", pointee: readCType(reader) };
    case 3:
      return {
        kind: "array",
        length: readUnsigned(reader),
        element: readCType(reader),
      };
    case 4: {
      const name = readString(reader);
      const union = readBool(reader);
      const packed = readBool(reader);
      const alignment = readUnsigned(reader);
      const fields: { readonly name: string; readonly type: CType }[] = [];
      const length = count(reader);
      for (let i = 0; i < length; i++)
        fields.push({ name: readString(reader), type: readCType(reader) });
      return { kind: "record", name, union, packed, alignment, fields };
    }
  }
  throw "invalid C type tag";
}
const callClasses: readonly CSignature["callClass"][] = [
  "leaf",
  "may-callback",
  "async",
];
function writeCSignature(writer: ByteWriter, signature: CSignature): void {
  writeRows<CType>(writer, signature.parameters, writeCType);
  writeCType(writer, signature.result);
  writeUnsigned(writer, signature.fixedParameters);
  writeUnsigned(
    writer,
    indexOfOrThrow<CSignature["callClass"]>(
      callClasses,
      signature.callClass,
      "call class",
    ),
  );
  writeByte(writer, signature.errno === "negated-result" ? 1 : 0);
}
function readCSignature(reader: ByteReader): CSignature {
  return {
    parameters: readRows<CType>(reader, readCType),
    result: readCType(reader),
    fixedParameters: readUnsigned(reader),
    callClass: tag<CSignature["callClass"]>(callClasses, readUnsigned(reader)),
    errno: readBool(reader) ? "negated-result" : "none",
  };
}
const operands: readonly ForeignOperand[] = [
  "number",
  "boolean",
  "bytes",
  "terminated-bytes",
  "record",
  "callback",
];
const results: readonly ForeignResult[] = [
  "void",
  "number",
  "boolean",
  "record",
];
const accesses: readonly ForeignMemoryAccess["operation"][] = [
  "load",
  "store",
  "fits",
  "address",
  "adopt",
  "retarget",
  "available",
  "callback-key",
  "callback-address",
  "stable",
];
function writeForeignCall(writer: ByteWriter, call: ForeignCall): void {
  // Callback thunks require the serial placement state.
  if (
    call.mayCallback === true ||
    call.callbacks !== undefined ||
    call.directCallbacks !== undefined
  )
    throw "callback outside prepared fragment vocabulary";
  writeString(writer, call.symbol);
  writeCSignature(writer, call.signature);
  writeUnsigned(writer, call.operands.length);
  for (const operand of call.operands) {
    if (operand === undefined) throw "missing foreign operand";
    writeUnsigned(
      writer,
      indexOfOrThrow<ForeignOperand>(operands, operand, "foreign operand"),
    );
  }
  writeUnsigned(
    writer,
    indexOfOrThrow<ForeignResult>(results, call.result, "foreign result"),
  );
  writeByte(writer, call.dynamic === true ? 1 : call.indirect === true ? 2 : 0);
  writeByte(writer, call.dynamicScalar === true ? 1 : 0);
  const specialized = call.staticScalar;
  writeByte(writer, specialized === undefined ? 0 : 1);
  if (specialized !== undefined) writeCSignature(writer, specialized);
}
function readForeignCall(reader: ByteReader): ForeignCall {
  const symbol = readString(reader);
  const signature = readCSignature(reader);
  const args: ForeignOperand[] = [];
  const length = count(reader);
  for (let i = 0; i < length; i++)
    args.push(tag<ForeignOperand>(operands, readUnsigned(reader)));
  const result = tag<ForeignResult>(results, readUnsigned(reader));
  const target = readByte(reader);
  const dynamicScalar = readBool(reader);
  const staticScalar = readBool(reader) ? readCSignature(reader) : undefined;
  let call: ForeignCall = { symbol, signature, operands: args, result };
  if (target === 1) call = { ...call, dynamic: true };
  else if (target === 2) call = { ...call, indirect: true };
  else if (target !== 0) throw "invalid foreign target tag";
  if (dynamicScalar) call = { ...call, dynamicScalar: true };
  if (staticScalar !== undefined) call = { ...call, staticScalar };
  return call;
}
function writeAccess(writer: ByteWriter, access: ForeignMemoryAccess): void {
  if (access.callback !== undefined)
    throw "callback outside prepared fragment vocabulary";
  writeUnsigned(
    writer,
    indexOfOrThrow<ForeignMemoryAccess["operation"]>(
      accesses,
      access.operation,
      "foreign access",
    ),
  );
  writeCType(writer, access.type);
  writeUnsigned(writer, access.offset);
  writeUnsigned(writer, access.minimum);
  const symbol = access.symbol;
  writeByte(writer, symbol === undefined ? 0 : 1);
  if (symbol !== undefined) writeString(writer, symbol);
  writeOptional(writer, access.stride);
  writeOptional(writer, access.length);
  writeOptional(writer, access.slot);
}
function readAccess(reader: ByteReader): ForeignMemoryAccess {
  const operation = tag<ForeignMemoryAccess["operation"]>(
    accesses,
    readUnsigned(reader),
  );
  const type = readCType(reader);
  const offset = readUnsigned(reader);
  const minimum = readUnsigned(reader);
  const symbol = readBool(reader) ? readString(reader) : undefined;
  const stride = readOptional(reader);
  const length = readOptional(reader);
  const slot = readOptional(reader);
  return { operation, type, offset, minimum, symbol, stride, length, slot };
}
const hostOps: readonly HostOperation[] = [
  "hosted-thread-entry",
  "word-park",
  "word-wake",
  "thread-start",
  "thread-join",
  "cpu-pause",
  "collect-garbage",
  "monotonic-time",
  "wall-clock-time",
  "random-word",
  "open-read",
  "open-exclusive",
  "read",
  "write",
  "close",
  "chmod",
  "rename",
  "unlink",
  "read-link",
  "argument-count",
  "argument-length",
  "argument-copy",
  "environment-copy",
  "native-function-descriptor",
  "native-function-signature",
  "native-value-function-descriptor",
  "native-value-function-signature",
  "native-array-detach",
  "root-head",
  "context-domain",
  "stack-overflow-is",
  "engine-range-error",
  "generational-state",
  "external-memory-configure",
  "external-memory-register",
  "stack-maps-register",
  "memory-map",
  "executable-callback-map",
  "executable-callback-write",
  "executable-callback-unmap",
  "executable-map",
  "executable-write",
  "executable-call-number",
  "executable-call-value",
  "executable-call-managed",
  "executable-unmap",
  "memory-unmap",
  "memory-release",
  "memory-read-word",
  "memory-write-word",
  "memory-move",
  "memory-write-bytes",
  "memory-read-float64",
  "memory-write-float64",
  "memory-write-string",
  "memory-read-string",
  "string-address",
  "string-at",
  "string-copy",
  "jit-debug-descriptor",
  "jit-debug-register",
  "process-id",
  "memory-page-bytes",
  "processor-count",
  "cpu-sha256",
  "target-os",
  "target-architecture",
  "memory-compare-exchange-word",
  "memory-fetch-add-word",
  "memory-load-acquire-word",
  "memory-store-release-word",
  "collector-worker-entry",
  "permanent-function-address",
  "permanent-array-address",
  "shared-read-unsigned",
  "shared-write-unsigned",
  "shared-read-word64",
  "shared-write-word64",
  "shared-compare-exchange-unsigned",
  "shared-compare-exchange-word64",
  "sha256-rounds",
  "string-from-latin1",
  "string-copy-latin1",
  "string-ascii-prefix",
  "bytes-ascii-prefix",
  "string-ascii-upper",
  "string-ascii-lower",
  "string-utf8-length",
  "string-write-utf8",
  "string-write-utf8-bytes",
  "string-from-utf8",
  "string-from-utf8-whole",
  "number-string-cached",
  "number-string-cache",
  "string-index-cached",
  "string-index-cache",
  "string-flat",
  "string-flatten-into",
];
function writeVocabulary(
  writer: ByteWriter,
  vocabulary: PackedVocabulary,
): void {
  writeUnsigned(writer, vocabulary.hostOperations.length);
  for (const op of vocabulary.hostOperations) {
    if (op === undefined) throw "missing host operation";
    writeUnsigned(
      writer,
      indexOfOrThrow<HostOperation>(hostOps, op, "host operation"),
    );
  }
  writeRows<string>(writer, vocabulary.operators, writeString);
  writeRows<ForeignCall>(writer, vocabulary.foreignCalls, writeForeignCall);
  writeRows<ForeignMemoryAccess>(
    writer,
    vocabulary.foreignAccesses,
    writeAccess,
  );
}
function readVocabulary(reader: ByteReader): PackedVocabulary {
  const tables = createPackedVocabulary();
  const hosts = count(reader);
  for (let i = 0; i < hosts; i++)
    tables.hostOperations.push(
      tag<HostOperation>(hostOps, readUnsigned(reader)),
    );
  for (const operator of readRows<string>(reader, readString)) {
    if (operator === undefined) throw "missing packed operator";
    tables.operators.push(operator);
  }
  for (const call of readRows<ForeignCall>(reader, readForeignCall)) {
    if (call === undefined) throw "missing packed call";
    tables.foreignCalls.push(call);
  }
  for (const access of readRows<ForeignMemoryAccess>(reader, readAccess)) {
    if (access === undefined) throw "missing packed access";
    tables.foreignAccesses.push(access);
  }
  return tables;
}
function writeRecordField(writer: ByteWriter, field: RecordField): void {
  writeUnsigned(writer, field.offset);
  writeUnsigned(
    writer,
    indexOfOrThrow<ScalarType>(scalarTypes, field.type, "scalar type"),
  );
  writeByte(writer, field.mutable ? 1 : 0);
  writeOptional(writer, field.stateOffset);
  writeOptional(writer, field.presenceOffset);
  writeByte(writer, field.deferred === true ? 1 : 0);
}
function readRecordField(reader: ByteReader): RecordField {
  const offset = readUnsigned(reader);
  const type = tag<ScalarType>(scalarTypes, readUnsigned(reader));
  const mutable = readBool(reader);
  const stateOffset = readOptional(reader);
  const presenceOffset = readOptional(reader);
  const deferred = readBool(reader);
  let field: RecordField = { offset, type, mutable };
  if (stateOffset !== undefined) field = { ...field, stateOffset };
  if (presenceOffset !== undefined) field = { ...field, presenceOffset };
  if (deferred) field = { ...field, deferred: true };
  return field;
}
function writeRecord(writer: ByteWriter, record: RecordLayout): void {
  writeUnsigned(writer, record.byteLength);
  writeRows<RecordField>(writer, record.fields, writeRecordField);
}
function readRecord(reader: ByteReader): RecordLayout {
  return {
    byteLength: readUnsigned(reader),
    fields: readRows<RecordField>(reader, readRecordField),
  };
}
function writeSignatureGroup(
  writer: ByteWriter,
  group: LocalSignatureBinding,
): void {
  writeString(writer, group.name);
  writeString(writer, group.contract);
  writeRows<number>(writer, group.functions, writeUnsigned);
}
function readSignatureGroup(reader: ByteReader): LocalSignatureBinding {
  return {
    name: readString(reader),
    contract: readString(reader),
    functions: readRows<number>(reader, readUnsigned),
  };
}
const listModes: readonly ListReadShape["mode"][] = [
  "read",
  "has",
  "cached",
  "unchecked",
];
function writeRecordValues(
  writer: ByteWriter,
  proof: RecordFlowFacts,
  fn: FunctionIR,
): void {
  for (const block of fn.blocks) {
    if (block === undefined) throw "missing proof block";
    for (const instruction of block.instructions) {
      if (instruction === undefined) throw "missing proof instruction";
      const id = instructionResult(instruction);
      if (id === undefined) continue;
      const descriptor = proof.descriptor(fn.id, id);
      if (descriptor < 0) continue;
      writeUnsigned(writer, id);
      writeUnsigned(
        writer,
        2 * descriptor + (proof.nonNull(fn.id, id) ? 1 : 0),
      );
    }
  }
}
/** Produce read-only byte windows and the per-function body index needed to
 * decode function bodies directly from `input.bodies` without re-parsing
 * `input.preparation` or maintaining a separate spill store. */
export function packPreparationWithIndex(
  prepared: Preparation,
  source: FunctionBodySource,
): PackedPreparation | undefined {
  if (prepared.hasForeignCallbacks === true) return undefined;
  const vocabulary = createPackedVocabulary();
  const metadata = createByteWriter(65536);
  const bodyWriter = createByteWriter(1048576);
  const headerWriter = createByteWriter(1024);
  const functions = prepared.module.functions;
  const recordValues = prepared.recordValues;
  const offsets = new Uint32Array(functions.length * 2);
  writeByte(metadata, preparationVersion);
  writeUnsigned(metadata, functions.length);
  writeByte(metadata, recordValues === undefined ? 0 : 1);
  for (let id = 0; id < functions.length; id++) {
    const header = functions[id];
    if (header === undefined) throw "missing prepared header";
    headerWriter.length = 0;
    encodeFunction(headerWriter, vocabulary, header);
    writeRaw(metadata, headerWriter.bytes.subarray(0, headerWriter.length));
    const bodyStart = bodyWriter.length;
    writeUnsigned(metadata, bodyStart);
    const fn = source.get(id);
    try {
      encodeFunction(bodyWriter, vocabulary, fn);
      const bodyEnd = bodyWriter.length;
      offsets[id * 2] = bodyStart;
      offsets[id * 2 + 1] = bodyEnd;
      writeUnsigned(metadata, bodyEnd);
      if (recordValues !== undefined)
        writeRecordValues(bodyWriter, recordValues, fn);
      writeUnsigned(metadata, bodyWriter.length);
    } finally {
      source.release(id);
    }
    const shape = prepared.listShapes[id];
    writeByte(metadata, shape === undefined ? 0 : 1);
    if (shape !== undefined) {
      writeSigned(metadata, shape.header);
      writeSigned(metadata, shape.field);
      writeUnsigned(
        metadata,
        indexOfOrThrow<ListReadShape["mode"]>(
          listModes,
          shape.mode,
          "list mode",
        ),
      );
    }
    writeOptional(metadata, prepared.vectorShapes[id]);
    const writeShape = prepared.writeShapes[id];
    writeByte(metadata, writeShape === undefined ? 0 : 1);
    if (writeShape !== undefined) {
      writeSigned(metadata, writeShape.header);
      writeByte(metadata, writeShape.unchecked === true ? 1 : 0);
    }
    if (recordValues !== undefined) {
      const row = recordValues.blocks[id];
      if (row === undefined) throw "missing record proof row";
      writeRaw(metadata, row);
    }
  }
  for (const call of vocabulary.foreignCalls)
    if (
      call !== undefined &&
      (call.mayCallback === true ||
        call.callbacks !== undefined ||
        call.directCallbacks !== undefined)
    )
      return undefined;
  for (const access of vocabulary.foreignAccesses)
    if (access !== undefined && access.callback !== undefined) return undefined;
  writeVocabulary(metadata, vocabulary);
  writeRaw(metadata, prepared.rootHeadBindings);
  writeByte(metadata, prepared.hasPlainErrors ? 1 : 0);
  writeByte(metadata, prepared.hasReferenceErrors ? 1 : 0);
  writeUnsigned(metadata, prepared.functionRecord);
  writeByte(metadata, prepared.hasFunctions ? 1 : 0);
  writeRows<RecordLayout>(metadata, prepared.recordLayouts, writeRecord);
  writeUnsigned(metadata, prepared.typeErrorRecord);
  writeRows<LocalSignatureBinding>(
    metadata,
    prepared.localGroups,
    writeSignatureGroup,
  );
  writeTable(metadata, prepared.signatureGroups);
  writeTable(metadata, prepared.signatureIds);
  let keys: number = 0;
  prepared.discardResultTargets.forEach((_values, _key): void => {
    keys++;
  });
  writeUnsigned(metadata, keys);
  prepared.discardResultTargets.forEach((values, key): void => {
    writeString(metadata, key);
    writeRows<number>(metadata, values, writeUnsigned);
  });
  writeRows<string>(metadata, prepared.parameterKeys, writeString);
  writeByte(metadata, prepared.stableLayouts ? 1 : 0);
  writeByte(metadata, prepared.stableGuards ? 1 : 0);
  writeByte(metadata, prepared.stableSlots ? 1 : 0);
  writeRaw(metadata, prepared.wordReturns);
  const wordArguments = prepared.wordArguments;
  writeByte(metadata, wordArguments === undefined ? 0 : 1);
  if (wordArguments !== undefined)
    writeRows<Uint8Array>(metadata, wordArguments, writeRaw);
  writeFlags(metadata, prepared.noSafepoints);
  writeFlags(metadata, prepared.directReturns);
  writeRaw(metadata, prepared.pureLeafNoActivation);
  return {
    input: {
      preparation: metadata.bytes.subarray(0, metadata.length),
      bodies: bodyWriter.bytes.subarray(0, bodyWriter.length),
    },
    offsets,
    vocabulary,
  };
}

/** Produce read-only byte windows. An embedding can publish these as shared
 * memory after this function returns and release its decoded bodies. */
export function packPreparation(
  prepared: Preparation,
  source: FunctionBodySource,
): PreparedFragments | undefined {
  return packPreparationWithIndex(prepared, source)?.input;
}

/** Decode function bodies directly from a packed wire `bodies` byte window. */
export function createPackedBodySource(
  bytes: Uint8Array,
  offsets: Uint32Array,
  vocabulary: PackedVocabulary,
): FunctionBodySource {
  return {
    get: (id: number): FunctionIR => {
      const first = offsets[id * 2],
        end = offsets[id * 2 + 1];
      if (
        !Number.isInteger(id) ||
        id < 0 ||
        first === undefined ||
        end === undefined ||
        end > bytes.length
      )
        throw "missing prepared body";
      return decodeFunction(bytes, first, end, vocabulary);
    },
    release: (_id: number): void => {},
  };
}

export interface PreparedBackend {
  readonly preparation: Preparation;
  readonly bodies: FunctionBodySource;
}

export function openPreparation(input: PreparedFragments): PreparedBackend {
  const reader = createByteReader(input.preparation);
  if (readByte(reader) !== preparationVersion)
    throw "unknown preparation version";
  const functions: FunctionIR[] = [];
  const signatures: SignatureLayout[] = [];
  const headerVocabulary = createPackedVocabulary();
  const total = count(reader);
  const hasRecordValues = readBool(reader);
  const blockFlows: Uint8Array[] = [];
  const offsets = new Uint32Array(total * 3);
  const listShapes: (ListReadShape | undefined)[] = [];
  const writeShapes: (ListWriteShape | undefined)[] = [];
  const vectorShapes: (number | undefined)[] = [];
  let previous = 0;
  for (let id = 0; id < total; id++) {
    const bytes = readRaw(reader);
    const header = decodeFunction(bytes, 0, bytes.length, headerVocabulary);
    if (
      header.id !== id ||
      header.blocks.length !== 0 ||
      header.debug !== undefined
    )
      throw "invalid preparation function header";
    functions.push(functionHeader(header));
    signatures.push(signatureLayout(header));
    const first = readUnsigned(reader);
    const end = readUnsigned(reader);
    const proofEnd = readUnsigned(reader);
    if (
      first !== previous ||
      first >= end ||
      end > proofEnd ||
      proofEnd > input.bodies.length
    )
      throw "invalid prepared body extent";
    offsets[id * 3] = first;
    offsets[id * 3 + 1] = end;
    offsets[id * 3 + 2] = proofEnd;
    previous = proofEnd;
    if (readBool(reader))
      listShapes.push({
        header: readSigned(reader),
        field: readSigned(reader),
        mode: tag<ListReadShape["mode"]>(listModes, readUnsigned(reader)),
      });
    else listShapes.push(undefined);
    vectorShapes.push(readOptional(reader));
    if (readBool(reader)) {
      const header = readSigned(reader);
      const unchecked = readBool(reader);
      writeShapes.push(unchecked ? { header, unchecked: true } : { header });
    } else writeShapes.push(undefined);
    if (hasRecordValues) blockFlows.push(readRaw(reader));
  }
  if (previous !== input.bodies.length) throw "trailing packed bodies";
  const vocabulary = readVocabulary(reader);
  const rootHeadBindings = readRaw(reader);
  const hasPlainErrors = readBool(reader);
  const hasReferenceErrors = readBool(reader);
  const functionRecord = readUnsigned(reader);
  const hasFunctions = readBool(reader);
  const recordLayouts = readRows<RecordLayout>(reader, readRecord);
  const typeErrorRecord = readUnsigned(reader);
  if (functionRecord > recordLayouts.length)
    throw "invalid prepared record count";
  const module: ModuleIR = {
    functions,
    records: recordLayouts.slice(0, functionRecord),
  };
  const localGroups = readRows<LocalSignatureBinding>(
    reader,
    readSignatureGroup,
  );
  const signatureGroups = readTable(reader);
  const signatureIds = readTable(reader);
  const discardResultTargets = createStringIndex<number[]>();
  const discarded = count(reader);
  for (let i = 0; i < discarded; i++)
    discardResultTargets.set(
      readString(reader),
      readRows<number>(reader, readUnsigned),
    );
  const parameterKeys = readRows<string>(reader, readString);
  const stableLayouts = readBool(reader);
  const stableGuards = readBool(reader);
  const stableSlots = readBool(reader);
  const wordReturns = readRaw(reader);
  const wordArguments = readBool(reader)
    ? readRows<Uint8Array>(reader, readRaw)
    : undefined;
  const noSafepoints = readFlags(reader);
  const directReturns = readFlags(reader);
  const pureLeafNoActivation = readRaw(reader);
  if (reader.offset !== reader.end) throw "trailing preparation bytes";
  let active = -1;
  let values: Map<number, number> | undefined;
  function proofFor(fn: number, id: number): number {
    if (fn !== active) {
      values = undefined;
      active = fn;
    }
    const previous = values;
    if (previous !== undefined) return previous.get(id) ?? -1;
    const end = offsets[fn * 3 + 1],
      proofEnd = offsets[fn * 3 + 2];
    if (end === undefined || proofEnd === undefined)
      throw "missing prepared proof";
    const proof = createByteReader(input.bodies, end, proofEnd);
    const cached = new Map<number, number>();
    while (proof.offset < proof.end)
      cached.set(readUnsigned(proof), readUnsigned(proof));
    values = cached;
    return cached.get(id) ?? -1;
  }
  const recordValues: RecordFlowFacts | undefined = hasRecordValues
    ? {
        blocks: blockFlows,
        descriptor: (fn: number, id: number): number =>
          Math.floor(proofFor(fn, id) / 2),
        nonNull: (fn: number, id: number): boolean =>
          proofFor(fn, id) % 2 === 1,
      }
    : undefined;
  const bodies: FunctionBodySource = {
    get: (id: number): FunctionIR => {
      const first = offsets[id * 3],
        end = offsets[id * 3 + 1];
      if (
        !Number.isInteger(id) ||
        id < 0 ||
        first === undefined ||
        end === undefined
      )
        throw "missing prepared body";
      return decodeFunction(input.bodies, first, end, vocabulary);
    },
    release: (id: number): void => {
      if (active === id) {
        active = -1;
        values = undefined;
      }
    },
  };
  const preparation: Preparation = {
    module,
    rootHeadBindings,
    listShapes,
    vectorShapes,
    writeShapes,
    hasPlainErrors,
    hasReferenceErrors,
    functionRecord,
    hasFunctions,
    recordLayouts,
    typeErrorRecord,
    localGroups,
    signatureGroups,
    signatureIds,
    discardResultTargets,
    parameterKeys,
    stableLayouts,
    stableGuards,
    stableSlots,
    wordReturns,
    wordArguments,
    recordValues,
    noSafepoints,
    directReturns,
    pureLeafNoActivation,
    signatures,
  };
  return { preparation, bodies };
}
