import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const sources = [
  [
    "UnicodeData.txt",
    "2e1efc1dcb59c575eedf5ccae60f95229f706ee6d031835247d843c11d96470c",
  ],
  [
    "Scripts.txt",
    "9f5e50d3abaee7d6ce09480f325c706f485ae3240912527e651954d2d6b035bf",
  ],
  [
    "ScriptExtensions.txt",
    "ec2107e58825a1586acee8e0911ce18260394ac8b87e535ca325f1ccbeb06bc6",
  ],
  [
    "PropList.txt",
    "130dcddcaadaf071008bdfce1e7743e04fdfbc910886f017d9f9ac931d8c64dd",
  ],
  [
    "DerivedCoreProperties.txt",
    "24c7fed1195c482faaefd5c1e7eb821c5ee1fb6de07ecdbaa64b56a99da22c08",
  ],
  [
    "DerivedNormalizationProps.txt",
    "71fd6a206a2c0cdd41feb6b7f656aa31091db45e9cedc926985d718397f9e488",
  ],
  [
    "extracted/DerivedBinaryProperties.txt",
    "13dd09d35a9377e33eb388a01e6581d4bfec6b2685316078c341982fa444071a",
  ],
  [
    "emoji/emoji-data.txt",
    "2cb2bb9455cda83e8481541ecf5b6dfda66a3bb89efa3fa7c5297eccf607b72b",
  ],
  [
    "PropertyValueAliases.txt",
    "64e9a5f76f7a1e8b5a47d6a1f9a26522a251208f5276bdfa1559dac7cf2e827a",
  ],
] as const;
const texts = new Map<string, string>();
for (const [name, hash] of sources) {
  const local = process.argv[2];
  const response =
    local === undefined
      ? await fetch("https://www.unicode.org/Public/17.0.0/ucd/" + name)
      : undefined;
  if (response !== undefined && !response.ok)
    throw new Error(name + ": HTTP " + response.status);
  const bytes =
    local === undefined
      ? new Uint8Array(await response!.arrayBuffer())
      : readFileSync(join(local, name));
  if (createHash("sha256").update(bytes).digest("hex") !== hash)
    throw new Error(name + ": Unicode 17.0.0 checksum mismatch");
  texts.set(name, new TextDecoder().decode(bytes));
}
function rows(name: string): string[][] {
  return texts
    .get(name)!
    .split("\n")
    .map((line) =>
      line
        .split("#")[0]!
        .split(";")
        .map((x) => x.trim()),
    )
    .filter((row) => row.length > 1);
}
function range(text: string): [number, number] {
  const [a, b] = text.split("..");
  return [parseInt(a!, 16), parseInt(b ?? a!, 16)];
}
const categoryAliases = new Map<string, string>(),
  scriptAliases = new Map<string, string>();
for (const row of rows("PropertyValueAliases.txt")) {
  const aliases =
    row[0] === "gc"
      ? categoryAliases
      : row[0] === "sc"
        ? scriptAliases
        : undefined;
  if (aliases !== undefined)
    for (const alias of row.slice(1)) if (alias) aliases.set(alias, row[2]!);
}
const database = new Map<string, number[]>();
function add(name: string, lo: number, hi: number): void {
  let entries = database.get(name);
  if (entries === undefined) {
    entries = [];
    database.set(name, entries);
  }
  if (entries.length > 0 && entries[entries.length - 1] === lo - 1)
    entries[entries.length - 1] = hi;
  else entries.push(lo, hi);
}
const categories = [...new Set(categoryAliases.values())],
  categoryIds = new Map(categories.map((name, id) => [name, id]));
const scripts = [...new Set(scriptAliases.values())],
  scriptIds = new Map(scripts.map((name, id) => [name, id]));
const categoryMap = new Uint8Array(0x110000).fill(
  categoryIds.get("Unassigned")!,
);
const scriptMap = new Uint16Array(0x110000).fill(scriptIds.get("Unknown")!);
let first = -1;
for (const row of rows("UnicodeData.txt")) {
  const point = parseInt(row[0]!, 16);
  if (row[1]!.endsWith(", First>")) {
    first = point;
    continue;
  }
  const lo = row[1]!.endsWith(", Last>") ? first : point;
  if (lo < 0) throw new Error("Unpaired UnicodeData range");
  categoryMap.fill(
    categoryIds.get(categoryAliases.get(row[2]!)!)!,
    lo,
    point + 1,
  );
  first = -1;
}
for (const row of rows("Scripts.txt")) {
  const [lo, hi] = range(row[0]!);
  scriptMap.fill(scriptIds.get(row[1]!)!, lo, hi + 1);
}
const extensions = new Map<number, readonly string[]>();
for (const row of rows("ScriptExtensions.txt")) {
  const [lo, hi] = range(row[0]!),
    names = row[1]!.split(/\s+/).map((name) => scriptAliases.get(name)!);
  if (names.some((name) => name === undefined))
    throw new Error("Unknown script alias");
  for (let point = lo; point <= hi; point++) extensions.set(point, names);
}
const categoryGroups = new Map<string, string[]>();
for (const [short, name] of categoryAliases)
  if (short.length === 2 && short !== "LC") {
    const names = [name, categoryAliases.get(short[0]!)!];
    if (["Lu", "Ll", "Lt"].includes(short)) names.push("Cased_Letter");
    categoryGroups.set(name, names);
  }
for (const name of categories) database.set("General_Category=" + name, []);
for (const name of scripts) {
  database.set("Script=" + name, []);
  database.set("Script_Extensions=" + name, []);
}
for (let point = 0; point <= 0x10ffff; point++) {
  const category = categories[categoryMap[point]!]!,
    script = scripts[scriptMap[point]!]!;
  const groups = categoryGroups.get(category);
  if (groups === undefined) throw new Error("Unknown category " + category);
  for (const name of groups) add("General_Category=" + name, point, point);
  if (category !== "Unassigned") add("Assigned", point, point);
  add("Script=" + script, point, point);
  for (const name of extensions.get(point) ?? [script])
    add("Script_Extensions=" + name, point, point);
}
for (const filename of [
  "PropList.txt",
  "DerivedCoreProperties.txt",
  "DerivedNormalizationProps.txt",
  "extracted/DerivedBinaryProperties.txt",
  "emoji/emoji-data.txt",
])
  for (const row of rows(filename))
    if (!row[2]) {
      const [lo, hi] = range(row[0]!);
      add(row[1]!, lo, hi);
    }
add("ASCII", 0, 127);
add("Any", 0, 0x10ffff);
function packed(values: number[]): string {
  const pairs: [number, number][] = [];
  for (let i = 0; i < values.length; i += 2)
    pairs.push([values[i]!, values[i + 1]!]);
  pairs.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const [lo, hi] of pairs) {
    const last = merged.at(-1);
    if (last !== undefined && lo <= last[1] + 1)
      last[1] = Math.max(last[1], hi);
    else merged.push([lo, hi]);
  }
  return merged
    .map(([lo, hi]) =>
      String.fromCharCode(
        Math.floor(lo / 65536),
        lo % 65536,
        Math.floor(hi / 65536),
        hi % 65536,
      ),
    )
    .join("");
}
const names = [...database.keys()].sort();
function literal(value: unknown): string {
  return JSON.stringify(value).replace(
    /[^\x20-\x7e]/g,
    (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"),
  );
}
writeFileSync(
  "packages/foundation/src/unicode/properties/data.ts",
  `// Generated by tools/generate-unicode-properties.ts. Unicode 17.0.0.\n// Sources: https://www.unicode.org/Public/17.0.0/ucd/\n${sources.map(([name, hash]) => `// ${name} SHA-256: ${hash}\n`).join("")}// Copyright and permission: ../LICENSE-UNICODE.txt\nexport const propertyNames:readonly string[]=${literal(names)};\nexport const propertyRanges:readonly string[]=${literal(names.map((name) => packed(database.get(name)!)))};\n`,
);
console.log("Generated " + names.length + " Unicode character properties.");
