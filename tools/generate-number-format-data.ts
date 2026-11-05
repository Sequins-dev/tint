import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { format } from "prettier";
import { canonicalizeLocaleId } from "../packages/js-runtime/src/objects/locale-canonicalization.ts";
import { maximizeLocaleId } from "../packages/js-runtime/src/objects/locale-likely.ts";

const archive = process.argv[2];
if (archive === undefined)
  throw new Error(
    "Usage: node tools/generate-number-format-data.ts CLDR49.zip",
  );
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
    [...text.matchAll(/([A-Za-z]+)="([^"]*)"/g)].map((m) => [
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
const symbolNames = [
  "decimal",
  "group",
  "percentSign",
  "plusSign",
  "minusSign",
  "exponential",
  "infinity",
  "nan",
  "approximatelySign",
  "currencyDecimal",
  "currencyGroup",
] as const;
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
      throw new Error("Unsupported parent locale declaration");
    for (const locale of locales.trim().split(/\s+/))
      parents.set(tag(locale), tag(parent));
  }
}
const digits = new Map<string, string>();
let algorithmic = 0;
for (const row of member("common/supplemental/numberingSystems.xml").matchAll(
  /<numberingSystem\b([^>]*)\/>/g,
)) {
  const attrs = attributes(row[1]!),
    type = attrs.get("type"),
    id = attrs.get("id");
  if (id === undefined) throw new Error("Missing numbering system ID");
  if (type === "algorithmic") {
    algorithmic++;
    continue;
  }
  const text = attrs.get("digits");
  if (
    type !== "numeric" ||
    text === undefined ||
    [...text].length !== 10 ||
    new Set([...text]).size !== 10
  )
    throw new Error("Invalid decimal digit mapping");
  digits.set(id, text);
}
interface RawContainer {
  readonly alias: string | undefined;
  readonly values: ReadonlyMap<string, string>;
}
interface RawNumberLocale {
  readonly defaultNu: string | undefined;
  readonly minimum: string | undefined;
  readonly containers: ReadonlyMap<string, RawContainer>;
  readonly useful: boolean;
}
const raw = new Map<string, RawNumberLocale>(),
  draftGrades = new Map<string, number>();
function observeGrade(attrs: ReadonlyMap<string, string>): void {
  const grade = attrs.get("draft") ?? "approved";
  draftGrades.set(grade, (draftGrades.get(grade) ?? 0) + 1);
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
    body = /<numbers>([\s\S]*?)<\/numbers>/.exec(text)?.[1] ?? "";
  if (/<\/identity>\s*<alias\b/.test(text))
    throw new Error("Unsupported whole-locale alias: " + locale);
  let defaultNu: string | undefined, minimum: string | undefined;
  const containers = new Map<string, RawContainer>();
  for (const match of body.matchAll(
    /<(defaultNumberingSystem|minimumGroupingDigits)\b([^>]*)>([^<]*)<\/\1>/g,
  )) {
    const attrs = attributes(match[2]!);
    if (attrs.has("alt")) continue;
    observeGrade(attrs);
    const value = xmlText(match[3]!);
    if (value === "↑↑↑") continue;
    if (match[1] === "defaultNumberingSystem") defaultNu = value;
    else minimum = value;
  }
  for (const match of body.matchAll(
    /<(symbols|decimalFormats)\b([^>]*)>([\s\S]*?)<\/\1>/g,
  )) {
    const kind = match[1]!,
      attrs = attributes(match[2]!),
      system = attrs.get("numberSystem"),
      inside = match[3]!;
    if (system === undefined)
      throw new Error("Missing numeric container system");
    const values = new Map<string, string>();
    let alias: string | undefined;
    const leading = /^\s*<alias\b([^>]*)\/>\s*$/.exec(inside);
    if (leading !== null) {
      const attrs = attributes(leading[1]!),
        parsed = new RegExp(
          "^\\.\\./" + kind + "\\[@numberSystem='([a-z0-9]+)'\\]$",
        ).exec(attrs.get("path") ?? "");
      if (attrs.get("source") !== "locale" || parsed === null)
        throw new Error("Unsupported numeric container alias");
      alias = parsed[1];
    } else if (kind === "symbols") {
      for (const field of inside.matchAll(
        /<([A-Za-z]+)\b([^>]*)>([^<]*)<\/\1>/g,
      )) {
        const attrs = attributes(field[2]!);
        if (attrs.has("alt")) continue;
        observeGrade(attrs);
        const value = xmlText(field[3]!);
        if (value !== "↑↑↑") values.set(field[1]!, value);
      }
    } else {
      // Standard decimal length is untyped; the first sparse length can instead
      // be compact long/short and must never supply the ordinary pattern.
      for (const length of inside.matchAll(
        /<decimalFormatLength\b([^>]*)>([\s\S]*?)<\/decimalFormatLength>/g,
      )) {
        if (attributes(length[1]!).has("type")) continue;
        for (const pattern of length[2]!.matchAll(
          /<pattern\b([^>]*)>([^<]*)<\/pattern>/g,
        )) {
          const attrs = attributes(pattern[1]!);
          if (attrs.has("alt") || attrs.has("type") || attrs.has("count"))
            continue;
          observeGrade(attrs);
          const value = xmlText(pattern[2]!);
          if (value !== "↑↑↑") values.set("pattern", value);
        }
      }
    }
    containers.set(kind + ":" + system, { alias, values });
  }
  if (raw.has(locale)) throw new Error("Duplicate canonical numeric locale");
  raw.set(locale, {
    defaultNu,
    minimum,
    containers,
    useful:
      /<(symbols|decimalFormats|defaultNumberingSystem|minimumGroupingDigits)\b/.test(
        body,
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
    if (seen.has(current)) throw new Error("Numeric parent cycle");
    seen.add(current);
    result.push(current);
    if (current === "root") return result;
  }
}
function scalar(locale: string, field: "defaultNu" | "minimum"): string {
  for (const ancestor of chain(locale)) {
    const value = raw.get(ancestor)?.[field];
    if (value !== undefined) return value;
  }
  throw new Error("Missing numeric scalar " + locale + ":" + field);
}
const cache = new Map<string, string>();
function container(
  locale: string,
  kind: string,
  system: string,
  field: string,
  seen: ReadonlySet<string> = new Set(),
): string | undefined {
  const key = locale + ":" + kind + ":" + system + ":" + field;
  if (seen.has(key)) throw new Error("Numeric container alias cycle");
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  for (const ancestor of chain(locale)) {
    const record = raw.get(ancestor)?.containers.get(kind + ":" + system);
    if (record === undefined) continue;
    const value = record.values.get(field);
    if (value !== undefined) {
      cache.set(key, value);
      return value;
    }
    if (record.alias !== undefined) {
      const resolved = container(
        locale,
        kind,
        record.alias,
        field,
        new Set([...seen, key]),
      );
      if (resolved !== undefined) cache.set(key, resolved);
      return resolved;
    }
  }
  return undefined;
}
function safeField(text: string): string {
  if (/[\t\r\n|]/.test(text))
    throw new Error("Unsupported packed numeric table character");
  return text;
}
const profiles: string[] = [],
  profileIds = new Map<string, number>(),
  bindings: string[] = [],
  bindingIds = new Map<string, number>(),
  locales = new Map<string, string>(),
  defaults = new Map<string, number>(),
  minima = new Map<number, number>(),
  patterns = new Map<string, number>();
let pairs = 0;
for (const locale of [...raw.keys()].sort()) {
  const defaultNu = scalar(locale, "defaultNu"),
    minimum = Number(scalar(locale, "minimum"));
  if (!digits.has(defaultNu) || ![1, 2, 3].includes(minimum))
    throw new Error("Unsupported numeric defaults");
  defaults.set(defaultNu, (defaults.get(defaultNu) ?? 0) + 1);
  minima.set(minimum, (minima.get(minimum) ?? 0) + 1);
  const entries: string[] = [];
  for (const system of [...digits.keys()].sort()) {
    const pattern = container(locale, "decimalFormats", system, "pattern");
    if (
      pattern === undefined ||
      !["#,##0.###", "#,##,##0.###", "0.######", "#,#0.###"].includes(pattern)
    )
      throw new Error(
        "Missing or unsupported standard decimal pattern: " +
          locale +
          ":" +
          system,
      );
    const symbolValues: string[] = [];
    for (const name of symbolNames) {
      let value = container(locale, "symbols", system, name);
      if (
        value === undefined &&
        (name === "currencyDecimal" || name === "currencyGroup")
      )
        value = container(
          locale,
          "symbols",
          system,
          name === "currencyDecimal" ? "decimal" : "group",
        );
      if (value === undefined)
        throw new Error(
          "Missing numeric symbol: " + locale + ":" + system + ":" + name,
        );
      symbolValues.push(safeField(value));
    }
    const groups = pattern.split(".")[0]!.split(","),
      primary = groups.length > 1 ? groups[groups.length - 1]!.length : 0,
      secondary =
        groups.length > 2 ? groups[groups.length - 2]!.length : primary;
    const packed = [
      ...symbolValues,
      String(primary),
      String(secondary),
      String(minimum),
      pattern,
    ].join("\t");
    let id = profileIds.get(packed);
    if (id === undefined) {
      id = profiles.length;
      profiles.push(packed);
      profileIds.set(packed, id);
    }
    entries.push(system + "," + id);
    pairs++;
    patterns.set(pattern, (patterns.get(pattern) ?? 0) + 1);
  }
  const packed = entries.join(";");
  let binding = bindingIds.get(packed);
  if (binding === undefined) {
    binding = bindings.length;
    bindings.push(packed);
    bindingIds.set(packed, binding);
  }
  locales.set(locale, defaultNu + "," + binding);
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
  if (value === undefined) throw new Error("Missing numeric alias owner");
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
if (
  raw.size !== 929 ||
  digits.size !== 78 ||
  algorithmic !== 19 ||
  pairs !== 72462 ||
  profiles.length !== 143 ||
  bindings.length !== 107 ||
  directLocales !== 814 ||
  available.size !== 860 ||
  parents.size !== 198 ||
  available.has("zxx")
)
  throw new Error("Unexpected CLDR49 numeric dataset population");
const sourcePath = "packages/js-runtime/src/objects/number-format-data.ts",
  source = await format(
    "// Generated by tools/generate-number-format-data.ts; do not edit.\n// CLDR49, Unicode-3.0; see ../../LICENSE-CLDR.txt.\n// https://unicode.org/Public/cldr/49/core.zip\n// Archive SHA256: " +
      archiveSha256 +
      "\n// All pinned draft grades included; algorithmic numbering systems are not advertised.\n" +
      [
        ["numberingSystemDigits", table(digits)],
        [
          "numberFormatProfiles",
          table(new Map(profiles.map((p, i) => [String(i), p]))),
        ],
        [
          "numberFormatBindings",
          table(new Map(bindings.map((p, i) => [String(i), p]))),
        ],
        ["numberFormatLocaleRows", table(available)],
      ]
        .map(
          ([name, text]) =>
            "export const " + name + " = " + JSON.stringify(text) + ";\n",
        )
        .join(""),
    { parser: "typescript" },
  );
writeFileSync(sourcePath, source);
const manifest = {
  kind: "cldr-number-format-data",
  version: "49",
  archive: {
    url: "https://unicode.org/Public/cldr/49/core.zip",
    sha256: archiveSha256,
  },
  license: "LICENSE-CLDR.txt",
  inputs,
  policy: {
    availability:
      "Actual main locales with nonroot numeric data ancestry and complete standard profiles; required structural aliases use likely-subtag preference.",
    grades:
      "Include all pinned CLDR draft grades; inherited grades are not used to filter data.",
    numberingSystems:
      "All 78 numeric ten-codepoint mappings with complete symbols/patterns; algorithmic systems excluded.",
    scope:
      "Standard decimal numeric profiles. These tables do not establish currency/unit/notation/range rendering capability.",
  },
  counts: {
    mainLocales: raw.size,
    numericSystems: digits.size,
    algorithmicSystems: algorithmic,
    localeSystemPairs: pairs,
    profiles: profiles.length,
    bindingMaps: bindings.length,
    directLocales,
    structuralAliases: aliases.length,
    availableLocales: available.size,
    parentOverrides: parents.size,
  },
  defaultNumberingSystems: Object.fromEntries(defaults),
  minimumGroupingDigits: Object.fromEntries(minima),
  patterns: Object.fromEntries(patterns),
  draftGradeObservations: Object.fromEntries(draftGrades),
  aliases,
  output: {
    path: sourcePath,
    sha256: digest(new TextEncoder().encode(source)),
  },
};
writeFileSync(
  "packages/js-runtime/number-format-data-manifest.json",
  JSON.stringify(manifest, null, 2) + "\n",
);
process.stdout.write(JSON.stringify(manifest.counts, null, 2) + "\n");
