import { loadedModule, type ModuleRecord } from "./records.ts";
export interface ResolvedBinding {
  readonly module: ModuleRecord;
  /** undefined denotes the module namespace rather than a local binding. */
  readonly bindingName: string | undefined;
}
export type ExportResolution = ResolvedBinding | "ambiguous" | undefined;
interface ResolveVisit {
  readonly module: ModuleRecord;
  readonly exportName: string;
}

/** ECMA-262 GetExportedNames: preserve discovery order; namespaces sort separately. */
export function getExportedNames(
  module: ModuleRecord,
  visited: ModuleRecord[] = [],
): string[] {
  if (module.status === "new") throw "MODULE_LOADED_INVARIANT";
  if (module.synthetic)
    return module.shape.localExports.map((entry) => {
      if (entry === undefined) throw "MODULE_SHAPE_INVARIANT";
      return entry.exportName;
    });
  for (const previous of visited) if (previous === module) return [];
  visited.push(module);
  const names: string[] = [];
  const seen = new Set<string>();
  for (const entry of module.shape.localExports) {
    if (entry === undefined) throw "MODULE_SHAPE_INVARIANT";
    if (!seen.has(entry.exportName)) {
      seen.add(entry.exportName);
      names.push(entry.exportName);
    }
  }
  for (const entry of module.shape.indirectExports) {
    if (entry === undefined) throw "MODULE_SHAPE_INVARIANT";
    if (!seen.has(entry.exportName)) {
      seen.add(entry.exportName);
      names.push(entry.exportName);
    }
  }
  for (const request of module.shape.starExports) {
    if (request === undefined) throw "MODULE_SHAPE_INVARIANT";
    for (const name of getExportedNames(
      loadedModule(module, request),
      visited,
    )) {
      if (name === undefined) throw "MODULE_SHAPE_INVARIANT";
      if (name !== "default" && !seen.has(name)) {
        seen.add(name);
        names.push(name);
      }
    }
  }
  return names;
}

/** ResolveExport shares the visited (module, name) list across star branches. */
export function resolveExport(
  module: ModuleRecord,
  exportName: string,
  visited: ResolveVisit[] = [],
): ExportResolution {
  if (module.status === "new") throw "MODULE_LOADED_INVARIANT";
  if (module.synthetic) {
    for (const entry of module.shape.localExports) {
      if (entry === undefined) throw "MODULE_SHAPE_INVARIANT";
      if (entry.exportName === exportName)
        return { module, bindingName: entry.localName };
    }
    return undefined;
  }
  for (const previous of visited) {
    if (previous === undefined) throw "MODULE_SHAPE_INVARIANT";
    if (previous.module === module && previous.exportName === exportName)
      return undefined;
  }
  visited.push({ module, exportName });
  for (const entry of module.shape.localExports) {
    if (entry === undefined) throw "MODULE_SHAPE_INVARIANT";
    if (entry.exportName === exportName)
      return { module, bindingName: entry.localName };
  }
  for (const entry of module.shape.indirectExports) {
    if (entry === undefined) throw "MODULE_SHAPE_INVARIANT";
    if (entry.exportName !== exportName) continue;
    const target = loadedModule(module, entry.request);
    if (entry.importName === undefined)
      return { module: target, bindingName: undefined };
    return resolveExport(target, entry.importName, visited);
  }
  if (exportName === "default") return undefined;
  let found: ResolvedBinding | undefined = undefined;
  for (const request of module.shape.starExports) {
    if (request === undefined) throw "MODULE_SHAPE_INVARIANT";
    const candidate = resolveExport(
      loadedModule(module, request),
      exportName,
      visited,
    );
    if (typeof candidate === "string") return "ambiguous";
    if (candidate === undefined) continue;
    if (found === undefined) found = candidate;
    else if (
      found.module !== candidate.module ||
      found.bindingName !== candidate.bindingName
    )
      return "ambiguous";
  }
  return found;
}
