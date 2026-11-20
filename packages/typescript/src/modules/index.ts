import {
  createSourceText,
  createSourceTextView,
  type SourceTextView,
} from "@tint/source/text";
import { createCatalog, type CatalogEntry } from "@tint/source/catalog";
import {
  createResolver,
  type ModuleSource,
  type ImportMapping,
} from "@tint/source/resolver";
import {
  parseModule,
  type Diagnostic,
  type Module,
  type Result,
} from "../syntax/index.ts";
import type { SourceModule } from "./model.ts";

export type SourcePosition = (
  offset: number,
) => { readonly line: number; readonly column: number } | undefined;

/** Stable IDs and fresh syntax for each request, in graph order. */
export interface SourceModuleLoader {
  readonly ids: readonly string[];
  load(ids?: readonly string[]): readonly SourceModule[];
  /** Resolve the whole graph with a deferred root without changing this loader.
   * Returns undefined if the requested root is unavailable. */
  readonly loadWithRoot?: (root: string) => LoadResult | undefined;
}

export interface SourceModuleText {
  readonly id: string;
  readonly text: string;
  readonly dependencies: ReadonlyMap<string, string>;
}
interface DecodedModule {
  readonly id: string;
  readonly source: SourceTextView;
  readonly dependencies: ReadonlyMap<string, string>;
}
function positionProvider(source: SourceTextView): SourcePosition {
  return (offset) => {
    const position = source.positionAt(offset);
    return position.ok ? position.value : undefined;
  };
}
function parseDecodedModule(input: DecodedModule): SourceModule {
  const parsed = parseModule(input.source);
  if (!parsed.ok) throw input.id + ": " + parsed.error.message;
  return {
    id: input.id,
    module: parsed.value,
    dependencies: input.dependencies,
    sourcePosition: positionProvider(input.source),
  };
}
function decodedModuleLoader(
  inputs: readonly DecodedModule[],
): SourceModuleLoader {
  const indexes = new Map<string, number>();
  const ids: string[] = [];
  for (const input of inputs) {
    if (input === undefined) throw "source module invariant";
    if (indexes.has(input.id)) throw "duplicate module: " + input.id;
    indexes.set(input.id, ids.length);
    ids.push(input.id);
  }
  return {
    ids,
    load: (selected?: readonly string[]): readonly SourceModule[] => {
      const modules: SourceModule[] = [];
      if (selected === undefined) {
        for (const input of inputs) {
          if (input === undefined) throw "source module invariant";
          modules.push(parseDecodedModule(input));
        }
      } else {
        const indexesToLoad = new Set<number>();
        for (const id of selected) {
          if (id === undefined) throw "module ID invariant";
          const index = indexes.get(id);
          if (index !== undefined) indexesToLoad.add(index);
        }
        const ordered: number[] = [];
        for (const index of indexesToLoad) {
          if (index === undefined) throw "module index invariant";
          ordered.push(index);
        }
        ordered.sort((a, b) => a - b);
        for (const index of ordered) {
          if (index === undefined) throw "module index invariant";
          const input = inputs[index];
          if (input === undefined) throw "source module invariant";
          modules.push(parseDecodedModule(input));
        }
      }
      return modules;
    },
  };
}
export function createSourceModuleLoader(
  inputs: readonly SourceModuleText[],
): SourceModuleLoader {
  const decoded: DecodedModule[] = [];
  for (const input of inputs) {
    if (input === undefined) throw "source module invariant";
    const dependencies = new Map<string, string>();
    for (const [specifier, target] of input.dependencies)
      dependencies.set(specifier, target);
    decoded.push({
      id: input.id,
      source: createSourceTextView(input.text),
      dependencies,
    });
  }
  return decodedModuleLoader(decoded);
}
export interface ModuleRequest {
  readonly modules: readonly SourceModule[];
  readonly moduleLoader?: SourceModuleLoader | undefined;
}
export function requestModules(
  request: ModuleRequest,
  ids?: readonly string[],
): readonly SourceModule[] {
  const loader = request.moduleLoader;
  if (loader !== undefined) return loader.load(ids);
  if (ids === undefined) return request.modules;
  const wanted = new Set<string>();
  for (const id of ids) if (id !== undefined) wanted.add(id);
  const selected: SourceModule[] = [];
  for (const module of request.modules)
    if (module !== undefined && wanted.has(module.id)) selected.push(module);
  return selected;
}

export interface SourceInput {
  readonly id: string;
  readonly packageId: string;
  readonly bytes: Uint8Array;
}
/** Decoded and parsed sources reused across loads of one snapshot. Entries
 * are keyed by object identity: only the same inputs (and their decoded
 * sources) hit, so different snapshots never share entries. */
export interface SourceGraphCache {
  readonly sources: Map<SourceInput, ModuleSource>;
  readonly modules: Map<ModuleSource, Module>;
}
export function createSourceGraphCache(): SourceGraphCache {
  return {
    sources: new Map<SourceInput, ModuleSource>(),
    modules: new Map<ModuleSource, Module>(),
  };
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
/** Parse a decoded source, or reuse its parse from the cache. */
function cachedModule(
  source: ModuleSource,
  cache: SourceGraphCache | undefined,
): Result<Module> {
  const known = cache?.modules.get(source);
  if (known !== undefined) return { ok: true, value: known };
  const parsed = parseModule(source.source);
  if (parsed.ok) cache?.modules.set(source, parsed.value);
  return parsed;
}
/** Decode owned source snapshots and resolve a deterministic reachable module graph.
 * IDs and package mappings are explicit; this layer performs no filesystem I/O. */
export function loadSourceGraph(
  inputs: readonly SourceInput[],
  mappings: readonly ImportMapping[],
  roots: readonly string[],
  cache?: SourceGraphCache,
): LoadResult {
  return resolveSourceGraph(inputs, mappings, roots, cache);
}

export type LoadSourceGraphLoaderResult =
  | { readonly ok: true; readonly value: SourceModuleLoader }
  | { readonly ok: false; readonly error: LoadDiagnostic };

/** Resolve the reachable graph and discard each temporary parse as we walk it. */
export function loadSourceGraphLoader(
  inputs: readonly SourceInput[],
  mappings: readonly ImportMapping[],
  roots: readonly string[],
): LoadSourceGraphLoaderResult {
  const decoded: DecodedModule[] = [];
  const resolved = resolveSourceGraph(
    inputs,
    mappings,
    roots,
    undefined,
    decoded,
  );
  if (!resolved.ok) return { ok: false, error: resolved.error };
  return { ok: true, value: decodedModuleLoader(decoded) };
}

function resolveSourceGraph(
  inputs: readonly SourceInput[],
  mappings: readonly ImportMapping[],
  roots: readonly string[],
  cache: SourceGraphCache | undefined,
  decoded?: DecodedModule[],
): LoadResult {
  const entries: CatalogEntry<ModuleSource>[] = [];
  for (const input of inputs) {
    if (input === undefined) throw "source input invariant";
    const known = cache?.sources.get(input);
    if (known !== undefined) {
      entries.push({ id: input.id, value: known });
      continue;
    }
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
    const value: ModuleSource = {
      packageId: input.packageId,
      source: source.value,
    };
    cache?.sources.set(input, value);
    entries.push({ id: input.id, value });
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
    const module = cachedModule(item.value, cache);
    if (!module.ok)
      return fail(
        "parse",
        id,
        module.error.message,
        module.error.start,
        module.error.end,
        "utf16",
        module.error,
      );
    const dependencies = new Map<string, string>();
    for (const declaration of module.value.imports) {
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
    if (decoded === undefined)
      modules.push({
        id,
        module: module.value,
        dependencies,
        sourcePosition: positionProvider(sourceText),
      });
    else decoded.push({ id, source: sourceText, dependencies });
  }
  return { ok: true, value: modules };
}
