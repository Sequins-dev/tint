import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { format } from "prettier";
import { canonicalizeLocaleId } from "../packages/js-runtime/src/objects/locale-canonicalization.ts";
import { maximizeLocaleId } from "../packages/js-runtime/src/objects/locale-likely.ts";

const archive = process.argv[2];
if (archive === undefined)
  throw new Error(
    "Usage: node tools/generate-plural-compact-data.ts CLDR49.zip",
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
const supplemental = member("common/supplemental/supplementalData.xml"),
  blocks = [
    ...supplemental.matchAll(
      /<parentLocales\b([^>]*)>([\s\S]*?)<\/parentLocales>/g,
    ),
  ];
const generalBlock = blocks.find((b) => !attributes(b[1]!).has("component")),
  pluralBlock =
    blocks.find((b) =>
      attributes(b[1]!).get("component")?.split(/\s+/).includes("plurals"),
    ) ?? generalBlock;
function parents(block: RegExpMatchArray | undefined): Map<string, string> {
  if (block === undefined)
    throw new Error("Missing parent locale declarations");
  const result = new Map<string, string>();
  for (const row of block[2]!.matchAll(/<parentLocale\b([^>]*)\/>/g)) {
    const attrs = attributes(row[1]!),
      parent = attrs.get("parent"),
      locales = attrs.get("locales");
    if (parent === undefined || locales === undefined)
      throw new Error("Unsupported parent declaration");
    for (const locale of locales.trim().split(/\s+/))
      result.set(tag(locale), tag(parent));
  }
  return result;
}
const formatParents = parents(generalBlock),
  pluralParents = parents(pluralBlock);
function chain(
  locale: string,
  overrides: ReadonlyMap<string, string>,
): string[] {
  const result: string[] = [],
    seen = new Set<string>();
  for (
    let current = locale;
    ;
    current =
      overrides.get(current) ??
      (current.includes("-")
        ? current.slice(0, current.lastIndexOf("-"))
        : "root")
  ) {
    if (seen.has(current)) throw new Error("Locale parent cycle: " + locale);
    seen.add(current);
    result.push(current);
    if (current === "root") return result;
  }
}
const ruleLocales = new Set<string>();
for (const name of ["plurals", "ordinals"])
  for (const row of member("common/supplemental/" + name + ".xml").matchAll(
    /<pluralRules locales="([^"]+)">/g,
  ))
    for (const locale of row[1]!.trim().split(/\s+/))
      ruleLocales.add(tag(locale));
interface RawPattern {
  readonly magnitude: number;
  readonly count: string;
  readonly text: string;
}
interface RawFormat {
  readonly alias: string | undefined;
  readonly patterns: readonly RawPattern[];
}
const raw = new Map<string, Map<string, RawFormat>>(),
  allPatterns: {
    locale: string;
    system: string;
    style: string;
    pattern: RawPattern;
  }[] = [];
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
    formats = new Map<string, RawFormat>();
  if (/<\/identity>\s*<alias\b/.test(text))
    throw new Error("Unsupported whole-locale alias: " + locale);
  for (const format of text.matchAll(
    /<decimalFormats\b([^>]*)>([\s\S]*?)<\/decimalFormats>/g,
  )) {
    const system = attributes(format[1]!).get("numberSystem");
    if (system === undefined)
      throw new Error("Missing decimal numbering system");
    for (const length of format[2]!.matchAll(
      /<decimalFormatLength\b([^>]*)>([\s\S]*?)<\/decimalFormatLength>/g,
    )) {
      const style = attributes(length[1]!).get("type");
      if (style !== "short" && style !== "long") continue;
      const body = length[2]!,
        patterns: RawPattern[] = [],
        seen = new Set<string>();
      for (const pattern of body.matchAll(
        /<pattern\b([^>]*)>([^<]*)<\/pattern>/g,
      )) {
        const attrs = attributes(pattern[1]!),
          type = attrs.get("type"),
          count = attrs.get("count");
        if (
          attrs.has("alt") ||
          type === undefined ||
          !/^10+$/.test(type) ||
          count === undefined ||
          !["zero", "one", "two", "few", "many", "other", "0", "1"].includes(
            count,
          )
        )
          throw new Error("Unsupported compact pattern attributes");
        const magnitude = type.length - 1,
          key = magnitude + ":" + count;
        if (seen.has(key)) throw new Error("Duplicate compact pattern");
        seen.add(key);
        const value = { magnitude, count, text: xmlText(pattern[2]!) };
        patterns.push(value);
        allPatterns.push({ locale, system, style, pattern: value });
      }
      const aliases = [...body.matchAll(/<alias\b([^>]*)\/>/g)];
      let alias: string | undefined;
      if (aliases.length !== 0) {
        const attrs = attributes(aliases[0]![1]!),
          match = /^\.\.\/decimalFormatLength\[@type='(short|long)'\]$/.exec(
            attrs.get("path") ?? "",
          );
        if (
          aliases.length !== 1 ||
          patterns.length !== 0 ||
          attrs.get("source") !== "locale" ||
          match === null
        )
          throw new Error("Unsupported compact format alias");
        alias = match[1];
      }
      if (patterns.length !== 0 || alias !== undefined)
        formats.set(system + ":" + style, { alias, patterns });
    }
  }
  if (raw.has(locale))
    throw new Error("Duplicate canonical main locale: " + locale);
  raw.set(locale, formats);
}
function resolve(
  locale: string,
  style: string,
  magnitude: number,
  seen: ReadonlySet<string> = new Set(),
): string | undefined {
  const state = locale + ":" + style + ":" + magnitude;
  if (seen.has(state)) throw new Error("Compact format alias cycle");
  for (const ancestor of chain(locale, formatParents)) {
    const format = raw.get(ancestor)?.get("latn:" + style);
    if (format === undefined) continue;
    const value = format.patterns.find(
      (p) => p.magnitude === magnitude && p.count === "other",
    )?.text;
    if (value !== undefined && value !== "↑↑↑") return value;
    if (format.alias !== undefined)
      return resolve(
        locale,
        format.alias,
        magnitude,
        new Set([...seen, state]),
      );
  }
  return undefined;
}
/** Count numeric runs per unquoted positive/negative subpattern. Literal-only
 * count-specific forms are valid, but never select a generic scaling profile. */
function numericWidth(pattern: string): number | undefined {
  let quoted = false,
    run = 0;
  const branches: number[][] = [[]];
  for (let i = 0; i < pattern.length; i++) {
    const unit = pattern.charAt(i);
    if (unit === "'") {
      if (pattern.charAt(i + 1) === "'") {
        i++;
        continue;
      }
      quoted = !quoted;
    }
    if (!quoted && unit === "0") run++;
    else {
      if (run !== 0) {
        branches[branches.length - 1]!.push(run);
        run = 0;
      }
      if (!quoted && unit === ";") branches.push([]);
    }
  }
  if (run !== 0) branches[branches.length - 1]!.push(run);
  if (quoted || branches.length > 2)
    throw new Error("Invalid compact numeric quoting/subpatterns");
  if (branches.every((b) => b.length === 0)) return undefined;
  if (
    branches.some((b) => b.length !== 1) ||
    branches.some((b) => b[0] !== branches[0]![0])
  )
    throw new Error("Inconsistent compact numeric subpatterns");
  return branches[0]![0];
}
function scale(pattern: string, magnitude: number): number {
  if (pattern === "0") return 0;
  const width = numericWidth(pattern);
  if (width === undefined)
    throw new Error("Generic compact pattern lacks numeric skeleton");
  const exponent = magnitude + 1 - width;
  if (exponent < 0) throw new Error("Negative compact exponent");
  return exponent;
}
const literalForms: unknown[] = [],
  categoryDifferences: unknown[] = [],
  numberingSystemDifferences: unknown[] = [];
for (const row of allPatterns) {
  const { pattern, locale, style, system } = row;
  if (pattern.text === "↑↑↑") continue;
  const width = numericWidth(pattern.text);
  if (width === undefined) {
    if (!["one", "0", "1"].includes(pattern.count))
      throw new Error("Unsupported literal compact category");
    literalForms.push(row);
    continue;
  }
  const exponent = scale(pattern.text, pattern.magnitude),
    other = raw
      .get(locale)
      ?.get(system + ":" + style)
      ?.patterns.find(
        (p) => p.magnitude === pattern.magnitude && p.count === "other",
      )?.text;
  if (
    !["0", "1"].includes(pattern.count) &&
    other !== undefined &&
    exponent !== scale(other, pattern.magnitude)
  )
    categoryDifferences.push({
      ...row,
      exponent,
      otherExponent: scale(other, pattern.magnitude),
    });
  if (system !== "latn") {
    const latin = resolve(locale, style, pattern.magnitude);
    if (latin === undefined || exponent !== scale(latin, pattern.magnitude))
      numberingSystemDifferences.push({
        ...row,
        exponent,
        latinExponent:
          latin === undefined ? undefined : scale(latin, pattern.magnitude),
      });
  }
}
const maxMagnitude = Math.max(...allPatterns.map((p) => p.pattern.magnitude)),
  profiles: string[] = [],
  profileIds = new Map<string, number>(),
  allLocales = new Map<string, string>();
let resolvedRows = 0;
for (const locale of [...raw.keys()].sort()) {
  const styles: string[] = [];
  for (const style of ["short", "long"]) {
    const values: string[] = [];
    for (let magnitude = 0; magnitude <= maxMagnitude; magnitude++) {
      const pattern = resolve(locale, style, magnitude);
      if (pattern !== undefined) {
        values.push(magnitude + "," + scale(pattern, magnitude));
        resolvedRows++;
      }
    }
    if (values.length === 0)
      throw new Error(
        "Missing complete compact profile: " + locale + ":" + style,
      );
    styles.push(values.join(";"));
  }
  const key = styles.join("|");
  let id = profileIds.get(key);
  if (id === undefined) {
    id = profiles.length;
    profiles.push(key);
    profileIds.set(key, id);
  }
  allLocales.set(locale, String(id));
}
const available = new Map(
  [...allLocales].filter(
    ([locale]) =>
      locale !== "root" &&
      chain(locale, pluralParents).some(
        (k) => k !== "root" && ruleLocales.has(k),
      ),
  ),
);
const directLocales = available.size,
  aliases: { locale: string; source: string }[] = [];
function addAlias(locale: string, source: string): void {
  if (available.has(locale)) return;
  let preferred = maximizeLocaleId(locale)?.toLowerCase() ?? locale;
  while (!available.has(preferred) && preferred.includes("-"))
    preferred = preferred.slice(0, preferred.lastIndexOf("-"));
  const owner = available.has(preferred) ? preferred : source,
    id = available.get(owner);
  if (id === undefined) throw new Error("Missing alias source profile");
  available.set(locale, id);
  aliases.push({ locale, source: owner });
}
for (const locale of [...available.keys()]) {
  const parts = locale.split("-");
  if (
    parts.length >= 3 &&
    parts[1]!.length === 4 &&
    (parts[2]!.length === 2 || parts[2]!.length === 3)
  )
    addAlias([parts[0], ...parts.slice(2)].join("-"), locale);
  if (parts.length > 1) addAlias(parts[0]!, locale);
}
if (
  raw.size !== 929 ||
  allPatterns.length !== 7059 ||
  profiles.length !== 23 ||
  directLocales !== 777 ||
  available.size !== 820 ||
  resolvedRows !== 22316 ||
  literalForms.length !== 6 ||
  categoryDifferences.length !== 1 ||
  numberingSystemDifferences.length !== 3 ||
  formatParents.size !== 198 ||
  pluralParents.size !== 0 ||
  available.has("zxx")
)
  throw new Error("Unexpected CLDR49 compact dataset population");
const sourcePath = "packages/js-runtime/src/objects/plural-compact-data.ts";
const output = await format(
  "// Generated by tools/generate-plural-compact-data.ts; do not edit.\n// CLDR49, Unicode-3.0; see ../../LICENSE-CLDR.txt.\n// https://unicode.org/Public/cldr/49/core.zip\n// Archive SHA256: " +
    archiveSha256 +
    "\n// PluralRules classification uses latn other-pattern scaling; not NumberFormat rendering data.\n" +
    "export const pluralServiceLocales = " +
    JSON.stringify(table(available)) +
    ";\nexport const pluralCompactProfiles = " +
    JSON.stringify(
      table(new Map(profiles.map((profile, id) => [String(id), profile]))),
    ) +
    ";\n",
  { parser: "typescript" },
);
writeFileSync(sourcePath, output);
const manifest = {
  kind: "cldr-plural-compact-data",
  version: "49",
  archive: {
    url: "https://unicode.org/Public/cldr/49/core.zip",
    sha256: archiveSha256,
  },
  license: "LICENSE-CLDR.txt",
  inputs,
  policy: {
    availability:
      "Main locale with explicit nonroot cardinal or ordinal rule ancestor under plural-component parents; complete short/long compact profile; required structural aliases added using likely-subtag preference.",
    compact:
      "Implementation-defined PluralRules classification uses latn other-pattern numeric scaling; NumberFormat must preserve numbering-system/category/exact-number data separately.",
    formatParentComponent: "general",
    ruleParentComponent: "plurals",
  },
  counts: {
    mainLocales: raw.size,
    rawPatterns: allPatterns.length,
    resolvedRows,
    profiles: profiles.length,
    directLocales,
    structuralAliases: aliases.length,
    availableLocales: available.size,
    formatParentOverrides: formatParents.size,
    pluralParentOverrides: pluralParents.size,
    maxMagnitude,
  },
  aliases,
  literalForms,
  categoryDifferences,
  numberingSystemDifferences,
  output: {
    path: sourcePath,
    sha256: digest(new TextEncoder().encode(output)),
  },
};
writeFileSync(
  "packages/js-runtime/plural-compact-data-manifest.json",
  JSON.stringify(manifest, null, 2) + "\n",
);
process.stdout.write(JSON.stringify(manifest.counts, null, 2) + "\n");
