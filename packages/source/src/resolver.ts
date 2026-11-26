import { isModuleId, type Catalog } from "./catalog.ts";
import type { SourceText, Position } from "./text.ts";
export interface ModuleSource {
  readonly packageId: string;
  readonly source: SourceText;
}
export interface ImportMapping {
  readonly packageId: string;
  readonly specifier: string;
  readonly target: string;
}
export interface ImportRequest {
  readonly importer: string;
  readonly specifier: string;
  readonly kind: "type" | "runtime";
  readonly start: number;
  readonly end: number;
}
export type DiagnosticCode =
  | "UNKNOWN_IMPORTER"
  | "INVALID_SPAN"
  | "INVALID_KIND"
  | "INVALID_SPECIFIER"
  | "ROOT_ESCAPE"
  | "MISSING_MODULE"
  | "CROSS_PACKAGE_IMPORT"
  | "DEEP_IMPORT"
  | "UNDECLARED_IMPORT";
export interface ResolutionDiagnostic {
  readonly code: DiagnosticCode;
  readonly importer: string;
  readonly specifier: string;
  readonly start: number;
  readonly end: number;
  readonly position: Position | undefined;
  readonly candidate: string | undefined;
}
export type ResolutionResult =
  | {
      readonly ok: true;
      readonly value: {
        readonly importer: string;
        readonly target: string;
        readonly kind: "type" | "runtime";
      };
    }
  | { readonly ok: false; readonly error: ResolutionDiagnostic };
export interface Resolver {
  readonly resolve: (request: ImportRequest) => ResolutionResult;
}
export type ResolverResult =
  | { readonly ok: true; readonly value: Resolver }
  | {
      readonly ok: false;
      readonly error: {
        readonly code:
          | "INVALID_OWNER"
          | "UNKNOWN_PACKAGE"
          | "INVALID_MAPPING"
          | "DUPLICATE_MAPPING"
          | "MISSING_TARGET";
        readonly subject: string;
      };
    };

function packageShape(specifier: string): "bare" | "deep" | "invalid" {
  // `tint:ffi` and `tint:ffi/unsafe` are granted with C binding modules
  // (docs/native-ffi.md).
  if (
    specifier === "node:buffer" ||
    specifier === "node:crypto" ||
    specifier === "node:fs" ||
    specifier === "node:ffi" ||
    specifier === "node:process" ||
    specifier === "node:worker_threads" ||
    specifier === "tint:ffi" ||
    specifier === "tint:ffi/unsafe"
  )
    return "bare";
  // C binding modules (docs/native-ffi.md), granted per package.
  if (specifier.startsWith("tint:c/"))
    return isModuleId(specifier.slice(7)) && specifier.indexOf("/", 7) < 0
      ? "bare"
      : "invalid";
  const scoped = specifier.startsWith("@"),
    name = scoped ? specifier.slice(1) : specifier;
  if (!isModuleId(name)) return "invalid";
  const parts = name.split("/");
  if (scoped && parts.length < 2) return "invalid";
  return parts.length > (scoped ? 2 : 1) ? "deep" : "bare";
}
function diagnostic(
  request: ImportRequest,
  code: DiagnosticCode,
  position: Position | undefined,
  candidate: string | undefined,
): ResolutionResult {
  return {
    ok: false,
    error: {
      code,
      importer: request.importer,
      specifier: request.specifier,
      start: request.start,
      end: request.end,
      position,
      candidate,
    },
  };
}
function validOffset(offset: number, length: number): boolean {
  return Number.isInteger(offset) && offset >= 0 && offset <= length;
}
export function createResolver(
  catalog: Catalog<ModuleSource>,
  mappings: readonly ImportMapping[],
): ResolverResult {
  const modules = new Map<string, ModuleSource>(),
    packages = new Set<string>(),
    grants = new Map<string, Map<string, string>>();
  for (const id of catalog.ids()) {
    if (id === undefined) throw "catalog id invariant";
    const entry = catalog.lookup(id);
    if (!entry.found) throw "catalog enumeration invariant";
    if (entry.value.packageId.length === 0)
      return { ok: false, error: { code: "INVALID_OWNER", subject: id } };
    modules.set(id, {
      packageId: entry.value.packageId,
      source: entry.value.source,
    });
    packages.add(entry.value.packageId);
  }
  for (const mapping of mappings) {
    if (mapping === undefined) throw "import mapping invariant";
    if (!packages.has(mapping.packageId))
      return {
        ok: false,
        error: { code: "UNKNOWN_PACKAGE", subject: mapping.packageId },
      };
    if (packageShape(mapping.specifier) === "invalid")
      return {
        ok: false,
        error: { code: "INVALID_MAPPING", subject: mapping.specifier },
      };
    if (!modules.has(mapping.target))
      return {
        ok: false,
        error: { code: "MISSING_TARGET", subject: mapping.target },
      };
    let scoped = grants.get(mapping.packageId);
    if (scoped === undefined) {
      scoped = new Map<string, string>();
      grants.set(mapping.packageId, scoped);
    }
    if (scoped.has(mapping.specifier))
      return {
        ok: false,
        error: { code: "DUPLICATE_MAPPING", subject: mapping.specifier },
      };
    scoped.set(mapping.specifier, mapping.target);
  }
  function resolve(request: ImportRequest): ResolutionResult {
    const importer = modules.get(request.importer);
    if (importer === undefined)
      return diagnostic(request, "UNKNOWN_IMPORTER", undefined, undefined);
    if (
      !validOffset(request.start, importer.source.text.length) ||
      !validOffset(request.end, importer.source.text.length) ||
      request.end < request.start
    )
      return diagnostic(request, "INVALID_SPAN", undefined, undefined);
    const location = importer.source.positionAt(request.start);
    if (!location.ok) throw "source position invariant";
    const position = location.value,
      specifier = request.specifier;
    if (request.kind !== "type" && request.kind !== "runtime")
      return diagnostic(request, "INVALID_KIND", position, undefined);
    const relative = specifier.startsWith("./") || specifier.startsWith("../");
    let candidate = "";
    if (relative) {
      if (specifier.slice(-3) !== ".ts")
        return diagnostic(request, "INVALID_SPECIFIER", position, undefined);
      const parts = specifier.split("/");
      for (const part of parts) {
        if (part === undefined) throw "specifier segment invariant";
        if (part !== "." && part !== ".." && !isModuleId(part))
          return diagnostic(request, "INVALID_SPECIFIER", position, undefined);
      }
      const normalized = request.importer.split("/");
      normalized.pop();
      for (const part of parts) {
        if (part === undefined) throw "specifier segment invariant";
        if (part === ".") continue;
        if (part === "..") {
          if (normalized.length === 0)
            return diagnostic(request, "ROOT_ESCAPE", position, undefined);
          normalized.pop();
        } else normalized.push(part);
      }
      candidate = normalized.join("/");
    } else {
      const shape = packageShape(specifier);
      if (shape === "invalid")
        return diagnostic(request, "INVALID_SPECIFIER", position, undefined);
      const scoped = grants.get(importer.packageId);
      const target = scoped === undefined ? undefined : scoped.get(specifier);
      if (target === undefined)
        return diagnostic(
          request,
          shape === "deep" ? "DEEP_IMPORT" : "UNDECLARED_IMPORT",
          position,
          undefined,
        );
      candidate = target;
    }
    const target = modules.get(candidate);
    if (target === undefined)
      return diagnostic(request, "MISSING_MODULE", position, candidate);
    if (relative && target.packageId !== importer.packageId)
      return diagnostic(request, "CROSS_PACKAGE_IMPORT", position, candidate);
    return {
      ok: true,
      value: {
        importer: request.importer,
        target: candidate,
        kind: request.kind,
      },
    };
  }
  return { ok: true, value: { resolve } };
}
