import { createSourceText } from "@tint/source/text";
import { createCatalog, type CatalogEntry } from "@tint/source/catalog";
import {
  createResolver,
  type ModuleSource,
  type ImportMapping,
} from "@tint/source/resolver";
import { parseModule, type Diagnostic } from "../syntax/index.ts";
import type { SourceModule } from "./model.ts";
export interface SourceInput {
  readonly id: string;
  readonly packageId: string;
  readonly bytes: Uint8Array;
}
export interface LoadDiagnostic {
  readonly syntax?: Diagnostic;
  readonly stage: "decode" | "catalog" | "resolve" | "parse";
  readonly module: string;
  readonly message: string;
  readonly start: number;
  readonly end: number;
  readonly offsetKind: "byte" | "utf16" | "none";
}
export type LoadResult =
  | { readonly ok: true; readonly value: readonly SourceModule[] }
  | { readonly ok: false; readonly error: LoadDiagnostic };
function fail(
  stage: LoadDiagnostic["stage"],
  module: string,
  message: string,
  start: number = 0,
  end: number = 0,
  offsetKind: LoadDiagnostic["offsetKind"] = "none",
  syntax?: Diagnostic,
): LoadResult {
  return {
    ok: false,
    error: {
      stage,
      module,
      message,
      start,
      end,
      offsetKind,
      ...(syntax === undefined ? {} : { syntax }),
    },
  };
}
/** Decode owned source snapshots and resolve a deterministic reachable module graph.
 * IDs and package mappings are explicit; this layer performs no filesystem I/O. */
export function loadSourceGraph(
  inputs: readonly SourceInput[],
  mappings: readonly ImportMapping[],
  roots: readonly string[],
): LoadResult {
  const entries: CatalogEntry<ModuleSource>[] = [];
  for (const input of inputs) {
    if (input === undefined) throw "source input invariant";
    const source = createSourceText(input.bytes, input.bytes.length);
    if (!source.ok) {
      const error = source.error;
      if (error.kind === "invalid-utf8")
        return fail(
          "decode",
          input.id,
          error.kind,
          error.sequenceStart,
          error.byteOffset,
          "byte",
        );
      return fail("decode", input.id, error.kind);
    }
    entries.push({
      id: input.id,
      value: { packageId: input.packageId, source: source.value },
    });
  }
  const catalog = createCatalog<ModuleSource>(entries);
  if (!catalog.ok) return fail("catalog", catalog.error.id, catalog.error.code);
  const resolver = createResolver(catalog.value, mappings);
  if (!resolver.ok)
    return fail("resolve", resolver.error.subject, resolver.error.code);
  const pending = roots.slice(),
    seen = new Set<string>(),
    modules: SourceModule[] = [];
  for (let index = 0; index < pending.length; index++) {
    const id = pending[index];
    if (id === undefined) throw "pending module invariant";
    if (seen.has(id)) continue;
    seen.add(id);
    const item = catalog.value.lookup(id);
    if (!item.found) return fail("resolve", id, "MISSING_MODULE");
    const parsed = parseModule(item.value.source);
    if (!parsed.ok)
      return fail(
        "parse",
        id,
        parsed.error.message,
        parsed.error.start,
        parsed.error.end,
        "utf16",
        parsed.error,
      );
    const dependencies = new Map<string, string>();
    for (const declaration of parsed.value.imports) {
      if (declaration === undefined) throw "module import invariant";
      const span = declaration.specifierSpan;
      const resolved = resolver.value.resolve({
        importer: id,
        specifier: declaration.specifier,
        kind: declaration.typeOnly ? "type" : "runtime",
        start: span.start,
        end: span.end,
      });
      if (!resolved.ok)
        return fail(
          "resolve",
          id,
          resolved.error.code + ": " + declaration.specifier,
          span.start,
          span.end,
          "utf16",
        );
      dependencies.set(declaration.specifier, resolved.value.target);
      pending.push(resolved.value.target);
    }
    const sourceText = item.value.source;
    modules.push({
      id,
      module: parsed.value,
      dependencies,
      sourcePosition: (offset) => {
        const position = sourceText.positionAt(offset);
        return position.ok ? position.value : undefined;
      },
    });
  }
  return { ok: true, value: modules };
}
