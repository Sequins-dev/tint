import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { format } from "prettier";
import { canonicalizeLocaleId } from "../packages/js-runtime/src/objects/locale-canonicalization.ts";
import { maximizeLocaleId } from "../packages/js-runtime/src/objects/locale-likely.ts";

const archive = process.argv[2];
if (archive === undefined)
  throw new Error("Usage: node tools/generate-number-affix-data.ts CLDR49.zip");
const archiveSha256 =
  "78403d8d6fb1fed6e208bf9001bf5be00bb5abfd9f8110dae062bf49309d6a89";
const digest = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");
if (digest(readFileSync(archive)) !== archiveSha256)
  throw new Error("CLDR49 archive checksum mismatch");
const inputs: { path: string; sha256: string }[] = [];
function member(path: string): string {
  const bytes = execFileSync("/usr/bin/unzip", ["-p", archive!, path], {
    maxBuffer: 16 * 1024 * 1024,
  });
  inputs.push({ path, sha256: digest(bytes) });
  return new TextDecoder("utf-8", { fatal: true })
    .decode(bytes)
    .replace(/<!--[\s\S]*?-->/g, "");
}
function xmlText(text: string): string {
  const entities = /&(?:amp|lt|gt|quot|apos|#[0-9]+|#x[0-9A-Fa-f]+);/g;
  if (text.replace(entities, "").includes("&") || text.includes("<"))
    throw new Error("Unsupported XML text markup");
  return text.replace(entities, (entity) => {
    if (entity === "&amp;") return "&";
    if (entity === "&lt;") return "<";
    if (entity === "&gt;") return ">";
    if (entity === "&quot;") return '"';
    if (entity === "&apos;") return "'";
    const point = entity.startsWith("&#x")
      ? parseInt(entity.slice(3, -1), 16)
      : Number(entity.slice(2, -1));
    if (
      !Number.isInteger(point) ||
      point < 0 ||
      point > 0x10ffff ||
      (point >= 0xd800 && point <= 0xdfff)
    )
      throw new Error("Invalid XML character reference");
    return String.fromCodePoint(point);
  });
}
function attributes(text: string): Map<string, string> {
  return new Map(
    [...text.matchAll(/([A-Za-z][A-Za-z0-9]*)="([^"]*)"/g)].map((m) => [
      m[1]!,
      xmlText(m[2]!),
    ]),
  );
}
function tag(locale: string): string {
  if (locale === "root") return locale;
  const canonical = canonicalizeLocaleId(locale.replaceAll("_", "-"));
  if (canonical === undefined) throw new Error("Invalid CLDR locale " + locale);
  return canonical.toLowerCase();
}
function table(rows: ReadonlyMap<string, string>): string {
  return [...rows]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([a, b]) => a + "|" + b)
    .join("\n");
}
import { parseNumberAffixPattern } from "../packages/js-runtime/src/objects/number-affixes.ts";
const supplemental = member("common/supplemental/supplementalData.xml"),
  parents = new Map<string, string>();
for (const block of supplemental.matchAll(
  /<parentLocales\b([^>]*)>([\s\S]*?)<\/parentLocales>/g,
)) {
  if (attributes(block[1]!).has("component")) continue;
  for (const row of block[2]!.matchAll(/<parentLocale\b([^>]*)\/>/g)) {
    const attrs = attributes(row[1]!),
      parent = attrs.get("parent"),
      locales = attrs.get("locales");
    if (parent === undefined || locales === undefined)
      throw new Error("Unsupported number affix parent");
    for (const locale of locales.trim().split(/\s+/))
      parents.set(tag(locale), tag(parent));
  }
}
const systems: string[] = [];
for (const match of member("common/supplemental/numberingSystems.xml").matchAll(
  /<numberingSystem\b([^>]*)\/>/g,
)) {
  const attrs = attributes(match[1]!);
  if (attrs.get("type") === "numeric") {
    const id = attrs.get("id"),
      digits = attrs.get("digits");
    if (id === undefined || digits === undefined || [...digits].length !== 10)
      throw new Error("Invalid affix numbering system");
    systems.push(id);
  }
}
systems.sort();
interface RawStyle {
  readonly alias: string | undefined;
  readonly patterns: ReadonlyMap<string, string>;
}
interface RawContainer {
  readonly alias: string | undefined;
  readonly styles: ReadonlyMap<string, RawStyle>;
}
interface RawUnit {
  readonly alias: string | undefined;
  readonly patterns: ReadonlyMap<string, string>;
}
interface RawLocale {
  readonly useful: boolean;
  readonly containers: ReadonlyMap<string, RawContainer>;
  readonly unit: ReadonlyMap<string, RawUnit>;
}
const raw = new Map<string, RawLocale>();
let rawUnitPatterns = 0,
  excludedUnitVariants = 0,
  rawStandardPatterns = 0;
function containerAlias(body: string, kind: string): string | undefined {
  const match = /^\s*<alias\b([^>]*)\/>\s*$/.exec(body);
  if (match === null) return undefined;
  const attrs = attributes(match[1]!),
    alias = new RegExp(
      "^\\.\\./" + kind + "\\[@numberSystem='([a-z0-9]+)'\\]$",
    ).exec(attrs.get("path") ?? "");
  if (attrs.get("source") !== "locale" || alias === null)
    throw new Error("Unsupported affix system alias");
  return alias[1];
}
const paths = execFileSync("/usr/bin/unzip", ["-Z1", archive], {
  encoding: "utf8",
  maxBuffer: 4 * 1024 * 1024,
})
  .split("\n")
  .filter((path) => /^common\/main\/[^/]+\.xml$/.test(path))
  .sort();
for (const path of paths) {
  const text = member(path),
    locale = tag(path.slice("common/main/".length, -4)),
    numbers = /<numbers>([\s\S]*?)<\/numbers>/.exec(text)?.[1] ?? "",
    containers = new Map<string, RawContainer>(),
    unit = new Map<string, RawUnit>();
  if (/<\/identity>\s*<alias\b/.test(text))
    throw new Error("Unsupported whole-locale affix alias");
  for (const block of numbers.matchAll(
    /<(percentFormats|currencyFormats)\b([^>]*)>([\s\S]*?)<\/\1>/g,
  )) {
    const kind = block[1]!,
      system = attributes(block[2]!).get("numberSystem"),
      body = block[3]!;
    if (system === undefined) throw new Error("Missing affix numbering system");
    const alias = containerAlias(body, kind),
      styles = new Map<string, RawStyle>();
    const lengths =
      kind === "percentFormats"
        ? [
            ...body.matchAll(
              /<percentFormatLength\b([^>]*)>([\s\S]*?)<\/percentFormatLength>/g,
            ),
          ]
        : [
            ...body.matchAll(
              /<currencyFormatLength\b([^>]*)>([\s\S]*?)<\/currencyFormatLength>/g,
            ),
          ];
    for (const length of lengths) {
      if (attributes(length[1]!).has("type")) continue;
      const formats =
        kind === "percentFormats"
          ? [
              ...length[2]!.matchAll(
                /<percentFormat\b([^>]*)>([\s\S]*?)<\/percentFormat>/g,
              ),
            ]
          : [
              ...length[2]!.matchAll(
                /<currencyFormat\b([^>]*)>([\s\S]*?)<\/currencyFormat>/g,
              ),
            ];
      for (const format of formats) {
        const type =
          kind === "percentFormats"
            ? "percent"
            : attributes(format[1]!).get("type");
        if (type !== "percent" && type !== "standard" && type !== "accounting")
          throw new Error("Unsupported affix style");
        const patternRows = new Map<string, string>();
        let styleAlias: string | undefined;
        const inner = /^\s*<alias\b([^>]*)\/>\s*$/.exec(format[2]!);
        if (inner !== null) {
          const attrs = attributes(inner[1]!),
            target =
              /^\.\.\/currencyFormat\[@type='(standard|accounting)'\]$/.exec(
                attrs.get("path") ?? "",
              );
          if (
            kind !== "currencyFormats" ||
            attrs.get("source") !== "locale" ||
            target === null
          )
            throw new Error("Unsupported accounting alias");
          styleAlias = target[1];
        }
        for (const pattern of format[2]!.matchAll(
          /<pattern\b([^>]*)>([^<]*)<\/pattern>/g,
        )) {
          const attrs = attributes(pattern[1]!);
          if (attrs.has("case") || attrs.has("gender")) continue;
          if (attrs.has("type") || attrs.has("count"))
            throw new Error(
              "Unexpected compact affix pattern in standard length",
            );
          const alt = attrs.get("alt") ?? "";
          if (alt !== "" && alt !== "alphaNextToNumber" && alt !== "noCurrency")
            throw new Error("Unsupported affix alternate");
          const value = xmlText(pattern[2]!);
          if (value === "↑↑↑") continue;
          if (parseNumberAffixPattern(value) === undefined)
            throw new Error(
              "Unsupported affix numeric pattern: " + locale + ":" + value,
            );
          patternRows.set(alt, value);
          rawStandardPatterns++;
        }
        styles.set(type, { alias: styleAlias, patterns: patternRows });
      }
    }
    containers.set(kind + ":" + system, { alias, styles });
  }
  const units = /<units>([\s\S]*?)<\/units>/.exec(text)?.[1] ?? "";
  for (const length of units.matchAll(
    /<unitLength\b([^>]*)>([\s\S]*?)<\/unitLength>/g,
  )) {
    const width = attributes(length[1]!).get("type");
    if (width !== "long" && width !== "short" && width !== "narrow") continue;
    const rows = new Map<string, string>();
    let alias: string | undefined;
    const top = /^\s*<alias\b([^>]*)\/>\s*$/.exec(length[2]!);
    if (top !== null) {
      const attrs = attributes(top[1]!),
        target = /^\.\.\/unitLength\[@type='(long|short|narrow)'\]$/.exec(
          attrs.get("path") ?? "",
        );
      if (attrs.get("source") !== "locale" || target === null)
        throw new Error("Unsupported percent unit width alias");
      alias = target[1];
    }
    for (const entry of length[2]!.matchAll(
      /<unit\b([^>]*)>([\s\S]*?)<\/unit>/g,
    )) {
      if (attributes(entry[1]!).get("type") !== "concentr-percent") continue;
      if (/<alias\b/.test(entry[2]!))
        throw new Error("Unsupported percent unit alias");
      for (const pattern of entry[2]!.matchAll(
        /<unitPattern\b([^>]*)>([^<]*)<\/unitPattern>/g,
      )) {
        const patternAttrs = attributes(pattern[1]!);
        if (
          patternAttrs.has("case") ||
          patternAttrs.has("gender") ||
          patternAttrs.has("alt")
        ) {
          excludedUnitVariants++;
          continue;
        }
        const count = patternAttrs.get("count"),
          value = xmlText(pattern[2]!);
        if (
          count === undefined ||
          !["zero", "one", "two", "few", "many", "other"].includes(count)
        )
          throw new Error("Unknown percent unit plural category");
        if (value === "↑↑↑") continue;
        if (
          value.split("{0}").length > 2 ||
          value.replace("{0}", "").includes("{") ||
          value.replace("{0}", "").includes("}")
        )
          throw new Error("Unsupported percent unit interpolation");
        rows.set(count, value);
        rawUnitPatterns++;
      }
    }
    unit.set(width, { alias, patterns: rows });
  }
  if (raw.has(locale)) throw new Error("Duplicate affix locale");
  raw.set(locale, {
    containers,
    unit,
    useful:
      /<(symbols|decimalFormats|defaultNumberingSystem|minimumGroupingDigits)\b/.test(
        numbers,
      ),
  });
}
function chain(locale: string): string[] {
  const result: string[] = [],
    seen = new Set<string>();
  for (
    let current = locale;
    ;
    current =
      parents.get(current) ??
      (current.includes("-")
        ? current.slice(0, current.lastIndexOf("-"))
        : "root")
  ) {
    if (seen.has(current)) throw new Error("Affix parent cycle");
    seen.add(current);
    result.push(current);
    if (current === "root") return result;
  }
}
const cache = new Map<string, string>();
function resolve(
  locale: string,
  kind: string,
  system: string,
  style: string,
  alt: string,
  seen: ReadonlySet<string> = new Set(),
): string | undefined {
  const key = [locale, kind, system, style, alt].join(":"),
    cached = cache.get(key);
  if (cached !== undefined) return cached;
  if (seen.has(key)) throw new Error("Affix alias cycle");
  for (const ancestor of chain(locale)) {
    const container = raw.get(ancestor)?.containers.get(kind + ":" + system);
    if (container === undefined) continue;
    const record = container.styles.get(style),
      value = record?.patterns.get(alt);
    if (value !== undefined) {
      cache.set(key, value);
      return value;
    }
    if (record?.alias !== undefined) {
      const result = resolve(
        locale,
        kind,
        system,
        record.alias,
        alt,
        new Set([...seen, key]),
      );
      if (result !== undefined) cache.set(key, result);
      return result;
    }
    if (container.alias !== undefined) {
      const result = resolve(
        locale,
        kind,
        container.alias,
        style,
        alt,
        new Set([...seen, key]),
      );
      if (result !== undefined) cache.set(key, result);
      return result;
    }
  }
  return undefined;
}
const unitCache = new Map<string, string>();
function resolveUnit(
  locale: string,
  width: string,
  category: string,
  seen: ReadonlySet<string> = new Set(),
): string | undefined {
  const key = locale + ":" + width + ":" + category,
    cached = unitCache.get(key);
  if (cached !== undefined) return cached;
  if (seen.has(key)) throw new Error("Percent unit alias cycle");
  for (const ancestor of chain(locale)) {
    const record = raw.get(ancestor)?.unit.get(width),
      value = record?.patterns.get(category);
    if (value !== undefined) {
      unitCache.set(key, value);
      return value;
    }
    if (record?.alias !== undefined) {
      const result = resolveUnit(
        locale,
        record.alias,
        category,
        new Set([...seen, key]),
      );
      if (result !== undefined) unitCache.set(key, result);
      return result;
    }
  }
  return undefined;
}
function safe(value: string): string {
  if (/[\r\n|]/.test(value))
    throw new Error("Unsupported affix table delimiter");
  return value;
}
function intern(
  list: string[],
  ids: Map<string, number>,
  value: string,
): string {
  let id = ids.get(value);
  if (id === undefined) {
    id = list.length;
    list.push(value);
    ids.set(value, id);
  }
  return String(id);
}
const patternList: string[] = [],
  patternIds = new Map<string, number>(),
  profiles: string[] = [],
  profileIds = new Map<string, number>(),
  bindings: string[] = [],
  bindingIds = new Map<string, number>(),
  unitPatternList: string[] = [],
  unitPatternIds = new Map<string, number>(),
  unitProfiles: string[] = [],
  unitProfileIds = new Map<string, number>(),
  locales = new Map<string, string>();
let pairs = 0,
  resolvedPatterns = 0;
const categories = ["zero", "one", "two", "few", "many", "other"];
for (const locale of [...raw.keys()].sort()) {
  const mapping: string[] = [];
  for (const system of systems) {
    const values = [
      resolve(locale, "percentFormats", system, "percent", ""),
      resolve(locale, "currencyFormats", system, "standard", ""),
      resolve(locale, "currencyFormats", system, "accounting", ""),
      resolve(
        locale,
        "currencyFormats",
        system,
        "standard",
        "alphaNextToNumber",
      ),
      resolve(
        locale,
        "currencyFormats",
        system,
        "accounting",
        "alphaNextToNumber",
      ),
    ];
    if (
      values[0] === undefined ||
      values[1] === undefined ||
      values[2] === undefined
    )
      throw new Error("Missing mandatory number affix profile");
    const ids = values.map((value) => {
      if (value === undefined) return "-";
      if (parseNumberAffixPattern(value) === undefined)
        throw new Error("Unparseable resolved number affix");
      resolvedPatterns++;
      return intern(patternList, patternIds, safe(value));
    });
    mapping.push(system + "," + intern(profiles, profileIds, ids.join(",")));
    pairs++;
  }
  const unitIds: string[] = [];
  for (const width of ["long", "short", "narrow"])
    for (const category of categories) {
      const value =
        resolveUnit(locale, width, category) ??
        resolveUnit(locale, width, "other");
      if (value === undefined)
        throw new Error(
          "Missing resolved percent unit pattern: " +
            locale +
            ":" +
            width +
            ":" +
            category,
        );
      unitIds.push(intern(unitPatternList, unitPatternIds, safe(value)));
    }
  locales.set(
    locale,
    intern(bindings, bindingIds, mapping.join(";")) +
      "," +
      intern(unitProfiles, unitProfileIds, unitIds.join(",")),
  );
}
const available = new Map(
    [...locales].filter(
      ([locale]) =>
        locale !== "root" &&
        chain(locale).some((k) => k !== "root" && raw.get(k)?.useful),
    ),
  ),
  directLocales = available.size,
  aliases: { locale: string; source: string }[] = [];
function addAlias(locale: string, source: string): void {
  if (available.has(locale)) return;
  let preferred = maximizeLocaleId(locale)?.toLowerCase() ?? locale;
  while (!available.has(preferred) && preferred.includes("-"))
    preferred = preferred.slice(0, preferred.lastIndexOf("-"));
  const owner = available.has(preferred) ? preferred : source,
    value = available.get(owner);
  if (value === undefined) throw new Error("Missing number affix alias source");
  available.set(locale, value);
  aliases.push({ locale, source: owner });
}
for (const locale of [...available.keys()]) {
  const fields = locale.split("-");
  if (
    fields.length >= 3 &&
    fields[1]!.length === 4 &&
    (fields[2]!.length === 2 || fields[2]!.length === 3)
  )
    addAlias([fields[0], ...fields.slice(2)].join("-"), locale);
  if (fields.length > 1) addAlias(fields[0]!, locale);
}
const fractions = new Map<string, string>();
for (const match of /<fractions>([\s\S]*?)<\/fractions>/
  .exec(supplemental)?.[1]
  ?.matchAll(/<info\b([^>]*)\/>/g) ?? []) {
  const attrs = attributes(match[1]!),
    code = attrs.get("iso4217"),
    digits = attrs.get("digits"),
    rounding = attrs.get("rounding");
  if (code === undefined || digits === undefined || rounding === undefined)
    throw new Error("Invalid currency fraction metadata");
  for (const value of [
    digits,
    rounding,
    attrs.get("cashDigits"),
    attrs.get("cashRounding"),
  ])
    if (value !== undefined && !/^[0-9]+$/.test(value))
      throw new Error("Unsupported currency fraction value");
  fractions.set(
    code,
    [
      digits,
      rounding,
      attrs.get("cashDigits") ?? "",
      attrs.get("cashRounding") ?? "",
    ].join(","),
  );
}
if (
  raw.size !== 929 ||
  systems.length !== 78 ||
  pairs !== 72462 ||
  profiles.length !== 69 ||
  directLocales !== 814 ||
  available.size !== 860 ||
  rawUnitPatterns !== 382 ||
  fractions.size !== 76 ||
  parents.size !== 198 ||
  available.has("zxx")
)
  throw new Error("Unexpected CLDR49 number affix population");
const sourcePath = "packages/js-runtime/src/objects/number-affix-data.ts",
  tables = [
    [
      "numberAffixPatterns",
      table(new Map(patternList.map((value, id) => [String(id), value]))),
    ],
    [
      "numberAffixProfiles",
      table(new Map(profiles.map((value, id) => [String(id), value]))),
    ],
    [
      "numberAffixBindings",
      table(new Map(bindings.map((value, id) => [String(id), value]))),
    ],
    ["numberAffixLocaleRows", table(available)],
    [
      "percentUnitPatterns",
      table(new Map(unitPatternList.map((value, id) => [String(id), value]))),
    ],
    [
      "percentUnitProfiles",
      table(new Map(unitProfiles.map((value, id) => [String(id), value]))),
    ],
    ["currencyFractions", table(fractions)],
  ];
const output = await format(
  "// Generated by tools/generate-number-affix-data.ts; do not edit.\n// CLDR49, Unicode-3.0; see ../../LICENSE-CLDR.txt.\n// https://unicode.org/Public/cldr/49/core.zip\n// Archive SHA256: " +
    archiveSha256 +
    "\n// All pinned draft grades retained. Currency cash metadata is distinct from ordinary digits.\n" +
    tables
      .map(
        ([name, value]) =>
          "export const " + name + " = " + JSON.stringify(value) + ";\n",
      )
      .join(""),
  { parser: "typescript" },
);
writeFileSync(sourcePath, output);
const manifest = {
  kind: "cldr-number-affix-data",
  version: "49",
  archive: {
    url: "https://unicode.org/Public/cldr/49/core.zip",
    sha256: archiveSha256,
  },
  license: "LICENSE-CLDR.txt",
  inputs,
  policy: {
    availability:
      "Mirror numeric-service main locales and structural alias owners; all 78 numeric systems have complete percent/standard/accounting patterns.",
    grades: "All pinned CLDR draft grades retained.",
    units:
      "Genuine unmarked concentr-percent patterns; grammatical case/gender/alt variants excluded, general parent inheritance and requested-locale width aliases; missing categories fall back to other.",
    currency:
      "Ordinary digits and cash metadata retained separately; localized currency symbols/names are not implemented by this dataset.",
  },
  counts: {
    mainLocales: raw.size,
    numericSystems: systems.length,
    localeSystemPairs: pairs,
    profiles: profiles.length,
    patterns: patternList.length,
    bindingMaps: bindings.length,
    directLocales,
    structuralAliases: aliases.length,
    availableLocales: available.size,
    parentOverrides: parents.size,
    rawStandardPatterns,
    resolvedPatterns,
    rawPercentUnitPatterns: rawUnitPatterns,
    excludedUnitVariants,
    unitPatterns: unitPatternList.length,
    unitProfiles: unitProfiles.length,
    currencyFractionRecords: fractions.size,
  },
  aliases,
  output: {
    path: sourcePath,
    sha256: digest(new TextEncoder().encode(output)),
  },
};
writeFileSync(
  "packages/js-runtime/number-affix-data-manifest.json",
  JSON.stringify(manifest, null, 2) + "\n",
);
process.stdout.write(JSON.stringify(manifest.counts, null, 2) + "\n");
