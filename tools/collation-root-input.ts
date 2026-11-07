/** Fractional UCA input decoding for the pinned CLDR generator, never runtime I/O. */
// Keep implicit Han values beyond the explicit 81.02.02 group boundary.
export const collationHanBase = 0x81040000;
export type CollationElement = [number, number, number];
export interface CollationPrefix {
  readonly prefix: string;
  readonly ces: CollationElement[];
}
export interface CollationRoot {
  readonly rows: Map<string, CollationElement[]>;
  readonly prefixes: Map<string, CollationPrefix[]>;
  readonly han: Map<number, number>;
  readonly numericPrimary: number;
}
function weight(value: string, bytes: number): number {
  const compact = value.replace(/\s/g, "");
  if (compact && !/^[0-9A-Fa-f]+$/.test(compact))
    throw Error("Invalid fractional weight");
  if (compact.length > bytes * 2) throw Error("Oversized fractional weight");
  return compact ? parseInt(compact.padEnd(bytes * 2, "0"), 16) : 0;
}
export function implicitCollationElement(
  cp: number,
  han: ReadonlyMap<number, number>,
): CollationElement {
  const rank = han.get(cp);
  return [
    rank === undefined ? 0xe0000000 + cp * 64 : collationHanBase + rank * 128,
    0x0500,
    0x0500,
  ];
}
export function parseCollationRoot(text: string): CollationRoot {
  if (!text.includes("# VERSION: UCA=17.0.0, UCD=17.0.0"))
    throw Error("Expected Unicode17 root");
  const ranges = /^\[Unified_Ideograph (.*)\]$/m.exec(text)?.[1];
  if (ranges === undefined) throw Error("Missing Han implicit ranges");
  const han = new Map<number, number>();
  let rank = 0;
  for (const range of ranges.split(/\s+/)) {
    const parts = range.split(".."),
      start = parseInt(parts[0] ?? "", 16),
      end = parseInt(parts[1] ?? parts[0] ?? "", 16);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start > end)
      throw Error("Invalid Han range");
    for (let cp = start; cp <= end; cp++) {
      if (han.has(cp)) throw Error("Overlapping Han range");
      han.set(cp, rank++);
    }
  }
  const rows = new Map<string, CollationElement[]>(),
    prefixes = new Map<string, CollationPrefix[]>();
  let numericPrimary: number | undefined;
  for (const line of text.split("\n")) {
    if (!/^[0-9A-F].*;/.test(line)) continue;
    const semi = line.indexOf(";"),
      rawKey = line.slice(0, semi),
      tail = line.slice(semi + 1).split("#")[0] ?? "";
    const sides = rawKey.split("|");
    if (sides.length > 2) throw Error("Invalid context mapping");
    const prefix = sides.length === 2 ? sides[0]!.trim() : "",
      key = sides.at(-1)!.trim();
    if (
      !/^[0-9A-F]+(?: [0-9A-F]+)*$/.test(key) ||
      (prefix && !/^[0-9A-F]+(?: [0-9A-F]+)*$/.test(prefix))
    )
      throw Error("Invalid root mapping key");
    const points = key.split(" ").map((x) => parseInt(x, 16));
    // FDD0 entries are generator metadata, including the dedicated numeric lead.
    // FDD1 script-boundary contractions remain ordinary table mappings.
    if (points[0] === 0xfdd0) {
      if (key === "FDD0 0034") {
        const match = /\[([^,]*),/.exec(tail);
        if (match === null) throw Error("Missing numeric primary");
        numericPrimary = weight(match[1]!, 4);
      }
      continue;
    }
    const ces: CollationElement[] = [];
    for (const match of tail.matchAll(/\[([^\]]*)\]/g)) {
      const parts = match[1]!.split(",").map((x) => x.trim()),
        first = parts[0]!;
      if (first.startsWith("U+")) {
        const cp = parseInt(first.slice(2), 16);
        const existing = rows.get(String.fromCodePoint(cp));
        let ce: CollationElement;
        if (han.has(cp)) ce = implicitCollationElement(cp, han);
        else if (existing?.length === 1 && existing[0] !== undefined)
          ce = [...existing[0]];
        else
          throw Error("Reference must identify one existing collation element");
        if (parts.length === 2) ce[2] = weight(parts[1]!, 2);
        else if (parts.length === 3) {
          ce[1] = weight(parts[1]!, 2);
          ce[2] = weight(parts[2]!, 2);
        } else if (parts.length !== 1) throw Error("Invalid reference form");
        ces.push(ce);
      } else {
        if (parts.length !== 3) throw Error("Invalid collation element");
        ces.push([
          weight(first, 4),
          weight(parts[1]!, 2),
          weight(parts[2]!, 2),
        ]);
      }
    }
    if (!ces.length) throw Error("Mapping lacks collation elements");
    const value = String.fromCodePoint(...points);
    if (prefix) {
      const before = String.fromCodePoint(
        ...prefix.split(" ").map((x) => parseInt(x, 16)),
      );
      let list = prefixes.get(value);
      if (list === undefined) {
        list = [];
        prefixes.set(value, list);
      }
      list.push({ prefix: before, ces });
    } else {
      if (rows.has(value)) throw Error("Duplicate root mapping");
      rows.set(value, ces);
    }
  }
  const hanMarker = rows.get("\ufdd1字")?.[0]?.[0];
  if (hanMarker !== undefined && hanMarker >= collationHanBase)
    throw Error("Han implicit base overlaps script boundary");
  if (numericPrimary === undefined) throw Error("Numeric lead metadata absent");
  return { rows, prefixes, han, numericPrimary };
}
