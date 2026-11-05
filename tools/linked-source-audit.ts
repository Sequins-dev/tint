import { emitDarwinModule } from "./aarch64-executable.ts";
import { bindingIdentifiers } from "@tint/typescript/syntax";
import { runtimeSources } from "@tint/compiler/cli";
import type { RuntimeSource } from "@tint/compiler/native";
import { prepareCollectionRuntimes } from "@tint/ts-native/runtime";
import {
  lowerModuleEntries,
  collectRuntimeRequirements,
  type ModuleEntryOptions,
} from "@tint/ts-native/closure/lowering";

import { bindModule } from "@tint/typescript/binding";
import type { Catalog } from "@tint/source/catalog";
import {
  createResolver,
  type ImportMapping,
  type ModuleSource,
} from "@tint/source/resolver";
import {
  parseModule,
  type Span,
  type ImportDeclaration,
  type Statement,
} from "@tint/typescript/syntax";
import {
  linkModules,
  locateSource,
  specializeModule,
  prepareModuleInstance,
  prepareNativeGlobals,
} from "@tint/ts-native/modules";
import type { SourceModule } from "@tint/typescript/modules/model";
import { checkClosureModule } from "@tint/typescript/checker";

/** Match native runtime retention by actual provider imports, independently of
 * physical package ownership. Type-only dependencies contribute declarations too. */
export function retainedRuntimeModuleIds(
  inputs: readonly SourceModule[],
  providers: readonly string[],
): ReadonlySet<string> {
  const retained = new Set<string>(),
    queue = providers.slice(),
    byId = new Map(inputs.map((input) => [input.id, input]));
  for (let index = 0; index < queue.length; index++) {
    const id = queue[index];
    if (id === undefined || retained.has(id)) continue;
    retained.add(id);
    const source = byId.get(id);
    if (source === undefined) continue;
    for (const declaration of source.module.imports) {
      if (declaration === undefined) throw "runtime audit import invariant";
      const dependency = source.dependencies.get(declaration.specifier);
      if (dependency !== undefined) queue.push(dependency);
    }
  }
  return retained;
}

/** Diagnostic graph audit: successful checking is not native execution or self-hosting. */
export function auditLinkedSources(
  catalog: Catalog<ModuleSource>,
  mappings: readonly ImportMapping[],
  entry: string,
  options?: {
    readonly specialize?: boolean;
    readonly emit?: boolean;
    readonly runtime?: boolean;
    readonly instance?: boolean;
    /** Explicit provider locations for a captured or remapped graph. */
    readonly runtimeProviders?: readonly Pick<
      RuntimeSource,
      "module" | "namespace"
    >[];
  },
) {
  const modules: string[] = [],
    inputs: SourceModule[] = [];
  const resolver = createResolver(catalog, mappings);
  if (!resolver.ok) throw new Error(JSON.stringify(resolver.error));
  function diagnostic(file: string, span: Span, message: string) {
    const source = catalog.lookup(file);
    const position = source.found
      ? source.value.source.positionAt(span.start)
      : undefined;
    return {
      file,
      ...span,
      message,
      position: position?.ok ? position.value : undefined,
    };
  }
  let failure:
    | { stage: "parse" | "resolve"; diagnostic: ReturnType<typeof diagnostic> }
    | undefined;
  // Select logical contracts from shared explicit provider declarations. Physical
  // ownership may be shared by unrelated source modules after consolidation.
  const helperNamespaces = new Set([
    "number-list",
    "linked-map",
    "sparse-list",
    "linked-set",
    "primitive-value",
    "number-text",
    "indexed-sort",
    "list-sort",
    "text-encoding",
  ]);
  const availableProviders = (
    options?.runtimeProviders ?? runtimeSources()
  ).filter(
    (provider) =>
      helperNamespaces.has(provider.namespace) &&
      catalog.lookup(provider.module).found,
  );
  const encodingAvailable = availableProviders.some(
    (provider) => provider.namespace === "text-encoding",
  );
  const providers = options?.runtime
    ? availableProviders
    : options?.specialize
      ? availableProviders.filter(
          (provider) => provider.namespace === "text-encoding",
        )
      : [];
  const runtimeNamespacesByModule = new Map<string, string>(),
    namespaces = new Set<string>();
  for (const provider of providers) {
    if (
      runtimeNamespacesByModule.has(provider.module) ||
      namespaces.has(provider.namespace)
    )
      throw Error("duplicate runtime audit provider or namespace");
    runtimeNamespacesByModule.set(provider.module, provider.namespace);
    namespaces.add(provider.namespace);
  }
  const runtimePaths = providers.map((provider) => provider.module);
  const pending = [entry, ...runtimePaths],
    seen = new Set<string>();
  for (let index = 0; index < pending.length; index++) {
    const file = pending[index]!;
    if (seen.has(file)) continue;
    seen.add(file);
    modules.push(file);
    const source = catalog.lookup(file);
    if (!source.found) {
      failure ??= {
        stage: "resolve",
        diagnostic: diagnostic(
          file,
          { start: 0, end: 0 },
          "entry module is missing",
        ),
      };
      continue;
    }
    const parsed = parseModule(source.value.source);
    if (!parsed.ok) {
      failure ??= {
        stage: "parse",
        diagnostic: diagnostic(file, parsed.error, parsed.error.message),
      };
      continue;
    }
    const dependencies = new Map<string, string>();
    for (const request of parsed.value.imports) {
      const resolved = resolver.value.resolve({
        importer: file,
        specifier: request.specifier,
        kind: request.typeOnly ? "type" : "runtime",
        start: request.specifierSpan.start,
        end: request.specifierSpan.end,
      });
      if (!resolved.ok) {
        failure ??= {
          stage: "resolve",
          diagnostic: diagnostic(
            file,
            request.specifierSpan,
            resolved.error.code + ": " + request.specifier,
          ),
        };
        continue;
      }
      dependencies.set(request.specifier, resolved.value.target);
      pending.push(resolved.value.target);
    }
    inputs.push({ id: file, module: parsed.value, dependencies });
  }
  const base = {
    entry,
    modules,
    selfHosted: false,
    specializations: 0,
    specializationRequested:
      options?.specialize === true || options?.runtime === true,
    emissionRequested: options?.emit === true || options?.runtime === true,
    runtimeRequested: options?.runtime === true,
    scope:
      "Reachable source graph using Tint resolution, parsing, linking and contextual checking. Type-only imports contribute declarations, not runtime function bodies. No execution. Native emission is attempted only when requested.",
  };
  if (failure) return { ...base, ...failure };
  let linkEntry = entry;
  if (runtimePaths.length > 0) {
    linkEntry = "@tint/runtime-audit-entry";
    const imports: ImportDeclaration[] = [entry, ...runtimePaths].map(
      (specifier) => ({
        specifier,
        specifierSpan: { start: 0, end: 0 },
        bindings: [],
        typeOnly: false,
        start: 0,
        end: 0,
      }),
    );
    const statements: Statement[] = imports.map((declaration) => ({
      kind: "import",
      declaration,
      start: 0,
      end: 0,
    }));
    inputs.push({
      id: linkEntry,
      module: { statements, imports, start: 0, end: 0 },
      dependencies: new Map(imports.map((i) => [i.specifier, i.specifier])),
    });
  }
  const linked = linkModules(
    inputs,
    linkEntry,
    [
      "undefined",
      "NaN",
      "Infinity",
      "Array",
      "Boolean",
      "String",
      "Number",
      "Math",
      "Map",
      "Set",
      "Uint8Array",
      "Uint16Array",
      "Uint32Array",
      "Float64Array",
      "ArrayBuffer",
      "DataView",
      "TextEncoder",
      "TextDecoder",
      "TypeError",
      "RangeError",
    ],
    { evaluation: "instance" },
  );
  if (!linked.ok)
    return {
      ...base,
      stage: "link",
      diagnostic: diagnostic(
        linked.error.module,
        linked.error,
        linked.error.message,
      ),
    };
  const helpers = new Map<string, string>();
  for (const exported of linked.value.exports) {
    const namespace = runtimeNamespacesByModule.get(exported.module);
    if (namespace !== undefined && exported.namespace === "value")
      helpers.set(namespace + ":" + exported.name, exported.linkedName);
  }
  const retainedRuntimeModules = retainedRuntimeModuleIds(inputs, runtimePaths);
  let normalizedModule = linked.value.module;
  let checkedModule = normalizedModule;
  if (options?.specialize || options?.runtime) {
    const bound = bindModule(checkedModule, [
      "undefined",
      "NaN",
      "Infinity",
      "Array",
      "Boolean",
      "String",
      "Number",
      "Math",
      "Map",
      "Set",
      "Uint8Array",
      "Uint16Array",
      "Uint32Array",
      "Float64Array",
      "TextEncoder",
      "TextDecoder",
      "TypeError",
      "RangeError",
    ]);
    if (!bound.ok)
      return {
        ...base,
        stage: "bind",
        diagnostic: diagnostic(entry, bound.error, bound.error.message),
      };
    if (options?.runtime || encodingAvailable) {
      const constructors = ["TextEncoder", "TextDecoder"].flatMap((name) => {
        const factory = helpers.get("text-encoding:createNative" + name);
        return factory === undefined ? [] : [{ global: name, factory }];
      });
      const normalized = prepareNativeGlobals(
        checkedModule,
        bound.value,
        constructors,
      );
      if (!normalized.ok)
        return {
          ...base,
          stage: "globals",
          diagnostic: { message: normalized.error },
        };
      normalizedModule = normalized.value;
      checkedModule = normalized.value;
    }
    const rebound = bindModule(checkedModule, [
      "undefined",
      "NaN",
      "Infinity",
      "Array",
      "Boolean",
      "String",
      "Number",
      "Math",
      "Map",
      "Set",
      "Uint8Array",
      "Uint16Array",
      "Uint32Array",
      "Float64Array",
      "ArrayBuffer",
      "DataView",
      "TextEncoder",
      "TextDecoder",
      "TypeError",
      "RangeError",
    ]);
    if (!rebound.ok)
      return {
        ...base,
        stage: "bind",
        diagnostic: diagnostic(entry, rebound.error, rebound.error.message),
      };
    const specialized = specializeModule(checkedModule, rebound.value, {
      maxSpecializations: 4096,
    });
    if (!specialized.ok) {
      const location = locateSource(linked.value, specialized.error);
      return {
        ...base,
        stage: "specialize",
        diagnostic: diagnostic(
          location?.module ?? entry,
          location ?? specialized.error,
          specialized.error.message,
        ),
      };
    }
    checkedModule = specialized.value.module;
    base.specializations = specialized.value.specializations.length;
  }
  const checked = checkClosureModule(checkedModule);
  if (!checked.ok) {
    const location = locateSource(linked.value, checked.error);
    return {
      ...base,
      stage: "check",
      diagnostic: diagnostic(
        location?.module ?? entry,
        location ?? checked.error,
        checked.error.message,
      ),
    };
  }
  let nativeChecked = checked.value;
  let runtimeOptions: ModuleEntryOptions | undefined;
  if (options?.runtime) {
    const prepared = prepareCollectionRuntimes(
      normalizedModule,
      checked.value,
      helpers,
      [
        "undefined",
        "NaN",
        "Infinity",
        "Number",
        "String",
        "Math",
        "Map",
        "Set",
        "Uint8Array",
        "Uint16Array",
        "Uint32Array",
        "Float64Array",
        "TextEncoder",
        "TextDecoder",
        "TypeError",
        "RangeError",
      ],
      options?.instance
        ? (module) => {
            const retained: string[] = [];
            for (const statement of module.statements) {
              const origin = locateSource(linked.value, statement);
              if (
                origin === undefined ||
                !retainedRuntimeModules.has(origin.module)
              )
                continue;
              if (statement.kind === "function") retained.push(statement.name);
              else if (statement.kind === "variable")
                for (const declaration of statement.declarations)
                  for (const identifier of bindingIdentifiers(declaration))
                    retained.push(identifier.name);
            }
            const exports = linked.value.exports
              .filter(
                (item) =>
                  item.module === entry &&
                  item.namespace === "value" &&
                  module.statements.some(
                    (s) => s.kind === "function" && s.name === item.linkedName,
                  ),
              )
              .map((item) => ({ name: item.name, local: item.linkedName }));
            const bound = bindModule(module, [
              "undefined",
              "NaN",
              "Infinity",
              "Number",
              "String",
              "Math",
              "Map",
              "Set",
              "Uint8Array",
              "Uint16Array",
              "Uint32Array",
              "Float64Array",
              "TextEncoder",
              "TextDecoder",
              "TypeError",
              "RangeError",
            ]);
            if (!bound.ok) return { ok: false, error: bound.error.message };
            const initialized = prepareModuleInstance(
              module,
              bound.value,
              exports,
              retained,
            );
            return initialized.ok
              ? { ok: true, value: initialized.value.module }
              : initialized;
          }
        : undefined,
    );
    if (!prepared.ok)
      return {
        ...base,
        stage: "runtime",
        checkedFunctions: checked.value.bindings.functions.length,
        runtimeRequirements: collectRuntimeRequirements(checked.value),
        unsupportedRuntimeTypes: collectRuntimeRequirements(
          checked.value,
        ).unsupported.map((item) => ({
          ...item,
          contract: checked.value.types[item.type],
          element: (() => {
            const type = checked.value.types[item.type];
            return type?.kind === "array" || type?.kind === "set"
              ? checked.value.types[type.element]
              : type?.kind === "map"
                ? {
                    key: checked.value.types[type.key],
                    value: checked.value.types[type.value],
                  }
                : undefined;
          })(),
        })),
        diagnostic: {
          file: undefined,
          position: undefined,
          message: prepared.error,
        },
      };
    nativeChecked = prepared.value.checked;
    runtimeOptions = prepared.value.options;
  }
  if (options?.emit || options?.runtime) {
    const requirements = collectRuntimeRequirements(nativeChecked);
    const lowered = lowerModuleEntries(
      nativeChecked,
      nativeChecked.bindings.functions
        .filter((fn) => fn.parent === undefined)
        .map((fn) => fn.id),
      {
        pointerSize: 8,
        wordSize: 8,
        allocationAlignment: 16,
        frameAlignment: 16,
        maxAlignment: 16,
      },
      4096,
      runtimeOptions,
    );
    if (!lowered.ok) {
      const sourceMatch = /\(source (\d+):(\d+)\)/.exec(lowered.error);
      const sourceSpan =
        sourceMatch === null
          ? undefined
          : { start: Number(sourceMatch[1]), end: Number(sourceMatch[2]) };
      const sourceLocation =
        sourceSpan === undefined
          ? undefined
          : locateSource(linked.value, sourceSpan);
      const match = /\(type (\d+)\)/.exec(lowered.error);
      const id = match === null ? undefined : Number(match[1]);
      const type = id === undefined ? undefined : nativeChecked.types[id];
      return {
        ...base,
        stage: "lower",
        runtimeRequirements: requirements,
        checkedFunctions: nativeChecked.bindings.functions.length,
        diagnostic: {
          file: undefined,
          position: undefined,
          message: lowered.error,
          source: sourceLocation,
        },
        ...(id === undefined
          ? {}
          : {
              unsupportedType: {
                id,
                type,
                properties:
                  type?.kind === "object"
                    ? type.properties.map((p) => ({
                        ...p,
                        contract: nativeChecked.types[p.type],
                      }))
                    : undefined,
                members:
                  type?.kind === "union"
                    ? type.members.map((member) => ({
                        id: member,
                        type: nativeChecked.types[member],
                        properties: (() => {
                          const t = nativeChecked.types[member];
                          return t?.kind === "object"
                            ? t.properties.map((p) => ({
                                ...p,
                                contract: nativeChecked.types[p.type],
                              }))
                            : undefined;
                        })(),
                      }))
                    : undefined,
              },
            }),
      };
    }
    const emitted = emitDarwinModule(lowered.value.module);
    if (!emitted.ok)
      return {
        ...base,
        stage: "emit",
        checkedFunctions: nativeChecked.bindings.functions.length,
        diagnostic: { ...emitted.error, file: undefined, position: undefined },
      };
    return {
      ...base,
      stage: "emitted",
      checkedFunctions: nativeChecked.bindings.functions.length,
      emittedFunctions: lowered.value.module.functions.length,
      nativeByteLength: emitted.value.code.length,
      maximumFrameBytes: Math.max(
        ...emitted.value.functions.map((fn) => fn.frameBytes),
      ),
    };
  }
  return {
    ...base,
    stage: "checked",
    checkedFunctions: checked.value.bindings.functions.length,
  };
}
