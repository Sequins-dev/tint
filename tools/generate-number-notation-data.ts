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
import { numberFormatLocaleRows } from "../packages/js-runtime/src/objects/number-format-data.ts";
import { numberFormatLocaleData } from "../packages/js-runtime/src/objects/number-format-profile.ts";

/** Compact decimal (short and long) and compact currency (short) patterns for
 * every NumberFormat locale and numbering system, from the pinned CLDR 49
 * archive. Usage: node tools/generate-number-notation-data.ts CLDR49.zip */
const archive = process.argv[2];
if (archive === undefined)
  throw Error("usage: node tools/generate-number-notation-data.ts CLDR49.zip");
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
  trees = new Map<string, CldrElement>();
for (let index = 0; index < paths.length; index++) {
  const path = paths[index]!,
    text = member(path),
    numbers = /<numbers>([\s\S]*?)<\/numbers>/.exec(text)?.[0] ?? "";
  trees.set(
    path.slice(12, -4).replaceAll("_", "-").toLowerCase(),
    parseCldrElements("<ldml>" + numbers + "</ldml>"),
  );
  if (index % 100 === 0)
    console.error(new Date().toISOString(), "loaded number trees", index + 1);
}
const resolver = createCldrLocaleResolver(trees, parent),
  pathCache = new Map<string, CldrPathStep[]>();
function get(locale: string, path: string): string | undefined {
  let parsed = pathCache.get(path);
  if (parsed === undefined) {
    parsed = cldrPath(path);
    pathCache.set(path, parsed);
  }
  return resolver.value(locale, parsed);
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
    if (/[\n\r|,]/.test(value) && pool === "strings")
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
const categories = ["zero", "one", "two", "few", "many", "other"],
  magnitudes: number[] = [];
for (let magnitude = 3; magnitude <= 14; magnitude++)
  magnitudes.push(magnitude);
/** Validate a compact pattern: a positive subpattern and an optional negative
 * subpattern, each with exactly one run of '0' digits (the bare "0" means no
 * compaction); a negative subpattern must contain one '-' sign. */
function validPattern(locale: string, value: string, category: string): string {
  const subpatterns = value.split(";");
  if (subpatterns.length > 2)
    throw Error("Invalid compact subpatterns " + locale + value);
  for (const subpattern of subpatterns) {
    const unquoted = subpattern.replace(/'[^']*'/g, "");
    const runs = unquoted.match(/0+/g) ?? [];
    // Non-"other" plural forms may omit the number (Italian "mille" for 1000).
    if (runs.length > 1 || (runs.length === 0 && category === "other"))
      throw Error("Invalid compact pattern " + locale + value);
  }
  const negative = subpatterns[1];
  if (
    negative !== undefined &&
    (negative.replace(/'[^']*'/g, "").match(/-/g) ?? []).length !== 1
  )
    throw Error("Invalid compact negative subpattern " + locale + value);
  return value;
}
const bindings: [string, string][] = [];
let completed = 0;
for (const row of numberFormatLocaleRows.split("\n")) {
  const locale = row.slice(0, row.indexOf("|")),
    numeric = numberFormatLocaleData(locale);
  if (numeric === undefined) throw Error("Missing numeric locale " + locale);
  const systemProfiles = new Map<string, string>();
  for (const system of numeric.numberingSystems) {
    const groups: string[] = [];
    for (const [kind, length] of [
      ["decimalFormats", "short"],
      ["decimalFormats", "long"],
      ["currencyFormats", "short"],
    ] as const) {
      const values = new Map<string, string>();
      // CLDR writes <decimalFormat> without a type but <currencyFormat
      // type="standard">; selectors must match each element's attributes.
      const element =
        kind === "decimalFormats"
          ? "decimalFormat"
          : "currencyFormat[@type='standard']";
      for (const magnitude of magnitudes)
        for (const category of categories) {
          const value = get(
            locale,
            `numbers/${kind}[@numberSystem='${system}']/${kind.slice(0, -1)}Length[@type='${length}']/${element}/pattern[@type='${10 ** magnitude}'][@count='${category}']`,
          );
          if (value !== undefined && value !== "")
            values.set(
              magnitude + "." + category,
              validPattern(locale, value, category),
            );
        }
      // A magnitude present for any category must provide "other".
      for (const magnitude of magnitudes)
        if (
          categories.some((c) => values.has(magnitude + "." + c)) &&
          !values.has(magnitude + ".other")
        )
          throw Error("Missing other compact pattern " + locale + magnitude);
      groups.push(packed(values));
    }
    systemProfiles.set(system, intern("profiles", groups.join(",")));
  }
  // One row per locale: the Latin-digit profile, then only numbering systems
  // whose resolved patterns differ from it ("system:profile" exceptions).
  const base =
    systemProfiles.get("latn") ??
    systemProfiles.get(numeric.defaultNumberingSystem);
  if (base === undefined) throw Error("Missing base compact profile " + locale);
  const exceptions = [...systemProfiles]
    .filter(([, id]) => id !== base)
    .map(([system, id]) => system + ":" + id)
    .sort();
  bindings.push([
    locale,
    exceptions.length === 0 ? base : base + ";" + exceptions.join(","),
  ]);
  resolver.clear();
  if (++completed % 100 === 0)
    console.error(
      new Date().toISOString(),
      "resolved compact profiles",
      completed,
      "unique",
      pools.profiles.length,
      "strings",
      pools.strings.length,
    );
}
const output = "packages/js-runtime/src/objects/number-notation-data.ts",
  source = await format(
    "// Generated by tools/generate-number-notation-data.ts; do not edit.\n// CLDR49, Unicode-3.0; see ../../LICENSE-CLDR.txt.\n" +
      [
        ["numberNotationLocaleRows", table(bindings)],
        [
          "numberNotationProfiles",
          table(pools.profiles.map((v, i) => [String(i), v] as const)),
        ],
        [
          "numberNotationFields",
          table(pools.fields.map((v, i) => [String(i), v] as const)),
        ],
        [
          "numberNotationStrings",
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
  "packages/js-runtime/number-notation-data-manifest.json",
  await format(
    JSON.stringify({
      source: "https://unicode.org/Public/cldr/49/core.zip",
      archiveSha256,
      inputs,
      locales: completed,
      groups: ["decimal-short", "decimal-long", "currency-short"],
      magnitudes,
      categories,
      strings: pools.strings.length,
      fields: pools.fields.length,
      profiles: pools.profiles.length,
      output,
      sha256: hash(new TextEncoder().encode(source)),
      policy:
        "Complete default compact decimal (short/long) and compact currency (short) patterns per locale and numbering system with CLDR inheritance and aliases; no host Intl",
    }),
    { parser: "json" },
  ),
);
console.log(
  JSON.stringify({
    locales: completed,
    bindings: bindings.length,
    strings: pools.strings.length,
    fields: pools.fields.length,
    profiles: pools.profiles.length,
  }),
);
