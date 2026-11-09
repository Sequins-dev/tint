import { format } from "prettier";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import {
  parseCldrElements,
  cldrPath,
  createCldrLocaleResolver,
  attributes,
  type CldrElement,
  type CldrPathStep,
} from "./cldr-xml.ts";
import { maximizeLocaleId } from "../packages/js-runtime/src/objects/locale-likely.ts";
import { numberFormatLocaleRows } from "../packages/js-runtime/src/objects/number-format-data.ts";
import { numberFormatLocaleData } from "../packages/js-runtime/src/objects/number-format-profile.ts";

/** Currency long names (display name and plural forms) and currency unit
 * patterns for currencyDisplay "name", from the pinned CLDR 49 archive. Each
 * locale row keeps only its own names and its CLDR parent, so the runtime
 * applies CLDR's per-path inheritance by walking parents.
 * Usage: node tools/generate-currency-name-data.ts CLDR49.zip */
const archive = process.argv[2];
if (archive === undefined)
  throw Error("usage: node tools/generate-currency-name-data.ts CLDR49.zip");
const archiveSha256 =
    "78403d8d6fb1fed6e208bf9001bf5be00bb5abfd9f8110dae062bf49309d6a89",
  hash = (bytes: Uint8Array) =>
    createHash("sha256").update(bytes).digest("hex");
if (hash(readFileSync(archive)) !== archiveSha256)
  throw Error("archive checksum");
const inputs: { path: string; sha256: string }[] = [];
function member(path: string): string {
  const bytes = execFileSync("/usr/bin/unzip", ["-p", archive!, path], {
    maxBuffer: 16000000,
  });
  inputs.push({ path, sha256: hash(bytes) });
  return new TextDecoder("utf8", { fatal: true }).decode(bytes);
}
const parents = new Map<string, string>();
for (const block of member("common/supplemental/supplementalData.xml").matchAll(
  /<parentLocales\b([^>]*)>([\s\S]*?)<\/parentLocales>/g,
)) {
  if (attributes(block[1]!).has("component")) continue;
  for (const row of block[2]!.matchAll(/<parentLocale\b([^>]+)\/>/g)) {
    const a = attributes(row[1]!);
    for (const locale of a.get("locales")!.trim().split(/\s+/))
      parents.set(
        locale.replaceAll("_", "-").toLowerCase(),
        a.get("parent")!.replaceAll("_", "-").toLowerCase(),
      );
  }
}
const parent = (locale: string): string | undefined =>
    parents.get(locale) ??
    (locale.includes("-")
      ? locale.slice(0, locale.lastIndexOf("-"))
      : locale === "root"
        ? undefined
        : "root"),
  paths = execFileSync("/usr/bin/unzip", ["-Z1", archive], {
    encoding: "utf8",
    maxBuffer: 4000000,
  })
    .split("\n")
    .filter((p) => /^common\/main\/[^/]+\.xml$/.test(p))
    .sort(),
  trees = new Map<string, CldrElement>(),
  currencyBlocks = new Map<string, string>();
for (let index = 0; index < paths.length; index++) {
  const path = paths[index]!,
    text = member(path),
    numbers = /<numbers>([\s\S]*?)<\/numbers>/.exec(text)?.[0] ?? "";
  currencyBlocks.set(
    path.slice(12, -4).replaceAll("_", "-").toLowerCase(),
    /<currencies>([\s\S]*?)<\/currencies>/.exec(text)?.[1] ?? "",
  );
  trees.set(
    path.slice(12, -4).replaceAll("_", "-").toLowerCase(),
    parseCldrElements("<ldml>" + numbers + "</ldml>"),
  );
  if (index % 100 === 0)
    console.error(new Date().toISOString(), "loaded number trees", index + 1);
}
/** Rows such as "zh-tw" have no CLDR file of their own: like the NumberFormat
 * generator, read them from the likely-subtags maximized locale's data. */
function dataLocale(locale: string): string {
  if (trees.has(locale)) return locale;
  let preferred = maximizeLocaleId(locale)?.toLowerCase() ?? locale;
  while (!trees.has(preferred) && preferred.includes("-"))
    preferred = preferred.slice(0, preferred.lastIndexOf("-"));
  return trees.has(preferred) ? preferred : locale;
}
const resolver = createCldrLocaleResolver(trees, parent),
  pathCache = new Map<string, CldrPathStep[]>();
function get(locale: string, path: string): string | undefined {
  let parsed = pathCache.get(path);
  if (parsed === undefined) {
    parsed = cldrPath(path);
    pathCache.set(path, parsed);
  }
  return resolver.value(dataLocale(locale), parsed);
}
type Pool = "strings" | "fields" | "profiles";
const pools: Record<Pool, string[]> = { strings: [], fields: [], profiles: [] },
  ids: Record<Pool, Map<string, string>> = {
    strings: new Map(),
    fields: new Map(),
    profiles: new Map(),
  };
function intern(pool: Pool, value: string): string {
  let id = ids[pool].get(value);
  if (id === undefined) {
    if (/[\n\r|]/.test(value) && pool === "strings")
      throw Error("Unexpected separator in pattern " + JSON.stringify(value));
    id = String(pools[pool].length);
    pools[pool].push(value);
    ids[pool].set(value, id);
  }
  return id;
}
function packed(entries: Map<string, string>): string {
  return intern(
    "fields",
    [...entries]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, value]) => key + ":" + intern("strings", value))
      .join(","),
  );
}
function table(entries: readonly (readonly [string, string])[]): string {
  return [...entries]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => key + "|" + value)
    .join("\n");
}
const keys: [string, string][] = [
  ["", "d"],
  ["zero", "z"],
  ["one", "o"],
  ["two", "t"],
  ["few", "f"],
  ["many", "m"],
  ["other", "x"],
];
/** A locale file's own currency names: "CODE/key=string,...". */
function ownNames(locale: string): string {
  const block = currencyBlocks.get(locale) ?? "";
  if (block.includes("<alias"))
    throw Error("Unexpected currency alias " + locale);
  const entries: string[] = [];
  for (const currency of block.matchAll(
    /<currency type="([A-Z]{3})">([\s\S]*?)<\/currency>/g,
  )) {
    let entry = currency[1]!;
    for (const name of currency[2]!.matchAll(
      /<displayName(?: count="(\w+)")?>([^<]*)<\/displayName>/g,
    )) {
      const key = keys.find(([count]) => count === (name[1] ?? ""));
      if (key === undefined) throw Error("Unknown currency count " + name[1]);
      const text = name[2]!
        .replaceAll("&amp;", "&")
        .replaceAll("&lt;", "<")
        .replaceAll("&gt;", ">")
        .replaceAll("&apos;", "'")
        .replaceAll("&quot;", '"');
      if (text === "" || text === "↑↑↑")
        throw Error("Unexpected currency placeholder " + locale + entry);
      entry += "/" + key[1] + "=" + intern("strings", text);
    }
    if (entry.length > 3) entries.push(entry);
  }
  return intern("fields", entries.sort().join(","));
}
const categories = ["zero", "one", "two", "few", "many", "other"];
const rows = new Map<string, string>();
function addRow(locale: string): void {
  if (rows.has(locale)) return;
  const owner = dataLocale(locale);
  const up = owner !== locale ? owner : parent(locale);
  rows.set(locale, (up ?? "") + ";" + ownNames(locale));
  if (up !== undefined) addRow(up);
}
const patternBindings: [string, string][] = [];
let completed = 0;
for (const row of numberFormatLocaleRows.split("\n")) {
  const locale = row.slice(0, row.indexOf("|")),
    numeric = numberFormatLocaleData(locale);
  if (numeric === undefined) throw Error("Missing numeric locale " + locale);
  addRow(locale);
  const systemPatterns = new Map<string, string>();
  // Numbering systems without their own currency unit patterns use latn's,
  // as for other numbering-system-specific number data.
  const systems = [
    "latn",
    ...numeric.numberingSystems.filter((system) => system !== "latn"),
  ];
  for (const system of systems) {
    const values = new Map<string, string>();
    for (const category of categories) {
      const value = get(
        locale,
        `numbers/currencyFormats[@numberSystem='${system}']/unitPattern[@count='${category}']`,
      );
      if (value === undefined || value === "") continue;
      if (value.split("{0}").length !== 2 || value.split("{1}").length !== 2)
        throw Error("Invalid currency unit pattern " + locale + value);
      values.set(category, value);
    }
    if (values.size === 0 && system !== "latn") {
      const latn = systemPatterns.get("latn");
      if (latn === undefined) throw Error("Missing latn fallback " + locale);
      systemPatterns.set(system, latn);
      continue;
    }
    if (!values.has("other"))
      throw Error("Missing currency unit pattern " + locale + system);
    systemPatterns.set(system, packed(values));
  }
  const base = systemPatterns.get("latn");
  if (base === undefined)
    throw Error("Missing latn currency patterns " + locale);
  const exceptions = [...systemPatterns]
    .filter(([, id]) => id !== base)
    .map(([system, id]) => system + ":" + id)
    .sort();
  patternBindings.push([
    locale,
    exceptions.length === 0 ? base : base + ";" + exceptions.join(","),
  ]);
  resolver.clear();
  if (++completed % 100 === 0)
    console.error(
      new Date().toISOString(),
      "resolved currency names",
      completed,
      "rows",
      rows.size,
      "strings",
      pools.strings.length,
    );
}
const output = "packages/js-runtime/src/objects/currency-name-data.ts",
  source = await format(
    "// Generated by tools/generate-currency-name-data.ts; do not edit.\n// CLDR49, Unicode-3.0; see ../../LICENSE-CLDR.txt.\n" +
      [
        ["currencyNameLocaleRows", table([...rows])],
        ["currencyUnitPatternRows", table(patternBindings)],
        [
          "currencyNameFields",
          table(pools.fields.map((v, i) => [String(i), v] as const)),
        ],
        [
          "currencyNameStrings",
          table(pools.strings.map((v, i) => [String(i), v] as const)),
        ],
      ]
        .map(
          ([name, value]) =>
            "export const " + name + " = " + JSON.stringify(value) + ";\n",
        )
        .join(""),
    { parser: "typescript" },
  );
writeFileSync(output, source);
writeFileSync(
  "packages/js-runtime/currency-name-data-manifest.json",
  await format(
    JSON.stringify({
      source: "https://unicode.org/Public/cldr/49/core.zip",
      archiveSha256,
      inputs,
      locales: completed,
      rows: rows.size,
      strings: pools.strings.length,
      fields: pools.fields.length,
      output,
      sha256: hash(new TextEncoder().encode(source)),
      policy:
        "Own (non-inherited) currency display names and plural names per locale with CLDR parent links for per-path inheritance; resolved currency unit patterns per locale and numbering system; no host Intl",
    }),
    { parser: "json" },
  ),
);
console.log(
  JSON.stringify({
    locales: completed,
    rows: rows.size,
    strings: pools.strings.length,
    fields: pools.fields.length,
  }),
);
