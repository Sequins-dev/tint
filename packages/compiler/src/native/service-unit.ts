import {
  prepareManagedSurfaceEntry,
  type ManagedSurfaceEntryRequest,
  type PreparedManagedSurfaceEntry,
  type ManagedSurfaceEntryFailure,
} from "./managed-jit-entry.ts";
export interface NativeServiceUnit extends PreparedManagedSurfaceEntry {
  readonly version: 1;
  readonly profile: "managed-factory-v1";
  readonly factoryContract: string;
  readonly surface: {
    readonly name: string;
    readonly digest: string;
    readonly frame: string;
  };
}
export type NativeServiceCompilation =
  | { readonly ok: true; readonly value: NativeServiceUnit }
  | ManagedSurfaceEntryFailure;
/** Compile one managed factory. Module bindings are initialized inside each
 * invocation; returned closures retain that invocation's traced import frame.
 * The result contains symbolic imports and no context or process addresses. */
export function compileNativeServiceUnit(
  request: ManagedSurfaceEntryRequest,
): NativeServiceCompilation {
  const prepared = prepareManagedSurfaceEntry({
    ...request,
    initialization: "factory",
  });
  if (!prepared.ok) return prepared;
  const directory = request.read.directory;
  return {
    ok: true,
    value: {
      ...prepared.value,
      version: 1,
      profile: "managed-factory-v1",
      factoryContract:
        "tint.service.factory.v1/" + directory.name + "/" + directory.digest,
      surface: {
        name: directory.name,
        digest: directory.digest,
        frame: directory.frame ?? "",
      },
    },
  };
}
