import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { format } from "prettier";
import { canonicalizeLocaleId } from "../packages/js-runtime/src/objects/locale-canonicalization.ts";

const archive = process.argv[2];
if (archive === undefined)
  throw new Error("Usage: node tools/generate-plural-rules-data.ts CLDR49.zip");
const archiveSha256 =
  "78403d8d6fb1fed6e208bf9001bf5be00bb5abfd9f8110dae062bf49309d6a89";
const digest = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");
if (digest(readFileSync(archive)) !== archiveSha256)
  throw new Error("CLDR49 archive checksum mismatch");
const inputs: { path: string; sha256: string }[] = [];
function member(name: string): string {
  const path = "common/supplemental/" + name + ".xml";
  const bytes = execFileSync("/usr/bin/unzip", ["-p", archive!, path]);
  inputs.push({ path, sha256: digest(bytes) });
  return new TextDecoder("utf-8", { fatal: true })
    .decode(bytes)
    .replace(/<!--[\s\S]*?-->/g, "");
}
function canonical(locale: string): string {
  if (locale === "root") return locale;
  const tag = canonicalizeLocaleId(locale.replaceAll("_", "-"));
  if (tag === undefined) throw new Error("Invalid CLDR locale: " + locale);
  return tag;
}
function table(values: ReadonlyMap<string, string>): string {
  return [...values]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => k + "|" + v)
    .join("\n");
}
const categories = ["zero", "one", "two", "few", "many", "other"];
function validateCondition(condition: string): void {
  if (condition === "") return;
  for (const alternative of condition.split(" or "))
    for (const relation of alternative.split(" and ")) {
      const m =
        /^([nivwftce])(?: % ([0-9]+))? (!=|=) ([0-9]+(?:\.\.[0-9]+)?(?:,[0-9]+(?:\.\.[0-9]+)?)*)$/.exec(
          relation,
        );
      if (m === null)
        throw new Error("Unsupported plural condition: " + condition);
      if (
        m[2] !== undefined &&
        ![10, 100, 1000, 100000, 1000000].includes(Number(m[2]))
      )
        throw new Error("Unsupported plural modulus");
      for (const item of m[4]!.split(",")) {
        const [a, b = a] = item.split("..");
        if (
          !Number.isSafeInteger(Number(a)) ||
          !Number.isSafeInteger(Number(b)) ||
          Number(a) > Number(b)
        )
          throw new Error("Invalid plural relation range");
      }
    }
}
/** Expand the checked sample ranges without rounding their visible decimals. */
function samples(text: string): string[] {
  const result: string[] = [];
  for (const block of text.split(/@(?:integer|decimal)/).slice(1))
    for (const item of block.trim().split(",")) {
      const source = item.trim();
      if (source === "…" || source === "...") continue;
      if (!source.includes("~")) {
        result.push(source);
        continue;
      }
      const [start, end] = source.split("~");
      const a = /^([0-9]+)(?:\.([0-9]+))?(?:c([0-9]+))?$/.exec(start!),
        b = /^([0-9]+)(?:\.([0-9]+))?(?:c([0-9]+))?$/.exec(end!);
      if (
        a === null ||
        b === null ||
        (a[2]?.length ?? 0) !== (b[2]?.length ?? 0) ||
        a[3] !== b[3]
      )
        throw new Error("Unsupported plural sample range");
      const places = a[2]?.length ?? 0,
        first = Number(a[1] + (a[2] ?? "")),
        last = Number(b[1] + (b[2] ?? ""));
      if (
        !Number.isSafeInteger(first) ||
        !Number.isSafeInteger(last) ||
        last - first > 10000
      )
        throw new Error("Unsafe plural sample range");
      for (let i = first; i <= last; i++) {
        const digits = String(i).padStart(places + 1, "0");
        result.push(
          (places === 0
            ? digits
            : digits.slice(0, -places) + "." + digits.slice(-places)) +
            (a[3] === undefined ? "" : "c" + a[3]),
        );
      }
    }
  return result;
}
const sets = new Map<string, string>(),
  dispatches = new Map<string, string>(),
  fixture: string[] = [];
const statistics: unknown[] = [];
for (const [name, type, expectedGroups, expectedAssignments, expectedRules] of [
  ["plurals", "cardinal", 39, 228, 131],
  ["ordinals", "ordinal", 28, 111, 87],
] as const) {
  const text = member(name);
  let groupCount = 0,
    assignmentCount = 0,
    ruleCount = 0,
    sampleCount = 0;
  const assigned = new Map<string, string>();
  for (const group of text.matchAll(
    /<pluralRules locales="([^"]+)">([\s\S]*?)<\/pluralRules>/g,
  )) {
    const locales = group[1]!.trim().split(/\s+/),
      rules: string[] = [];
    let other = false;
    for (const rule of group[2]!.matchAll(
      /<pluralRule count="([^"]+)">([^<]*)<\/pluralRule>/g,
    )) {
      const category = rule[1]!,
        body = rule[2]!.trim(),
        condition = body.split("@")[0]!.trim();
      if (!categories.includes(category) || other)
        throw new Error("Unexpected plural category ordering");
      validateCondition(condition);
      if (category === "other") {
        other = true;
        if (condition !== "") throw new Error("Conditional other rule");
      } else if (condition === "") throw new Error("Empty non-other rule");
      rules.push(category + "=" + condition);
      ruleCount++;
      for (const sample of samples(body)) {
        if (!/^[0-9]+(?:\.[0-9]+)?(?:c[0-9]+)?$/.test(sample))
          throw new Error("Unsupported plural sample: " + sample);
        fixture.push(
          type + "|" + canonical(locales[0]!) + "|" + category + "|" + sample,
        );
        sampleCount++;
      }
    }
    if (!other) throw new Error("Missing fallback plural rule");
    const id = type + ":" + String(groupCount++),
      encoded = rules.join(";");
    sets.set(id, encoded);
    for (const locale of locales) {
      assignmentCount++;
      const key = canonical(locale),
        old = assigned.get(key);
      if (old !== undefined && old !== encoded)
        throw new Error("Conflicting canonical plural assignments: " + key);
      assigned.set(key, encoded);
      dispatches.set(type + ":" + key, id);
    }
  }
  if (
    groupCount !== expectedGroups ||
    assignmentCount !== expectedAssignments ||
    ruleCount !== expectedRules
  )
    throw new Error("CLDR plural population changed");
  statistics.push({
    type,
    groups: groupCount,
    localeAssignments: assignmentCount,
    canonicalAssignments: assigned.size,
    rules: ruleCount,
    samples: sampleCount,
  });
}
const ranges = new Map<string, string>();
let rangeGroups = 0,
  rangeAssignments = 0,
  rangeRules = 0;
for (const group of member("pluralRanges").matchAll(
  /<pluralRanges locales="([^"]+)">([\s\S]*?)<\/pluralRanges>/g,
)) {
  rangeGroups++;
  const rows: string[] = [];
  for (const range of group[2]!.matchAll(
    /<pluralRange start="([^"]+)"\s+end="([^"]+)"\s+result="([^"]+)"\s*\/>/g,
  )) {
    if (![range[1]!, range[2]!, range[3]!].every((c) => categories.includes(c)))
      throw new Error("Unknown range category");
    rows.push(range[1] + "," + range[2] + "," + range[3]);
    rangeRules++;
  }
  const encoded = rows.join(";");
  for (const locale of group[1]!.trim().split(/\s+/)) {
    rangeAssignments++;
    const key = canonical(locale),
      old = ranges.get(key);
    if (old !== undefined && old !== encoded)
      throw new Error("Conflicting plural range assignments: " + key);
    ranges.set(key, encoded);
  }
}
if (rangeGroups !== 22 || rangeAssignments !== 92 || rangeRules !== 175)
  throw new Error("CLDR range population changed");
// Component-specific declarations override the general parent locale list,
// even when the selected component's declaration is empty.
const supplemental = member("supplementalData"),
  blocks = [
    ...supplemental.matchAll(
      /<parentLocales\b([^>]*)>([\s\S]*?)<\/parentLocales>/g,
    ),
  ];
const selected =
  blocks.find((b) =>
    /component="([^"]*)"/.exec(b[1]!)?.[1]?.split(/\s+/).includes("plurals"),
  ) ?? blocks.find((b) => !b[1]!.includes("component="));
if (selected === undefined)
  throw new Error("Missing parent locale declaration");
const parents = new Map<string, string>();
for (const row of selected[2]!.matchAll(/<parentLocale\b([^>]*)\/>/g)) {
  const parent = /parent="([^"]+)"/.exec(row[1]!)?.[1],
    locales = /locales="([^"]+)"/.exec(row[1]!)?.[1];
  if (parent === undefined || locales === undefined)
    throw new Error("Unsupported plural parent declaration");
  for (const locale of locales.trim().split(/\s+/))
    parents.set(canonical(locale), canonical(parent));
}
const sourcePath = "packages/js-runtime/src/objects/plural-rule-data.ts",
  fixturePath = "packages/js-runtime/test/fixtures/plural-rule-samples.txt";
const output = await format(
  "// Generated from CLDR 49; Unicode-3.0, see ../../LICENSE-CLDR.txt.\n// https://unicode.org/Public/cldr/49/core.zip\n// Archive SHA256: " +
    archiveSha256 +
    "\n" +
    [
      ["pluralRuleSets", table(sets)],
      ["pluralRuleDispatch", table(dispatches)],
      ["pluralRangeRules", table(ranges)],
      ["pluralRuleParents", table(parents)],
    ]
      .map(
        ([name, value]) =>
          "export const " + name + " = " + JSON.stringify(value) + ";\n",
      )
      .join(""),
  { parser: "typescript" },
);
const fixtureText =
  "# CLDR49 plural sample vectors, type|locale|category|decimal[cExponent]\n" +
  fixture.join("\n") +
  "\n";
writeFileSync(sourcePath, output);
writeFileSync(fixturePath, fixtureText);
const manifest = {
  kind: "cldr-plural-rule-data",
  version: "49",
  archive: {
    url: "https://unicode.org/Public/cldr/49/core.zip",
    sha256: archiveSha256,
  },
  license: "LICENSE-CLDR.txt",
  inputs,
  statistics,
  ranges: {
    groups: rangeGroups,
    localeAssignments: rangeAssignments,
    rules: rangeRules,
    missingPair: "end",
    ordinal: "end; no ordinal matrix in source data",
  },
  parentComponent: "plurals",
  parentOverrides: parents.size,
  output: {
    path: sourcePath,
    sha256: digest(new TextEncoder().encode(output)),
  },
  fixture: {
    path: fixturePath,
    sha256: digest(new TextEncoder().encode(fixtureText)),
    samples: fixture.length,
  },
};
writeFileSync(
  "packages/js-runtime/plural-rules-data-manifest.json",
  JSON.stringify(manifest, null, 2) + "\n",
);
process.stdout.write(JSON.stringify(manifest, null, 2) + "\n");
