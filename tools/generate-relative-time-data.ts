import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { format } from "prettier";
import { attributes, xmlText } from "./cldr-xml.ts";
import { numberFormatLocaleRows } from "../packages/js-runtime/src/objects/number-format-data.ts";
const archive = process.argv[2];
if (archive === undefined)
  throw Error("usage: node tools/generate-relative-time-data.ts CLDR49.zip");
const archiveSha256 =
  "78403d8d6fb1fed6e208bf9001bf5be00bb5abfd9f8110dae062bf49309d6a89";
const hash = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
if (hash(readFileSync(archive)) !== archiveSha256)
  throw Error("CLDR49 checksum differs");
const inputs: { path: string; sha256: string }[] = [];
function member(path: string): string {
  const bytes = execFileSync("/usr/bin/unzip", ["-p", archive!, path], {
    maxBuffer: 16 * 1024 * 1024,
  });
  inputs.push({ path, sha256: hash(bytes) });
  return new TextDecoder("utf-8", { fatal: true })
    .decode(bytes)
    .replace(/<!--[\s\S]*?-->/g, "");
}
const parents = new Map<string, string>();
for (const block of member("common/supplemental/supplementalData.xml").matchAll(
  /<parentLocales\b([^>]*)>([\s\S]*?)<\/parentLocales>/g,
)) {
  if (attributes(block[1]!).has("component")) continue;
  for (const match of block[2]!.matchAll(/<parentLocale\b([^>]+)\/>/g)) {
    const a = attributes(match[1]!);
    for (const locale of a.get("locales")!.trim().split(/\s+/))
      parents.set(
        locale.replaceAll("_", "-").toLowerCase(),
        a.get("parent")!.replaceAll("_", "-").toLowerCase(),
      );
  }
}
const units = [
    "second",
    "minute",
    "hour",
    "day",
    "week",
    "month",
    "quarter",
    "year",
  ],
  styles = ["long", "short", "narrow"];
interface Field {
  alias: string | undefined;
  values: Map<string, string>;
}
const raw = new Map<string, Map<string, Field>>(),
  numericKeys = new Set<string>();
const paths = execFileSync("/usr/bin/unzip", ["-Z1", archive], {
  encoding: "utf8",
  maxBuffer: 4 * 1024 * 1024,
})
  .split("\n")
  .filter((p) => /^common\/main\/[^/]+\.xml$/.test(p))
  .sort();
for (const path of paths) {
  const text = member(path),
    locale = path
      .slice("common/main/".length, -4)
      .replaceAll("_", "-")
      .toLowerCase();
  if (/<\/identity>\s*<alias\b/.test(text))
    throw Error("Whole-locale alias: " + locale);
  const fields = new Map<string, Field>();
  const block = /<fields>([\s\S]*?)<\/fields>/.exec(text)?.[1] ?? "";
  for (const match of block.matchAll(/<field\b([^>]*)>([\s\S]*?)<\/field>/g)) {
    const name = attributes(match[1]!).get("type")!,
      body = match[2]!;
    if (
      !units.some(
        (u) => name === u || name === u + "-short" || name === u + "-narrow",
      )
    )
      continue;
    const values = new Map<string, string>();
    for (const item of body.matchAll(
      /<relative\b([^>]*)>([^<]*)<\/relative>/g,
    )) {
      const a = attributes(item[1]!);
      if (a.has("alt")) continue;
      const key = a.get("type")!;
      if (!/^-?[0-9]+$/.test(key)) throw Error("Non-numeric relative key");
      numericKeys.add(key);
      values.set(key, xmlText(item[2]!));
    }
    for (const time of body.matchAll(
      /<relativeTime\b([^>]*)>([\s\S]*?)<\/relativeTime>/g,
    )) {
      const tense = attributes(time[1]!).get("type")!;
      if (tense !== "past" && tense !== "future")
        throw Error("Unknown relative tense");
      for (const item of time[2]!.matchAll(
        /<relativeTimePattern\b([^>]*)>([^<]*)<\/relativeTimePattern>/g,
      )) {
        const a = attributes(item[1]!);
        if (a.has("alt")) continue;
        const key = tense + "." + a.get("count")!,
          value = xmlText(item[2]!);
        if (
          value.replaceAll("{0}", "").includes("{") ||
          value.replaceAll("{0}", "").includes("}")
        )
          throw Error("Relative placeholder differs");
        if (values.has(key)) throw Error("Duplicate relative field");
        values.set(key, value);
      }
    }
    const alias = /<alias\b([^>]+)\/>/.exec(body);
    let target: string | undefined;
    if (alias !== null) {
      const a = attributes(alias[1]!),
        parsed = /^\.\.\/field\[@type='([^']+)'\]$/.exec(a.get("path")!);
      if (a.get("source") !== "locale" || parsed === null || values.size !== 0)
        throw Error("Unsupported relative alias");
      target = parsed[1]!;
    }
    fields.set(name, { alias: target, values });
  }
  raw.set(locale, fields);
}
function chain(locale: string): string[] {
  const seen = new Set<string>(),
    result: string[] = [];
  for (
    let key = locale;
    ;
    key =
      parents.get(key) ??
      (key.includes("-") ? key.slice(0, key.lastIndexOf("-")) : "root")
  ) {
    if (seen.has(key)) throw Error("Relative parent cycle");
    seen.add(key);
    result.push(key);
    if (key === "root") return result;
  }
}
function resolve(
  locale: string,
  field: string,
  key: string,
  seen: ReadonlySet<string> = new Set(),
): string | undefined {
  const state = locale + "|" + field + "|" + key;
  if (seen.has(state)) throw Error("Relative alias cycle");
  for (const parent of chain(locale)) {
    const entry = raw.get(parent)?.get(field),
      value = entry?.values.get(key);
    if (value !== undefined && value !== "↑↑↑") return value;
    if (entry?.alias !== undefined)
      return resolve(locale, entry.alias, key, new Set([...seen, state]));
  }
  return undefined;
}
const strings = new Map<string, string>(),
  fields = new Map<string, string>(),
  profiles = new Map<string, string>(),
  locales = new Map<string, string>();
const stringIds = new Map<string, string>(),
  fieldIds = new Map<string, string>(),
  profileIds = new Map<string, string>();
function intern(
  value: string,
  ids: Map<string, string>,
  table: Map<string, string>,
): string {
  let id = ids.get(value);
  if (id === undefined) {
    id = String(ids.size);
    ids.set(value, id);
    table.set(id, value);
  }
  return id;
}
for (const row of numberFormatLocaleRows.split("\n")) {
  const locale = row.slice(0, row.indexOf("|")),
    ids: string[] = [];
  for (const unit of units)
    for (const style of styles) {
      const field = unit + (style === "long" ? "" : "-" + style),
        values = new Map<string, string>();
      for (const key of [
        ...numericKeys,
        ...["past", "future"].flatMap((t) =>
          ["zero", "one", "two", "few", "many", "other"].map(
            (c) => t + "." + c,
          ),
        ),
      ]) {
        const value = resolve(locale, field, key);
        if (value !== undefined)
          values.set(key, intern(value, stringIds, strings));
      }
      if (!values.has("past.other") || !values.has("future.other"))
        throw Error("Incomplete relative field: " + locale + "/" + field);
      ids.push(
        intern(
          [...values]
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
            .map(([k, v]) => k + ":" + v)
            .join(","),
          fieldIds,
          fields,
        ),
      );
    }
  locales.set(locale, intern(ids.join(","), profileIds, profiles));
}
function table(values: Map<string, string>): string {
  return [...values]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => {
      if (/[\r\n]/.test(k + v) || k.includes("|"))
        throw Error("Packed relative data delimiter");
      return k + "|" + v;
    })
    .join("\n");
}
let output =
  "// Generated by tools/generate-relative-time-data.ts; do not edit.\n// CLDR49, Unicode-3.0; see ../../LICENSE-CLDR.txt.\n// Archive SHA256: " +
  archiveSha256 +
  "\n";
for (const [name, values] of [
  ["relativeTimeLocales", locales],
  ["relativeTimeProfiles", profiles],
  ["relativeTimeFields", fields],
  ["relativeTimeStrings", strings],
] as const)
  output +=
    "export const " + name + " = " + JSON.stringify(table(values)) + ";\n";
output = await format(output, { parser: "typescript" });
const outputPath = "packages/js-runtime/src/objects/relative-time-data.ts";
writeFileSync(outputPath, output);
writeFileSync(
  "packages/js-runtime/relative-time-data-manifest.json",
  JSON.stringify(
    {
      kind: "cldr-relative-time-data",
      archiveSha256,
      cldrVersion: "49",
      inputs,
      locales: locales.size,
      profiles: profiles.size,
      fields: fields.size,
      strings: strings.size,
      output: {
        path: outputPath,
        sha256: hash(new TextEncoder().encode(output)),
      },
      policy:
        "General parent/field alias inheritance; numeric service locale registry; all pinned draft grades; no host Intl.",
    },
    null,
    2,
  ) + "\n",
);
console.log(
  JSON.stringify({
    locales: locales.size,
    profiles: profiles.size,
    fields: fields.size,
    strings: strings.size,
  }),
);
