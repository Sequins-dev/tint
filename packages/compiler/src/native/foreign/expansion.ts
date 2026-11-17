import {
  cLayout,
  cScalarBytes,
  cScalarSigned,
  type CFunctionDeclaration,
  type CLibraryDeclaration,
  type CScalar,
  type CTarget,
  type CType,
  type CValueForm,
} from "@tint/abi/c";
import type {
  ForeignCall,
  ForeignOperand,
  ForeignResult,
} from "@tint/ir/scalar";
/** One generated function bound to a c-call. */
export interface ForeignStub {
  readonly name: string;
  readonly call: ForeignCall;
}
export interface ForeignExpansion {
  /** TypeScript source implementing the declarations. */
  readonly text: string;
  readonly stubs: readonly ForeignStub[];
}
export type ForeignExpansionResult =
  | { readonly ok: true; readonly value: ForeignExpansion }
  | { readonly ok: false; readonly error: string };
/** The ForeignCall that binds a declaration whose string and record
 * conversions happen in TypeScript (strings become NUL-terminated bytes,
 * records their C images). */
export function foreignCall(declaration: CFunctionDeclaration): ForeignCall {
  const operands: ForeignOperand[] = [];
  for (const form of declaration.parameterForms) {
    if (form === undefined) throw "foreign form invariant";
    operands.push(machineOperand(form));
  }
  return {
    symbol: declaration.symbol,
    signature: declaration.signature,
    operands,
    result: machineResult(declaration.resultForm),
  };
}
function machineOperand(form: CValueForm): ForeignOperand {
  switch (form) {
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "bytes":
      return "bytes";
    case "string":
    case "terminated-bytes":
      return "terminated-bytes";
    case "record":
      return "record";
    case "void":
      throw "void operand invariant";
  }
}
function machineResult(form: CValueForm): ForeignResult {
  switch (form) {
    case "void":
      return "void";
    case "boolean":
      return "boolean";
    case "record":
      return "record";
    default:
      return "number";
  }
}
/** Whether a declaration needs a TypeScript conversion wrapper. */
function converts(declaration: CFunctionDeclaration): boolean {
  if (declaration.resultForm === "record") return true;
  for (const form of declaration.parameterForms)
    if (form === "string" || form === "record") return true;
  return false;
}
function tsType(form: CValueForm, type: CType): string {
  switch (form) {
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "string":
      return "string";
    case "bytes":
    case "terminated-bytes":
      return "Uint8Array";
    case "record":
      return type.kind === "record" ? type.name : "never";
    case "void":
      return "void";
  }
}
function memberTsType(type: CType): string {
  switch (type.kind) {
    case "scalar":
      return type.scalar === "bool" ? "boolean" : "number";
    case "array":
      return memberTsType(type.element) + "[]";
    case "record":
      return type.name;
    default:
      return "never";
  }
}
interface IntegerRange {
  readonly min: number;
  readonly max: number;
}
function integerRange(scalar: CScalar, target: CTarget): IntegerRange {
  const bytes = cScalarBytes(scalar),
    signed = cScalarSigned(scalar, target);
  if (bytes === 8)
    return signed
      ? { min: -9007199254740991, max: 9007199254740991 }
      : { min: 0, max: 9007199254740991 };
  const span = bytes === 1 ? 256 : bytes === 2 ? 65536 : 4294967296;
  return signed
    ? { min: -span / 2, max: span / 2 - 1 }
    : { min: 0, max: span - 1 };
}
/** Generate the implementation module of a binding: bodyless stubs bound
 * to c-calls, TypeScript wrappers for string and record conversions,
 * record interfaces and Layout constants. The text only uses ordinary
 * TypeScript, so the same module also runs where the stubs are replaced by
 * a dynamic adapter. */
export function expandForeignLibrary(
  library: CLibraryDeclaration,
  target: CTarget,
): ForeignExpansionResult {
  const lines: string[] = [];
  const stubs: ForeignStub[] = [];
  const helpers = new Set<string>();
  const recordCodecs = new Set<string>();
  lines.push(
    '// Generated from the "' +
      library.module +
      '" binding declaration (docs/native-ffi.md).',
  );
  for (const record of library.records) {
    if (record === undefined) throw "foreign record invariant";
    const type = record.type;
    if (type.kind !== "record") throw "foreign record kind invariant";
    lines.push("export interface " + record.name + " {");
    for (const field of type.fields) {
      if (field === undefined) throw "foreign field invariant";
      lines.push("  " + field.name + ": " + memberTsType(field.type) + ";");
    }
    lines.push("}");
  }
  for (const name of library.layouts) {
    if (name === undefined) throw "foreign layout invariant";
    let declared: CType | undefined;
    for (const record of library.records) {
      if (record === undefined) throw "foreign record invariant";
      if (record.name === name) declared = record.type;
    }
    if (declared === undefined || declared.kind !== "record")
      return { ok: false, error: "Layout of an undeclared record " + name };
    const layout = cLayout(declared, target);
    if (!layout.ok) return { ok: false, error: name + ": " + layout.error };
    const offsets: string[] = [];
    for (let index = 0; index < declared.fields.length; index++) {
      const field = declared.fields[index],
        offset = layout.value.offsets[index];
      if (field === undefined || offset === undefined)
        throw "foreign layout field invariant";
      offsets.push(field.name + ": " + String(offset));
    }
    lines.push(
      "export const " +
        name +
        " = { size: " +
        String(layout.value.size) +
        ", alignment: " +
        String(layout.value.alignment) +
        ", offsets: { " +
        offsets.join(", ") +
        " } };",
    );
  }
  for (const declaration of library.functions) {
    if (declaration === undefined) throw "foreign function invariant";
    const call = foreignCall(declaration);
    const wrapped = converts(declaration);
    const stubName = wrapped ? declaration.name + "$c" : declaration.name;
    const parameters = declaration.signature.parameters;
    const rawParameters: string[] = [];
    for (let index = 0; index < parameters.length; index++) {
      const name = declaration.parameterNames[index],
        form = declaration.parameterForms[index],
        type = parameters[index];
      if (name === undefined || form === undefined || type === undefined)
        throw "foreign parameter invariant";
      rawParameters.push(
        name +
          ": " +
          (form === "number" || form === "boolean"
            ? tsType(form, type)
            : "Uint8Array"),
      );
    }
    if (declaration.resultForm === "record")
      rawParameters.push("result$: Uint8Array");
    const rawResult =
      call.result === "record"
        ? "void"
        : tsType(declaration.resultForm, declaration.signature.result);
    // Stubs are exported runtime entries (the binding authority resolves
    // them by export); a wrapper's stub is its `$c` twin.
    lines.push(
      "export function " +
        stubName +
        "(" +
        rawParameters.join(", ") +
        "): " +
        rawResult +
        ' {\n  throw "FOREIGN_UNAVAILABLE";\n}',
    );
    stubs.push({ name: stubName, call });
    if (!wrapped) continue;
    const userParameters: string[] = [],
      prologue: string[] = [],
      args: string[] = [];
    for (let index = 0; index < parameters.length; index++) {
      const name = declaration.parameterNames[index],
        form = declaration.parameterForms[index],
        type = parameters[index];
      if (name === undefined || form === undefined || type === undefined)
        throw "foreign parameter invariant";
      userParameters.push(name + ": " + tsType(form, type));
      if (form === "string") {
        helpers.add("cString");
        args.push("cString$(" + name + ")");
      } else if (form === "record" && type.kind === "record") {
        const layout = cLayout(type, target);
        if (!layout.ok) return { ok: false, error: layout.error };
        recordCodecs.add(type.name);
        prologue.push(
          "  const " +
            name +
            "$bytes = new Uint8Array(" +
            String(layout.value.size) +
            ");\n  write$" +
            type.name +
            "(" +
            name +
            "$bytes, 0, " +
            name +
            ");",
        );
        args.push(name + "$bytes");
      } else args.push(name);
    }
    const result = declaration.signature.result;
    let body: string;
    if (declaration.resultForm === "record" && result.kind === "record") {
      const layout = cLayout(result, target);
      if (!layout.ok) return { ok: false, error: layout.error };
      recordCodecs.add(result.name);
      args.push("result$");
      body =
        "  const result$ = new Uint8Array(" +
        String(layout.value.size) +
        ");\n  " +
        stubName +
        "(" +
        args.join(", ") +
        ");\n  return read$" +
        result.name +
        "(result$, 0);";
    } else
      body =
        "  " +
        (declaration.resultForm === "void" ? "" : "return ") +
        stubName +
        "(" +
        args.join(", ") +
        ");";
    lines.push(
      "export function " +
        declaration.name +
        "(" +
        userParameters.join(", ") +
        "): " +
        tsType(declaration.resultForm, result) +
        " {\n" +
        (prologue.length === 0 ? "" : prologue.join("\n") + "\n") +
        body +
        "\n}",
    );
  }
  // Record codecs (and the codecs of nested records).
  const pending: string[] = [];
  for (const name of recordCodecs) {
    if (name === undefined) throw "codec invariant";
    pending.push(name);
  }
  const emitted = new Set<string>();
  for (let index = 0; index < pending.length; index++) {
    const name = pending[index];
    if (name === undefined) throw "codec queue invariant";
    if (emitted.has(name)) continue;
    emitted.add(name);
    let type: CType | undefined;
    for (const record of library.records) {
      if (record === undefined) throw "foreign record invariant";
      if (record.name === name) type = record.type;
    }
    if (type === undefined || type.kind !== "record")
      return { ok: false, error: "unknown record " + name };
    const codec = recordCodec(type, target, helpers, pending);
    if (!codec.ok) return codec;
    lines.push(codec.value);
  }
  if (helpers.has("cString")) lines.push(cStringHelper);
  if (helpers.has("integer") || helpers.has("f64")) lines.push(integerHelpers);
  if (helpers.has("f64") || helpers.has("f32")) lines.push(pow2Helpers);
  if (helpers.has("f64")) lines.push(f64Helpers);
  if (helpers.has("f32")) lines.push(f32Helpers);
  return { ok: true, value: { text: lines.join("\n") + "\n", stubs } };
}
function recordCodec(
  type: CType,
  target: CTarget,
  helpers: Set<string>,
  pending: string[],
):
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly error: string } {
  if (type.kind !== "record") throw "codec record invariant";
  const layout = cLayout(type, target);
  if (!layout.ok) return layout;
  const writes: string[] = [],
    reads: string[] = [];
  for (let index = 0; index < type.fields.length; index++) {
    const field = type.fields[index],
      offset = layout.value.offsets[index];
    if (field === undefined || offset === undefined)
      throw "codec field invariant";
    const access = member(
      field.type,
      target,
      "value." + field.name,
      "offset + " + String(offset),
      helpers,
      pending,
      0,
    );
    if (!access.ok) return access;
    writes.push(access.write);
    reads.push(field.name + ": " + access.read);
  }
  return {
    ok: true,
    value:
      "function write$" +
      type.name +
      "(bytes: Uint8Array, offset: number, value: " +
      type.name +
      "): void {\n" +
      writes.join("\n") +
      "\n}\nfunction read$" +
      type.name +
      "(bytes: Uint8Array, offset: number): " +
      type.name +
      " {\n  return { " +
      reads.join(", ") +
      " };\n}",
  };
}
type MemberAccess =
  | { readonly ok: true; readonly write: string; readonly read: string }
  | { readonly ok: false; readonly error: string };
/** Statements writing `value` at byte `offset` and an expression reading
 * it back, for one record member. */
function member(
  type: CType,
  target: CTarget,
  value: string,
  offset: string,
  helpers: Set<string>,
  pending: string[],
  depth: number,
): MemberAccess {
  if (type.kind === "scalar") {
    const scalar = type.scalar;
    if (scalar === "f64") {
      helpers.add("f64");
      return {
        ok: true,
        write: "  writeF64$(bytes, " + offset + ", " + value + ");",
        read: "readF64$(bytes, " + offset + ")",
      };
    }
    if (scalar === "f32") {
      helpers.add("f32");
      helpers.add("integer");
      return {
        ok: true,
        write:
          "  writeInteger$(bytes, " +
          offset +
          ", 4, f32Bits$(" +
          value +
          "), 0, 4294967295);",
        read: "f32FromBits$(readInteger$(bytes, " + offset + ", 4, false))",
      };
    }
    helpers.add("integer");
    if (scalar === "bool")
      return {
        ok: true,
        write: "  bytes[" + offset + "] = " + value + " ? 1 : 0;",
        read: "(bytes[" + offset + "] ?? 0) !== 0",
      };
    const range = integerRange(scalar, target),
      bytes = cScalarBytes(scalar);
    return {
      ok: true,
      write:
        "  writeInteger$(bytes, " +
        offset +
        ", " +
        String(bytes) +
        ", " +
        value +
        ", " +
        String(range.min) +
        ", " +
        String(range.max) +
        ");",
      read:
        "readInteger$(bytes, " +
        offset +
        ", " +
        String(bytes) +
        ", " +
        (cScalarSigned(scalar, target) ? "true" : "false") +
        ")",
    };
  }
  if (type.kind === "record") {
    pending.push(type.name);
    return {
      ok: true,
      write: "  write$" + type.name + "(bytes, " + offset + ", " + value + ");",
      read: "read$" + type.name + "(bytes, " + offset + ")",
    };
  }
  if (type.kind === "array") {
    const element = cLayout(type.element, target);
    if (!element.ok) return element;
    const index = "i" + String(depth),
      local = "element" + String(depth);
    const inner = member(
      type.element,
      target,
      local,
      offset + " + " + index + " * " + String(element.value.size),
      helpers,
      pending,
      depth + 1,
    );
    if (!inner.ok) return inner;
    const list = "list" + String(depth);
    return {
      ok: true,
      write:
        "  if (" +
        value +
        ".length !== " +
        String(type.length) +
        ') throw new RangeError("C array member needs ' +
        String(type.length) +
        ' elements");\n  for (let ' +
        index +
        " = 0; " +
        index +
        " < " +
        String(type.length) +
        "; " +
        index +
        "++) {\n    const " +
        local +
        " = " +
        value +
        "[" +
        index +
        "];\n    if (" +
        local +
        ' === undefined) throw new RangeError("missing C array element");\n  ' +
        inner.write +
        "\n  }",
      read:
        "((): " +
        memberTsType(type) +
        " => { const " +
        list +
        ": " +
        memberTsType(type) +
        " = []; for (let " +
        index +
        " = 0; " +
        index +
        " < " +
        String(type.length) +
        "; " +
        index +
        "++) " +
        list +
        ".push(" +
        inner.read +
        "); return " +
        list +
        "; })()",
    };
  }
  return { ok: false, error: "unsupported record member" };
}
const cStringHelper: string = `/** NUL-terminated UTF-8 for a C string argument; lone surrogates become
 * U+FFFD. */
function cString$(text: string): Uint8Array {
  let length = 1;
  for (let index = 0; index < text.length; index++) {
    const unit = text.charCodeAt(index);
    if (unit < 0x80) length += 1;
    else if (unit < 0x800) length += 2;
    else if (unit >= 0xd800 && unit <= 0xdbff && index + 1 < text.length) {
      const next = text.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        length += 4;
        index++;
      } else length += 3;
    } else length += 3;
  }
  const bytes = new Uint8Array(length);
  let at = 0;
  for (let index = 0; index < text.length; index++) {
    let point = text.charCodeAt(index);
    if (point >= 0xd800 && point <= 0xdbff && index + 1 < text.length) {
      const next = text.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        point = (point - 0xd800) * 0x400 + (next - 0xdc00) + 0x10000;
        index++;
      }
    }
    if (point >= 0xd800 && point <= 0xdfff) point = 0xfffd;
    if (point < 0x80) bytes[at++] = point;
    else if (point < 0x800) {
      bytes[at++] = 0xc0 + Math.floor(point / 64);
      bytes[at++] = 0x80 + (point % 64);
    } else if (point < 0x10000) {
      bytes[at++] = 0xe0 + Math.floor(point / 4096);
      bytes[at++] = 0x80 + (Math.floor(point / 64) % 64);
      bytes[at++] = 0x80 + (point % 64);
    } else {
      bytes[at++] = 0xf0 + Math.floor(point / 262144);
      bytes[at++] = 0x80 + (Math.floor(point / 4096) % 64);
      bytes[at++] = 0x80 + (Math.floor(point / 64) % 64);
      bytes[at++] = 0x80 + (point % 64);
    }
  }
  bytes[at] = 0;
  return bytes;
}`;
const integerHelpers: string = `/** Little-endian C integer members; values must be integers in range. */
function writeInteger$(bytes: Uint8Array, offset: number, size: number, value: number, min: number, max: number): void {
  if (!(value >= min && value <= max) || Math.floor(value) !== value)
    throw new RangeError("value out of range for a C record member");
  let low = value, high = 0;
  if (size === 8) {
    high = Math.floor(value / 4294967296);
    low = value - high * 4294967296;
    if (high < 0) high += 4294967296;
  } else if (low < 0) low += size === 1 ? 256 : size === 2 ? 65536 : 4294967296;
  for (let index = 0; index < size && index < 4; index++) {
    bytes[offset + index] = low % 256;
    low = Math.floor(low / 256);
  }
  for (let index = 4; index < size; index++) {
    bytes[offset + index] = high % 256;
    high = Math.floor(high / 256);
  }
}
function readInteger$(bytes: Uint8Array, offset: number, size: number, signed: boolean): number {
  let low = 0, high = 0;
  for (let index = Math.min(size, 4) - 1; index >= 0; index--) low = low * 256 + (bytes[offset + index] ?? 0);
  for (let index = size - 1; index >= 4; index--) high = high * 256 + (bytes[offset + index] ?? 0);
  if (size < 8) {
    const span = size === 1 ? 256 : size === 2 ? 65536 : 4294967296;
    return signed && low >= span / 2 ? low - span : low;
  }
  if (signed && high >= 2147483648) high -= 4294967296;
  return high * 4294967296 + low;
}`;
const pow2Helpers: string = `/** 2^exponent, exactly (callers stay within binary64's range). */
function pow2$(exponent: number): number {
  let value = 1;
  for (let i = 0; i < exponent; i++) value *= 2;
  for (let i = 0; i > exponent; i--) value /= 2;
  return value;
}
/** Round half to even. */
function roundEven$(value: number): number {
  const floor = Math.floor(value), rest = value - floor;
  return rest > 0.5 || (rest === 0.5 && floor % 2 !== 0) ? floor + 1 : floor;
}
/** The binary exponent e of a finite nonzero magnitude: 2^e <= m < 2^(e+1). */
function exponentOf$(magnitude: number): number {
  let exponent = 0, scaled = magnitude;
  while (scaled >= 2) { scaled /= 2; exponent++; }
  while (scaled < 1) { scaled *= 2; exponent--; }
  return exponent;
}`;
const f64Helpers: string = `/** IEEE binary64 members as two little-endian words, computed exactly. */
function writeF64$(bytes: Uint8Array, offset: number, value: number): void {
  let high = 0, low = 0;
  if (value !== value) high = 0x7ff80000;
  else {
    const sign = value < 0 || 1 / value < 0 ? 0x80000000 : 0;
    const magnitude = Math.abs(value);
    if (magnitude === Infinity) high = sign + 0x7ff00000;
    else if (magnitude === 0) high = sign;
    else {
      const exponent = exponentOf$(magnitude);
      let biased = 0, mantissa = 0;
      if (exponent < -1022) mantissa = magnitude * pow2$(537) * pow2$(537);
      else {
        biased = exponent + 1023;
        mantissa = (magnitude / pow2$(exponent) - 1) * 4503599627370496;
      }
      const upper = Math.floor(mantissa / 4294967296);
      low = mantissa - upper * 4294967296;
      high = sign + biased * 1048576 + upper;
    }
  }
  writeInteger$(bytes, offset, 4, low, 0, 4294967295);
  writeInteger$(bytes, offset + 4, 4, high, 0, 4294967295);
}
function readF64$(bytes: Uint8Array, offset: number): number {
  const low = readInteger$(bytes, offset, 4, false),
    high = readInteger$(bytes, offset + 4, 4, false);
  const sign = high >= 0x80000000 ? -1 : 1;
  const biased = Math.floor(high / 1048576) % 2048,
    mantissa = (high % 1048576) * 4294967296 + low;
  if (biased === 2047) return mantissa === 0 ? sign * Infinity : NaN;
  if (biased === 0) return sign * mantissa * pow2$(-537) * pow2$(-537);
  return sign * (1 + mantissa / 4503599627370496) * pow2$(biased - 1023);
}`;
const f32Helpers: string = `/** IEEE binary32 bits of a number rounded to single precision. */
function f32Bits$(value: number): number {
  if (value !== value) return 0x7fc00000;
  const sign = value < 0 || 1 / value < 0 ? 0x80000000 : 0;
  const magnitude = Math.abs(value);
  if (magnitude === 0) return sign;
  let exponent = exponentOf$(magnitude);
  const scaled = magnitude / pow2$(exponent);
  if (exponent < -126) {
    const fraction = roundEven$(magnitude * pow2$(149));
    return sign + fraction;
  }
  let mantissa = roundEven$((scaled - 1) * 8388608);
  if (mantissa === 8388608) { mantissa = 0; exponent++; }
  if (exponent > 127) return sign + 0x7f800000;
  return sign + (exponent + 127) * 8388608 + mantissa;
}
function f32FromBits$(bits: number): number {
  const sign = bits >= 0x80000000 ? -1 : 1;
  const exponent = Math.floor(bits / 8388608) % 256, fraction = bits % 8388608;
  if (exponent === 255) return fraction === 0 ? sign * Infinity : NaN;
  if (exponent === 0) return sign * fraction * pow2$(-149);
  return sign * (1 + fraction / 8388608) * pow2$(exponent - 127);
}`;
