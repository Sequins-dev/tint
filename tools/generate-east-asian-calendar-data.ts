/** Regenerate the published Chinese/Korean calendar rows from pinned ICU4X data.
 * Usage: node tools/generate-east-asian-calendar-data.ts <input-directory>
 * The directory contains qing_data.rs, china_data.rs and korea_data.rs.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { epochDayFromGregorianCoordinate } from "@tint/foundation/chrono/gregorian-calendar";
const revision = "b6b00b90cdad5bb4385a88c94f05718e94eebc93";
const inputs = [
  [
    "qing",
    "e8097d4ba4651863644ef2ed7247d57640e949eb2c2ef207a2d8ebf9b5c4f69e",
    1900,
    12,
  ],
  [
    "china",
    "46e9ad101ef4501765524d5f5ea65ec1c87a1c9f1bec00cb66e7b57ad49ef9a5",
    1912,
    191,
  ],
  [
    "korea",
    "109acbffe1cf64ce20bf483752f5c1d2f6b8cae07b6a75e17e79e0f2a20eb69f",
    1912,
    191,
  ],
] as const;
interface Year {
  year: number;
  start: number;
  end: number;
  leap: number;
  bits: string;
}
const directory = process.argv[2];
if (directory === undefined) throw Error("expected ICU4X source directory");
const groups: Year[][] = [];
for (const [name, sha256, firstYear, count] of inputs) {
  const source = readFileSync(join(directory, name + "_data.rs"));
  if (createHash("sha256").update(source).digest("hex") !== sha256)
    throw Error("source checksum mismatch: " + name);
  const text = source.toString("utf8").split("\n    ]")[0]!;
  const rows: Year[] = [];
  const pattern =
    /PackedEastAsianTraditionalYearData::new\((\d+), \[([ls, ]+)\], (None|Some\(\d+\)), gregorian\((\d+), (\d+), (\d+)\)\)/g;
  for (const match of text.matchAll(pattern)) {
    const year = Number(match[1]),
      leap = match[3] === "None" ? 0 : Number(match[3]!.slice(5, -1));
    const lengths = match[2]!
      .split(",")
      .map((value) => (value.trim() === "l" ? 30 : 29))
      .slice(0, leap === 0 ? 12 : 13);
    const start = epochDayFromGregorianCoordinate(
      Number(match[4]),
      Number(match[5]),
      Number(match[6]),
    );
    if (
      start === undefined ||
      year !== firstYear + rows.length ||
      lengths.length !== (leap === 0 ? 12 : 13) ||
      (leap !== 0 && (leap < 2 || leap > 13))
    )
      throw Error("invalid year record: " + name);
    const previous = rows.at(-1);
    if (previous !== undefined && previous.end !== start)
      throw Error("noncontiguous years: " + name);
    rows.push({
      year,
      start,
      end: start + lengths.reduce((sum, days) => sum + days, 0),
      leap,
      bits: lengths.map((days) => (days === 30 ? "1" : "0")).join(""),
    });
  }
  if (rows.length !== count) throw Error("incomplete year data: " + name);
  groups.push(rows);
  console.error(name, rows.length, "years verified", sha256);
}
const qing = groups[0]!;
const packed = (rows: Year[]): string => {
  const all = [...qing, ...rows];
  if (qing.at(-1)!.end !== rows[0]!.start)
    throw Error("Qing transition mismatch");
  return all
    .map((row) => `${row.year}|${row.start},${row.leap},${row.bits}`)
    .join("\n");
};
const path = "packages/js-runtime/src/objects/calendar-data.ts";
let source = readFileSync(path, "utf8");
for (const [name, rows] of [
  ["chineseCalendarYears", groups[1]!],
  ["dangiCalendarYears", groups[2]!],
] as const) {
  const pattern = new RegExp(`export const ${name} =\\s*"[^"\\n]*";`);
  if (!pattern.test(source)) throw Error("missing packed table: " + name);
  source = source.replace(
    pattern,
    () => `export const ${name} =\n  ${JSON.stringify(packed(rows))};`,
  );
}
writeFileSync(path, source);
console.error("Regenerated 406 calendar years from ICU4X", revision);
