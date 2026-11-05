import {
  canonicalModuleRequest,
  moduleRequestsEqual,
  type SourceModuleShape,
  type ModuleRequest,
  type ImportEntry,
  type LocalExportEntry,
  type IndirectExportEntry,
} from "@tint/foundation/modules";
import {
  bindingIdentifiers,
  type Module,
  type Span,
  type ImportDeclaration,
} from "@tint/typescript/syntax";
/** Linkage metadata only. The shared execution lowerer determines suspension
 * while visiting module code, without treating nested async bodies as TLA. */
interface ModuleLinkageShape {
  readonly requests: SourceModuleShape["requests"];
  readonly imports: SourceModuleShape["imports"];
  readonly localExports: SourceModuleShape["localExports"];
  readonly indirectExports: SourceModuleShape["indirectExports"];
  readonly starExports: SourceModuleShape["starExports"];
}
export type ModuleShapeResult =
  | { readonly ok: true; readonly value: ModuleLinkageShape }
  | { readonly ok: false; readonly error: Span & { readonly message: string } };
function unsupported(span: Span, message: string): ModuleShapeResult {
  return { ok: false, error: { start: span.start, end: span.end, message } };
}
/** ParseModule's request and export normalization, before runtime loading. */
export function sourceModuleShape(module: Module): ModuleShapeResult {
  const requests: ModuleRequest[] = [],
    imports: ImportEntry[] = [],
    localExports: LocalExportEntry[] = [],
    indirectExports: IndirectExportEntry[] = [],
    starExports: number[] = [];
  function requestIndex(declaration: ImportDeclaration): number {
    const request = canonicalModuleRequest({
      specifier: declaration.specifier,
      attributes: declaration.attributes ?? [],
    });
    for (let index = 0; index < requests.length; index++) {
      const known = requests[index];
      if (known === undefined) throw "MODULE_REQUEST_INVARIANT";
      if (moduleRequestsEqual(known, request)) return index;
    }
    requests.push(request);
    return requests.length - 1;
  }
  for (const declaration of module.imports) {
    if (declaration === undefined) throw "MODULE_SHAPE_INPUT_INVARIANT";
    if (declaration.phase !== undefined)
      return unsupported(
        declaration,
        "import phases require their proposal slice",
      );
    if (declaration.typeOnly)
      return unsupported(
        declaration,
        "type-only imports require TypeScript module lowering",
      );
    requestIndex(declaration);
  }
  const imported = new Map<string, ImportEntry>();
  for (const statement of module.statements) {
    if (statement === undefined) throw "MODULE_SHAPE_INPUT_INVARIANT";
    if (statement.kind !== "import") continue;
    const declaration = statement.declaration;
    for (const binding of declaration.bindings) {
      if (binding === undefined) throw "MODULE_SHAPE_INPUT_INVARIANT";
      if (binding.typeOnly)
        return unsupported(
          declaration,
          "type-only imports require TypeScript module lowering",
        );
      const entry: ImportEntry = {
        request: requestIndex(declaration),
        importName: binding.namespace ? undefined : binding.imported,
        localName: binding.local,
      };
      imports.push(entry);
      imported.set(binding.local, entry);
    }
  }
  for (const statement of module.statements) {
    if (statement === undefined) throw "MODULE_SHAPE_INPUT_INVARIANT";
    switch (statement.kind) {
      case "variable":
        if (statement.exported)
          for (const declaration of statement.declarations) {
            if (declaration === undefined) throw "MODULE_SHAPE_INPUT_INVARIANT";
            for (const identifier of bindingIdentifiers(declaration)) {
              if (identifier === undefined)
                throw "MODULE_SHAPE_INPUT_INVARIANT";
              localExports.push({
                exportName: identifier.name,
                localName: identifier.name,
              });
            }
          }
        break;
      case "function":
      case "class":
        if (statement.exported)
          localExports.push({
            exportName: statement.name,
            localName: statement.name,
          });
        break;
      case "export-default": {
        const value = statement.value;
        const localName =
          statement.declaration && value.kind === "function-expression"
            ? (value.name ?? "*default*")
            : statement.declaration && value.kind === "class-expression"
              ? (value.definition.name ?? "*default*")
              : "*default*";
        localExports.push({ exportName: "default", localName });
        break;
      }
      case "interface":
      case "type-alias":
        return unsupported(
          statement,
          "TypeScript declarations require TypeScript module lowering",
        );
      case "export": {
        const declaration = statement.declaration;
        if (declaration.typeOnly)
          return unsupported(
            declaration,
            "type-only exports require TypeScript module lowering",
          );
        const source = declaration.source;
        if (declaration.bindings === undefined) {
          if (source === undefined) throw "MODULE_SHAPE_INPUT_INVARIANT";
          starExports.push(requestIndex(source));
          break;
        }
        for (const binding of declaration.bindings) {
          if (binding === undefined) throw "MODULE_SHAPE_INPUT_INVARIANT";
          if (binding.typeOnly)
            return unsupported(
              declaration,
              "type-only exports require TypeScript module lowering",
            );
          if (source !== undefined)
            indirectExports.push({
              exportName: binding.exported,
              request: requestIndex(source),
              importName: binding.namespace ? undefined : binding.local,
            });
          else {
            const entry = imported.get(binding.local);
            if (entry === undefined)
              localExports.push({
                exportName: binding.exported,
                localName: binding.local,
              });
            else
              indirectExports.push({
                exportName: binding.exported,
                request: entry.request,
                importName: entry.importName,
              });
          }
        }
        break;
      }
    }
  }
  return {
    ok: true,
    value: {
      requests,
      imports,
      localExports,
      indirectExports,
      starExports,
    },
  };
}
