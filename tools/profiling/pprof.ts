// pprof's profile.proto (gzip-compressed) for the shared sample model:
// sample types, samples with location stacks (leaf first) and labels,
// locations with optional addresses and inlined lines, functions, mappings
// and the string table. `go tool pprof` and pprofessor read what
// encodeProfile writes; decodeProfile reads their profiles (pprofessor's CPU
// samples among them) back into the model.
import { gunzipSync, gzipSync } from "node:zlib";
import type {
  Location,
  Mapping,
  Sample,
  SampleProfile,
  SourceLine,
} from "./samples.ts";

class Writer {
  private bytes = new Uint8Array(1 << 16);
  length = 0;
  private ensure(extra: number): void {
    if (this.length + extra <= this.bytes.length) return;
    let capacity = this.bytes.length * 2;
    while (capacity < this.length + extra) capacity *= 2;
    const grown = new Uint8Array(capacity);
    grown.set(this.bytes.subarray(0, this.length));
    this.bytes = grown;
  }
  varint(value: number): void {
    this.ensure(10);
    if (value < 0) {
      // int64 two's complement: ten bytes, exact only through BigInt.
      let rest = BigInt.asUintN(64, BigInt(Math.round(value)));
      while (rest >= 128n) {
        this.bytes[this.length++] = Number(rest & 127n) | 128;
        rest >>= 7n;
      }
      this.bytes[this.length++] = Number(rest);
      return;
    }
    let rest = value;
    while (rest >= 128) {
      this.bytes[this.length++] = (rest % 128) | 128;
      rest = Math.floor(rest / 128);
    }
    this.bytes[this.length++] = rest;
  }
  key(field: number, wire: number): void {
    this.varint(field * 8 + wire);
  }
  uint(field: number, value: number): void {
    if (value === 0) return;
    this.key(field, 0);
    this.varint(value);
  }
  int(field: number, value: number): void {
    if (value === 0) return;
    this.key(field, 0);
    this.varint(value);
  }
  bytesField(field: number, value: Uint8Array): void {
    this.key(field, 2);
    this.varint(value.length);
    this.ensure(value.length);
    this.bytes.set(value, this.length);
    this.length += value.length;
  }
  packed(field: number, values: readonly number[]): void {
    if (values.length === 0) return;
    const inner = new Writer();
    for (const value of values) inner.varint(value);
    this.bytesField(field, inner.finish());
  }
  message(field: number, build: (writer: Writer) => void): void {
    const inner = new Writer();
    build(inner);
    this.bytesField(field, inner.finish());
  }
  finish(): Uint8Array {
    return this.bytes.slice(0, this.length);
  }
}

export type ProfileLine = SourceLine;
export type ProfileLocation = Location;
export type ProfileSample = Sample;
export type ProfileRequest = SampleProfile;

export function encodeProfile(request: SampleProfile): Uint8Array {
  const strings: string[] = [""],
    stringIds = new Map<string, number>([["", 0]]);
  const string = (text: string): number => {
    const known = stringIds.get(text);
    if (known !== undefined) return known;
    strings.push(text);
    stringIds.set(text, strings.length - 1);
    return strings.length - 1;
  };
  const functions = new Map<string, number>(),
    functionList: { id: number; name: number; file: number; start: number }[] =
      [];
  const functionId = (line: SourceLine): number => {
    const key = line.function + "\0" + (line.file ?? "");
    const known = functions.get(key);
    if (known !== undefined) return known;
    const id = functionList.length + 1;
    functionList.push({
      id,
      name: string(line.function),
      file: string(line.file ?? ""),
      start: line.startLine ?? 0,
    });
    functions.set(key, id);
    return id;
  };
  const mappings: readonly Mapping[] =
    request.mappings ??
    (request.mapping === undefined ? [] : [request.mapping]);
  const mappingOf = (address: number): number => {
    if (address === 0) return 0;
    const index = mappings.findIndex(
      (mapping) => address >= mapping.start && address < mapping.limit,
    );
    return index < 0 ? (mappings.length === 1 ? 1 : 0) : index + 1;
  };
  const locations = new Map<string, number>(),
    locationList: {
      id: number;
      address: number;
      mapping: number;
      lines: { fn: number; line: number; column: number }[];
    }[] = [];
  const locationId = (location: Location): number => {
    const key =
      String(location.address ?? 0) +
      "|" +
      location.lines
        .map(
          (line) =>
            line.function +
            ":" +
            (line.file ?? "") +
            ":" +
            String(line.line ?? 0) +
            ":" +
            String(line.column ?? 0),
        )
        .join("|");
    const known = locations.get(key);
    if (known !== undefined) return known;
    const id = locationList.length + 1;
    locationList.push({
      id,
      address: location.address ?? 0,
      mapping: mappingOf(location.address ?? 0),
      // profile.proto lists a location's lines caller last.
      lines: location.lines.map((line) => ({
        fn: functionId(line),
        line: line.line ?? 0,
        column: line.column ?? 0,
      })),
    });
    locations.set(key, id);
    return id;
  };
  const out = new Writer();
  const sampleTypes = request.sampleTypes.map((type) => ({
    type: string(type.type),
    unit: string(type.unit),
  }));
  for (const type of sampleTypes)
    out.message(1, (writer) => {
      writer.uint(1, type.type);
      writer.uint(2, type.unit);
    });
  for (const sample of request.samples) {
    const ids = sample.stack.map(locationId),
      labels = Object.entries(sample.labels ?? {}).map(([key, value]) => ({
        key: string(key),
        value: string(value),
      })),
      numbers = Object.entries(sample.numLabels ?? {}).map(([key, value]) => ({
        key: string(key),
        value,
      }));
    out.message(2, (writer) => {
      writer.packed(1, ids);
      writer.packed(
        2,
        sample.values.map((value) => Math.round(value)),
      );
      for (const label of labels)
        writer.message(3, (inner) => {
          inner.uint(1, label.key);
          inner.uint(2, label.value);
        });
      for (const label of numbers)
        writer.message(3, (inner) => {
          inner.uint(1, label.key);
          inner.int(3, Math.round(label.value));
        });
    });
  }
  mappings.forEach((mapping, index) => {
    const file = string(mapping.file),
      buildId = string(mapping.buildId);
    out.message(3, (writer) => {
      writer.uint(1, index + 1);
      writer.uint(2, mapping.start);
      writer.uint(3, mapping.limit);
      writer.uint(4, mapping.offset);
      writer.uint(5, file);
      writer.uint(6, buildId);
      writer.uint(7, 1);
      writer.uint(8, 1);
      writer.uint(9, 1);
    });
  });
  for (const location of locationList)
    out.message(4, (writer) => {
      writer.uint(1, location.id);
      if (location.address !== 0) writer.uint(2, location.mapping);
      writer.uint(3, location.address);
      for (const line of location.lines)
        writer.message(4, (inner) => {
          inner.uint(1, line.fn);
          inner.int(2, line.line);
          inner.int(3, line.column);
        });
    });
  for (const fn of functionList)
    out.message(5, (writer) => {
      writer.uint(1, fn.id);
      writer.uint(2, fn.name);
      writer.uint(3, fn.name);
      writer.uint(4, fn.file);
      writer.int(5, fn.start);
    });
  const comments = (request.comments ?? []).map(string),
    periodType =
      request.periodType === undefined
        ? undefined
        : {
            type: string(request.periodType.type),
            unit: string(request.periodType.unit),
          },
    defaultType =
      request.defaultSampleType === undefined
        ? 0
        : string(request.defaultSampleType);
  for (const text of strings) out.bytesField(6, new TextEncoder().encode(text));
  out.int(9, request.timeNanos ?? 0);
  out.int(10, request.durationNanos ?? 0);
  if (periodType !== undefined)
    out.message(11, (writer) => {
      writer.uint(1, periodType.type);
      writer.uint(2, periodType.unit);
    });
  out.int(12, request.period ?? 0);
  if (comments.length > 0) out.packed(13, comments);
  out.int(14, defaultType);
  return gzipSync(out.finish());
}

/** Protobuf fields of one message: [field, wire type, value] where a
 * varint is a number (int64 two's complement folded to negative) and a
 * length-delimited field is its bytes. */
function* fields(
  bytes: Uint8Array,
): Generator<[number, number, number | Uint8Array]> {
  let at = 0;
  const varint = (): number => {
    let value = 0,
      scale = 1,
      length = 0;
    const start = at;
    for (;;) {
      if (at >= bytes.length) throw Error("truncated protobuf varint");
      const byte = bytes[at++] ?? 0;
      value += (byte & 127) * scale;
      scale *= 128;
      length++;
      if (byte < 128) break;
    }
    if (length < 8) return value;
    // Beyond 2^53: exact through BigInt, int64 folded to negative.
    let exact = 0n;
    for (let index = at - 1; index >= start; index--)
      exact = (exact << 7n) | BigInt((bytes[index] ?? 0) & 127);
    return Number(BigInt.asIntN(64, exact));
  };
  while (at < bytes.length) {
    const key = varint(),
      field = Math.floor(key / 8),
      wire = key % 8;
    if (wire === 0) yield [field, wire, varint()];
    else if (wire === 2) {
      const length = varint();
      if (at + length > bytes.length) throw Error("truncated protobuf field");
      yield [field, wire, bytes.subarray(at, at + length)];
      at += length;
    } else if (wire === 1) {
      at += 8;
    } else if (wire === 5) {
      at += 4;
    } else throw Error("unsupported protobuf wire type " + wire);
  }
}
function numbers(value: number | Uint8Array): number[] {
  if (typeof value === "number") return [value];
  const result: number[] = [];
  for (const [, , item] of fields(packedAsFields(value)))
    result.push(item as number);
  return result;
}
/** Packed varints re-keyed as field 1 varints, so `fields` parses them. */
function packedAsFields(bytes: Uint8Array): Uint8Array {
  const out: number[] = [];
  let start = true;
  for (const byte of bytes) {
    if (start) out.push(8);
    out.push(byte);
    start = byte < 128;
  }
  return Uint8Array.from(out);
}

/** Reads a (gzip-compressed or raw) profile.proto into the sample model.
 * Labels keep their keys; numeric labels go to `numLabels`. */
export function decodeProfile(data: Uint8Array): SampleProfile {
  const bytes = data[0] === 0x1f && data[1] === 0x8b ? gunzipSync(data) : data;
  const strings: string[] = [];
  const sampleTypes: { type: number; unit: number }[] = [];
  const rawSamples: {
    locations: number[];
    values: number[];
    labels: { key: number; str: number; num: number }[];
  }[] = [];
  const mappings: {
    id: number;
    start: number;
    limit: number;
    offset: number;
    file: number;
    buildId: number;
  }[] = [];
  const locations = new Map<
    number,
    { address: number; lines: { fn: number; line: number; column: number }[] }
  >();
  const functions = new Map<
    number,
    { name: number; file: number; start: number }
  >();
  let timeNanos = 0,
    durationNanos = 0,
    period = 0,
    periodType: { type: number; unit: number } | undefined,
    defaultType = 0;
  const comments: number[] = [];
  const valueType = (value: Uint8Array): { type: number; unit: number } => {
    const result = { type: 0, unit: 0 };
    for (const [field, , item] of fields(value)) {
      if (field === 1) result.type = item as number;
      if (field === 2) result.unit = item as number;
    }
    return result;
  };
  for (const [field, , value] of fields(bytes)) {
    if (field === 1) sampleTypes.push(valueType(value as Uint8Array));
    else if (field === 2) {
      const sample = {
        locations: [] as number[],
        values: [] as number[],
        labels: [] as { key: number; str: number; num: number }[],
      };
      for (const [inner, , item] of fields(value as Uint8Array)) {
        if (inner === 1) sample.locations.push(...numbers(item));
        else if (inner === 2) sample.values.push(...numbers(item));
        else if (inner === 3) {
          const label = { key: 0, str: 0, num: 0 };
          for (const [part, , entry] of fields(item as Uint8Array)) {
            if (part === 1) label.key = entry as number;
            if (part === 2) label.str = entry as number;
            if (part === 3) label.num = entry as number;
          }
          sample.labels.push(label);
        }
      }
      rawSamples.push(sample);
    } else if (field === 3) {
      const mapping = {
        id: 0,
        start: 0,
        limit: 0,
        offset: 0,
        file: 0,
        buildId: 0,
      };
      for (const [inner, , item] of fields(value as Uint8Array)) {
        if (inner === 1) mapping.id = item as number;
        if (inner === 2) mapping.start = item as number;
        if (inner === 3) mapping.limit = item as number;
        if (inner === 4) mapping.offset = item as number;
        if (inner === 5) mapping.file = item as number;
        if (inner === 6) mapping.buildId = item as number;
      }
      mappings.push(mapping);
    } else if (field === 4) {
      let id = 0,
        address = 0;
      const lines: { fn: number; line: number; column: number }[] = [];
      for (const [inner, , item] of fields(value as Uint8Array)) {
        if (inner === 1) id = item as number;
        if (inner === 3) address = item as number;
        if (inner === 4) {
          const line = { fn: 0, line: 0, column: 0 };
          for (const [part, , entry] of fields(item as Uint8Array)) {
            if (part === 1) line.fn = entry as number;
            if (part === 2) line.line = entry as number;
            if (part === 3) line.column = entry as number;
          }
          lines.push(line);
        }
      }
      locations.set(id, { address, lines });
    } else if (field === 5) {
      let id = 0;
      const fn = { name: 0, file: 0, start: 0 };
      for (const [inner, , item] of fields(value as Uint8Array)) {
        if (inner === 1) id = item as number;
        if (inner === 2) fn.name = item as number;
        if (inner === 4) fn.file = item as number;
        if (inner === 5) fn.start = item as number;
      }
      functions.set(id, fn);
    } else if (field === 6)
      strings.push(new TextDecoder().decode(value as Uint8Array));
    else if (field === 9) timeNanos = value as number;
    else if (field === 10) durationNanos = value as number;
    else if (field === 11) periodType = valueType(value as Uint8Array);
    else if (field === 12) period = value as number;
    else if (field === 13) comments.push(...numbers(value));
    else if (field === 14) defaultType = value as number;
  }
  const text = (index: number): string => strings[index] ?? "";
  const location = (id: number): Location => {
    const entry = locations.get(id);
    if (entry === undefined) return { lines: [{ function: "?" }] };
    const lines = entry.lines.map((line): SourceLine => {
      const fn = functions.get(line.fn);
      return {
        function:
          fn === undefined
            ? "0x" + entry.address.toString(16)
            : text(fn.name) || "0x" + entry.address.toString(16),
        file: fn === undefined || fn.file === 0 ? undefined : text(fn.file),
        line: line.line,
        column: line.column,
        startLine: fn === undefined || fn.start === 0 ? undefined : fn.start,
      };
    });
    return {
      address: entry.address,
      lines:
        lines.length > 0
          ? lines
          : [{ function: "0x" + entry.address.toString(16) }],
    };
  };
  const samples: Sample[] = rawSamples.map((sample) => {
    const labels: Record<string, string> = {},
      numLabels: Record<string, number> = {};
    for (const label of sample.labels) {
      if (label.str !== 0) labels[text(label.key)] = text(label.str);
      else numLabels[text(label.key)] = label.num;
    }
    return {
      stack: sample.locations.map(location),
      values: sample.values,
      ...(sample.labels.some((label) => label.str !== 0) ? { labels } : {}),
      ...(sample.labels.some((label) => label.str === 0) ? { numLabels } : {}),
    };
  });
  return {
    sampleTypes: sampleTypes.map((type) => ({
      type: text(type.type),
      unit: text(type.unit),
    })),
    samples,
    ...(periodType === undefined
      ? {}
      : {
          periodType: {
            type: text(periodType.type),
            unit: text(periodType.unit),
          },
        }),
    period,
    ...(defaultType === 0 ? {} : { defaultSampleType: text(defaultType) }),
    mappings: mappings.map((mapping) => ({
      start: mapping.start,
      limit: mapping.limit,
      offset: mapping.offset,
      file: text(mapping.file),
      buildId: text(mapping.buildId),
    })),
    comments: comments.map(text),
    timeNanos,
    durationNanos,
  };
}
