import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { format } from "prettier";
import inputs from "./collation-data-inputs.json" with { type: "json" };
import {
  parseCollationRoot,
  collationHanBase,
  type CollationElement,
} from "./collation-root-input.ts";
import { compileCollationTailoring } from "./collation-tailoring.ts";
const [archive, unicodeData] = process.argv.slice(2);
if (archive === undefined || unicodeData === undefined)
  throw Error(
    "Usage: node tools/generate-collation-data.ts CLDR48.zip UnicodeData17.txt",
  );
const digest = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");
if (digest(readFileSync(archive)) !== inputs.archiveSha256)
  throw Error("CLDR48 archive checksum mismatch");
const unicodeBytes = readFileSync(unicodeData);
if (digest(unicodeBytes) !== inputs.unicodeDataSha256)
  throw Error("Unicode17 data checksum mismatch");
const sources = new Map<string, string>();
for (const input of inputs.members) {
  const bytes = execFileSync("/usr/bin/unzip", ["-p", archive, input.path], {
    maxBuffer: 20 * 1024 * 1024,
  });
  if (digest(bytes) !== input.sha256)
    throw Error("Collation input checksum mismatch: " + input.path);
  sources.set(
    input.path,
    new TextDecoder("utf-8", { fatal: true }).decode(bytes),
  );
}
const fractional = sources.get("common/uca/FractionalUCA.txt");
if (fractional === undefined) throw Error("Missing fractional root");
const root = parseCollationRoot(fractional);
class Encoder {
  readonly chunks: string[] = [];
  unsigned(value: number): void {
    if (!Number.isSafeInteger(value) || value < 0)
      throw Error("Invalid packed unsigned value");
    do {
      const low = value % 32;
      value = Math.floor(value / 32);
      this.chunks.push(String.fromCharCode(48 + low + (value ? 32 : 0)));
    } while (value);
  }
  text(value: string): void {
    this.unsigned(value.length);
    for (let i = 0; i < value.length; i++) this.unsigned(value.charCodeAt(i));
  }
  number(value: number): void {
    if (Number.isSafeInteger(value) && value >= 0) {
      this.unsigned(value * 2);
      return;
    }
    if (!Number.isFinite(value) || value < 0)
      throw Error("Invalid collation weight");
    this.unsigned(1);
    const bytes = Buffer.alloc(8);
    bytes.writeDoubleLE(value);
    this.unsigned(bytes.readUInt32LE(0));
    this.unsigned(bytes.readUInt32LE(4));
  }
  finish(): string {
    return this.chunks.join("");
  }
}
const weights: CollationElement[] = [],
  ids = new Map<string, number>();
function id(ce: CollationElement): number {
  const key = ce.join(",");
  let index = ids.get(key);
  if (index === undefined) {
    index = weights.length;
    weights.push(ce);
    ids.set(key, index);
  }
  return index;
}
const entries = [...root.rows].map(([key, ces]) => ({
  points: Array.from(key, (c) => c.codePointAt(0)!),
  prefix: [] as number[],
  ces: ces.map(id),
}));
for (const [key, rules] of root.prefixes)
  for (const rule of rules)
    entries.push({
      points: Array.from(key, (c) => c.codePointAt(0)!),
      prefix: Array.from(rule.prefix, (c) => c.codePointAt(0)!),
      ces: rule.ces.map(id),
    });
entries.sort(
  (a, b) => a.points[0]! - b.points[0]! || a.points.length - b.points.length,
);
const packed = new Encoder();
packed.unsigned(weights.length);
for (const ce of weights) for (const value of ce) packed.unsigned(value);
packed.unsigned(entries.length);
let previous = 0;
for (const row of entries) {
  const first = row.points[0]!;
  packed.unsigned(first - previous);
  previous = first;
  packed.unsigned(row.points.length);
  for (const point of row.points.slice(1)) packed.unsigned(point);
  packed.unsigned(row.prefix.length);
  for (const point of row.prefix) packed.unsigned(point);
  packed.unsigned(row.ces.length);
  for (const index of row.ces) packed.unsigned(index);
}
const ranges: [number, number][] = [];
for (const point of root.han.keys()) {
  const last = ranges.at(-1);
  if (last !== undefined && last[1] + 1 === point) last[1] = point;
  else ranges.push([point, point]);
}
packed.unsigned(ranges.length);
for (const [start, end] of ranges) {
  packed.unsigned(start);
  packed.unsigned(end);
}
const localeInputs = new Map<string, string>();
for (const [path, text] of sources) {
  const match = /^common\/collation\/(.*)\.xml$/.exec(path);
  if (match) localeInputs.set(match[1]!, text);
}
// Only approved/contributed rules are used; provisional German EOR inherits root.
const profiles = [
  ["root", "search"],
  ["root", "eor"],
  ["de", "phonebk"],
  ["de", "search"],
  ["es", "standard"],
  ["es", "search"],
  ["sv", "standard"],
  ["th", "standard"],
] as const;
const tailoringPacked = new Encoder();
tailoringPacked.unsigned(profiles.length);
const summaries = [];
for (const [locale, type] of profiles) {
  const profile = compileCollationTailoring(root, localeInputs, locale, type);
  tailoringPacked.text(locale + "/" + type);
  tailoringPacked.text(profile.settings.reorder.join(" "));
  tailoringPacked.unsigned(profile.settings.shifted ? 1 : 0);
  tailoringPacked.unsigned(profile.changes.length);
  for (const [key, ces] of profile.changes) {
    tailoringPacked.text(key);
    if (ces === null) {
      tailoringPacked.unsigned(0);
      continue;
    }
    tailoringPacked.unsigned(ces.length + 1);
    for (const ce of ces) for (const value of ce) tailoringPacked.number(value);
  }
  summaries.push({
    locale,
    type,
    mappings: profile.changes.length,
    reorder: profile.settings.reorder,
    shifted: profile.settings.shifted,
  });
}
const decimalZeros: number[] = [];
for (const line of new TextDecoder().decode(unicodeBytes).split("\n")) {
  const fields = line.split(";");
  if (fields[2] === "Nd" && fields[6] === "0")
    decimalZeros.push(parseInt(fields[0]!, 16));
}
const header =
  "// Generated by tools/generate-collation-data.ts. Unicode17.0.0 / CLDR48.\n// Pinned sources and hashes: tools/collation-data-inputs.json\n// Copyright and permission: ../../LICENSE-COLLATION-UNICODE.txt\n";
const rootText = packed.finish(),
  tailoringText = tailoringPacked.finish();
const output = await format(
  header +
    `export const collationUnicodeVersion = "17.0.0";\nexport const collationCLDRVersion = "48";\nexport const rootPacked:string=${JSON.stringify(rootText)};\nexport const tailoringPacked:string=${JSON.stringify(tailoringText)};\nexport const decimalZeros:readonly number[]=${JSON.stringify(decimalZeros)};\nexport const collationNumericPrimary:number=${root.numericPrimary};\nexport const collationHanBase:number=${collationHanBase};\n`,
  { parser: "typescript" },
);
writeFileSync("packages/js-runtime/src/objects/collation-data.ts", output);
const license = sources.get("LICENSE");
if (license === undefined) throw Error("Missing license");
writeFileSync("packages/js-runtime/LICENSE-COLLATION-UNICODE.txt", license);
const manifest = {
  ...inputs,
  outputSha256: digest(new TextEncoder().encode(output)),
  rootMappings: entries.length,
  uniqueElements: weights.length,
  hanRanges: ranges.length,
  decimalBlocks: decimalZeros.length,
  rootPackedCharacters: rootText.length,
  tailoringPackedCharacters: tailoringText.length,
  profiles: summaries,
};
writeFileSync(
  "tools/collation-data-output.json",
  JSON.stringify(manifest, null, 2) + "\n",
);
console.log(JSON.stringify(manifest));
