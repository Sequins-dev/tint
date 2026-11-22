import assert from "node:assert/strict";
import {
  capturedPublicEntry,
  capturedModuleExports,
} from "./captured-module-exports.ts";
import {
  scriptRuntimeImports,
  scriptRuntimeSurface,
} from "@tint/js-engine/lowering";
import { linkModules } from "@tint/ts-native/modules";
import type {
  ManagedSurfaceRequest,
  ManagedSurfaceSelection,
} from "@tint/compiler/native";
import {
  type WorkspaceSourceSnapshot,
  workspaceModules,
} from "./workspace-sources.ts";
export const scriptEntryFrameModule =
  "packages/js-engine/src/native/script-entry.ts";
/** The marker belongs to the captured lowerer, so historical snapshots retain
 * their vocabulary even when these tools have newer runtime support. */
function capturedScriptRuntimeMarker(
  snapshot: WorkspaceSourceSnapshot | undefined,
  marker: string,
): boolean {
  if (snapshot === undefined) return true;
  const module = capturedPublicEntry(
    snapshot.publicEntries ?? snapshot.mappings,
    "@tint/js-engine/lowering",
  );
  return (
    module !== undefined &&
    capturedModuleExports(workspaceModules([module], snapshot))
      .get(module)
      ?.has(marker) === true
  );
}
export function capturedScriptDynamicImport(
  snapshot?: WorkspaceSourceSnapshot,
): boolean {
  return capturedScriptRuntimeMarker(
    snapshot,
    "scriptRuntimeSupportsDynamicImport",
  );
}
export function capturedScriptTemplateSites(
  snapshot?: WorkspaceSourceSnapshot,
): boolean {
  return capturedScriptRuntimeMarker(
    snapshot,
    "scriptRuntimeSupportsTemplateSites",
  );
}
export function capturedScriptLiteralTables(
  snapshot?: WorkspaceSourceSnapshot,
): boolean {
  return capturedScriptRuntimeMarker(
    snapshot,
    "scriptRuntimeSupportsLiteralTables",
  );
}
export function capturedScriptEngineAborts(
  snapshot?: WorkspaceSourceSnapshot,
): boolean {
  return capturedScriptRuntimeMarker(
    snapshot,
    "scriptRuntimeSupportsEngineAborts",
  );
}
export function capturedScriptCompactResults(
  snapshot?: WorkspaceSourceSnapshot,
): boolean {
  return capturedScriptRuntimeMarker(
    snapshot,
    "scriptRuntimeSupportsCompactResults",
  );
}
export function capturedScriptFusedResults(
  snapshot?: WorkspaceSourceSnapshot,
): boolean {
  return capturedScriptRuntimeMarker(
    snapshot,
    "scriptRuntimeSupportsFusedResults",
  );
}
export function capturedScriptRetainedFunctions(
  snapshot?: WorkspaceSourceSnapshot,
): boolean {
  return capturedScriptRuntimeMarker(
    snapshot,
    "scriptRuntimeSupportsRetainedFunctions",
  );
}
export const scriptRuntimeDependencies: readonly [string, string][] = [
  ["@tint/js-runtime/modules", "packages/js-runtime/src/modules/index.ts"],
  ["@tint/js-runtime/objects", "packages/js-runtime/src/objects/index.ts"],
  [
    "@tint/js-runtime/environments/global",
    "packages/js-runtime/src/environments/global/index.ts",
  ],
  [
    "@tint/js-runtime/environments/records",
    "packages/js-runtime/src/environments/records/index.ts",
  ],
];
export const scriptRuntimeGlobals = [
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
];
/** Classify the registry by actual export namespace, never import typeOnly flags. */
export function createScriptRuntimeRequest(
  bind: ManagedSurfaceRequest["bind"],
  frame = true,
  snapshot?: WorkspaceSourceSnapshot,
): ManagedSurfaceRequest {
  const dynamicImport = capturedScriptDynamicImport(snapshot),
    templateSites = capturedScriptTemplateSites(snapshot),
    compactResults = capturedScriptCompactResults(snapshot),
    literalTables = capturedScriptLiteralTables(snapshot),
    engineAborts = capturedScriptEngineAborts(snapshot),
    fusedResults = capturedScriptFusedResults(snapshot),
    retainedFunctions = capturedScriptRetainedFunctions(snapshot);
  const runtimeDependencies = scriptRuntimeDependencies.filter(
    ([specifier]) => dynamicImport || specifier !== "@tint/js-runtime/modules",
  );
  const modules = workspaceModules(
    runtimeDependencies.map((item) => item[1]),
    snapshot,
  );
  // These entries exist only in captures with the positional call or property
  // cache runtime. The normal linker still checks all required imports.
  const missingFastPaths = new Set<string>();
  if (snapshot !== undefined) {
    const objects = capturedModuleExports(modules).get(
      "packages/js-runtime/src/objects/index.ts",
    );
    for (const name of [
      "createRegisterSourceFunction",
      "callRegisterObjectValue",
      "createWideRegisterSourceFunction",
      "callWideRegisterObjectValue",
      "createScriptPropertyCache",
      "readCachedObjectValueProperty",
      "writeCachedObjectValueProperty",
      "scriptIsHTMLDDA",
      "looselyEqualOrThrow",
      "excludeHTMLDDAObjects",
      "cachedOwnPropertyValue",
      "cachedInheritedPropertyValue",
      "absentPropertyValue",
      "cachedPropertyStore",
      "propertySlotWord",
    ]) {
      if (!objects?.has(name)) missingFastPaths.add(name);
    }
    const global = capturedModuleExports(modules).get(
      "packages/js-runtime/src/environments/global/index.ts",
    );
    if (!global?.has("cachedGlobalIdentifierCell"))
      missingFastPaths.add("cachedGlobalIdentifierCell");
  }
  const imports = scriptRuntimeImports(
      { start: 0, end: 0 },
      true,
      true,
      true,
      "all",
      true,
      dynamicImport,
      false,
      true,
      false,
      templateSites,
      compactResults,
      false,
      false,
      literalTables,
      engineAborts,
      fusedResults,
      retainedFunctions,
    ).map((declaration) => ({
      ...declaration,
      bindings: declaration.bindings.filter(
        (binding) => !missingFastPaths.has(binding.imported),
      ),
    })),
    root = "$surface-kinds";
  const linked = linkModules(
    [
      ...modules,
      {
        id: root,
        module: {
          start: 0,
          end: 0,
          imports,
          statements: imports.map((declaration) => ({
            start: 0,
            end: 0,
            kind: "import",
            declaration,
          })),
        },
        dependencies: new Map(runtimeDependencies),
      },
    ],
    root,
    scriptRuntimeGlobals,
    { evaluation: "instance" },
  );
  assert.ok(linked.ok, JSON.stringify(linked));
  const dependencies = new Map(runtimeDependencies),
    values: ManagedSurfaceSelection[] = [],
    types: ManagedSurfaceSelection[] = [];
  for (const item of scriptRuntimeSurface(
    dynamicImport,
    templateSites,
    compactResults,
    literalTables,
    engineAborts,
    fusedResults,
    retainedFunctions,
  )) {
    if (missingFastPaths.has(item.name)) continue;
    const module = dependencies.get(item.specifier);
    assert.ok(module);
    const exported =
      linked.value.exports.find(
        (entry) =>
          entry.module === module &&
          entry.name === item.name &&
          entry.namespace === "value",
      ) ??
      linked.value.exports.find(
        (entry) =>
          entry.module === module &&
          entry.name === item.name &&
          entry.namespace === "type",
      );
    assert.ok(exported, item.name);
    const selection: ManagedSurfaceSelection = {
      module,
      name: item.name,
      typeArguments: item.typeArguments.map((argument) =>
        argument === "unknown"
          ? { kind: "keyword", name: "unknown" }
          : { kind: "export", name: argument },
      ),
    };
    (exported.namespace === "value" ? values : types).push(selection);
  }
  if (frame)
    types.push({
      module: scriptEntryFrameModule,
      name: "ScriptEntryFrame",
      typeArguments: [],
    });
  return {
    name: "scriptRuntime",
    values,
    types,
    ...(frame ? { frame: "ScriptEntryFrame" } : {}),
    bind,
  };
}
