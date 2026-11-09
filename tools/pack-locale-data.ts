import { createHash } from "node:crypto";
export interface PackedLocaleTables {
  readonly payload: string;
  readonly packedBytes: number;
  readonly decodedBytes: number;
  readonly utf16CodeUnits: number;
  readonly decodedSha256: string;
}
/** Deterministic greedy LZ packing. This host-only encoder favors bounded work;
 * the portable decoder accepts the versioned frame independently. */
export function packLocaleTables(
  tables: readonly string[],
): PackedLocaleTables {
  if (tables.length > 65536 || tables.some((value) => value.includes("\0")))
    throw Error("Invalid CLDR table boundary");
  const input = new TextEncoder().encode(tables.join("\0")),
    length = input.length;
  if (length > 33554432) throw Error("CLDR data exceeds frame budget");
  const heads = new Int32Array(1 << 20).fill(-1),
    previous = new Int32Array(length).fill(-1),
    output = new Uint8Array(length * 2 + 64);
  let used = 0;
  function byte(value: number): void {
    output[used++] = value;
  }
  function integer(value: number): void {
    while (value >= 128) {
      byte((value & 127) | 128);
      value = Math.floor(value / 128);
    }
    byte(value);
  }
  for (const value of [67, 76, 68, 49]) byte(value);
  for (const value of [length, tables.length])
    for (let shift = 0; shift < 32; shift += 8) byte((value >>> shift) & 255);
  function hash(index: number): number {
    const value =
      input[index]! |
      (input[index + 1]! << 8) |
      (input[index + 2]! << 16) |
      (input[index + 3]! << 24);
    return Math.imul(value, 2654435761) >>> 12;
  }
  function insert(index: number): void {
    if (index + 4 > length) return;
    const key = hash(index);
    previous[index] = heads[key]!;
    heads[key] = index;
  }
  let index = 0,
    anchor = 0;
  while (index + 8 <= length) {
    let best = 7,
      matched = -1,
      candidate = heads[hash(index)]!,
      attempts = 0;
    const maximum = Math.min(length - index, 65535);
    while (candidate >= 0 && attempts++ < 64) {
      if (
        input[candidate] === input[index] &&
        input[candidate + best] === input[index + best]
      ) {
        let size = 0;
        while (
          size < maximum &&
          input[candidate + size] === input[index + size]
        )
          size++;
        if (size > best) {
          best = size;
          matched = candidate;
          if (size === maximum) break;
        }
      }
      candidate = previous[candidate]!;
    }
    if (matched < 0) {
      insert(index++);
      continue;
    }
    integer(index - anchor);
    for (let cursor = anchor; cursor < index; cursor++) byte(input[cursor]!);
    integer(index - matched);
    integer(best);
    for (let cursor = index; cursor < index + best; cursor++) insert(cursor);
    index += best;
    anchor = index;
  }
  if (anchor < length) {
    integer(length - anchor);
    for (let cursor = anchor; cursor < length; cursor++) byte(input[cursor]!);
  }
  if (used > output.length || used > 33554432)
    throw Error("CLDR packed frame exceeds budget");
  const characters: string[] = [];
  let bits = 0,
    value = 0;
  function character(unit: number): void {
    let code = unit + 32;
    if (code >= 0x2028) code += 2;
    characters.push(String.fromCharCode(code));
  }
  for (let cursor = 0; cursor < used; cursor++) {
    value |= output[cursor]! << bits;
    bits += 8;
    while (bits >= 15) {
      character(value & 32767);
      value >>>= 15;
      bits -= 15;
    }
  }
  if (bits > 0) character(value);
  const payload = characters.join("");
  return {
    payload,
    packedBytes: used,
    decodedBytes: length,
    utf16CodeUnits: payload.length,
    decodedSha256: createHash("sha256").update(input).digest("hex"),
  };
}
export function packedLocaleModule(
  header: string,
  entries: readonly (readonly [string, string])[],
): {
  readonly source: string;
  readonly packing: Omit<PackedLocaleTables, "payload">;
} {
  if (
    entries.some(([name]) => !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)) ||
    new Set(entries.map(([name]) => name)).size !== entries.length
  )
    throw Error("Invalid CLDR export name");
  const packed = packLocaleTables(entries.map(([, value]) => value)),
    { payload, ...packing } = packed;
  let source =
    header +
    'import { unpackLocaleData } from "./locale-data-pack.ts";\n' +
    "const cache: { tables: readonly string[] | undefined } = { tables: undefined };\n" +
    "const packed: string = " +
    JSON.stringify(payload) +
    ";\n" +
    "function table(index: number): string {\n" +
    "let tables = cache.tables;\n" +
    "if (tables === undefined) { tables = unpackLocaleData(packed, " +
    String(packed.packedBytes) +
    "); cache.tables = tables; }\n" +
    'const value = tables[index]; if (value === undefined) throw "CLDR_PACK_TABLE_INDEX"; return value; }\n';
  for (const [index, [name]] of entries.entries())
    source +=
      "export function " +
      name +
      "(): string { return table(" +
      String(index) +
      "); }\n";
  return { source, packing };
}
