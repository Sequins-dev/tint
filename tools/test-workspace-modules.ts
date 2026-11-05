import type { SourceModule } from "@tint/typescript/modules/model";
import { workspaceModules, workspaceSources } from "./workspace-sources.ts";

const snapshot = workspaceSources();

/** Load test runtime fixtures through the real package grants and transitive
 * imports. Short module IDs are fixture-local provider paths; runtime helper
 * namespaces are separate explicit compiler-request contracts. */
export function testWorkspaceModules(
  packages: readonly string[],
  transform?: (text: string, module: string) => string,
  locations: ReadonlyMap<string, string> = new Map(),
): SourceModule[] {
  locations = new Map([
    ...textFixtureLocations,
    ...nativeFixtureLocations,
    ...locations,
  ]);
  function shortId(id: string): string {
    const explicit = [...locations].find(([, path]) => path === id);
    if (explicit !== undefined) return explicit[0];
    return id
      .replace(/^packages\//, "")
      .replace(/\/src\//, "/")
      .replace(/\.ts$/, "")
      .replace(/\/index$/, "");
  }
  const sources =
    transform === undefined
      ? snapshot
      : {
          mappings: snapshot.mappings,
          inputs: snapshot.inputs.map((input) => ({
            ...input,
            bytes: new TextEncoder().encode(
              transform(
                new TextDecoder().decode(input.bytes),
                shortId(input.id),
              ),
            ),
          })),
        };
  return workspaceModules(
    packages.map(
      (name) => locations.get(name) ?? "packages/" + name + "/src/index.ts",
    ),
    sources,
  ).map((module) => ({
    ...module,
    id: shortId(module.id),
    dependencies: new Map(
      [...module.dependencies].map(([specifier, target]) => [
        specifier,
        shortId(target),
      ]),
    ),
  }));
}

/** Explicit fixture aliases preserve local request identities while providers move. */
export const collectionFixtureLocations: ReadonlyMap<string, string> = new Map([
  ["key-index", "packages/foundation/src/collections/key-index.ts"],
  ["linked-map", "packages/foundation/src/collections/linked-map.ts"],
  ["linked-set", "packages/foundation/src/collections/linked-set.ts"],
  ["sparse-list", "packages/foundation/src/collections/sparse-list.ts"],
  ["number-list", "packages/foundation/src/collections/number-list.ts"],
  ["indexed-sort", "packages/foundation/src/collections/indexed-sort.ts"],
  ["list-sort", "packages/foundation/src/collections/list-sort.ts"],
]);

/** Numeric provider aliases are fixture-local identities, separate from imports. */
export const numericFixtureLocations: ReadonlyMap<string, string> = new Map([
  ["big-integer", "packages/foundation/src/numeric/big-integer.ts"],
  ["integer-rounding", "packages/foundation/src/numeric/integer-rounding.ts"],
  ["exact-sum", "packages/foundation/src/numeric/exact-sum.ts"],
  ["number-text", "packages/foundation/src/numeric/number-text/index.ts"],
  [
    "binary64-trigonometry",
    "packages/foundation/src/numeric/binary64-trigonometry/index.ts",
  ],
]);

/** Text fixture IDs preserve runtime namespaces independently of ownership. */
export const textFixtureLocations: ReadonlyMap<string, string> = new Map([
  ["text-scanner", "packages/foundation/src/text/text-scanner.ts"],
  ["string-builder", "packages/foundation/src/text/string-builder.ts"],
  ["text-encoding", "packages/foundation/src/text/text-encoding/index.ts"],
  ["base-encoding", "packages/foundation/src/text/base-encoding/index.ts"],
  ["json-syntax", "packages/foundation/src/text/json-syntax.ts"],
]);

/** Strict value-helper namespace stays stable when its provider changes owner. */
const nativeFixtureLocations: ReadonlyMap<string, string> = new Map([
  ["primitive-value", "packages/native-runtime/src/values/index.ts"],
]);
