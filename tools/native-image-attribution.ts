/**
 * Where a native program module's bytes go, per function: code, safepoint
 * entries and the map words each function introduces (a map shared by several
 * safepoints is charged to the first function that uses it), plus string
 * literals and record descriptors. Analysis only (image-size work).
 */
import { decodeStackMaps } from "@tint/codegen/aarch64/scalar";
import type { NativeModule } from "@tint/codegen/aarch64/scalar";

export interface FunctionAttribution {
  readonly name: string;
  readonly codeBytes: number;
  readonly frameBytes: number;
  readonly safepoints: number;
  /** Distinct maps this function introduces and their encoded words. */
  readonly maps: number;
  readonly mapWords: number;
  /** Reference and general words listed over all of its safepoints. */
  readonly listedWords: number;
}

export interface ModuleAttribution {
  readonly codeBytes: number;
  readonly functionBytes: number;
  readonly tableBytes: number;
  readonly tableEntryBytes: number;
  readonly mapBytes: number;
  readonly safepoints: number;
  readonly distinctMaps: number;
  readonly stringBytes: number;
  readonly strings: number;
  readonly recordBytes: number;
  readonly functions: readonly FunctionAttribution[];
  /** Code bytes and ranges per IR operation kind and function category
   * (when the module kept operation ranges). */
  readonly operations: Record<string, Record<string, [number, number]>>;
  /** Largest string literals by bytes (length and a prefix). */
  readonly largestStrings: readonly { bytes: number; prefix: string }[];
}

export function attributeNativeModule(module: NativeModule): ModuleAttribution {
  const functions = module.functions
    .filter((fn) => fn.import !== true && fn.byteLength > 0)
    .slice()
    .sort((left, right) => left.offset - right.offset);
  const safepoints = decodeStackMaps(module);
  if (safepoints === undefined) throw Error("malformed safepoint table");
  const counts = functions.map(() => ({
    safepoints: 0,
    maps: 0,
    mapWords: 0,
    listed: 0,
  }));
  const seen = new Set<string>();
  let distinctMaps = 0,
    mapWordsTotal = 0;
  for (const point of safepoints) {
    // The function holding the call (return offset minus one instruction).
    let low = 0,
      high = functions.length - 1,
      found = -1;
    const at = point.offset - 4;
    while (low <= high) {
      const middle = (low + high) >> 1,
        fn = functions[middle]!;
      if (at < fn.offset) high = middle - 1;
      else if (at >= fn.offset + fn.byteLength) low = middle + 1;
      else {
        found = middle;
        break;
      }
    }
    if (found < 0) continue;
    const count = counts[found]!;
    count.safepoints++;
    count.listed += point.references.length + point.generals.length;
    const key = JSON.stringify([
      point.frameBytes,
      point.references,
      point.generals,
      point.registers,
      point.saves,
    ]);
    if (seen.has(key)) continue;
    seen.add(key);
    const words =
      4 + point.references.length + point.generals.length + point.saves.length;
    count.maps++;
    count.mapWords += words;
    distinctMaps++;
    mapWordsTotal += words;
  }
  let tableBytes = 0;
  for (const table of module.stackMaps) tableBytes += table.byteLength;
  let stringBytes = 0;
  for (const literal of module.strings) stringBytes += literal.byteLength;
  let recordBytes = 0;
  for (const record of module.records) recordBytes += record.byteLength;
  let functionBytes = 0;
  for (const fn of functions) functionBytes += fn.byteLength;
  const operations: Record<string, Record<string, [number, number]>> = {},
    names = new Map<number, string>();
  for (const fn of module.functions) names.set(fn.id, fn.name);
  for (const range of module.operationRanges ?? []) {
    const category = functionCategory(names.get(range.function) ?? ""),
      table = (operations[category] ??= {}),
      key = range.operation,
      entry = (table[key] ??= [0, 0]);
    entry[0] += range.byteLength;
    entry[1]++;
  }
  return {
    operations,
    codeBytes: module.code.length,
    functionBytes,
    tableBytes,
    tableEntryBytes: tableBytes - mapWordsTotal * 8,
    mapBytes: mapWordsTotal * 8,
    safepoints: safepoints.length,
    distinctMaps,
    stringBytes,
    strings: module.strings.length,
    recordBytes,
    functions: functions.map((fn, index) => {
      const count = counts[index]!;
      return {
        name: fn.name,
        codeBytes: fn.byteLength,
        frameBytes: fn.frameBytes,
        safepoints: count.safepoints,
        maps: count.maps,
        mapWords: count.mapWords,
        listedWords: count.listed,
      };
    }),
    largestStrings: module.strings
      .slice()
      .sort((left, right) => right.byteLength - left.byteLength)
      .slice(0, 200)
      .map((literal) => ({
        bytes: literal.byteLength,
        prefix: literal.value.slice(0, 80),
      })),
  };
}

/** Coarse origin of a program function by its generated name. */
export function functionCategory(name: string): string {
  if (name.startsWith("@")) return "module";
  if (name.startsWith("closure")) return "closure";
  if (name.startsWith("__tint_specialized")) return "specialized";
  if (name.startsWith("__tint_initialize")) return "initialize";
  return "other";
}
