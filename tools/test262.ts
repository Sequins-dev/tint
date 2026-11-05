import { parseDocument } from "yaml";
import { createSourceText } from "@tint/source/text";
import {
  parseModule,
  parseStrictScript,
  parseScript,
  type Diagnostic,
} from "@tint/typescript/syntax";
export interface TestMetadata {
  readonly flags: readonly string[];
  readonly features: readonly string[];
  readonly includes: readonly string[];
  readonly negative?: { readonly phase: string; readonly type: string };
}
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
export function testMetadata(source: string): TestMetadata {
  const match = /\/\*---([\s\S]*?)---\*\//.exec(source);
  if (!match) throw new Error("missing Test262 metadata");
  // Some upstream tests deliberately use CR-only line endings. Normalize only
  // the metadata passed to YAML; execution and source hashes retain original bytes.
  const metadata = match[1]!.replace(/\r\n?/g, "\n");
  const document = parseDocument(metadata, {
    schema: "core",
    uniqueKeys: true,
  });
  if (document.errors.length)
    throw new Error(document.errors.map((e) => e.message).join("; "));
  const data: unknown = document.toJS({ maxAliasCount: 0 });
  if (!object(data)) throw new Error("invalid Test262 metadata");
  const fields = data;
  function strings(key: string): string[] {
    const value = fields[key];
    if (value === undefined) return [];
    if (!Array.isArray(value) || !value.every((v) => typeof v === "string"))
      throw new Error(`invalid Test262 ${key}`);
    return value;
  }
  const flags = strings("flags");
  if (
    flags.includes("noStrict") &&
    (flags.includes("onlyStrict") || flags.includes("module"))
  )
    throw new Error("conflicting Test262 flags");
  const negative = data.negative;
  if (
    negative !== undefined &&
    (!object(negative) ||
      !["parse", "early", "resolution", "runtime"].includes(
        String(negative.phase),
      ) ||
      typeof negative.type !== "string")
  )
    throw new Error("invalid Test262 negative metadata");
  return {
    flags,
    features: strings("features"),
    includes: strings("includes"),
    ...(object(negative)
      ? {
          negative: {
            phase: String(negative.phase),
            type: String(negative.type),
          },
        }
      : {}),
  };
}
export type SyntaxVariant = "module" | "strict" | "sloppy" | "raw";
export function syntaxVariants(metadata: TestMetadata): SyntaxVariant[] {
  if (metadata.flags.includes("module")) return ["module"];
  if (metadata.flags.includes("raw")) return ["raw"];
  if (metadata.flags.includes("onlyStrict")) return ["strict"];
  if (metadata.flags.includes("noStrict")) return ["sloppy"];
  return ["sloppy", "strict"];
}
export interface SyntaxObservation {
  readonly status:
    | "unavailable-goal"
    | "unsupported"
    | "limit"
    | "accepted"
    | "rejected"
    | "negative-accepted"
    | "negative-rejected-unverified";
  readonly prefixLines: number;
  readonly diagnostic?: Diagnostic;
}
/** Syntax inventory only: no harness execution or conformance pass is implied. */
export function inspectSyntax(
  text: string,
  variant: SyntaxVariant,
  metadata: TestMetadata,
): SyntaxObservation {
  const prefixLines = variant === "strict" ? 1 : 0;
  const bytes = new TextEncoder().encode(
    (prefixLines ? '"use strict";\n' : "") + text,
  );
  const source = createSourceText(bytes, bytes.length);
  if (!source.ok) throw new Error("invalid Test262 source encoding");
  const result =
    variant === "module"
      ? parseModule(source.value, "javascript")
      : variant === "strict"
        ? parseStrictScript(source.value)
        : parseScript(source.value);
  const negative =
    metadata.negative?.phase === "parse" ||
    metadata.negative?.phase === "early";
  if (result.ok)
    return { status: negative ? "negative-accepted" : "accepted", prefixLines };
  const diagnostic = result.error;
  return {
    status:
      diagnostic.code === "UNSUPPORTED_SYNTAX"
        ? "unsupported"
        : diagnostic.code === "LIMIT"
          ? "limit"
          : negative
            ? "negative-rejected-unverified"
            : "rejected",
    prefixLines,
    diagnostic,
  };
}
