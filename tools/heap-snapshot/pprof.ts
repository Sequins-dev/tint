// A minimal writer for pprof's profile.proto (gzip-compressed), enough for
// heap profiles that `go tool pprof` and pprofessor read: sample types,
// samples with location stacks (leaf first), locations with optional
// addresses and inlined lines, functions, one mapping and a string table.
import { gzipSync } from "node:zlib";

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
    // int64: negative values are ten-byte two's complement varints.
    if (value >= 0) this.varint(value);
    else this.varint(2 ** 64 + value);
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
    for (const value of values)
      inner.varint(value < 0 ? 2 ** 64 + value : value);
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

export interface ProfileLine {
  readonly function: string;
  readonly file?: string | undefined;
  readonly line?: number | undefined;
}
export interface ProfileLocation {
  /** Leaf (innermost inlined) line first. */
  readonly lines: readonly ProfileLine[];
  readonly address?: number | undefined;
}
export interface ProfileSample {
  /** Leaf first. */
  readonly stack: readonly ProfileLocation[];
  readonly values: readonly number[];
  readonly labels?: Readonly<Record<string, string>> | undefined;
}
export interface ProfileRequest {
  readonly sampleTypes: readonly {
    readonly type: string;
    readonly unit: string;
  }[];
  readonly samples: readonly ProfileSample[];
  readonly periodType?: { readonly type: string; readonly unit: string };
  readonly period?: number;
  readonly defaultSampleType?: string;
  readonly mapping?: {
    readonly start: number;
    readonly limit: number;
    readonly offset: number;
    readonly file: string;
    readonly buildId: string;
  };
  readonly comments?: readonly string[];
  readonly timeNanos?: number;
}

export function encodeProfile(request: ProfileRequest): Uint8Array {
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
    functionList: { id: number; name: number; file: number }[] = [];
  const functionId = (line: ProfileLine): number => {
    const key = line.function + "\0" + (line.file ?? "");
    const known = functions.get(key);
    if (known !== undefined) return known;
    const id = functionList.length + 1;
    functionList.push({
      id,
      name: string(line.function),
      file: string(line.file ?? ""),
    });
    functions.set(key, id);
    return id;
  };
  const locations = new Map<string, number>(),
    locationList: {
      id: number;
      address: number;
      lines: { fn: number; line: number }[];
    }[] = [];
  const locationId = (location: ProfileLocation): number => {
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
            String(line.line ?? 0),
        )
        .join("|");
    const known = locations.get(key);
    if (known !== undefined) return known;
    const id = locationList.length + 1;
    locationList.push({
      id,
      address: location.address ?? 0,
      // profile.proto lists a location's lines caller last.
      lines: location.lines.map((line) => ({
        fn: functionId(line),
        line: line.line ?? 0,
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
    });
  }
  const mapping = request.mapping;
  if (mapping !== undefined) {
    const file = string(mapping.file),
      buildId = string(mapping.buildId);
    out.message(3, (writer) => {
      writer.uint(1, 1);
      writer.uint(2, mapping.start);
      writer.uint(3, mapping.limit);
      writer.uint(4, mapping.offset);
      writer.uint(5, file);
      writer.uint(6, buildId);
      writer.uint(7, 1);
      writer.uint(8, 1);
      writer.uint(9, 1);
    });
  }
  for (const location of locationList)
    out.message(4, (writer) => {
      writer.uint(1, location.id);
      if (mapping !== undefined && location.address !== 0) writer.uint(2, 1);
      writer.uint(3, location.address);
      for (const line of location.lines)
        writer.message(4, (inner) => {
          inner.uint(1, line.fn);
          inner.int(2, line.line);
        });
    });
  for (const fn of functionList)
    out.message(5, (writer) => {
      writer.uint(1, fn.id);
      writer.uint(2, fn.name);
      writer.uint(3, fn.name);
      writer.uint(4, fn.file);
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
